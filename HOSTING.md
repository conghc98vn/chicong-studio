# Hosting và release ChiCong Studio

Hướng dẫn hiện hành ngày 30/10/2026. Production theo [biên bản cutover](docs/archive/r2-production-cutover-2026-10-21.md): **Cloudflare → Caddy trên VPS iNET → PM2/Node**, database **PostgreSQL Supabase**, media **R2 private**. Revision đang chạy, baseline và LIVE smoke được cập nhật tại [handbook](docs/handbook/README.md); runbook này mô tả quy trình áp dụng cho từng release.

## 1. Runtime và dữ liệu

Dùng Node 24 và `npm ci --omit=dev`; chạy `npm start` hoặc PM2 theo [ecosystem.config.cjs](ecosystem.config.cjs). PM2 chạy fork, nên kích hoạt release có gián đoạn ngắn. Caddy chuyển tiếp tới cổng Node, TLS/Cloudflare do cấu hình máy chủ quản lý. Giữ cổng Node chỉ tiếp cận từ proxy được tin cậy.

| Cấu hình | Yêu cầu |
|---|---|
| `NODE_ENV` | `production` |
| `SITE_URL` | Origin HTTPS chuẩn, ví dụ `https://chicongphoto.vn`; không path/query |
| `FREELANCER_HOST` | Host hồ sơ đối tác, mặc định `freelancer.chicongphoto.vn`; cần trỏ DNS về cùng service |
| `FREELANCER_PRICE_CODE` | Mã server-only để mở bảng giá đối tác; không commit vào repo |
| `FREELANCER_PRICE_SECRET` | Chuỗi server-only tùy chọn dùng để làm mã phiên báo giá; đổi chuỗi sẽ thu hồi phiên cũ |
| `DATABASE_URL` | PostgreSQL đúng project/schema, TLS xác thực hostname/CA |
| `NODE_EXTRA_CA_CERTS` | Nếu cần CA Supabase: đường dẫn tuyệt đối tới certificate đã đối chiếu, đặt trước lúc Node khởi động |
| `MEDIA_STORAGE_PROVIDER` | `r2` theo production hiện hành; phải khớp binding DB |
| `R2_ENDPOINT`, `R2_BUCKET` | Endpoint tài khoản và bucket private đã tạo |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Credential phía server, giới hạn đúng bucket và quyền cần thiết |
| `TRUST_PROXY` | Địa chỉ/CIDR proxy hoặc số hop đã xác minh; không dùng `true` |
| `PORT`, `HOST` | Khớp Caddy/PM2; không coi default `0.0.0.0` là firewall |
| `SETUP_TOKEN` | Cần khi tạo admin đầu tiên; không có tài khoản/mật khẩu mặc định |
| `FEEDBACK_LINK_SECRET` | Khóa base64url chứa ít nhất 32 byte ngẫu nhiên, riêng từng môi trường, ổn định qua restart và giống nhau trên mọi web instance; giữ trong vault ngoài snapshot |
| `FEEDBACK_API_PAUSED`, `FEEDBACK_NOTIFICATIONS_PAUSED`, `INQUIRY_NOTIFICATIONS_PAUSED` | Đặt các cờ liên quan thành `true` khi bảo trì/restore; restart mọi web instance để áp dụng |

Repo giữ CA công khai `certs/supabase-root-2021.crt`. Kiểm tính hợp lệ/expiry theo chứng chỉ thực tế; không tắt TLS verification để xử lý lỗi kết nối. `NODE_EXTRA_CA_CERTS` không có tác dụng nếu chỉ đặt muộn trong file do ứng dụng tự đọc.

R2 runtime không cần service-role Supabase Storage. Bucket phải giữ private, không bật r2.dev/custom media domain để bỏ qua backend. Runtime kiểm HeadBucket và binding, không thay thao tác kiểm public-access trên dashboard.

Web và worker dùng cùng database/storage identity. Không đổi provider/bucket/endpoint bằng env đơn thuần: startup từ chối binding sai. Supabase Storage còn là adapter tương thích và kho nguồn rollback theo report, không phải nơi ghi ảnh mới hiện hành.

### Hồ sơ đối tác `freelancer.chicongphoto.vn`

Hồ sơ freelancer chạy trong cùng Node service và dùng chung database/media. Tạo bản ghi DNS cho `freelancer.chicongphoto.vn` trỏ về cùng Cloudflare/Caddy/VPS như `chicongphoto.vn`, đặt `FREELANCER_HOST` đúng hostname và cấu hình `FREELANCER_PRICE_CODE` trong secret environment. Không đặt mã giá trong HTML, JavaScript, Git hoặc tài liệu chia sẻ. Website freelancer tự trả `noindex, nofollow`, không được thêm vào menu/footer hoặc sitemap của web chính.

Trang hồ sơ dùng link chia sẻ; ai có link đều có thể xem phần hồ sơ, các bộ ảnh đã chọn riêng, thiết bị, quy trình và lịch. Báo giá vẫn cần mã server-only. Bộ ảnh freelancer không tự lấy toàn bộ album công khai: vào `/admin#settings`, tích các bộ ảnh trong mục **Bộ ảnh dành cho đối tác**, rồi lưu. Album chưa tích sẽ không xuất hiện trên trang hoặc trang chi tiết freelancer. Sau khi cấu hình DNS/TLS, kiểm tra cả `https://freelancer.chicongphoto.vn/` và `https://chicongphoto.vn/`; host chính phải tiếp tục vào website hiện tại, host freelancer phải trả header `X-Robots-Tag: noindex, nofollow`, và nhập sai mã không được mở bảng giá.

Trong cùng phần cài đặt, nhập khu vực nhận chụp, thời gian phản hồi, trạng thái cập nhật và quy tắc booking ở phần nội dung chung; nhập thiết bị, báo giá, đơn vị tính, phụ phí và cam kết qua các nhóm biểu mẫu có nút **Thêm** / **Xóa**; máy chủ lưu các nhóm này dưới dạng JSON. Để trống thì trang dùng nội dung mặc định chờ cập nhật. Bảng giá chỉ được render sau khi máy chủ xác nhận mã; giá không nằm trong HTML của trang khóa và không được đưa vào JavaScript phía trình duyệt. Lịch freelancer hợp nhất ngày bận trong studio với ngày bận từ Google Calendar nếu Google Calendar đã được cấu hình.

## 2. Worker, backup và staging

Worker Drive là service riêng theo [scripts/systemd/chicong-drive.service](scripts/systemd/chicong-drive.service). Key service account chỉ ở worker, quyền file 0600, scope chỉ đọc; web không cần key này. Cả web/worker dùng `DRIVE_SYNC_ENABLED`; `DRIVE_SYNC_SCHEDULER_ENABLED` là cổng riêng và hiện tắt theo report. [Runbook Drive](docs/google-drive-sync-operations.md).

Backup runner có credential riêng, không dùng key service account nhập ảnh. Dump SQL theo [backup-db.sh](scripts/backup-db.sh) không chứa bytes R2. Workflow [media-backup.yml](.github/workflows/media-backup.yml) chạy thủ công; file workflow không chứng minh đã có lịch hoặc cảnh báo.

Script dump SQL chỉ công bố `db_*.sql.gz` sau khi `pg_dump` và kiểm tra gzip thành công; các lượt cùng giây có tên riêng. Tệp tạm được dọn khi lệnh lỗi hoặc nhận SIGINT/SIGTERM, quyền file là `0600`, thời hạn giữ bản cũ vẫn là 14 ngày. Mặc định đọc `/var/www/chicongphoto/.env` và ghi `/var/backups/chicongphoto`; có thể đặt `STUDIO_ENV_FILE` và `STUDIO_BACKUP_DIR` để diễn tập ở vị trí riêng. Test tự động dùng `pg_dump` giả và dữ liệu tổng hợp, không kết nối database thật.

Staging feedback dùng signing key riêng, mặc định `FEEDBACK_NOTIFICATIONS_PAUSED=true`, và chỉ dùng transport thử hoặc địa chỉ nhận thử đã được phép khi diễn tập email. Không sao chép khóa/link/customer snapshot production vào fixture. Staging dùng DB/schema/bucket/credential riêng, `SITE_INDEXING=false`, `ANALYTICS_ENABLED=false`, không mail/Calendar khách thật. `render.yaml` là cấu hình dự phòng/rehearsal nếu dùng lại Render, không phản ánh VPS. Hướng dẫn Render cũ và số liệu triển khai được giữ trong [lưu trữ](docs/archive/README.md).

## 3. Chuẩn bị và kích hoạt release

Trước tiên chạy kiểm tra source và QA trên database tạm theo [hướng dẫn](docs/handbook/03-phong-lab-qa.md). Giữ commit/diff của bản chuẩn bị, kết quả kiểm tra và revision rollback hiểu schema hiện tại.

```sh
npm run deploy:vps -- --help
npm run deploy:vps -- --stage
```

`--stage` kết nối SSH alias `chicong-vps` hoặc `VPS_HOST`, đóng gói source theo allowlist và cài dependency trong thư mục release riêng. Nó không đưa `.env`/ảnh/credential vào gói, không kích hoạt release, restart hay migration. Script từ chối chạy deploy không có `--stage`.

Kích hoạt do người vận hành thực hiện với cấu hình production rõ ràng:

1. Giữ source/config/service definition hiện tại và xác nhận phương án rollback. Bật `FEEDBACK_API_PAUSED`, `FEEDBACK_NOTIFICATIONS_PAUSED` và `INQUIRY_NOTIFICATIONS_PAUSED`, restart áp dụng trên mọi instance, kiểm API feedback trả 503 và drain cả hai dispatcher email; media lease không chặn ghi feedback hoặc gửi thư. Lấy maintenance lease, ngừng claim/schedule, drain writer/cleanup; dừng worker/runner cũ và xác minh đã thoát.
2. Dùng runtime hiện hành tương thích DB trước migration để chụp **DB + media baseline**, verify và giữ bản ngoài VPS; lease phải còn hiệu lực. Hết hạn không có nghĩa được bỏ khóa.
3. Dừng web sau khi writer đã drain. Giữ `.env` 0600, credential ngoài repo, data và quyền đọc module cho user worker; thay source từ release đã kiểm.
4. Khởi động một web instance với Drive tắt và các cờ feedback/inquiry vẫn pause để migration có một owner. Kiểm health, số lượng/invariant DB, public/private media và admin. Cập nhật worker/runner về cùng revision và binding; backup runner sau migration phải hiểu schema v4 gồm sáu bảng feedback và một bảng inquiry outbox. Runner v2/v3 không dùng để chụp DB sau khi các bảng mới được tạo.
5. Kiểm heartbeat, quyền người dùng worker, upload/đọc bằng fixture được phép, rồi bật nhập thủ công và unlock đúng lease. Giữ scheduler tắt trừ khi có kế hoạch riêng.
6. Xác nhận signing key riêng, sổ xóa độc lập và bản sao của sổ đã có người vận hành; kiểm feedback bằng hồ sơ thử được phép, chỉ mở API/mail sau nghiệm thu và restart áp dụng cờ. Kiểm album draft và retry/no-op theo runbook. Nếu thất bại, giữ writer dừng và dùng rollback tương thích. Không restore DB cũ đè lên dữ liệu khách đã được nhận sau release.

Chi tiết lease/recovery và lệnh chính xác nằm ở [runbook Drive](docs/google-drive-sync-operations.md#6-lỗi-dừng-và-phục-hồi) và `npm run media -- help`. Chuyển storage cần `lock → drain → backup/copy/verify → switch → restart mọi consumer → smoke → unlock`; giữ kho nguồn cho tới khi nghiệm thu xong. Có ảnh mới ở R2 thì rollback phải xử lý delta ngược dưới khóa.

**Rollback feedback/inquiry:** giữ database và runtime backup v4 tương thích; rollback UI không được làm mất revision/receipt/queue đã nhận. Gói `--stage` có module feedback/inquiry và công cụ vận hành nhưng không chứa tài liệu, signing key hoặc sổ xóa. Giữ runbook và sổ xóa riêng ngoài thư mục release. `npm run deploy:vps -- --help` tóm tắt các cờ pause và yêu cầu backup v4; dùng hướng dẫn này cho đầy đủ các bước kích hoạt. [Quy trình restore và khác biệt SQL dump](docs/handbook/02-van-hanh-bi-mat-va-khoi-phuc.md#36-feedback-snapshot-v3-và-phục-hồi-từ-sql-dump).

## 4. Kiểm tra sau release

- `/api/health` trả 200 và `{"ok":true}` chỉ xác nhận truy vấn DB; kiểm thêm ảnh public và gallery có mật khẩu bằng phiên khách.
- API admin phải trả 401 khi chưa đăng nhập; đổi mật khẩu gallery phải thu hồi quyền cũ. Public media dùng `private,no-cache`; private media dùng `private,no-store`; 304 vẫn phải qua kiểm quyền.
- Không cấu hình CDN ghi đè cache theo prefix `/media/*`: public/private dùng chung route. R2 private qua proxy không tự thành CDN cache.
- Kiểm upload/retry, JPEG/ZIP dùng được, lựa chọn khách, DB/media tồn tại sau restart và worker đúng revision/binding. Inquiry đã lưu không phụ thuộc email giao thành công.
- `/feedback/*` và `/api/feedback/*` phải giữ no-store/no-referrer/noindex qua Caddy/Cloudflare; kiểm không chèn analytics vào shell riêng. Kiểm link sai/thu hồi, bản nháp khi mất ACK, unread/history và job mail accepted sau restart bằng fixture. WebKit local không chứng minh Zalo/iOS/Android thật.
- Xem log lỗi và tuổi backup hoàn chỉnh, không chỉ trạng thái process. Bản vá xử lý mất kết nối PostgreSQL cả lúc pool rảnh và giữa transaction, giữ lỗi gốc nếu rollback thất bại, không tự chạy lại thao tác ghi chưa rõ kết quả. Inquiry đã lưu không phụ thuộc email giao thành công; dashboard phải còn nhìn thấy pending/retry/blocked/failed. Email recipient thật và full cloud restore vẫn là các cổng riêng.

## 5. Giới hạn nghiệm thu

Report 21/10 ghi đã chuyển 3.386 object sang R2, có backup ngoài VPS và restore offline. Chưa nghiệm thu full Supabase/cloud restore, reboot/kill worker giữa import, tải 500/5.000 JPEG thật, lịch backup media hoặc cảnh báo snapshot. Không thay các mục đó bằng kết quả unit test. [Bằng chứng và việc còn mở](docs/handbook/README.md).

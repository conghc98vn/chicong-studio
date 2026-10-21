# Hosting và release ChiCong Studio

Hướng dẫn hiện hành ngày 21/10/2026. Production theo [biên bản cutover](docs/archive/r2-production-cutover-2026-10-21.md): **Cloudflare → Caddy trên VPS iNET → PM2/Node**, database **PostgreSQL Supabase**, media **R2 private**. [Handbook](docs/handbook/README.md) phân biệt trạng thái đã báo cáo với kiểm tra mới.

## 1. Runtime và dữ liệu

Dùng Node 24 và `npm ci --omit=dev`; chạy `npm start` hoặc PM2 theo [ecosystem.config.cjs](ecosystem.config.cjs). PM2 chạy fork, nên kích hoạt release có gián đoạn ngắn. Caddy chuyển tiếp tới cổng Node, TLS/Cloudflare do cấu hình máy chủ quản lý. Giữ cổng Node chỉ tiếp cận từ proxy được tin cậy.

| Cấu hình | Yêu cầu |
|---|---|
| `NODE_ENV` | `production` |
| `SITE_URL` | Origin HTTPS chuẩn, ví dụ `https://chicongphoto.vn`; không path/query |
| `DATABASE_URL` | PostgreSQL đúng project/schema, TLS xác thực hostname/CA |
| `NODE_EXTRA_CA_CERTS` | Nếu cần CA Supabase: đường dẫn tuyệt đối tới certificate đã đối chiếu, đặt trước lúc Node khởi động |
| `MEDIA_STORAGE_PROVIDER` | `r2` theo production hiện hành; phải khớp binding DB |
| `R2_ENDPOINT`, `R2_BUCKET` | Endpoint tài khoản và bucket private đã tạo |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Credential phía server, giới hạn đúng bucket và quyền cần thiết |
| `TRUST_PROXY` | Địa chỉ/CIDR proxy hoặc số hop đã xác minh; không dùng `true` |
| `PORT`, `HOST` | Khớp Caddy/PM2; không coi default `0.0.0.0` là firewall |
| `SETUP_TOKEN` | Cần khi tạo admin đầu tiên; không có tài khoản/mật khẩu mặc định |

Repo giữ CA công khai `certs/supabase-root-2021.crt`. Kiểm tính hợp lệ/expiry theo chứng chỉ thực tế; không tắt TLS verification để xử lý lỗi kết nối. `NODE_EXTRA_CA_CERTS` không có tác dụng nếu chỉ đặt muộn trong file do ứng dụng tự đọc.

R2 runtime không cần service-role Supabase Storage. Bucket phải giữ private, không bật r2.dev/custom media domain để bỏ qua backend. Runtime kiểm HeadBucket và binding, không thay thao tác kiểm public-access trên dashboard.

Web và worker dùng cùng database/storage identity. Không đổi provider/bucket/endpoint bằng env đơn thuần: startup từ chối binding sai. Supabase Storage còn là adapter tương thích và kho nguồn rollback theo report, không phải nơi ghi ảnh mới hiện hành.

## 2. Worker, backup và staging

Worker Drive là service riêng theo [scripts/systemd/chicong-drive.service](scripts/systemd/chicong-drive.service). Key service account chỉ ở worker, quyền file 0600, scope chỉ đọc; web không cần key này. Cả web/worker dùng `DRIVE_SYNC_ENABLED`; `DRIVE_SYNC_SCHEDULER_ENABLED` là cổng riêng và hiện tắt theo report. [Runbook Drive](docs/google-drive-sync-operations.md).

Backup runner có credential riêng, không dùng key service account nhập ảnh. Dump SQL theo [backup-db.sh](scripts/backup-db.sh) không chứa bytes R2. Workflow [media-backup.yml](.github/workflows/media-backup.yml) chạy thủ công; file workflow không chứng minh đã có lịch hoặc cảnh báo.

Staging dùng DB/schema/bucket/credential riêng, `SITE_INDEXING=false`, `ANALYTICS_ENABLED=false`, không mail/Calendar khách thật. `render.yaml` là cấu hình dự phòng/rehearsal nếu dùng lại Render, không phản ánh VPS. Hướng dẫn Render cũ và số liệu triển khai được giữ trong [lưu trữ](docs/archive/README.md).

## 3. Chuẩn bị và kích hoạt release

Trước tiên chạy kiểm tra source và QA trên database tạm theo [hướng dẫn](docs/handbook/03-phong-lab-qa.md). Giữ commit/diff của bản chuẩn bị, kết quả kiểm tra và revision rollback hiểu schema hiện tại.

```sh
npm run deploy:vps -- --help
npm run deploy:vps -- --stage
```

`--stage` kết nối SSH alias `chicong-vps` hoặc `VPS_HOST`, đóng gói source theo allowlist và cài dependency trong thư mục release riêng. Nó không đưa `.env`/ảnh/credential vào gói, không kích hoạt release, restart hay migration. Script từ chối chạy deploy không có `--stage`.

Kích hoạt do người vận hành thực hiện với cấu hình production rõ ràng:

1. Giữ source/config/service definition hiện tại và xác nhận phương án rollback. Lấy maintenance lease, ngừng claim/schedule, drain writer/cleanup; dừng worker/runner cũ và xác minh đã thoát.
2. Chụp **DB + media baseline**, verify và giữ bản ngoài VPS; lease phải còn hiệu lực. Hết hạn không có nghĩa được bỏ khóa.
3. Dừng web sau khi writer đã drain. Giữ `.env` 0600, credential ngoài repo, data và quyền đọc module cho user worker; thay source từ release đã kiểm.
4. Khởi động một web instance với Drive tắt để migration có một owner. Kiểm health, số lượng/invariant DB, public/private media và admin. Cập nhật worker/runner về cùng revision và binding.
5. Kiểm heartbeat, quyền người dùng worker, upload/đọc bằng fixture được phép, rồi bật nhập thủ công và unlock đúng lease. Giữ scheduler tắt trừ khi có kế hoạch riêng.
6. Kiểm album draft và retry/no-op theo runbook. Nếu thất bại, giữ writer dừng và dùng rollback tương thích. Không restore DB cũ đè lên dữ liệu khách đã được nhận sau release.

Chi tiết lease/recovery và lệnh chính xác nằm ở [runbook Drive](docs/google-drive-sync-operations.md#6-lỗi-dừng-và-phục-hồi) và `npm run media -- help`. Chuyển storage cần `lock → drain → backup/copy/verify → switch → restart mọi consumer → smoke → unlock`; giữ kho nguồn cho tới khi nghiệm thu xong. Có ảnh mới ở R2 thì rollback phải xử lý delta ngược dưới khóa.

## 4. Kiểm tra sau release

- `/api/health` trả 200 và `{"ok":true}` chỉ xác nhận truy vấn DB; kiểm thêm ảnh public và gallery có mật khẩu bằng phiên khách.
- API admin phải trả 401 khi chưa đăng nhập; đổi mật khẩu gallery phải thu hồi quyền cũ. Public media dùng `private,no-cache`; private media dùng `private,no-store`; 304 vẫn phải qua kiểm quyền.
- Không cấu hình CDN ghi đè cache theo prefix `/media/*`: public/private dùng chung route. R2 private qua proxy không tự thành CDN cache.
- Kiểm upload/retry, JPEG/ZIP dùng được, lựa chọn khách, DB/media tồn tại sau restart và worker đúng revision/binding. Inquiry đã lưu không phụ thuộc email giao thành công.
- Xem log lỗi và tuổi backup hoàn chỉnh, không chỉ trạng thái process. Bản vá local xử lý mất kết nối PostgreSQL cả lúc pool rảnh và giữa transaction, giữ lỗi gốc nếu rollback thất bại, không tự chạy lại thao tác ghi chưa rõ kết quả. Nó chưa được coi là có trên VPS trước release.

## 5. Giới hạn nghiệm thu

Report 21/10 ghi đã chuyển 3.386 object sang R2, có backup ngoài VPS và restore offline. Chưa nghiệm thu full Supabase/cloud restore, reboot/kill worker giữa import, tải 500/5.000 JPEG thật, lịch backup media hoặc cảnh báo snapshot. Không thay các mục đó bằng kết quả unit test. [Bằng chứng và việc còn mở](docs/handbook/README.md).

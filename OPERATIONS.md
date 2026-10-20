# Vận hành ChiCong Studio 2.2

## Bắt đầu dùng

1. Mở `/admin`, tự tạo hoặc đăng nhập tài khoản quản trị.
2. Trong **Website**, điền thông tin liên hệ và nội dung của bạn. Tên thương hiệu và tiêu đề trang chủ bắt buộc có giá trị.
3. Tạo portfolio ở trạng thái bản nháp, thêm ảnh, chọn bìa rồi công khai. Kiểm tra bằng cửa sổ khách trước khi chia sẻ.
4. Với gallery khách, đặt mật khẩu, thêm ảnh, gửi link và mật khẩu riêng. Khi khách gửi lựa chọn, xem cảnh báo tại Tổng quan hoặc xuất CSV trong album.
5. Kiểm tra yêu cầu đặt lịch thường xuyên. App lưu yêu cầu vào quản trị và gửi email khi đã cấu hình Resend/SMTP; vẫn kiểm tra quản trị để xử lý yêu cầu nếu email bị lỗi. Chỉ xác nhận lịch sau khi trao đổi với khách.

Portfolio chưa có nội dung là trạng thái khởi đầu có chủ đích. App không dùng ảnh cưới giả hoặc tự xuất bản nội dung WordPress.

## Cập nhật phiên bản

1. Sao lưu dữ liệu và kho ảnh theo phần bên dưới.
2. Cập nhật mã nguồn và chạy `npm ci`, `npm run check`, `npm test`.
3. Khởi động lại bằng `npm start` hoặc deploy lại trên host đã cấu hình.
4. Xem `/api/health`: khi database hoạt động trả `{ "ok": true }`; khi database lỗi trả HTTP 503. Endpoint không kiểm tra đọc từng file Storage.
5. Kiểm tra một portfolio, một gallery riêng, upload và đặt lịch. Trên cloud phải kiểm tra dữ liệu vẫn tồn tại sau restart/deploy.

Bản 2.1 thêm `upload_key`, `upload_hash` và index vào bảng ảnh, giữ các bản ghi trước đó. Mã upload có phạm vi từng album và gắn với nội dung file; gửi lại cùng mã/file trả về ảnh đã lưu. Chọn file lần mới tạo mã mới, cho phép bạn chủ động đăng lại cùng một ảnh.

## Xử lý yêu cầu và đổi lịch

1. Vào **Yêu cầu đặt lịch → Xem**, đọc thông tin khách và lời nhắn.
2. Điền ngày sau khi trao đổi, chọn trạng thái phù hợp và lưu ghi chú riêng nếu cần. Khách chưa chọn ngày có thể giữ ở trạng thái mới nhận/đã liên hệ.
3. Khi xác nhận, phải có ngày chụp hợp lệ. Ngày bị chặn hoặc đã có lịch xác nhận khác sẽ bị từ chối; biểu mẫu giữ nội dung để sửa và lưu lại.
4. Để dời lịch, thay ngày và lưu. Sau khi thành công, lịch cũ được mở lại trừ khi có chặn ngày riêng. Kiểm tra trong **Lịch chụp** hoặc trang liên hệ.
5. Khi hoàn tất buổi chụp, chuyển sang hoàn thành; nếu hủy, chọn đã hủy. Ghi chú có thể sửa cho yêu cầu cũ mà không cần dời ngày.

Bản 2.2 tự thêm cột ghi chú rỗng cho yêu cầu cũ. Ghi chú tối đa 3.000 ký tự, chỉ xuất hiện trong quản trị và bản sao lưu JSON. File sao lưu có thông tin khách và cần được giữ kín.

## Sao lưu và khôi phục local

- Dừng server để có bộ dữ liệu nhất quán, rồi sao chép toàn bộ `data/live/` (hoặc đường dẫn `DATA_DIR` đã cấu hình) vào nơi riêng an toàn. Bao gồm database và thư mục `uploads/`; nếu có file SQLite `-wal`/`-shm`, giữ chúng cùng bộ sao lưu.
- Giữ ít nhất một bản sao ngoài máy hiện tại và giữ ảnh gốc riêng. File web đã được thu nhỏ/chuyển WebP, không thay thế ảnh gốc.
- Khôi phục: dừng server, giữ một bản sao của dữ liệu hiện tại, phục hồi nguyên bộ thư mục từ bản sao cùng thời điểm rồi chạy lại. Dùng phiên bản mã nguồn tương ứng hoặc mới hơn; không ghép database và ảnh từ hai bộ khác nhau.
- JSON tải trong quản trị chỉ là bản xuất metadata, không chứa file ảnh hoặc tài khoản admin và chưa có chức năng nhập lại qua giao diện.

Trên Supabase, sao lưu PostgreSQL và toàn bộ bucket Storage riêng, kiểm tra khôi phục bằng project thử. Đã có rehearsal backup/restore trên Render staging với dữ liệu tổng hợp; đây không phải bằng chứng khôi phục production. Xem [sổ tay vận hành](docs/handbook/02-van-hanh-bi-mat-va-khoi-phuc.md) và [biên bản R2, mục 17](docs/r2-implementation-plan.md#17-triển-khai-và-kiểm-chứng-cloud-ngày-16102026).

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| Upload gián đoạn | Giữ nguyên trang/file đã chọn, bấm thử lại. Ảnh đã lưu được nhận diện ở máy chủ. |
| Ảnh bị từ chối | Dùng JPEG/PNG/WebP thật, tối đa 20 MiB/file và 40 megapixel. Ảnh hỏng hoặc kho ảnh hết dung lượng không được lưu. |
| Phiên admin hết hạn | Đăng nhập lại. Ghi chú/cài đặt chưa gửi cần nhập lại; không lưu nháp các thông tin riêng vào localStorage. |
| Gallery không mở | Kiểm tra trạng thái riêng, link và mật khẩu. Đổi mật khẩu hoặc trạng thái album làm phiên cũ hết hiệu lực. |
| Ngày chụp không xác nhận được | Kiểm tra ngày bị chặn hoặc một lịch đã xác nhận cùng ngày. Mỗi ngày chỉ có một lịch xác nhận. |
| Không thấy ảnh sau deploy | Kiểm tra database/bucket đúng project và biến môi trường. Không dùng filesystem tạm của host để lưu ảnh production. |
| Quên mật khẩu admin | Chạy `npm run admin:reset` tại máy/server có đúng database; tự nhập mật khẩu trong terminal. |

## Phạm vi đã hoàn thành

Có website công khai, quản trị nội dung/cài đặt, upload ảnh web, album nháp/công khai/riêng/lưu trữ, chọn ảnh khách hàng và xuất CSV, yêu cầu đặt lịch/lịch bận, đăng nhập/session và cấu hình PostgreSQL/Storage cho hosting.

Việc kết nối tài khoản hosting, domain và kiểm thử cloud thực tế đã hoàn thành. Hệ thống hỗ trợ email tự động qua Resend/SMTP; chưa có thanh toán tự động, giao file RAW/ảnh gốc, nhiều tài khoản quản trị hay nhập lại JSON qua giao diện.

### Email thông báo tự động (Resend / SMTP)

Hệ thống hỗ trợ gửi email thông báo tự động khi khách hàng gửi biểu mẫu tư vấn qua website:
1. **Thông báo cho Studio**: Gửi email tóm tắt thông tin khách (tên, SĐT, email, dịch vụ, ngày, ngân sách, lời nhắn) kèm link truy cập Quản trị đến địa chỉ `NOTIFICATION_EMAIL` (hoặc email cài đặt của studio). Header `reply_to` được gắn sẵn email của khách để studio có thể trả lời trực tiếp.
2. **Xác nhận cho Khách hàng**: Nếu khách hàng có nhập email hợp lệ, hệ thống gửi email xác nhận mang phong cách editorial trang nhã, tóm tắt thông tin yêu cầu, mã tham chiếu `#...`, ghi chú thời gian phản hồi và thông tin liên hệ Zalo/Hotline của Chí Công.

Cấu hình qua biến môi trường:
- **Resend (khuyên dùng trên Render)**: Đặt `RESEND_API_KEY=re_...`, `NOTIFICATION_EMAIL=...`, và `EMAIL_FROM=...` (mặc định `ChiCong Studio <onboarding@resend.dev>` hoặc domain riêng đã xác thực trên Resend).
- **SMTP**: Đặt `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` nếu muốn sử dụng máy chủ gửi mail riêng (như Gmail SMTP).
- Khi chưa cấu hình email, hệ thống tự động bỏ qua gửi mail và không gây gián đoạn luồng lưu yêu cầu của khách.

### Public album URLs

On startup, the additive migration adds `albums.slug`, the unique `album_slug`
index, and the `album_slugs` URL history table on SQLite or PostgreSQL. Existing
albums receive Vietnamese ASCII slugs with numeric suffixes for collisions;
IDs, photos, gallery passwords and sessions are preserved. Back up the database
before deployment as usual. Include `album_slugs` in database restores so old
public URLs retain their redirects (the admin JSON export includes this table).

Published pages use `/album/:slug`. Legacy IDs and previous slugs redirect in one
301 hop to the current slug. The JSON album API accepts either key without a
redirect. Non-public albums still require existing authorization; only published
albums enter the sitemap. `/gallery/:id` remains ID-based and password protected.

In album settings, an empty slug generates a URL from the title; changing only
the title preserves a saved slug. Custom slugs are normalized and suffixed if
already reserved, including by historical URLs. The preview shows the normalized
base; the saved value includes any necessary suffix. Hash-shaped slugs are
reserved for legacy IDs. Canonical metadata and portfolio links use the saved URL.

### Schema.org and Web Analytics

Public pages automatically render Schema.org JSON-LD structured data (`@graph` linking `PhotographyBusiness`, founder, social links, contact, and `ImageGallery` on album pages). Private pages (`/admin`, `/gallery/:id`) and 404 responses omit structured data.

Cloudflare Web Analytics can be enabled automatically via the Cloudflare proxy dashboard, or explicitly configured via `CF_BEACON_TOKEN` / `CLOUDFLARE_ANALYTICS_TOKEN` environment variable on Render. Content-Security-Policy permits `static.cloudflareinsights.com` and `cloudflareinsights.com`.

Verification commands (run from the repository root):

- `npm test` runs SQLite, API, privacy and migration regression tests.
- `STUDIO_TEST_POSTGRES_URL=postgres://... npm test` additionally runs the real
  PostgreSQL test. Use a local disposable test database. The test creates and
  removes its own random schema, exercises RLS and 20 concurrent create/edit
  requests, and verifies redirects and migration across restarts.
- `npm run check` verifies server and frontend JavaScript syntax.
- `node studio/tests/album-slug-browser.smoke.mjs` runs the optional Chrome smoke
  test with Playwright installed. Alternatively set `STUDIO_PLAYWRIGHT_MODULE`
  to an installed Playwright module's absolute path. It uses a temporary SQLite
  database and checks actual desktop/mobile admin forms, URL previews, photo
  upload, public links, canonical metadata and redirects. Screenshots go to
  `STUDIO_BROWSER_EVIDENCE_DIR` or the temporary `chicong-slug-evidence` directory.

## Công cụ R2/backup mới (local và staging cloud đã kiểm chứng; production chưa chuyển)

Hướng dẫn đầy đủ và biên bản staging được giữ tại [kế hoạch triển khai, mục 16–17](docs/r2-implementation-plan.md#16-kết-quả-triển-khai-local-ngày-16102026). Render staging với PostgreSQL/R2 riêng đã qua smoke, redeploy, backup/restore và client-abort/retry bằng dữ liệu giả; chưa đổi provider hoặc dữ liệu production. `npm run media -- help` liệt kê lệnh. Không tự nạp `.env` để tránh dùng nhầm DB/bucket production khi restore. Bản restore local chỉ ghi vào thư mục chưa tồn tại, xóa sessions cũ, reset queue/journal/khóa và không cần kết nối Drive/R2 nguồn.

`GET /api/admin/media-status` cho admin biết khóa, writer, unknown writes và số job cleanup. HTTP 503 báo tạm khóa media; gallery đọc, booking và lựa chọn vẫn hoạt động. Client ngắt upload không xóa writer trước khi handler kết thúc. Không xóa journal hoặc queue để ép cutover qua cổng kiểm tra.

Nếu runner chết, lock vẫn lưu qua restart. `recover` chỉ nhận lock hết hạn và cấp lease mới, vẫn giữ khóa. Chỉ dùng `--writers-stopped yes` sau khi đã dừng mọi process cũ; giải quyết PUT/COMMIT chưa rõ và drain trước `unlock`. Một GET/HEAD 404 không chứng minh PUT đã kết thúc. Quyền quyết định này nằm ở người vận hành, không được tự động suy từ timeout.

Drive/backup files chứa dữ liệu khách, admin password hash và sessions trong snapshot gốc. Bản này dùng TLS, folder Drive chỉ chủ sở hữu và quyền file local 0600; chưa thêm mã hóa phía client. Không chia sẻ folder hoặc copy bí mật runner vào bộ offline. Retention chỉ dọn files do công cụ tạo và đã được snapshot hết hạn tham chiếu, luôn giữ bản tốt mới nhất. Backup lỗi do đầy Drive không xóa bản tốt để lấy chỗ.

## Vận hành Production trên iNET Cloud Server (từ 16/10/2026)

Từ ngày 16/10/2026, website chính thức `chicongphoto.vn` chuyển từ Render sang máy chủ ảo riêng iNET (103.56.162.182, Ubuntu 24.04 LTS).

- **Kết nối SSH:**
  ```bash
  ssh chicong-vps                  # Qua alias đã cấu hình
  # hoặc: ssh -p 24700 root@103.56.162.182
  ```
- **Thư mục ứng dụng:** `/var/www/chicongphoto`
- **Quản lý tiến trình (PM2):**
  ```bash
  pm2 status                       # Xem trạng thái
  pm2 logs chicong-photo           # Xem log realtime
  pm2 status                       # Không restart khi chưa drain media writer
  ```
- **Web server (Caddy):**
  ```bash
  systemctl status caddy           # Trạng thái web server
  systemctl restart caddy          # Khởi động lại Caddy
  caddy reload --config /etc/caddy/Caddyfile  # Nạp lại cấu hình Caddy
  ```
- **Chứng chỉ SSL:** Cloudflare Origin CA Certificate 15 năm tại `/etc/caddy/chicongphoto.crt` và `/etc/caddy/chicongphoto.key` (hết hạn 12/10/2041).
- **Bộ nhớ:** 2 GB RAM vật lý + 2 GB Swap (`/swapfile`).
- **Tường lửa:** UFW cho phép cổng `24700` (SSH), `80` (HTTP) và `443` (HTTPS).
- **Chuẩn bị release từ máy tính:**
  ```bash
  npm run deploy:vps -- --stage
  ```
  Script kiểm cú pháp, đóng gói source allowlist và cài dependencies trong thư mục mới; không kích hoạt production. Activation cần backup, lease/drain và dừng web/worker theo [biên bản rollout](docs/google-drive-sync-production-release-2026-10-17.md). PM2 fork mode có gián đoạn ngắn, không bảo đảm zero downtime.
- **Sao lưu cơ sở dữ liệu hàng ngày (PostgreSQL):**
  - Tự động chạy lúc 03:00 AM hàng ngày qua cron job: `/var/www/chicongphoto/scripts/backup-db.sh`.
  - Tự động lưu trữ tại `/var/backups/chicongphoto/` và giữ lịch sử 14 ngày.
  - Chạy sao lưu thủ công từ máy tính bất cứ lúc nào:
    ```bash
    npm run backup:db
    ```
- **Tài liệu chuyển đổi chi tiết:** Xem [báo cáo di dời Cloud Server iNET](docs/inet-vps-migration-2026-10-16.md).

## Google Drive Sync — cập nhật ngày 20/10/2026

Luồng duyệt folder mới: tạo bộ ảnh, chọn Google Drive, nhập tên/link folder, **Duyệt và chọn folder → Chọn folder này → Kiểm tra folder**, rồi tạo; xem trước và duyệt riêng để nhập ảnh. Chế độ **Các folder đã chia sẻ** cho phép chọn bất kỳ folder nào tài khoản dịch vụ đọc được, không cần chung folder cha. Có thể duyệt folder con theo trang; chỉ ảnh trực tiếp trong folder đã chọn được nhập. Duyệt folder không tự tạo album hoặc nhập ảnh. Bằng chứng kiểm thử tại [admin local](http://127.0.0.1:4175/admin) nằm trong [biên bản duyệt folder](docs/google-drive-folder-browser-2026-10-20.md); trạng thái production nằm trong [biên bản phát hành 20/10](docs/google-drive-sync-production-release-2026-10-20.md). Danh sách album hiển thị tiến độ, preview hỗ trợ lọc và so sánh ảnh; thử lại riêng file lỗi khi bản duyệt còn hợp lệ.

Theo [biên bản phát hành 20/10](docs/google-drive-sync-production-release-2026-10-20.md), source `5a9e83c` đã lên VPS, nhập Drive thủ công bật, worker đã khởi động và lịch tự động vẫn tắt. **Nghiệm thu chưa đóng:** [runbook](docs/google-drive-sync-operations.md) và kế hoạch ghi shared/check, heartbeat, unlock và browse thành công, pilot 33 ảnh đang nhập; bảng nghiệm thu release vẫn để PENDING. Cần đối chiếu kết quả cuối của pilot/no-op, boot và dữ liệu trước khi ghi phát hành hoàn tất. Khóa cũ đã thu hồi và khóa thay thế được kiểm quyền đọc trên VPS ngày 19/10. Cấu hình cũ mặc định giữ `root`; đổi chế độ phải kiểm tra kết nối và tạo preview mới.

Lượt tối ưu trước phát hành đạt [420/420 regression test](docs/google-drive-perf-pass-2026-10-20.md) và kiểm UI với Drive thật; không phải suite vừa chạy lại trong deploy. Các mốc 373 test, 5.000 ảnh giả và backup/restore 15.000 rendition thuộc [workflow 17/10](docs/google-drive-sync-workflow-2026-10-17.md). Bản local 346 ảnh thật vẫn là bằng chứng riêng; chưa thay thế thử tải full-resolution trên cloud. Xem [handbook 20/10](docs/handbook/05-cap-nhat-du-an-2026-10-20.md) để phân biệt bằng chứng theo môi trường và các việc còn lại.

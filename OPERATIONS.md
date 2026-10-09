# Vận hành ChiCong Studio 2.2

## Bắt đầu dùng

1. Mở `/admin`, tự tạo hoặc đăng nhập tài khoản quản trị.
2. Trong **Website**, điền thông tin liên hệ và nội dung của bạn. Tên thương hiệu và tiêu đề trang chủ bắt buộc có giá trị.
3. Tạo portfolio ở trạng thái bản nháp, thêm ảnh, chọn bìa rồi công khai. Kiểm tra bằng cửa sổ khách trước khi chia sẻ.
4. Với gallery khách, đặt mật khẩu, thêm ảnh, gửi link và mật khẩu riêng. Khi khách gửi lựa chọn, xem cảnh báo tại Tổng quan hoặc xuất CSV trong album.
5. Kiểm tra yêu cầu đặt lịch thường xuyên. App lưu yêu cầu vào quản trị, chưa gửi email tự động. Chỉ xác nhận lịch sau khi trao đổi với khách.

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

Trên Supabase, sao lưu PostgreSQL và toàn bộ bucket Storage riêng, kiểm tra khôi phục bằng project thử. Hướng dẫn cấu hình nằm ở `HOSTING.md`; chưa xác nhận khôi phục trên tài khoản cloud thật trong phiên này.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| Upload gián đoạn | Giữ nguyên trang/file đã chọn, bấm thử lại. Ảnh đã lưu được nhận diện ở máy chủ. |
| Ảnh bị từ chối | Dùng JPEG/PNG/WebP thật, tối đa 8MB/file và 40 megapixel. Ảnh hỏng hoặc kho ảnh hết dung lượng không được lưu. |
| Phiên admin hết hạn | Đăng nhập lại. Ghi chú/cài đặt chưa gửi cần nhập lại; không lưu nháp các thông tin riêng vào localStorage. |
| Gallery không mở | Kiểm tra trạng thái riêng, link và mật khẩu. Đổi mật khẩu hoặc trạng thái album làm phiên cũ hết hiệu lực. |
| Ngày chụp không xác nhận được | Kiểm tra ngày bị chặn hoặc một lịch đã xác nhận cùng ngày. Mỗi ngày chỉ có một lịch xác nhận. |
| Không thấy ảnh sau deploy | Kiểm tra database/bucket đúng project và biến môi trường. Không dùng filesystem tạm của host để lưu ảnh production. |
| Quên mật khẩu admin | Chạy `npm run admin:reset` tại máy/server có đúng database; tự nhập mật khẩu trong terminal. |

## Phạm vi đã hoàn thành

Có website công khai, quản trị nội dung/cài đặt, upload ảnh web, album nháp/công khai/riêng/lưu trữ, chọn ảnh khách hàng và xuất CSV, yêu cầu đặt lịch/lịch bận, đăng nhập/session và cấu hình PostgreSQL/Storage cho hosting.

Việc kết nối tài khoản hosting, domain và kiểm thử cloud thực tế vẫn cần thực hiện khi triển khai. Chưa có email tự động, thanh toán, giao file RAW/ảnh gốc, nhiều tài khoản quản trị hay nhập lại JSON qua giao diện.

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

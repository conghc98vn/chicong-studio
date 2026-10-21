# Đưa ChiCong Studio lên máy chủ và tên miền chicongphoto.vn

> Cập nhật production 21/10/2026: website chạy trên VPS iNET, ảnh dùng R2 private `chicong-production`, database vẫn Supabase. Các hướng dẫn Supabase Storage/Render dưới đây là cấu hình lịch sử trước cutover; xem [biên bản hiện tại](docs/r2-production-cutover-2026-10-21.md).

> **Cập nhật ngày 16/10/2026:** Sau sự cố hết 5 GB băng thông miễn phí trên Render, website chính thức `chicongphoto.vn` đã được **chuyển đổi thành công sang máy chủ ảo riêng (Cloud Server Linux 2) tại iNET (Việt Nam)**, thời hạn 3 năm (2026–2029). Xem chi tiết cấu hình, vận hành và nghiệm thu tại [báo cáo di dời Cloud Server iNET](docs/inet-vps-migration-2026-10-16.md).

> **Cập nhật Drive ngày 17/10/2026:** Source web/worker/backup mới đã lên VPS; nhập Drive và scheduler vẫn tắt. Worker systemd riêng đang kiểm kết nối, chưa enable khởi động cùng máy. [Biên bản rollout](docs/google-drive-sync-production-release-2026-10-17.md) ghi các cổng còn lại, backup và rollback.

Phương án ban đầu (lịch sử): **Render Free** chạy Node.js, **Supabase Free** lưu PostgreSQL và ảnh trong bucket riêng. Website chính thức đang hoạt động tại [chicongphoto.vn](https://chicongphoto.vn) (được định tuyến qua Cloudflare proxy đến máy chủ mới) từ ngày 09/10/2026; [trang quản trị](https://chicongphoto.vn/admin) dùng tài khoản studio đã cấu hình. Tên miền `chicongphoto.vn` đã trỏ đúng và kích hoạt HTTPS thành công với Cloudflare Origin Certificate (15 năm).

## 1. Tạo Supabase project Free

Bạn tự tạo tài khoản/project, chọn vùng gần người dùng và giữ mật khẩu database.

Lấy các thông tin dưới đây để nhập trực tiếp vào Environment trên Render. Không đăng key/password trong chat hoặc file commit:

- `DATABASE_URL`: Connect → Session pooler (IPv4, cổng 5432), dạng `postgresql://postgres.PROJECT:…@…pooler.supabase.com:5432/postgres`. URL-encode mật khẩu và dùng tham số `sslmode=verify-full`. Không tắt kiểm tra chứng chỉ; nếu nhà cung cấp yêu cầu certificate CA riêng, cấu hình certificate đúng theo tài liệu.
- `SUPABASE_URL`: URL project `https://PROJECT.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: legacy **service_role JWT** phía máy chủ, không phải anon/public key.
- `SUPABASE_BUCKET`: `chicong-private`.

Repository có chứng chỉ công khai `certs/supabase-root-2021.crt`, tải từ Database → Settings → SSL configuration của Supabase. Đặt `NODE_EXTRA_CA_CERTS=./certs/supabase-root-2021.crt` trong Environment của Render để Node tin cậy CA này và vẫn kiểm tra hostname/chứng chỉ với `sslmode=verify-full`. Chứng chỉ hết hạn ngày 26/04/2031; SHA-256: `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`. Nếu Supabase thay CA, tải và đối chiếu chứng chỉ mới trước khi thay file. Biến này phải được đặt trước khi Node khởi động, không chỉ trong file `.env` được app nạp.

Ứng dụng kiểm tra bucket khi khởi động và tạo bucket riêng nếu chưa có. Nếu bucket có sẵn, nó phải là **private**. Không bật Public cho bucket này. Backend tự tạo bảng và bật RLS; không có policy cho anon/browser. Browser chỉ gọi backend cùng domain, không nhận service role key hay database URL.

## 2. Đưa mã nguồn vào repository của bạn

Các file cần: `studio/`, `certs/`, `package.json`, `package-lock.json`, `render.yaml`, `.gitignore`. Không upload `node_modules/`, `.env`, `data/`, `legacy-prototype/` hoặc thư mục WordPress/SQL.

`studio/tests/manual-fixture.mjs` chỉ là server kiểm thử local; không chạy nó trên host. Lệnh production là `npm start`.

## 3. Tạo Render Web Service Free

Kết nối repository, chọn Node.js và gói Free. Có thể dùng Blueprint `render.yaml` hoặc cấu hình thủ công:

- Node: 24 LTS.
- Build: `npm ci --omit=dev`.
- Start: `npm start`.
- Health check: `/api/health`.
- `NODE_ENV=production`.
- `MEDIA_STORAGE_PROVIDER=supabase` cho bản tương thích trước chuyển kho; không đổi sang `r2` chỉ bằng chỉnh biến môi trường.
- `NODE_EXTRA_CA_CERTS=./certs/supabase-root-2021.crt`.
- `SITE_URL=https://chicongphoto.vn` (trước khi nối domain có thể đặt URL https://…onrender.com để preview).
- Các biến Supabase ở bước 1.
- `SETUP_TOKEN`: tự tạo chuỗi ngẫu nhiên dài dùng một lần để bảo vệ trang thiết lập đầu tiên.

Mã khởi động không tạo album minh họa, không tạo mật khẩu admin mặc định và không gửi email.

## 4. Tạo tài khoản studio

Mở `/admin` trên đúng domain trong `SITE_URL`. Nếu dùng địa chỉ `https://…onrender.com/admin` để thiết lập, đặt `SITE_URL` tương ứng trước; khi chuyển sang tên miền chính, cập nhật lại `SITE_URL`. Production yêu cầu HTTPS và chỉ nhận thao tác ghi từ Origin đã cấu hình. Tự nhập email, mật khẩu từ 12 ký tự và `SETUP_TOKEN`. Sau khi tạo xong, bạn có thể xóa biến `SETUP_TOKEN` khỏi Render; app không cho tạo thêm tài khoản qua endpoint thiết lập.

Với dịch vụ hiện tại, tài khoản local đã được chuyển và kiểm tra khớp hoàn toàn; `SETUP_TOKEN` đã xóa khỏi Render. Chỉ cần đăng nhập tài khoản studio cũ. Không dùng mật khẩu database Supabase để đăng nhập studio.

Trong **Website**, điền email, điện thoại, nội dung giới thiệu và Instagram. Trong **Portfolio**, tạo album, upload ảnh, chọn ảnh bìa rồi đặt trạng thái công khai. Gallery riêng có mật khẩu từ 8 ký tự.

## 5. Đã nối và xác thực chicongphoto.vn

Tên miền `chicongphoto.vn` đã được thêm vào Custom Domains của Render và trỏ bản ghi DNS qua Cloudflare. Biến môi trường `SITE_URL=https://chicongphoto.vn` và `CF_BEACON_TOKEN` đã cấu hình trên Render. HTTPS hoạt động bình thường, cookie và session admin không bị phân tán.

### Proxy và triển khai bản vá bảo mật 13/10/2026

`TRUST_PROXY` mặc định giữ một hop trên production và tắt ở local. Có thể đặt `false` khi truy cập trực tiếp không có reverse proxy, số hop đã xác minh, hoặc danh sách IP/CIDR proxy tin cậy theo cú pháp Express. Giá trị `true` bị từ chối. Trước khi thay đổi trên Render, cần kiểm tra IP thực tế Express nhận qua cả domain Cloudflare và đường truy cập trực tiếp Render. Không lấy thẳng `CF-Connecting-IP` hoặc IP đầu tiên trong `X-Forwarded-For` nếu chưa xác thực proxy gửi nó. Bản vá chưa chứng minh cấu hình một hop trên hosting hiện tại có lỗi, nên không tự đổi số hop.

Migration thêm index `rate_limits_expires`, giữ nguyên dữ liệu. Unlock gallery giới hạn tổng 60 lần/IP/15 phút, đồng thời giữ giới hạn 8 lần/gallery/IP/15 phút cho gallery có thật. ID không tồn tại không tạo quota riêng; dọn bản ghi hết hạn tối đa mỗi phút khi có request.

Ảnh công khai và chân dung chuyển sang `private,no-cache`, giữ ETag để phản hồi 304 sau khi kiểm tra quyền; ảnh private và phản hồi media bị từ chối dùng `private,no-store`. Cache một giờ từ phiên bản cũ có thể còn hiệu lực tối đa một giờ sau lần cuối nhận header cũ. Nếu đã cấu hình CDN cache ảnh, purge các URL ảnh cần thu hồi khi triển khai; không tạo quy tắc CDN ghi đè header mới. Thay đổi header không thu hồi bản ảnh người xem đã tải về.

## Đã kiểm chứng và vận hành thực tế

Đã kiểm chứng trên tài khoản cloud thật ngày 08/10/2026 và 09/10/2026: health PostgreSQL, 9 bảng ứng dụng bật RLS, các trang/API công khai, API quản trị trả 401 khi chưa đăng nhập, và Storage ghi/đọc khớp dữ liệu trong bucket private với truy cập công khai bị từ chối. Mã nguồn tự động xử lý tạo bucket private khi chưa có.

Bộ kiểm thử tự động đạt 56/56 bài test (bao gồm SEO album slug, retry upload, bảo mật gallery, CSRF, Schema.org và Cloudflare Analytics). Portfolio trên production hiện đã công khai 7 album với 284 ảnh. Ngày 09/10/2026 đã chụp snapshot sao lưu toàn bộ dữ liệu công khai và 568 file WebP vào `data/backups/launch-2026-10-09/public-1791512046057`.

Biểu mẫu liên hệ trên website thật cũng đã gửi thành công yêu cầu thử; PostgreSQL lưu đúng một bản ghi và không giữ ngày chụp khi chưa chọn ngày.

Ảnh upload được đổi sang WebP (cạnh dài tối đa 2400px + thumbnail 900px) và loại metadata; hệ thống phục vụ gallery xem/chọn, không phải kho giao file RAW/ảnh gốc độ phân giải đầy đủ. Email tự động chưa tích hợp: yêu cầu nằm trong **Yêu cầu đặt lịch**, bạn chủ động liên hệ khách. Không có thanh toán hoặc booking tự động được xác nhận.

## Cấu hình R2 sau khi triển khai bản tương thích

Code hỗ trợ `MEDIA_STORAGE_PROVIDER=r2`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Giữ `DATABASE_URL`, TLS và các biến website hiện tại. R2 không yêu cầu `SUPABASE_URL`/service-role cho Storage. Runtime chỉ dùng S3 Object Read & Write cho bucket đã tạo; không tạo bucket hoặc xác minh control-plane public access thay chủ tài khoản. Không bật r2.dev, custom media domain hoặc browser upload trực tiếp.

Production đã chuyển sang `MEDIA_STORAGE_PROVIDER=r2`, bucket private `chicong-production` ngày 21/10/2026; xem [biên bản cutover](docs/r2-production-cutover-2026-10-21.md). Web và worker Drive phải cùng cấu hình R2. Startup gắn danh tính kho với DB. Đổi provider/bucket/endpoint trái binding sẽ bị từ chối; xem quy trình `lock → drain → backup/delta/verify → switch → restart mọi instance → smoke → unlock` ở [kế hoạch, mục 16](docs/r2-implementation-plan.md#16-kết-quả-triển-khai-local-ngày-16102026). `render.yaml` đã cập nhật provider R2; chỉ là cấu hình dự phòng nếu dùng lại Render, không tự deploy/sync Render.

Không đưa OAuth Drive vào Render web service. Runner dùng secrets riêng, DB/schema/bucket thử tách biệt, không có biến Resend/SMTP/Google Calendar của production. Chưa kích hoạt billing, deploy hoặc schedule từ các thay đổi source này.

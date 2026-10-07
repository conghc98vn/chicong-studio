# Đưa ChiCong Studio lên host miễn phí và chicongphoto.vn

Phương án chuẩn bị trong mã nguồn: **Render Free** chạy Node.js, **Supabase Free** lưu PostgreSQL và ảnh trong bucket riêng. Tên miền đặt ở Render; không cần mua custom domain cho Supabase.

Tài liệu nhà cung cấp được kiểm tra ngày 07/10/2026:

- [Render Free](https://render.com/docs/free): hỗ trợ custom domain, nhưng ngủ sau 15 phút không có traffic và filesystem không lưu bền vững qua restart/deploy.
- [Supabase Free](https://supabase.com/pricing): 500MB database, 1GB file storage, 5GB egress và 5GB cached egress; có thể pause khi không hoạt động một tuần. Không bao gồm automatic database backups.
- [Kết nối PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).
- [Custom domain trên Render](https://render.com/docs/custom-domains).

Vì vậy bản production yêu cầu database và Storage bên ngoài; không được dùng SQLite/filesystem tạm của Render để lưu ảnh khách. Free phù hợp khởi đầu và thử nghiệm, không phải cam kết uptime. Giữ bản ảnh gốc và tự sao lưu dữ liệu.

## 1. Tạo Supabase project Free

Bạn tự tạo tài khoản/project, chọn vùng gần người dùng và giữ mật khẩu database.

Lấy các thông tin dưới đây để nhập trực tiếp vào Environment trên Render. Không đăng key/password trong chat hoặc file commit:

- `DATABASE_URL`: Connect → Session pooler (IPv4, cổng 5432), dạng `postgresql://postgres.PROJECT:…@…pooler.supabase.com:5432/postgres`. URL-encode mật khẩu và dùng tham số `sslmode=verify-full`. Không tắt kiểm tra chứng chỉ; nếu nhà cung cấp yêu cầu certificate CA riêng, cấu hình certificate đúng theo tài liệu.
- `SUPABASE_URL`: URL project `https://PROJECT.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: legacy **service_role JWT** phía máy chủ, không phải anon/public key.
- `SUPABASE_BUCKET`: `chicong-private`.

Ứng dụng kiểm tra bucket khi khởi động và tạo bucket riêng nếu chưa có. Nếu bucket có sẵn, nó phải là **private**. Không bật Public cho bucket này. Backend tự tạo bảng và bật RLS; không có policy cho anon/browser. Browser chỉ gọi backend cùng domain, không nhận service role key hay database URL.

## 2. Đưa mã nguồn vào repository của bạn

Các file cần: `studio/`, `package.json`, `package-lock.json`, `render.yaml`, `.gitignore`. Không upload `node_modules/`, `.env`, `data/`, `legacy-prototype/` hoặc thư mục WordPress/SQL.

`studio/tests/manual-fixture.mjs` chỉ là server kiểm thử local; không chạy nó trên host. Lệnh production là `npm start`.

## 3. Tạo Render Web Service Free

Kết nối repository, chọn Node.js và gói Free. Có thể dùng Blueprint `render.yaml` hoặc cấu hình thủ công:

- Node: 24 LTS.
- Build: `npm ci --omit=dev`.
- Start: `npm start`.
- Health check: `/api/health`.
- `NODE_ENV=production`.
- `SITE_URL=https://chicongphoto.vn` (trước khi nối domain có thể đặt URL https://…onrender.com để preview).
- Các biến Supabase ở bước 1.
- `SETUP_TOKEN`: tự tạo chuỗi ngẫu nhiên dài dùng một lần để bảo vệ trang thiết lập đầu tiên.

Mã khởi động không tạo album minh họa, không tạo mật khẩu admin mặc định và không gửi email.

## 4. Tạo tài khoản studio

Mở `https://…onrender.com/admin`. Tự nhập email, mật khẩu từ 12 ký tự và `SETUP_TOKEN`. Sau khi tạo xong, bạn có thể xóa biến `SETUP_TOKEN` khỏi Render; app không cho tạo thêm tài khoản qua endpoint thiết lập.

Trong **Website**, điền email, điện thoại, nội dung giới thiệu và Instagram. Trong **Portfolio**, tạo album, upload ảnh, chọn ảnh bìa rồi đặt trạng thái công khai. Gallery riêng có mật khẩu từ 8 ký tự.

## 5. Nối chicongphoto.vn

Thêm `chicongphoto.vn` và nếu cần `www.chicongphoto.vn` trong Settings → Custom Domains của Render. Tại nơi quản lý tên miền, thêm đúng DNS records mà Render hiện trong dashboard. Không đoán IP hoặc thay nameserver khi không cần.

Chờ xác minh DNS/HTTPS, đặt `SITE_URL=https://chicongphoto.vn`, rồi kiểm tra trang chủ, login, upload, gallery riêng và đặt lịch. Giữ một domain chính để người dùng không bị tách cookie đăng nhập giữa www và domain gốc.

## Trước khi nhận dữ liệu thật

Kiểm tra bằng album thử trên cloud: upload ảnh, restart/deploy lại, kiểm tra ảnh còn; mở gallery trong trình duyệt khách và kiểm tra password/selected photos; gửi yêu cầu đặt lịch thử rồi xử lý trong studio. Các adapter PostgreSQL/Supabase đã được viết nhưng chưa được kiểm chứng trên tài khoản cloud thật trong phiên làm việc này.

Ảnh upload được đổi sang WebP (cạnh dài tối đa 2400px + thumbnail 900px) và loại metadata; hệ thống phục vụ gallery xem/chọn, không phải kho giao file RAW/ảnh gốc độ phân giải đầy đủ. Email tự động chưa tích hợp: yêu cầu nằm trong **Yêu cầu đặt lịch**, bạn chủ động liên hệ khách. Không có thanh toán hoặc booking tự động được xác nhận.

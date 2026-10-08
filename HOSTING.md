# Đưa ChiCong Studio lên host miễn phí và chicongphoto.vn

Phương án đã triển khai: **Render Free** chạy Node.js, **Supabase Free** lưu PostgreSQL và ảnh trong bucket riêng. Website đang chạy tại [chicong-photo-studio.onrender.com](https://chicong-photo-studio.onrender.com) từ ngày 08/10/2026; [trang quản trị](https://chicong-photo-studio.onrender.com/admin) dùng tài khoản studio cũ đã chuyển từ local. Chưa cấu hình DNS cho `chicongphoto.vn`. Tên miền sẽ đặt ở Render; không cần mua custom domain cho Supabase.

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
- `NODE_EXTRA_CA_CERTS=./certs/supabase-root-2021.crt`.
- `SITE_URL=https://chicongphoto.vn` (trước khi nối domain có thể đặt URL https://…onrender.com để preview).
- Các biến Supabase ở bước 1.
- `SETUP_TOKEN`: tự tạo chuỗi ngẫu nhiên dài dùng một lần để bảo vệ trang thiết lập đầu tiên.

Mã khởi động không tạo album minh họa, không tạo mật khẩu admin mặc định và không gửi email.

## 4. Tạo tài khoản studio

Mở `https://…onrender.com/admin`. Tự nhập email, mật khẩu từ 12 ký tự và `SETUP_TOKEN`. Sau khi tạo xong, bạn có thể xóa biến `SETUP_TOKEN` khỏi Render; app không cho tạo thêm tài khoản qua endpoint thiết lập.

Với dịch vụ hiện tại, tài khoản local đã được chuyển và kiểm tra khớp hoàn toàn; `SETUP_TOKEN` đã xóa khỏi Render. Chỉ cần đăng nhập tài khoản studio cũ. Không dùng mật khẩu database Supabase để đăng nhập studio.

Trong **Website**, điền email, điện thoại, nội dung giới thiệu và Instagram. Trong **Portfolio**, tạo album, upload ảnh, chọn ảnh bìa rồi đặt trạng thái công khai. Gallery riêng có mật khẩu từ 8 ký tự.

## 5. Nối chicongphoto.vn

Thêm `chicongphoto.vn` và nếu cần `www.chicongphoto.vn` trong Settings → Custom Domains của Render. Tại nơi quản lý tên miền, thêm đúng DNS records mà Render hiện trong dashboard. Không đoán IP hoặc thay nameserver khi không cần.

Chờ xác minh DNS/HTTPS, đặt `SITE_URL=https://chicongphoto.vn`, rồi kiểm tra trang chủ, login, upload, gallery riêng và đặt lịch. Giữ một domain chính để người dùng không bị tách cookie đăng nhập giữa www và domain gốc.

## Trước khi nhận dữ liệu thật

Đã kiểm chứng trên tài khoản cloud thật ngày 08/10/2026: health PostgreSQL, 9 bảng ứng dụng bật RLS, các trang/API công khai, API quản trị trả 401 khi chưa đăng nhập, và Storage ghi/đọc khớp dữ liệu trong bucket private với truy cập công khai bị từ chối. Ảnh kiểm thử đã được xóa. Mã nguồn cũng xử lý phản hồi HTTP 400 `NoSuchBucket` của Supabase để tự tạo bucket private khi chưa có; các lỗi xác thực khác vẫn dừng khởi động.

Các bước còn cần kiểm tra qua tài khoản studio: upload album, restart/deploy lại và kiểm tra ảnh còn; mở gallery trong trình duyệt khách và kiểm tra mật khẩu/lựa chọn ảnh; xử lý yêu cầu đặt lịch trong quản trị. Bộ kiểm thử tự động được chạy lại ngày 09/10/2026: 45/45 bài đạt; chúng không thay thế các bước kiểm tra giao diện quản trị trên cloud.

Biểu mẫu liên hệ trên website thật cũng đã gửi thành công một yêu cầu thử; PostgreSQL lưu đúng một bản ghi và không giữ ngày chụp khi chưa chọn ngày. Bản ghi kiểm thử đã được xóa sau đối chiếu. Lượt kiểm tra từ dòng lệnh trước đó gặp lỗi kết nối mạng; luồng trình duyệt thực tế đã được xác nhận thành công.

Ảnh upload được đổi sang WebP (cạnh dài tối đa 2400px + thumbnail 900px) và loại metadata; hệ thống phục vụ gallery xem/chọn, không phải kho giao file RAW/ảnh gốc độ phân giải đầy đủ. Email tự động chưa tích hợp: yêu cầu nằm trong **Yêu cầu đặt lịch**, bạn chủ động liên hệ khách. Không có thanh toán hoặc booking tự động được xác nhận.

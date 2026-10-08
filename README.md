# ChiCong Studio · v2.2.1

Hệ thống nhiếp ảnh mới cho **chicongphoto.vn**, có portfolio công khai, studio quản trị, upload ảnh, gallery riêng cho khách chọn ảnh và yêu cầu đặt lịch. Portfolio bắt đầu trống để bạn tự đăng các bộ ảnh cưới; không nhập lại nội dung WordPress.

## Chạy trên máy

Cần Node.js 22.13+; dùng Node 24 LTS khi deploy.

```sh
npm ci
npm run dev
```

- Website: http://localhost:4173
- Quản trị: http://localhost:4173/admin

Lần đầu bạn tự tạo tài khoản email và mật khẩu từ 12 ký tự. Mã thiết lập chỉ bắt buộc trên hosting hoặc khi truy cập từ máy khác. Không có mật khẩu mặc định. Dữ liệu local nằm trong `data/live/`: `studio.sqlite` và `uploads/`. Dừng app bằng Ctrl+C. Sửa mã nguồn server cần khởi động lại; sửa frontend chỉ cần tải lại trình duyệt.

## Quy trình đăng portfolio

1. Mở **Portfolio → Tạo album**, nhập tên, thể loại và mô tả.
2. Thêm ảnh JPEG/PNG/WebP, chọn nhiều ảnh cùng lúc, tối đa 8MB/ảnh. Giao diện tự chia lượt upload và hiển thị tiến trình.
3. Chọn ảnh bìa; sửa chú thích, sắp xếp thứ tự bằng ↑/↓. Toàn bộ thứ tự lưu trong một yêu cầu, tối đa 2.000 ảnh/bộ cho thao tác sắp xếp.
4. Trong **Thông tin album**, đổi trạng thái từ bản nháp sang công khai.
5. Dùng **Đã lưu trữ** để ẩn album mà vẫn giữ dữ liệu. Xóa từng ảnh sẽ xóa file web; luôn giữ bản gốc trên máy.

Trong quản trị, bạn có thể tìm album/gallery theo tên bộ ảnh hoặc khách hàng, tìm không dấu và lọc trạng thái. Yêu cầu đặt lịch cũng có tìm kiếm và lọc trạng thái. Tải lại trình duyệt giữ trang quản trị hoặc album đang mở.

Nếu upload có ảnh hỏng, các ảnh thành công vẫn được lưu và hiện ngay; **Thử lại ảnh còn lại** bỏ qua những ảnh đã được máy chủ xác nhận. Giữ nguyên trang và danh sách file để tiếp tục. Khi mất kết nối giữa chừng, bấm thử lại trong cùng lượt chọn file: mỗi ảnh có mã upload riêng, máy chủ nhận diện ảnh đã lưu để không tạo bản trùng, kể cả khi phản hồi lượt trước bị mất. Nếu chọn lại file hoặc tải lại trang, mã upload mới sẽ được tạo; đó được xem là một lần đăng ảnh mới. Đổi trang hoặc tải lại sẽ mất tiến trình thử lại trên trình duyệt. Hệ thống nhắc trước khi rời trang lúc upload đang chạy.

## Gallery riêng cho khách

1. **Gallery khách → Tạo gallery**, đặt mật khẩu từ 8 ký tự.
2. Upload ảnh và sao chép link gallery. Bạn gửi link/mật khẩu cho khách qua kênh của mình.
3. Khách mở link, nhập mật khẩu, bấm ♡ trên danh sách hoặc **Chọn ảnh này** trong trình xem ảnh lớn. Có thể chuyển ảnh bằng phím ←/→ trên máy tính. Bấm **Gửi lựa chọn** khi xong.
4. Studio hiển thị số ảnh đã chọn và trạng thái khách đã gửi; có thể xuất danh sách tên file/chú thích dưới dạng CSV.
5. Khách có thể chỉnh lựa chọn và gửi lại. Nhiều thiết bị dùng cùng gallery chia sẻ một danh sách lựa chọn. Đổi mật khẩu vô hiệu phiên gallery cũ; khách có thể bấm **Đóng gallery** để thoát.

File media của gallery private yêu cầu session hợp lệ; có link ảnh đơn lẻ cũng không xem được nếu chưa đăng nhập. Gallery và admin có noindex. Không giữ ảnh gốc/RAW để giao file: ảnh web được tối ưu 2400px + thumbnail 900px.

## Liên hệ và đặt lịch

- Khách chọn ngày, dịch vụ, gửi thông tin và lời nhắn.
- Yêu cầu lưu thật vào database, xuất hiện trong **Yêu cầu đặt lịch**; không gửi email tự động.
- Admin cập nhật: mới nhận, đã liên hệ, đã xác nhận, hoàn thành hoặc đã hủy. Trong chi tiết yêu cầu, có thể đổi ngày chụp và lưu ghi chú riêng (tối đa 3.000 ký tự).
- Phải chọn ngày trước khi xác nhận. Đổi lịch đã xác nhận kiểm tra ngày bị chặn/lịch trùng; nếu không hợp lệ, ngày, trạng thái và ghi chú cũ được giữ nguyên. Đổi lịch hoặc hủy thành công mở lại ngày cũ nếu không bị chặn riêng.
- Lịch trên trang liên hệ đồng bộ với ô nhập ngày, giữ ngày đã chọn khi chuyển tháng và có nút bỏ chọn. Khách chưa biết ngày vẫn gửi được yêu cầu tư vấn; ngày bận nhập bằng tay cũng bị kiểm tra.
- **Lịch chụp** cho phép chặn ngày bận. Ngày bị chặn hoặc có một lịch đã xác nhận không nhận yêu cầu mới.
- Một ngày chỉ xác nhận một booking. Gửi yêu cầu chưa giữ chỗ, chưa nhận thanh toán và chưa xác nhận lịch.

## Theo dõi trạng thái studio

**Tổng quan → Chuẩn bị mở studio** cho biết đã có thông tin liên hệ, portfolio có ảnh và cấu hình lưu trữ cloud hay chưa. Trạng thái cloud phản ánh cấu hình đang chạy; không thay thế kiểm thử dữ liệu tồn tại sau restart trên hosting thật. Không có key hoặc mật khẩu hosting trong trình duyệt.

## Chỉnh website và sao lưu

Trong **Website**, chỉnh thương hiệu, tiêu đề, giới thiệu, email, điện thoại, khu vực, Instagram và lời nhắn đặt lịch. Không cần sửa code để đăng album hoặc thay nội dung. Cấu hình được kiểm tra toàn bộ trước khi lưu; một trường sai sẽ không làm các trường khác bị thay đổi một phần.

Tải JSON trong phần sao lưu để giữ cấu trúc album/lựa chọn/yêu cầu. JSON này chứa dữ liệu khách, ghi chú riêng của studio và hash mật khẩu gallery: lưu kín. Nó không chứa ảnh hoặc tài khoản admin. Sao lưu toàn bộ `data/live/` khi app local đã dừng; trên Supabase sao lưu database và Storage riêng. JSON chưa có luồng khôi phục qua giao diện.

## Hosting miễn phí

Xem [HOSTING.md](HOSTING.md): Render Free + Supabase PostgreSQL/Storage, cấu hình cho chicongphoto.vn. Production từ chối chạy nếu không cấu hình database và Storage lưu bền vững. Đây là app Node.js chạy server, không phải thư mục HTML để upload vào hosting tĩnh/cPanel PHP.

Đã triển khai Render Free + Supabase ngày 08/10/2026: [website](https://chicong-photo-studio.onrender.com), [quản trị](https://chicong-photo-studio.onrender.com/admin). Tài khoản quản trị và 10 cài đặt từ bản local đã được chuyển sang PostgreSQL, giữ nguyên mật khẩu; không chuyển phiên đăng nhập. Database dùng TLS xác thực CA/hostname, bucket ảnh `chicong-private` giữ riêng tư. Tên miền `chicongphoto.vn` chưa được nối vào dịch vụ này.

Đã đạt 26 bài test tự động, kiểm tra health/API/trang công khai trên Render, chặn API quản trị khi chưa đăng nhập và kiểm thử ghi/đọc/xóa ảnh trên Supabase thật. Portfolio hiện chưa có ảnh. Đăng nhập tài khoản studio cũ để cập nhật thông tin liên hệ và đăng album; kiểm tra thêm luồng quản trị/gallery và dữ liệu qua restart theo [HOSTING.md](HOSTING.md).

Nếu quên mật khẩu quản trị, chạy `npm run admin:reset` trong terminal của máy/server có đúng database; tự nhập email và mật khẩu mới. Mật khẩu không hiển thị khi nhập, các phiên cũ bị vô hiệu. Không có reset password công khai hoặc gửi mail khôi phục.

## Mã nguồn

- `studio/server/app.mjs`: API, auth/session, upload, album, gallery, lịch và serving.
- `studio/server/db.mjs`: SQLite local / PostgreSQL khi deploy, schema.
- `studio/server/storage.mjs`: file local / private Supabase Storage.
- `studio/web/`: giao diện khách và quản trị, vanilla JavaScript/CSS.
- `studio/tests/`: integration tests, mock cloud Storage và fixture trình duyệt tách biệt.
- `render.yaml`, `.env.example`: cấu hình hosting.

Bản prototype trước nằm trong `legacy-prototype/`; thư mục WordPress gốc được giữ nguyên và không phục vụ trên website mới. Không đưa các thư mục này lên host/repository public.

## Kiểm tra

```sh
npm run check
npm test
npm audit --omit=dev
```

Integration tests kiểm tra đăng nhập, CSRF, quyền truy cập album/ảnh, upload và từ chối ảnh sai, lưu lựa chọn/CSV, đổi mật khẩu gallery, lưu dữ liệu, booking conflicts và không lộ ghi chú riêng. Các kiểm thử bổ sung kiểm tra upload đồng thời/thử lại không trùng, mã upload không được dùng cho file khác, sắp xếp ảnh khác album bị từ chối, trạng thái chuẩn bị studio và nâng cấp schema giữ dữ liệu cũ. Kiểm tra trình duyệt dùng database/file tạm riêng; không tạo account hoặc yêu cầu giả trong studio của bạn.

## Vận hành bản 2.1

Xem [OPERATIONS.md](OPERATIONS.md) cho checklist dùng hằng ngày, cập nhật và xử lý sự cố. Khi khởi động, bản 2.1 tự thêm cột/index vào schema cũ; không xóa hay tạo lại album. Sao lưu trước khi cập nhật phiên bản.

Bản 2.1.1 hoàn thiện thao tác chọn ảnh trong lightbox, cập nhật lựa chọn tại chỗ để giữ vị trí xem, tăng cỡ chữ và vùng bấm trên điện thoại. Ở thời điểm phát hành 2.1.1, website chỉ chạy local; trạng thái hosting hiện tại nằm ở mục Hosting miễn phí phía trên.

## Hoàn thiện đặt lịch · 2.2.0

Bổ sung đổi ngày chụp và ghi chú riêng trong **Yêu cầu đặt lịch → Xem**. Một lần lưu cập nhật cả ngày, trạng thái và ghi chú. Ngày chụp mới không được nằm trong quá khứ; vẫn có thể cập nhật ghi chú/trạng thái hoàn thành cho các buổi chụp cũ. Ghi chú riêng chỉ có trong API quản trị và bản sao JSON, không xuất hiện trong thông tin lịch công khai.

Nâng cấp tự thêm cột `inquiries.notes` mặc định rỗng, giữ nguyên các yêu cầu hiện có. Sao lưu trước khi chạy bản mới. Bản 2.2.0 đã kiểm tra 24 bài test tự động trên SQLite và luồng trình duyệt desktop/mobile với database tạm riêng; kết quả kiểm thử cloud hiện tại nằm ở mục Hosting miễn phí phía trên.

## Giao diện tinh giản · 2.2.1

Website và studio dùng chung bảng màu trắng ngà/xanh rêu, hệ thống nút và ô nhập liệu, biểu tượng SVG nét mảnh. Tiêu đề quản trị ngắn hơn; thanh điều hướng mobile tự đưa mục đang chọn vào vùng nhìn thấy. Bảng yêu cầu đặt lịch chuyển thành danh sách thông tin trên điện thoại để không phải cuộn ngang. Các trạng thái chưa có album/ảnh cũng có bố cục riêng.

Kiểm tra trình duyệt trên 11 trang ở các độ rộng 320, 390, 768 và 1440px: không tràn ngang; tìm kiếm, lọc, lưu yêu cầu, tạo album, menu mobile, mở gallery, chọn ảnh và gửi lựa chọn hoạt động. Bộ 24 bài kiểm thử vẫn qua. Toàn bộ dữ liệu thử nằm trong fixture tạm; cập nhật giao diện không thay đổi database thật.

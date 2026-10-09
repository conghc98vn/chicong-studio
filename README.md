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

## Hosting và Tên miền

Xem [HOSTING.md](HOSTING.md): Render Free + Supabase PostgreSQL/Storage, cấu hình chính thức cho [chicongphoto.vn](https://chicongphoto.vn). Production từ chối chạy nếu không cấu hình database và Storage lưu bền vững. Đây là app Node.js chạy server, không phải thư mục HTML tĩnh để upload vào hosting cPanel PHP.

Đã triển khai và kết nối tên miền chính thức ngày 09/10/2026: [website](https://chicongphoto.vn), [quản trị](https://chicongphoto.vn/admin). Tên miền `chicongphoto.vn` hoạt động qua HTTPS với proxy Cloudflare, kết hợp Cloudflare Web Analytics và Schema.org JSON-LD structured data. Database dùng TLS xác thực CA/hostname, bucket ảnh `chicong-private` trên Supabase giữ riêng tư.

Hệ thống đã xác minh 56 bài test tự động (gồm SEO URL slug, retry upload, bảo mật gallery, CSRF và Schema.org). Portfolio hiện đã công khai 7 album với 284 ảnh thực tế phục vụ định dạng WebP tối ưu. Đăng nhập tài khoản studio để cập nhật ảnh chân dung, thông tin liên hệ và quản trị album/gallery theo [HOSTING.md](HOSTING.md) và [OPERATIONS.md](OPERATIONS.md).

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

## Hoàn thiện tư vấn · 08/10/2026

Khách có thể để email hoặc điện thoại; ngân sách dự kiến không bắt buộc và báo giá vẫn gửi riêng. Form chỉ rõ trường sai, có trạng thái đang gửi và giữ nội dung khi lỗi mạng. Mã lần gửi bảo vệ thao tác thử lại khỏi tạo trùng; database tự bổ sung các cột, không xóa yêu cầu cũ. Ngày chụp vẫn được máy chủ kiểm tra kể cả khi lịch trên giao diện tạm chưa tải được.

Trong **Website**, điền **Thời gian phản hồi thực tế** nếu đã có cam kết; để trống sẽ không hiện lời hứa thời gian. Facebook chỉ hiện khi có đường dẫn được cấu hình. Việc nhận yêu cầu vẫn cần chủ studio mở quản trị kiểm tra, chưa có email tự động.

Đã kiểm tra 43 tests cùng các tình huống lỗi trên trình duyệt. Xem [kết quả kiểm thử](docs/consultation-enhancements-2026-10-08.md) để biết phạm vi và giới hạn xác minh.

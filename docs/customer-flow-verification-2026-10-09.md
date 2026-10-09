# Xác minh email và luồng nhận khách · 09/10/2026

## Website thật — chicongphoto.vn

- Gửi form liên hệ trên giao diện mobile bằng dữ liệu ghi rõ KIỂM THỬ MOBILE 09-10-2026, không chọn ngày chụp. Form hiển thị thành công với mã `480cd1df`.
- Resend hiển thị **Delivered** cho cả thông báo studio và email xác nhận khách của mã trên. Cả hai được gửi về hộp thư studio để thử, không gửi đến khách thật. Đây là xác nhận giao từ nhà cung cấp; chưa kiểm tra vị trí Inbox/Spam của thư mới.
- Trong quản trị đã thấy đúng nội dung yêu cầu, đổi sang **Hoàn thành**, lưu ghi chú riêng xác định đây là dữ liệu thử. Danh sách hiển thị trạng thái đã lưu. Không giữ lịch chụp.
- Form liên hệ có chiều rộng DOM thực tế 390px, scrollWidth 390px, không tràn ngang tại thời điểm kiểm tra.
- Portfolio hiển thị 7 album; mở Wedding on Film (37 ảnh), mở ảnh lớn và chuyển từ ảnh 1 sang ảnh 2 thành công.

## Gallery — môi trường thử local

Chạy `studio/tests/manual-fixture.mjs` bằng database và ảnh tạm riêng, không dùng gallery khách thật.

- Đăng nhập gallery bằng mật khẩu fixture.
- Mở lightbox, chọn ảnh 1, chuyển sang ảnh 2: số ảnh chọn vẫn là 1.
- Gửi lựa chọn thành công; tải lại trang vẫn giữ ảnh chọn và trạng thái đã gửi.
- Đăng nhập quản trị fixture: Tổng quan báo khách đã gửi lựa chọn; chi tiết album hiển thị **1 ảnh được chọn**, **Khách đã gửi**, đúng `test-1.jpg`.
- Giao diện gallery dùng bố cục mobile; chiều rộng DOM thực tế đo được 487px và scrollWidth 487px. Không coi đây là xác minh gallery tại 390px.

## Kiểm thử mã nguồn

- `npm run check`: đạt.
- `npm test`: 59 đạt, 0 lỗi, 1 bỏ qua (PostgreSQL cần database thử riêng).
- Có kiểm thử thông báo email, retry không gửi trùng, lỗi mail không làm mất yêu cầu, gallery riêng và quyền truy cập ảnh.

## Bằng chứng và giới hạn

Ảnh nằm trong `output/verification-2026-10-09/` (không đưa vào Git):

- `emails-delivered.jpg`
- `contact-success-mobile.jpg`
- `admin-test-completed.jpg`
- `gallery-mobile.jpg`
- `gallery-admin.jpg`
- `album-mobile.jpg`

Chưa kiểm tra điện thoại vật lý/mạng di động, gallery mới trên cloud, khả năng khôi phục backup hoặc giao email đến nhà cung cấp hộp thư khác. Không đổi cấu hình hosting và không deploy mã ứng dụng trong phiên này: email đã được cấu hình, xác minh trực tiếp cho thấy hoạt động. Đã sửa các đoạn tài liệu cũ vẫn nói chưa có email tự động.

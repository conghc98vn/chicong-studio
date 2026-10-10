# Rà soát wording · 10/10/2026

Đã tiếp tục phần chỉnh sửa còn trong workspace sau khi phiên trước bị ngắt kết nối.

## Nội dung hoàn thiện

- Rà soát trang chủ, danh sách bộ ảnh, chi tiết bộ ảnh, giới thiệu, liên hệ, bộ ảnh riêng và trang quản trị; chỉnh cả nội dung dịch vụ trong module dùng chung.
- Thống nhất các nhãn chức năng: Bộ ảnh, Yêu cầu tư vấn, Tải ảnh lên, Cài đặt. Theo yêu cầu xem lại của chủ website, header giữ “Wedding Photographer” và menu “Portfolio · About · Contact” như trước. Giữ tên thương hiệu, tên bộ ảnh và thông tin tác giả gốc.
- Chỉnh lời giới thiệu, lời mời liên hệ và hướng dẫn theo giọng gần gũi, dùng “mình – hai bạn” cho nội dung ngày cưới.
- Làm rõ mục bắt buộc, cách để trống ngày/ngân sách, thông báo lỗi và bước tiếp theo sau khi gửi yêu cầu. Gửi tư vấn chưa có nghĩa là đã giữ lịch chụp.
- Tách trạng thái “Đang chọn ảnh” của khách khỏi trạng thái “Bản nháp” của bộ ảnh. Màn hình lịch trống có thông báo riêng, không dùng thông báo chưa có yêu cầu tư vấn.
- Đồng bộ nhãn ngân sách, mã yêu cầu và nội dung email với website. Các giá trị ngân sách đã lưu vẫn được giữ nguyên.
- Nội dung mặc định cũ được nâng cấp khi trùng chính xác; nội dung studio tự viết và những mục cố ý để trống vẫn được giữ lại.
- Sửa việc chèn nội dung HTML ban đầu bị phụ thuộc vào nguyên văn câu tải trang. Bổ sung kiểm thử để thay wording không làm mất phần nội dung HTML phục vụ SEO.
- Cập nhật CSS bảng trên điện thoại theo nhãn dịch vụ mới.

## Xác minh

- `npm run check`: đạt.
- `npm test`: 75 đạt, 0 lỗi; 1 bài PostgreSQL bỏ qua do không cấu hình môi trường kiểm thử tương ứng.
- Chrome: kiểm tra ở chiều rộng 360, 390, 768 và 1440 px; không phát hiện tràn ngang ở các trang đã kiểm tra.
- Kiểm tra tạo/sửa bộ ảnh, tải ảnh, đường dẫn và chuyển hướng; gửi tư vấn, lỗi số điện thoại, nhãn ngân sách trong quản trị; mở bộ ảnh riêng, chọn/gửi lựa chọn và đóng bộ ảnh. Không có lỗi JavaScript ở cấp trang trong lượt kiểm tra.
- Xem ảnh chụp trang giới thiệu trên máy tính, trang liên hệ và cài đặt trên điện thoại. Ảnh và script kiểm tra bổ sung nằm trong `output/wording-review/` và `output/wording-review-smoke.mjs` (được Git bỏ qua).
- Kiểm tra trên dữ liệu tạm, không gửi email thật hoặc tạo yêu cầu trong dữ liệu studio đang sử dụng.

Review lần cuối trước khi push: kiểm tra cú pháp, bộ kiểm thử tự động và lượt kiểm tra Chrome nêu trên đều đạt sau khi khôi phục header theo yêu cầu. Việc push mã nguồn không xác nhận website chính thức đã triển khai xong bản cập nhật.

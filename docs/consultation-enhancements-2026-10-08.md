# Hoàn thiện luồng tư vấn — 08/10/2026

## Đã thay đổi

- Form dùng chung quy tắc kiểm tra phía trình duyệt và API. Lỗi xuất hiện cạnh trường nhập, liên kết bằng aria-describedby; focus vào trường sai đầu tiên. Email hoặc điện thoại là đủ, nhưng thông tin đã điền phải hợp lệ.
- Các lần nhập sai không tính vào quota 5 yêu cầu hợp lệ/15 phút. Guard ngoài vẫn giới hạn 60 lần gọi API/15 phút/IP để chống lạm dụng.
- Request key duy nhất và hash nội dung giúp retry không tạo trùng; replay đã lưu trả về cùng mã yêu cầu, kể cả ngày sau đó bị chặn. Nội dung thay đổi không được dùng lại key cũ. API cũ không gửi key vẫn được hỗ trợ.
- Nút thể hiện đang gửi; khóa input trong lúc chờ. Timeout/network error giữ form và cho thử lại. Session storage chỉ lưu mã ngẫu nhiên và digest nội dung; không lưu bản nháp có thông tin cá nhân.
- Lỗi API lịch không ngăn hiển thị/gửi form. Có nút tải lại lịch. Server vẫn kiểm tra ngày khi nhận yêu cầu.
- Tiêu đề và form dùng cùng trục 760px; mô tả và credit album có computed font-size 15px. Giảm lặp ở phần mở đầu và gợi ý ngân sách; không có giá gợi ý.
- Nội dung Về mình chia đoạn; bổ sung việc thống nhất phạm vi chụp, hình thức bàn giao và thời gian nhận ảnh trước khi xác nhận lịch. Không tự đặt thời hạn bàn giao.
- Sáu album số có mô tả riêng dựa trên ảnh bìa đã kiểm tra; credit cộng tác được giữ nguyên. Nội dung tự nhập khác bản import sẽ được ưu tiên.
- /api/portfolio?view=cards trả metadata, tổng số ảnh, ảnh bìa/ảnh được chọn. Chi tiết album vẫn tải đầy đủ khi mở. Về mình không gọi API portfolio.

## Xác minh

- npm run check: pass.
- npm test: 43/43 pass, gồm migration dữ liệu cũ, phone/email, quota, retry đồng thời, replay sau khi ngày bị chặn, request key/content mismatch, request timeout và lựa chọn ảnh cho API cards.
- Kiểm thử trình duyệt trên dữ liệu tạm: điện thoại sai cạnh email đúng focus chính xác vào điện thoại; message lỗi không làm đổi accessible name của field.
- Mô phỏng server lưu thành công nhưng cắt kết nối trước khi phản hồi: trình duyệt giữ nội dung, retry thành công; truy vấn database xác nhận đúng 1 request.
- Mô phỏng availability 503: form vẫn dùng được và có thông báo + nút tải lại. Mô phỏng portfolio 503: Về mình vẫn hiển thị.
- 1440px: contact-title và contact-layout có cùng x=340px.
- 390px: form/lỗi dùng được. 320px: portfolio, album và contact không tràn ngang; input 16px, mô tả/credit album 15px. 768px: trang chủ không tràn ngang, 3 slide có ảnh mở đầu tải thành công.
- Chọn ngày, đổi tháng, bỏ ngày: đúng; ngày đã chọn giữ nguyên khi đổi tháng.
- Payload API đo trên portfolio local: 83.515 byte/284 photo objects trước; cards 8.209 byte/25 photo objects. Đây là kích thước JSON, không phải số đo tốc độ tải trang hoặc dung lượng file ảnh.
- Không tạo inquiry giả trong data/live. Không triển khai production. PostgreSQL thật, thiết bị vật lý và mạng di động chưa được kiểm thử trong lượt này.

## Vận hành và thông tin còn thiếu

- Trong Studio → Website có trường thời gian phản hồi thực tế, mặc định trống. Khi chủ studio điền, nội dung hiện trước và sau gửi form. Không tự hứa 24h/48h khi chưa có cam kết.
- Facebook vẫn chờ chủ studio xác nhận đường dẫn. Có trường cấu hình và icon, chỉ hiện khi đã điền.
- Studio cần tự kiểm tra yêu cầu mới đều đặn, ví dụ đầu và cuối ngày làm việc, rồi cập nhật trạng thái đã liên hệ. Chưa cài lịch tự động hoặc gửi email thông báo.
- Trước quảng bá rộng, xác nhận hình thức bàn giao và thời gian trả ảnh dùng khi tư vấn. Nội dung công khai giữ báo giá riêng.

## Ảnh kiểm tra

- output/enhanced-contact-desktop.jpg
- output/enhanced-form-error-mobile.jpg

Fixture lỗi trình duyệt: node studio/tests/consultation-fixture.mjs, port 4180, database tạm được xóa khi dừng bằng SIGTERM/SIGINT. Không dùng cho hosting.

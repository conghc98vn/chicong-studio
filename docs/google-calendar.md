# Google Calendar → Studio

Cập nhật 21/10/2026. Đồng bộ một chiều từ **private iCal feed** của Google Calendar, không dùng Gmail và không tự ghi booking từ Studio về Google.

## Cấu hình

Đặt `GOOGLE_CALENDAR_ICS_URL` trong cấu hình bí mật của server rồi restart. URL phải là HTTPS `calendar.google.com/calendar/ical/...`; không đặt trong frontend, iframe, Git hoặc report chia sẻ. Không cần công khai lịch Google.

Mặc định bỏ sự kiện được đánh dấu **Free/Transparent**. Nếu studio dùng sự kiện cả ngày ở trạng thái Free để lưu lịch chụp, đặt `GOOGLE_CALENDAR_INCLUDE_FREE=true`. Đây là lựa chọn nghiệp vụ theo env, không phải mặc định cho mọi môi trường.

## Hoạt động

Trang Cài đặt hiển thị trạng thái, lần đồng bộ thành công và các ngày bận. Server đọc khi có yêu cầu, cache năm phút, timeout fetch mười giây và giới hạn feed 5 MB. Trình duyệt khách chỉ nhận ngày bận; không nhận tiêu đề/mô tả sự kiện hoặc URL bí mật.

Phạm vi từ hôm nay đến hết ngày cách 730 ngày theo Asia/Ho_Chi_Minh. Một sự kiện bận chặn cả ngày studio. Có xử lý recurrence, ngoại lệ, đổi ngày, sự kiện hủy và ngày kết thúc độc quyền của sự kiện cả ngày.

Khi refresh lỗi, giữ dữ liệu cũ nhưng đánh dấu chưa xác minh được lịch. Yêu cầu có ngày, xác nhận mới hoặc đổi lịch phải đợi kiểm tra thành công; khách vẫn có thể gửi tư vấn không chọn ngày. Ngày ngoài phạm vi cũng bị từ chối khi tích hợp bật. Bỏ biến URL làm tích hợp tùy chọn này tắt, không làm mất lịch studio trong DB.

## Kiểm tra

`studio/tests/google-calendar.test.mjs` kiểm timezone, recurrence, cache, lỗi/giấu secret và API xung đột ngày. Test API dùng ngày tương đối để không tự hỏng khi thời gian thực trôi qua. Chạy `node --test studio/tests/google-calendar.test.mjs` với Node 24, không cần feed thật.

Ghi nhận 09/10 trước đây: lịch thử ban đầu không có ngày Busy; bật include-free đưa các lịch chụp Transparent vào danh sách. Đây là lịch sử, không xác nhận env hoặc lịch live hôm nay. [Trạng thái triển khai và bằng chứng](handbook/README.md).

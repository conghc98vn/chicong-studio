# Kiểm tra vận hành ngày 09/10/2026

- Tên miền https://chicongphoto.vn đã hoạt động qua HTTPS. Các đoạn trong README/HOSTING nói chưa nối tên miền là thông tin cũ.
- Đã lưu điện thoại công khai `0969910198` qua Studio và xác minh API site, trang liên hệ, liên kết `tel:`.
- `/api/health` trả `{"ok":true}`.
- Chrome ở viewport 390 × 844: trang chủ và liên hệ không tràn ngang; album Wedding on Film mở được, lightbox chuyển từ ảnh 1 sang ảnh 2/37.
- `npm run check` đạt; `npm test`: 56 đạt, 0 lỗi, 1 bài PostgreSQL bỏ qua do chưa cấu hình database thử riêng.
- Đã tải ảnh đại diện công khai từ Facebook CC.PhotoLife (photo ID 4096199897320891) và lưu sẵn tại `data/imports/portrait-chi-cong.jpg` để chủ studio tải lên qua giao diện Quản trị (`/admin` → Website). Chưa đổi portrait trên production.
- Đã thực hiện snapshot sao lưu toàn bộ dữ liệu công khai lúc 09:15 tại `data/backups/launch-2026-10-09/public-1791512046057` (7 album, 284 ảnh, 568 file WebP và SQLite database tái tạo, hash SHA-256 đối chiếu khớp 100%).
- Đã đồng bộ `README.md` và `HOSTING.md` với trạng thái vận hành thực tế của `chicongphoto.vn`.
- Chưa kiểm tra bằng điện thoại vật lý/mạng di động; chưa thử gallery cloud mới hoặc gửi yêu cầu tư vấn mới trong phiên này.
- Chưa cấu hình email thông báo, đang chờ địa chỉ nhận từ chủ studio.

Ảnh kiểm chứng số điện thoại trên trang liên hệ nằm trong `output/launch-2026-10-09/contact-mobile.jpg` (không đưa vào Git).

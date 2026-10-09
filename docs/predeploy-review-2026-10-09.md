# Kiểm tra trước deploy — 09/10/2026

Không phát hiện lỗi chặn deploy trong phạm vi đã kiểm tra. Chưa commit, push hoặc deploy. Dữ liệu thử nằm trong fixture local và PostgreSQL Docker tạm; không thay đổi production.

## Thay đổi

- Dịch vụ ẩn khỏi menu, trang chủ và sitemap; `/services`, `/services/`, `/SERVICES` và URL có query chuyển hướng 302 về `/`. Giữ nội dung và CSS để dùng lại.
- Sửa nhãn Tổng quan: khi đã có album, hiển thị **Tạo album mới**, thay vì **Tạo album đầu tiên**. Đã kiểm tra giao diện sau sửa.

## Kết quả

- `npm run check`: đạt.
- `npm test`: 59 đạt, 0 lỗi; bài PostgreSQL bỏ qua trong lệnh mặc định.
- Chạy riêng `album-slug-postgres.test.mjs` trên PostgreSQL 16 Docker tạm: 1 đạt. Bao gồm migration, lịch sử URL, RLS và 20 yêu cầu tạo/sửa album đồng thời. Tổng cộng 60 bài chạy đạt qua hai lượt. Container thử đã dừng và tự xóa.
- `npm audit --omit=dev`: 0 lỗ hổng được báo tại thời điểm kiểm tra.
- `git diff --check`: đạt.
- Bốn trang công khai trả 200, metadata không còn placeholder; trang không tồn tại trả 404.
- Trang chủ, portfolio, giới thiệu, liên hệ ở 320, 390, 768, 1440px: 16 tổ hợp không tràn ngang và không có liên kết services.
- Sau khi tạo album có ảnh bằng API fixture, kiểm tra lại trang chủ, portfolio và album ở bốn kích thước: thêm 12 tổ hợp không tràn ngang.
- Menu mobile mở được và dẫn đến Liên hệ.
- Form thiếu liên hệ báo lỗi đúng, giữ nội dung. Thêm số điện thoại, để trống email/ngày: gửi thành công; đúng một yêu cầu được lưu trong quản trị.
- Gallery 390px: từ chối mật khẩu sai; mật khẩu đúng mở được; chọn ảnh, gửi, tải lại giữ lựa chọn; lightbox mở; đóng gallery quay về màn hình mật khẩu.
- Quản trị ghi nhận yêu cầu mới và đúng một ảnh khách chọn với trạng thái Khách đã gửi. Dashboard 390px không tràn ngang.
- Album công khai mở lightbox, Escape đóng được. Console lượt kiểm tra cuối không ghi lỗi/cảnh báo.
- Truy cập services trên trình duyệt chuyển về trang chủ.

Ảnh kiểm chứng: `output/predeploy-2026-10-09/contact-320.jpg` và `gallery-390.jpg` (không đưa vào Git).

## Giới hạn

PostgreSQL thử local, không phải Supabase production. Storage và email có kiểm thử mock; email production đã xác minh Delivered ở phiên trước, không gửi lại trong phiên này. Chưa thử điện thoại vật lý, mạng di động hoặc tải lớn. Sau deploy cần kiểm tra health, album và form trên host thật.

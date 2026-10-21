# Bản vá bảo mật — 13/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Đã sửa trong working tree trên nền commit `754573d1a4b9d0a8458e8728fecfd613164b0a3a`. Tại thời điểm lập báo cáo: chưa commit, push hoặc deploy. Database và ảnh production không bị thay đổi trong lúc sửa/kiểm thử.

## Thay đổi

| Phát hiện | Bản vá | Trạng thái |
|---|---|---|
| S-01: cache ảnh sau khi đổi quyền | Ảnh công khai và chân dung dùng `private,no-cache`, giữ ETag; ảnh private hoặc bị từ chối dùng `private,no-store`. Kiểm tra quyền diễn ra trước 304, cả GET và HEAD. | Đã sửa và kiểm thử |
| S-02: tạo quota bằng ID gallery tùy ý | Giới hạn tổng 60 lần/IP/15 phút; kiểm tra ID; chỉ tạo quota riêng 8 lần/gallery/IP/15 phút khi gallery private có thật. Thêm index expiry, dọn tối đa mỗi phút khi có request. | Đã sửa và kiểm thử |
| S-03: Host tùy ý trên local | Chặn Host ngoài loopback hoặc địa chỉ cấu hình; Origin phải đúng cấu hình. Nếu có SETUP_TOKEN thì luôn kiểm tra, kể cả loopback. Chỉ kết nối loopback tới hostname loopback mới được thiết lập không token khi chưa cấu hình token. | Đã sửa và kiểm thử |
| C-01: IP qua proxy | Thêm TRUST_PROXY rõ ràng, từ chối `true`, kiểm thử bỏ qua header giả khi tắt proxy và chọn IP từ chuỗi proxy tin cậy. | Đã bổ sung cấu hình; chưa xác minh chuỗi proxy production |

Production yêu cầu `SITE_URL` là HTTPS origin hợp lệ. API ghi không còn chấp nhận Origin chỉ vì khớp Host do request gửi lên. Health check GET vẫn hoạt động qua địa chỉ hosting. Hướng dẫn thiết lập qua domain Render và truy cập LAN được cập nhật để dùng đúng SITE_URL.

C-01 chưa có bằng chứng rằng một hop hiện tại trên Render sai, nên bản vá giữ mặc định này. Thay đổi số hop khi chưa kiểm chứng có thể khiến nhiều khách dùng chung quota hoặc tin IP giả. Cần kiểm tra đường đi Cloudflare/Render trước khi thay cấu hình production.

## Kiểm chứng

- `npm run check`: qua.
- `npm test` mặc định: 90 qua, 1 bài PostgreSQL bỏ qua vì chưa đặt URL test.
- `npm test` với PostgreSQL 16 trong container tạm: **91/91 qua, không bỏ qua**. Các test bảo mật mới sử dụng schema PostgreSQL riêng, tự xóa sau khi chạy.
- 11 test bảo mật mới cũng chạy riêng trên SQLite: **11/11 qua**.
- Test đồng thời: 80 request đổi ID gallery từ cùng IP chỉ tạo một quota chung; 60 phản hồi 401 và 20 phản hồi 429. Dọn expiry chạy một lần, không chạy lại trên từng request.
- Test chuyển album qua API từ published sang private/archived: request không có quyền, kể cả mang ETag cũ, trả 404/no-store; không trả 304.
- Test local Host giả không tạo admin hoặc rate-limit record. Host loopback hợp lệ và Origin LAN cấu hình rõ ràng vẫn hoạt động; token đã cấu hình được thực thi.
- `git diff --check`: qua.

Log suite với PostgreSQL (artifact local, ngoài Git: `output/security-fixes-tests-2026-10-13.txt`).

## Khi triển khai

SITE_URL production hiện đã được khai báo là `https://chicongphoto.vn` trong Blueprint. Cần deploy bản mới để các bản vá có hiệu lực trên website thật. Truy cập admin và gửi form trên đúng domain này; domain preview cần SITE_URL tương ứng.

Index mới được thêm qua migration idempotent, không xóa dữ liệu. Cache nhận header cũ trước deploy có thể còn fresh tối đa một giờ từ lần nhận header cũ. Nếu CDN có quy tắc cache riêng, purge ảnh cần thu hồi và bảo đảm quy tắc không ghi đè header mới. Ảnh đã tải về không thể thu hồi bằng thay đổi cache.

Ảnh công khai sẽ có thêm request kiểm tra lại quyền so với cache một giờ trước đây; ETag vẫn giúp tránh tải lại nội dung ảnh không đổi. Việc dọn rate limit được kích hoạt theo request, không có timer chạy nền khi app không nhận traffic.

Các thay đổi chính nằm ở [app.mjs](../../studio/server/app.mjs), [request-security.mjs](../../studio/server/request-security.mjs), [db.mjs](../../studio/server/db.mjs) và [security.test.mjs](../../studio/tests/security.test.mjs).

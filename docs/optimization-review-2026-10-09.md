# Tối ưu FE và BE — 09/10/2026

- FE: tải cấu hình website và portfolio cards đồng thời trên trang chủ/portfolio, loại bỏ phụ thuộc tuần tự giữa hai API.
- BE: portfolio cards lấy ảnh theo lô thay cho truy vấn riêng từng album. Kiểm thử 8 album xác nhận 3 truy vấn thay vì 10; vẫn chỉ trả ảnh bìa, ảnh đầu và ảnh được tuyển chọn.
- BE: dùng Set tra cứu ảnh được chọn thay vì tìm tuyến tính cho từng ảnh.
- Media: ETag phân biệt ảnh đầy đủ/thumbnail. Kiểm tra quyền trước kiểm tra cache; conditional request hợp lệ trả 304 và HEAD không đọc Storage. Gallery riêng giữ private,no-store; album bị ẩn không được đọc bằng ETag cũ.
- Khởi động: chèn cấu hình mặc định bằng một câu INSERT với ON CONFLICT DO NOTHING, giữ giá trị đã chỉnh.

## Kiểm chứng

62/62 bài test đạt với STUDIO_TEST_POSTGRES_URL trỏ PostgreSQL 16 Docker tạm, không bỏ qua bài nào. Kiểm tra cú pháp và git diff --check đạt. Đã thêm test đếm truy vấn, đếm đọc Storage, thumbnail ETag và quyền gallery/album bị ẩn; bổ sung kiểm tra portfolio cards trên PostgreSQL. Container PostgreSQL thử đã dừng và tự xóa.

Trình duyệt local: trang chủ có ảnh, portfolio mobile, album và lightbox hoạt động; album 390px không tràn ngang, console lượt kiểm tra cuối không ghi lỗi. Ảnh kiểm chứng ở output/predeploy-2026-10-09/optimized-album-390.jpg.

Chưa đo latency hoặc Core Web Vitals trên hosting thật, chưa load test. Không thay đổi cấu hình production, không push/deploy. Trang Dịch vụ vẫn ẩn. Kết quả nêu trên đo số truy vấn và đọc Storage, không phải cam kết phần trăm tốc độ tải trang.

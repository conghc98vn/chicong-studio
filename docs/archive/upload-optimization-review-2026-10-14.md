# Nâng cấp upload & tối ưu ảnh — 14/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Đã nâng cấp luồng upload hiện có và kiểm thử bằng hai file Lightroom do chủ dự án cung cấp. File nguồn được đọc và đối chiếu hash; không ghi đè. Bản xem thử chạy tại localhost:4173; chưa triển khai cloud.

## Cấu hình đã chọn

- Bản xem lớn: cạnh dài tối đa 2400 px, WebP quality 88, effort 6, smartSubsample.
- Thumbnail: cạnh dài tối đa 900 px, WebP quality 80, effort 6, smartSubsample.
- Giữ tỷ lệ, tự xoay theo EXIF, chuyển màu về sRGB; không phóng lớn, tăng nét hay chỉnh lại ánh sáng/màu sắc. Loại bỏ EXIF/GPS.
- Tạo từng bản trực tiếp từ file đầu vào để tránh thumbnail bị nén thêm một lần qua bản WebP lớn.
- Không hạ quality liên tục để ép trần dung lượng. So sánh vùng da, tóc và hoa ở cùng kích thước cho thấy quality thấp hơn giảm chi tiết nhỏ. Cấu hình cuối ưu tiên chi tiết hơn cấu hình cũ quality 86; vì vậy file web có thể lớn hơn một chút so với bộ nén cũ, trong khi vẫn giảm mạnh so với JPEG Lightroom.

## Đo trên file thật

Dung lượng dùng đơn vị thập phân: 1 MB = 1.000.000 byte.

| File | JPEG đầu vào | WebP xem lớn | Thumbnail | Kích thước web | Giảm tổng dung lượng |
| --- | ---: | ---: | ---: | --- | ---: |
| CC - 0546.jpg | 7.221.518 B | 639.330 B | 111.082 B | 2400 × 1601 | 89,6% |
| CC - 0201.jpg | 6.018.278 B | 351.320 B | 54.478 B | 1600 × 2400 | 93,3% |

Thời gian xử lý riêng hai ảnh trong một lượt đo trên máy local: khoảng 1,37 giây và 1,08 giây; chưa phải benchmark máy chủ cloud. Ảnh tham chiếu được resize cùng 2400 px trước khi cắt vùng để so sánh công bằng với WebP. Nén WebP là lossy, vẫn có khác biệt ở chi tiết khi xem sát; không khẳng định giống từng pixel với JPEG hay phù hợp để in.

Trang so sánh local: `http://localhost:4173/upload-review/`. Các file kết quả, ảnh chụp, báo cáo JSON và hash đầu vào nằm trong `output/upload-review/` (Git bỏ qua).

## Hành vi và xử lý lỗi

- Báo số ảnh đã lưu, dung lượng đầu vào của các ảnh đó, bản web, thumbnail và phần trăm giảm cả hai bản cộng lại.
- Lưu số byte vào database bằng migration bổ sung ba cột nullable. Dữ liệu cũ vẫn nguyên vẹn và không có số liệu giả. Chỉ API quản trị trả các số liệu này.
- Lỗi từng file có mã/lý do/hướng xử lý: file rỗng, hỏng/truncated, sai định dạng, ảnh động, quá 8 MiB/40 megapixel; kiểm tra nội dung thực thay vì chỉ tin đuôi file hoặc MIME.
- File không hợp lệ được tách khỏi những file còn hợp lệ. File lỗi cố định cần chọn bản xuất mới; lỗi lưu tạm thời có nút thử lại.
- Retry theo mã riêng từng file: không tạo bản trùng sau khi mất phản hồi; số liệu lưu trữ được trả lại từ database. Mở lại trang/chọn lại file là một lượt mới.
- Nếu lưu thumbnail thất bại, dọn bản web và không tạo record ảnh thành công. Có test mô phỏng lỗi kho lưu trữ rồi thử lại.
- Chia nhóm tối đa 8 file, giới hạn tổng khoảng 12 MiB mỗi nhóm, giảm bộ nhớ và thời gian chờ cho ảnh Lightroom lớn.
- Tên file hiển thị được escape HTML. Báo lỗi kho dữ liệu không lộ thông tin nội bộ.
- Sửa tương phản chữ nhãn và chữ ký sidebar được phát hiện trong audit desktop.

## Kiểm chứng

- `npm run check`: đạt.
- Bộ đầy đủ có PostgreSQL 16 cô lập: **115/115 đạt, 0 bỏ qua**.
- 12 test chuyên về optimizer, queue và API: đạt. API mới chạy cả SQLite và PostgreSQL.
- Migration SQLite/PostgreSQL: bổ sung cột trên schema cũ, giữ ảnh cũ, chạy lại an toàn. Số liệu ảnh mới giữ nguyên sau mở database lại và retry.
- Kiểm tra hướng EXIF, chuyển ICC Display P3 → sRGB, màu mẫu sai lệch dưới 5/255 mỗi kênh, alpha, ảnh nhỏ không phóng lớn, định dạng giả, file truncated và giới hạn pixel.
- Browser upload dùng đúng hai file Lightroom: thành công một phần; lỗi file rõ ràng; mất phản hồi rồi retry giữ một ảnh; file >8 MiB không chặn file tốt; số liệu tồn tại sau reload; lightbox tải được ảnh.
- Responsive phần upload/report: 320, 390, 768, 1440 px, không tràn ngang. Axe trên trang có báo cáo và lỗi: không phát hiện violations trong các rule WCAG 2 A/AA, 2.1 AA, 2.2 AA đã chạy. Các mục cần xác minh thủ công giữ trong JSON; đây không phải chứng nhận WCAG.
- UX section mở rộng: **19/19 đạt**. Browser sections và browser album/slug: đạt các luồng CRUD, upload, lọc, lightbox, lựa chọn, preset, homepage và portfolio.

## Giới hạn cần biết

File đầu vào vẫn được truyền lên rồi mới tối ưu. Muốn giảm băng thông upload, xuất thêm bản JPEG web từ Lightroom; không cần làm để sử dụng tính năng hiện tại với hai ảnh mẫu. Giới hạn đầu vào vẫn 8 MiB/40 MP. Ảnh web đã có trước đây không bị nén lại. Chưa kiểm thử trên iPhone/Android thật hoặc tải đồng thời lớn trên hosting. Việc đánh giá hình ảnh mới dựa trên hai ảnh mẫu; ảnh nhiễu, grain hoặc màu HDR có thể cần đánh giá thêm. Các kiểm thử và demo dùng dữ liệu local/database tạm, không dùng production.

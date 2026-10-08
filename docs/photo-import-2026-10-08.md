# Sáu bộ ảnh portfolio — 08/10/2026

Đã lưu 247 ảnh từ sáu bài đăng do chủ dự án cung cấp, nhập vào website **cục bộ** tại `http://127.0.0.1:4173/portfolio`. Chưa đồng bộ dữ liệu lên hosting.

| Album | Số ảnh |
| --- | ---: |
| Ceremony \| T & T | 45 |
| A New Chapter of Love | 48 |
| Love in the Details | 41 |
| Celebrating Love | 25 |
| Traditional Wedding | 40 |
| A Wedding Story | 48 |

Các album thuộc mục Ngày cưới, có ảnh bìa riêng và giữ credit cộng tác trong mô tả. Không đặt ngày sự kiện theo ngày đăng bài.

## Ảnh và dung lượng

- 247 bản JPEG tải từ Facebook được giữ nguyên, có cạnh dài 2048 px; đây là bản tải từ mạng xã hội, không phải RAW từ máy ảnh.
- Tạo 247 bản WebP đầy đủ, cạnh dài tối đa 2048 px, quality 84, effort 6; tự xoay theo metadata và không phóng lớn.
- Tăng nét nhẹ: sigma 0.45, m1 0.3, m2 0.8. Không thay đổi nội dung hoặc chỉnh lại màu ảnh.
- Tạo riêng 247 ảnh thu nhỏ từ JPEG gốc, cạnh dài tối đa 900 px, WebP quality 78.
- JPEG gốc: 59.11 MB. WebP đầy đủ: 47.57 MB, giảm 19.5%. Tổng thumbnail: 12.19 MB, giảm 79.4% so với JPEG gốc. Hai loại WebP cộng lại chiếm 59.76 MB; lợi ích của thumbnail là giảm dữ liệu tải khi xem danh sách ảnh.
- Website phục vụ ảnh qua `/media/…`; dữ liệu portfolio không có iframe hoặc URL Facebook/CDN Facebook.

## Nơi lưu

- Nội dung đang chạy: `data/live/studio.sqlite` và `data/live/uploads/`.
- JPEG theo album: `data/imports/facebook-2026-10-08/originals/`.
- WebP theo album: `data/imports/facebook-2026-10-08/optimized/`.
- Thumbnail: `data/imports/facebook-2026-10-08/thumbnails/`.
- ZIP JPEG: `data/imports/chicong-originals-247-photos.zip`.
- ZIP WebP đầy đủ: `data/imports/chicong-web-247-photos.zip`.
- Báo cáo xử lý: `data/imports/facebook-2026-10-08/report.json`.
- Báo cáo kiểm tra: `data/imports/facebook-2026-10-08/verification.json`.
- Bản sao database trước khi nhập nằm trong `data/backups/`; đường dẫn chính xác được ghi trong `report.json`.

Thư mục `data/` được loại khỏi Git theo cấu hình sẵn có. Khi chuyển lên hosting, cần chuyển cả dữ liệu album lẫn file ảnh qua luồng quản trị/lưu trữ của website; chỉ đẩy mã nguồn không chuyển các album này.

## Xác minh

- 247 SHA-256 khác nhau, không có ảnh tải trùng; đối chiếu hash của toàn bộ bản JPEG được lưu.
- API portfolio trả đủ 6 album và 247 ảnh đúng thứ tự, đúng ảnh bìa.
- 494 đường dẫn media trả HTTP 200 với MIME WebP, giải mã thành công và đúng kích thước.
- Không phát hiện đường dẫn Facebook trong JSON portfolio.
- Kiểm tra bố cục desktop và điện thoại: sáu album hiển thị, không tràn ngang trên màn hình nhỏ.
- Mở thử lightbox: ảnh đầy đủ 2048 px và bộ đếm 1/45 hoạt động.

Các script trong thư mục nhập là công cụ cho lần nhập này; không chạy lại script nhập vào database đã có sáu album.

# Hoàn thiện portfolio — 08/10/2026

Bản cập nhật hiện ở local. Chưa triển khai hosting.

- Đồng bộ Wedding Photographer, tên Chí Công và điện thoại 0969 910 198. Email, Instagram, Zalo chưa được cung cấp nên không hiển thị.
- Rút gọn wording, giảm lặp, bỏ địa điểm trên các trang công khai. Nội dung mặc định cũ được chuẩn hóa khi đọc; nội dung người dùng đã tùy chỉnh được giữ lại.
- Trang giới thiệu không dùng ảnh khách làm chân dung. Có thể tải JPEG/PNG/WebP riêng trong Studio → Website; chưa có chân dung thật thì dùng bố cục chữ.
- Form liên hệ đặt trước lịch thu gọn; ngày không bắt buộc. Kênh gọi trực tiếp ở đầu trang và footer. Dịch vụ tập trung vào chụp cưới film, số và kết hợp.
- Hero tuyển lại ảnh mặc định, nhẹ lớp tối; nút Phát/Tạm dừng hoạt động khi vẫn còn focus. Không dừng chỉ vì con trỏ nằm trên ảnh. Chế độ giảm chuyển động tắt tự phát lúc khởi tạo.
- Đổi bìa film để không lặp cảnh bước đi trong slideshow. Giảm độ lệch cột; thêm ảnh ngang toàn chiều rộng ở một số nhịp trong album.
- Giữ nguyên credit cộng tác, tách khỏi phần mô tả. Không tự đặt tên cặp đôi hoặc thông tin sự kiện.
- Studio → Website chọn tối đa 4 slide, ảnh máy tính/điện thoại riêng và 6 album nổi bật kèm preview. Chỉ ảnh thuộc album công khai được chấp nhận; các vị trí lỗi/ảnh bị gỡ có fallback.
- Metadata mô tả và ảnh chia sẻ trang chủ đồng bộ với nội dung/slideshow hiện tại.

## Kiểm tra

`npm run check`: kiểm tra cú pháp toàn bộ JavaScript server và frontend.

`npm test`: 29 bài qua, gồm quyền truy cập chân dung, ảnh không hợp lệ, lựa chọn ảnh công khai/riêng tư, lưu atomic, metadata, booking và gallery.

Trình duyệt: lưu curation, gửi form không chọn ngày trên fixture tạm riêng; nút phát/tạm dừng và tự chuyển slide; trang chủ, giới thiệu, portfolio và album ở 320px, liên hệ ở 390px. Không tạo yêu cầu thử trong dữ liệu thật.

Sao lưu trước khi cập nhật tên và số điện thoại: `data/backups/before-editorial-1791470935982.sqlite`.

Ảnh chân dung cũ khi thay hoặc ẩn không còn được endpoint phục vụ, nhưng file được giữ trong kho lưu trữ. Sao lưu cả database và thư mục uploads; JSON riêng không chứa ảnh.

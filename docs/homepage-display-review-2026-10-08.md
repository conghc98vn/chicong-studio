# Rà soát hiển thị trang chủ — 08/10/2026

## Phạm vi và kết luận

Kiểm tra trang chủ đang chạy tại localhost:4173, bốn slide trên desktop, bốn ảnh thay thế trên mobile và sáu ảnh bìa album. Xem cả ảnh nguồn, thumbnail, tỷ lệ hiển thị, thứ tự nội dung, hiệu ứng và nút điều khiển. Các kích thước kiểm tra là viewport trình duyệt; chưa thay thế việc thử trực tiếp Safari iPhone hoặc Chrome Android trên thiết bị thật.

Không phát hiện ảnh trả lỗi trong nhóm ảnh được chọn; các ảnh hero và ảnh bìa có ID riêng, không trùng file. Kích thước file ảnh và thumbnail khớp với tỷ lệ lưu trong dữ liệu. Ảnh chụp đã có bố cục cận cảnh vẫn giữ bố cục gốc; không dùng phần mềm để tạo thêm phần ảnh ngoài khung.

## Phát hiện và chỉnh sửa

| Hạng mục | Trước | Sau |
| --- | --- | --- |
| Slide mobile 1 và 4 | Ảnh ngang nằm trong khung đứng, khoảng nền trên/dưới lớn | Chọn ảnh dọc thực có trong đúng album: cô dâu viết lời nhắn; cặp đôi trong tiệc |
| Slide desktop | Chiều cao theo viewport kết hợp cover cắt ảnh khác nhau tùy màn hình | Khung 3:2, contain, giữ nguyên ảnh; ảnh film khác tỷ lệ có viền nền nhỏ |
| Bìa album desktop | Ép ảnh dọc vào 4:5 | Hiển thị đúng tỷ lệ của từng ảnh |
| Thứ tự bộ ảnh | Năm ảnh dọc rồi mới đến ảnh ngang | Đưa Traditional Wedding với ảnh nhóm ngang lên thứ ba để đổi nhịp |
| Tablet | Ba cột khiến mỗi ảnh hẹp | Hai cột ở 751–1000px; điện thoại một cột; desktop lớn ba cột |
| Hiệu ứng cuộn | Ảnh bìa hiện từ opacity 0, dễ thấy ảnh nhạt khi vừa lướt tới | Bỏ hiệu ứng hiện dần trên thẻ album, vẫn giữ chuyển cảnh nhẹ ở slideshow |
| Tải slide | Đồng hồ bắt đầu ngay khi trang khởi tạo | Chờ ảnh đầu decode xong mới bắt đầu khoảng xem 5 giây |
| Ảnh lỗi khi đi lùi | Có trường hợp bỏ sót slide còn dùng được | Tìm theo đúng chiều và đủ các slide; ảnh đầu lỗi có ảnh khác thay thế |
| Ảnh trên điện thoại | Source mobile chỉ trỏ ảnh lớn | Source có thumbnail và ảnh lớn với khai báo chiều rộng, trình duyệt chọn theo màn hình |
| Wording | Nhãn và tiêu đề cùng lặp film/máy số | Tiêu đề “Hai chất ảnh, một ngày đáng nhớ.”; lời dẫn phân biệt cách chụp ngắn gọn |
| Giới thiệu | Dấu ngoặc kép trang trí khiến đoạn tự giới thiệu giống lời chứng thực | Bỏ dấu ngoặc kép, giữ tên Chí Công và hơn 5 năm kinh nghiệm |
| Mô tả slide | Alt lấy mã ảnh desktop dù mobile là ảnh khác | Alt thống nhất theo nội dung bộ ảnh, không đọc sai mã ảnh |

## Vai trò và thứ tự ảnh

Hero desktop giữ chuỗi: lễ cưới trên film → khoảnh khắc gần gũi → không gian tiệc → niềm vui cùng bạn bè. Mobile chọn ảnh dọc trong cùng bốn album, giữ trọn ảnh và đưa tiêu đề xuống dưới. Khung không đổi chiều cao khi chuyển slide nên nội dung bên dưới không nhảy.

Sáu bộ ảnh: Wedding on Film → A New Chapter of Love → Traditional Wedding → Ceremony | T & T → Love in the Details → Celebrating Love. Chuỗi có chân dung, khoảnh khắc đôi, ảnh nhóm, chi tiết và không gian. Tên album được giữ theo dữ liệu hiện có, không tự đặt tên cặp đôi hay địa điểm.

Sau ảnh là cách chụp film/máy số, giới thiệu ngắn và lời mời liên hệ. Không bổ sung đoạn quảng cáo dài hoặc thêm nút cạnh tranh với nút xem bộ ảnh.

## Kiểm chứng

- 320px: không tràn ngang; tên album dài xuống dòng; nút điều khiển 44×44px.
- 390px: kiểm tra trực quan cả bốn slide mobile và lướt các phần của trang chủ.
- 768px: kiểm tra hero và xác nhận lưới hai cột sau chỉnh sửa.
- 1440px: kiểm tra hero desktop; ảnh không bị ép cắt theo chiều cao viewport.
- JavaScript syntax check đạt.
- 33 tests đạt, bao gồm bốn tình huống slideshow: ảnh đầu chậm, ảnh lỗi khi đi lùi, ảnh đầu lỗi, rời trang trong lúc ảnh đang tải.
- Chưa đo tốc độ trên mạng di động thật hoặc chạy Lighthouse; không đưa ra điểm hiệu năng giả định.

## Cân nhắc giữ lại

Giữ trọn ảnh đồng nghĩa một số slide có viền nền nhỏ. Sáu album khiến trang mobile dài hơn; đây là lựa chọn ưu tiên xem ảnh lớn, không thu ảnh xuống hai cột nhỏ. Khi có tên cặp đôi hoặc tên câu chuyện thực tế, các tên chung như “A New Chapter of Love” nên được cá nhân hóa. Không cần thêm animation cho ảnh ở giai đoạn này.

Ảnh kiểm chứng mobile: ../output/home-review/mobile-final.jpg

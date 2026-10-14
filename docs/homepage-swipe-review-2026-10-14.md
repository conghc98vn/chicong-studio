# Trang chủ: bố cục và vuốt ảnh — 14/10/2026

## Nguyên nhân

- Hero có nhiều nhóm CSS ghi đè qua các lần chỉnh sửa. Trên mobile, ảnh, tiêu đề, liên kết và điều khiển bị tách xa nhau; ảnh dọc nằm trong khung rộng với nhiều khoảng trống hai bên.
- HTML ban đầu dùng icon SVG, nhưng `hero-slideshow.mjs` thay toàn bộ nội dung liên kết bằng tên album cộng ký tự `↗` sau khi chuyển ảnh. Ký tự này có thể hiển thị thành emoji màu trên điện thoại.
- Slideshow tự chạy sau mỗi 5 giây; chưa nhận thao tác vuốt trên ảnh.

## Thay đổi

- Gom CSS hero thành một khối. Trên mobile: ảnh → tên bộ ảnh và điều khiển → lời giới thiệu và liên kết xem các bộ ảnh. Căn cùng lề với nội dung trang, giảm khoảng cách tới bộ ảnh nổi bật.
- Khung mobile tỷ lệ 4:5; ảnh vẫn dùng `object-fit:contain` để giữ toàn bộ bố cục. Desktop giữ khung 3:2 và chữ phủ phía dưới ảnh.
- Giữ icon mũi tên ngang SVG, chỉ cập nhật phần tên và đường dẫn album khi đổi ảnh.
- Bỏ autoplay. Vuốt ngang hoặc kéo chuột trên ảnh, bấm nút 44×44px, hoặc dùng phím trái/phải khi vùng ảnh có focus để chuyển ảnh.
- Phân biệt vuốt ngang với cuộn dọc; bỏ qua chạm nhẹ, kéo ngắn, thao tác bị huỷ và nhiều ngón. Giữ pinch zoom và cuộn dọc của trình duyệt.
- Giữ tải trì hoãn ảnh chưa xem, bỏ qua ảnh tải lỗi, không để yêu cầu cũ ghi đè ảnh mới; dọn listener khi rời trang. Ảnh đầu lỗi vẫn được thay bằng ảnh tải thành công.

## Kiểm tra

- `npm run check`: đạt.
- `npm test`: 116 đạt, 1 PostgreSQL test bỏ qua vì không cấu hình môi trường; 0 lỗi.
- `studio/tests/hero-slideshow.test.mjs`: 8 bài kiểm thử trạng thái, vuốt, huỷ thao tác, tải lỗi, tải chậm và cleanup.
- `studio/tests/hero-browser.smoke.mjs`: Chromium touch events thực, vuốt hai chiều/vòng, cuộn trang, không autoplay sau thời gian mô phỏng, SVG và href, kéo chuột, bàn phím, nút, reduced motion, menu, mở album và tên dài; responsive 320/360/390/430/750/768/1440px.
- Cập nhật lượt kiểm tra cuối: đã cài và chạy smoke test WebKit thành công; chưa kiểm chứng trên Safari/iPhone thật. Xem `final-ui-ux-performance-review-2026-10-14.md` cho kết quả mới nhất.
- Ảnh kiểm tra: `output/home-swipe-review/home-390.png` và `home-1440.png`.

Chạy smoke test trên preview local có ít nhất hai ảnh mở đầu. Nếu Playwright không nằm trong dependencies, đặt `STUDIO_PLAYWRIGHT_MODULE` đến module đã cài. Có thể đổi `STUDIO_PREVIEW_URL` và `STUDIO_BROWSER_EVIDENCE_DIR`.

Đã chỉnh mã nguồn và kiểm tra local; chưa triển khai lên website công khai.

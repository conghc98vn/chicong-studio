# Regression trước khi push — 14/10/2026

## Môi trường và phạm vi

Node 24.19.0 (cùng major với Render/CI), dependencies cài sạch bằng `npm ci`; PostgreSQL 16 chạy trong container tạm riêng. Test API dùng database/thư mục tạm. Test giao diện công khai đọc preview local; form gửi được mock. Không thay dữ liệu production, gửi email thật hay gọi triển khai Render.

## Kết quả

- `npm ci`: đạt, audit không ghi nhận lỗ hổng trong 108 packages.
- `npm run check`, `git diff --check`: đạt.
- `npm test`: **148 đạt, 0 lỗi, 0 bỏ qua**. Bao gồm authentication/authorization, CSRF, private media, album/slugs, migrations SQLite/PostgreSQL, backup/curation, sections, upload/retry, image optimization, storage, selected downloads, booking/inquiries, calendar, email adapter, SEO/schema và performance assertions.
- Mở rộng PostgreSQL integration: upload hai ảnh vào section, xác nhận số byte JPG được lưu, chọn ảnh rồi tải ZIP gồm một JPG có sẵn và một ảnh cũ chuyển từ WebP. Kiểm tra truy vấn mới, thứ tự/tên ảnh, định dạng và độ dài response thực.
- Axe trên 5 trang công khai × Chromium/WebKit: **0 vi phạm tự động** theo WCAG 2 A/AA và 2.1 AA; các bộ upload/sections/download cũng chạy kiểm tra accessibility riêng.
- Tám lượt browser smoke đạt: public UI (Chromium + WebKit), hero (Chromium + WebKit), album slug/admin, sections, sections UX, upload ảnh thật, selected downloads Chromium, selected downloads WebKit.
- Responsive kiểm tra 320/390/768/1440px ở các bộ public/sections/upload/download; bộ slug còn kiểm tra 800px. Gallery download dùng đúng hai ảnh Lightroom của người dùng và kiểm tra JPG/ZIP thật, hủy/retry, phân gói, gói quá lớn, focus, phiên hết hạn, đồng bộ lựa chọn.

## Lỗi test đã sửa

`album-slug-browser.smoke.mjs` vẫn đợi hero tự chuyển ảnh sau khi tắt reduced motion. Hành vi hiện tại là hero chuyển thủ công; bộ test hero mới đã kiểm tra không autoplay. Cập nhật test cũ dùng đồng hồ giả lập tiến 12 giây và xác nhận slide giữ nguyên, sau đó chạy lại toàn bộ smoke slug/admin/upload/lightbox/canonical: đạt. Không thêm lại autoplay chỉ để làm test cũ qua.

Không phát hiện lỗi ứng dụng mới trong lượt regression này. Log và ảnh chụp nằm tại `output/project-regression/` (gitignore), không đưa ảnh khách hay dữ liệu test vào commit.

## Giới hạn

Kiểm tra Chromium/WebKit trên máy tính, chưa dùng iPhone/Android vật lý. Supabase, Google Calendar và email dùng mock trong test; không gửi yêu cầu nghiệp vụ tới production. Các số đo hiệu năng local và giới hạn thực tế được ghi trong [báo cáo tải ảnh](gallery-download-review-2026-10-14.md) và [báo cáo UI/UX](final-ui-ux-performance-review-2026-10-14.md); không xem là chứng nhận tải cao trên Render.

Người dùng thực hiện deploy thủ công trên Render sau khi push. Migration database tự chạy khi server khởi động; các cột số byte mới nullable để giữ nguyên ảnh cũ. Startup kiểm tra bucket private, cho phép JPEG và nâng giới hạn đối tượng nhỏ hơn 24 MiB; giới hạn file upload đầu vào vẫn 8 MiB.

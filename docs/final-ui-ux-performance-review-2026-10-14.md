# Kiểm tra UI/UX, tính năng và hiệu năng — 14/10/2026

Phạm vi: trang chủ, Portfolio, album công khai, About, Contact; các thay đổi gần đây về phân phần album, upload và tải ảnh đã chọn trong gallery riêng. Kiểm tra trên preview local có ảnh thực và các fixture dùng database tạm. Không gửi form đến khách, gửi email thực, thay dữ liệu production hay push/deploy.

## Nội dung và bố cục

- Trang chủ chuyển ảnh bằng vuốt, kéo chuột, bàn phím hoặc nút; không tự chạy. Icon SVG giữ nguyên khi đổi slide, tránh ký tự mũi tên biến thành emoji trên điện thoại.
- Ảnh, tên album và điều khiển nằm cùng một nhóm. Mobile giữ toàn bộ bố cục ảnh; nút chuyển ảnh đủ vùng chạm 44×44px. Cuộn dọc và pinch zoom vẫn được giữ.
- Home, About, Portfolio và album dùng cùng một lời mời liên hệ, gồm tiêu đề, mô tả và liên kết “Gửi lời nhắn”. Contact và gallery riêng không lặp lời mời này.
- Album công khai bỏ số lượng ảnh, nhãn/liên kết thừa và CTA trùng ở đầu trang. Giữ nguyên nội dung ghi nguồn và các bên liên quan; kiểm tra đối chiếu với dữ liệu của cả 7 album trong preview.
- Wording About/Contact ngắn, gần gũi; giữ giá trị API của các lựa chọn dịch vụ để việc đổi nhãn không ảnh hưởng xử lý form.
- Kiểm tra ảnh chụp trên Chromium/WebKit, mobile và desktop; không ghi nhận tràn ngang ở các độ rộng đã thử.

## Lỗi phát hiện và sửa trong lượt cuối

1. **Lịch hẹn làm chậm toàn bộ Contact:** bootstrap chờ API lịch trước khi hiện form. Chuyển tải lịch sang nền; người dùng có thể điền form ngay, vẫn giữ bản nháp khi lịch lỗi hoặc tải lại.
2. **Đường dẫn có dấu `/` cuối:** About không đánh dấu menu hiện tại; Contact lặp lại lời mời ở footer. Đồng bộ cách chuẩn hóa đường dẫn giữa router, menu và footer.
3. **Hủy tải rồi tải lại ngay:** tác vụ chuyển đổi JPEG cũ có thể chưa kết thúc, làm lượt tiếp theo nhận 429. Client tôn trọng `Retry-After`, thử lại tối đa hai lần, cho phép hủy cả trong lúc đợi. Không tự lặp vô hạn hoặc gửi tệp nếu đã hủy. Server cũng bỏ qua yêu cầu đã ngắt kết nối trong lúc kiểm tra quyền/danh sách ảnh, trước khi chiếm suất xử lý.
4. **Trả focus sau hộp tải ảnh trên WebKit:** click không luôn focus nút mở hộp thoại. Truyền đúng nút kích hoạt vào dialog để Escape/đóng hộp thoại trả focus về nút “Tải ảnh đã chọn”; nút hủy cũng giữ focus rõ ràng trước khi chuyển về nút tải lại.

Đã bổ sung kiểm thử hồi quy cho lịch chậm/lỗi, bản nháp form, đường dẫn có `/` cuối, ngắt kết nối sớm và chờ tải lại có thể hủy. Smoke test ảnh đợi ảnh giải mã xong trước khi chụp; xử lý việc đổi nguồn `<picture>` khi thay viewport.

## Hiệu năng

- Khai báo kích thước ảnh bìa theo bố cục hiện tại: ba cột desktop, hai cột tablet và hai cột album liên quan.
- Ảnh mở đầu mobile tính kích thước theo phần ảnh thật trong khung 4:5, thay vì mặc định `100vw`. Server preload và HTML dùng cùng hàm để không tải hai nguồn khác nhau.
- Với viewport 390px, DPR 2, ảnh mở đầu chọn bản 600px đủ cho phần ảnh hiển thị khoảng 285 CSS px. Dung lượng truyền giảm **173.676 → 49.586 byte**, khoảng **71%**. Tổng tài nguyên trước khi chụp màn hình đầu giảm **528.111 → 406.270 byte**, khoảng **23%**.

Phép đo lạnh trên Chromium: cache tắt, độ trễ 100ms, tải xuống 200.000 byte/s, CPU chậm 4 lần, server SQLite local. Đây là số đo lab một lượt trước/sau, không phải Core Web Vitals từ người dùng thật.

| Trang | Mobile LCP trước → sau | Desktop LCP trước → sau |
| --- | --- | --- |
| Home | 2,86 → 2,26 giây | 4,42 → 4,31 giây |
| Portfolio | 5,72 → 5,73 giây | 3,46 → 3,44 giây |
| Album | 3,95 → 3,98 giây | 3,25 → 3,23 giây |
| About | 1,99 → 2,00 giây | 2,01 → 1,99 giây |
| Contact | 2,19 → 2,09 giây | 2,26 → 2,06 giây |

CLS sau chỉnh sửa nằm trong khoảng 0,0004–0,0199 ở các lượt đo này. Portfolio/album vẫn chịu chi phí tải ảnh trên mạng giả lập chậm; chưa coi số đo local là chứng nhận hiệu năng production. Không giảm chất lượng ảnh gốc hoặc thay đổi dữ liệu album để đạt điểm đo.

## Kiểm tra

- `npm run check`: đạt; `git diff --check`: sạch.
- `npm test`: 148 đạt, 0 lỗi, 0 bỏ qua; gồm PostgreSQL 16 trong container kiểm thử riêng.
- `public-polish-browser.smoke.mjs`: Chromium và WebKit, 320/390/768/1440px; CTA đồng nhất, credit, menu và lightbox qua bàn phím, focus, lịch chậm/lỗi/retry, form lỗi/retry/thành công, request key và giá trị dịch vụ giữ ổn định. Form gửi được chặn bằng mock.
- `hero-browser.smoke.mjs`: touch thật qua Chromium, vuốt hai chiều/vòng, cuộn dọc, ngưỡng chạm, kéo chuột, bàn phím, không autoplay, SVG, tên album dài, reduced motion và 320–1440px. WebKit kiểm tra bố cục, chuyển ảnh thủ công và touch-action.
- `album-sections-browser.smoke.mjs` và `album-sections-ux.smoke.mjs`: đạt, gồm 18 tình huống UX trong bộ kiểm tra thứ hai.
- `upload-browser.smoke.mjs`: upload thực trong database tạm, thành công một phần, lỗi từng tệp, retry không nhân đôi ảnh, số đo dung lượng và responsive.
- `gallery-download-browser.smoke.mjs`: đạt trên Chromium và WebKit; ZIP/JPEG thực, chỉ tải đúng ảnh đã chọn kể cả khi lọc phần, hủy/retry, Escape/focus, danh sách thay đổi, phiên hết hạn, chia 51 ảnh thành gói 50 + 1, chia nhỏ tiếp khi gói quá lớn mà không mất lựa chọn. Dùng hai file Lightroom thật trong lượt xác nhận cuối. Có thể chạy bằng `STUDIO_BROWSER=webkit` để kiểm tra WebKit.
- Axe WCAG 2 A/AA và 2.1 AA: **0 vi phạm tự động trên 5 trang công khai × 2 engine**. Đây không thay thế kiểm tra bằng người dùng và công nghệ hỗ trợ thực tế.

Ảnh và log nằm trong `output/final-ui-audit/` (được gitignore). Các smoke test dùng `STUDIO_PLAYWRIGHT_MODULE` nếu Playwright được cài ngoài dự án; test public/hero nhận `STUDIO_PREVIEW_URL`, mặc định `http://127.0.0.1:4173`. Các fixture upload/gallery dùng dữ liệu tạm và tự dọn sau khi chạy.

WebKit đã chạy được trong lượt kiểm tra này; chưa kiểm tra trực tiếp trên iPhone/Safari thiết bị thật. Tích hợp PostgreSQL đã đạt trên database tạm; dịch vụ email/lịch production chưa được chạy live. Mã nguồn vẫn ở working tree để review/push.

Chi tiết tải JPG/ZIP, dung lượng hai ảnh thật và tối ưu chuyển ảnh cũ (26,6 → 4,3 giây/gói 50 ảnh local) nằm trong [báo cáo tải ảnh](gallery-download-review-2026-10-14.md).

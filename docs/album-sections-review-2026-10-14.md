# Review & kiểm thử Album Sections — 14/10/2026

Đã review API, migration, dữ liệu, giao diện quản trị, album công khai và gallery riêng. Các lỗi tìm được trong phạm vi kiểm tra bên dưới đã được sửa và có kiểm thử hồi quy. Bản local ở cổng 4173 đã cập nhật, giữ nguyên database demo.

## Những lỗi đã sửa

| Vấn đề | Kết quả sau sửa |
| --- | --- |
| Đổi bộ lọc làm mất tệp đang chờ upload | Giữ form và File objects, giữ phần đích đã chọn; xóa phần đích thì giữ tệp và thông báo chuyển về Chưa phân loại |
| Upload thành công một phần nhưng số ảnh trên tab chưa cập nhật | Làm mới toàn bộ số đếm và giữ trạng thái thử lại, không tải trùng ảnh đã lưu |
| Nút đổi thứ tự ảnh còn bật ở ranh giới hai phần | Vô hiệu hóa thao tác vượt ranh giới phần |
| Lưu phần/chuyển ảnh đưa focus về đầu trang | Trả focus về điều khiển liên quan, giữ vị trí cuộn |
| Khi lưu thiếu trạng thái chờ rõ ràng | Hiện trạng thái, aria-busy và chặn thao tác trùng trong lúc lưu |
| Chế độ Xem ảnh đã chọn vẫn đếm toàn bộ ảnh trên tab | Số đếm phản ánh chế độ lọc đang xem |
| Điều khiển phần ảnh nhỏ trên mobile, tên trợ năng chưa rõ | Nút phần ảnh tối thiểu 44 px, select 16 px trên mobile, bổ sung nhãn gắn với từng ảnh/phần |
| Sửa chú thích có thể ghi đè section vừa được đổi bởi yêu cầu khác | PATCH chỉ ghi trường thực sự được gửi |
| Đổi tên phần có thể ghi đè thứ tự mới | PATCH chỉ ghi trường thực sự được gửi |
| Sắp xếp trong lúc có phần mới được thêm gây lỗi NOT NULL | Giữ position của phần mới ngoài danh sách đang sắp xếp |
| Mất phản hồi tạo phần rồi thử lại có thể tạo trùng | request_id giúp cùng một lượt tạo trả lại cùng phần; kiểm tra xung đột payload/album |
| Áp dụng lại mẫu sau đổi tên có thể tái sử dụng request_id cũ | Giải phóng mã sau phản hồi thành công; có kiểm thử đổi tên rồi áp dụng mẫu lại |

## Kết quả kiểm thử

- `npm run check`: đạt.
- Bộ kiểm thử đầy đủ với `STUDIO_TEST_POSTGRES_URL`: **106/106 đạt, không bỏ qua test**.
- Bộ API section: **11/11 đạt trên SQLite**, **11/11 đạt trên PostgreSQL 16**. Có migration dữ liệu cũ, kiểm tra quyền/CSRF, xác thực liên album, thứ tự, xóa giữ ảnh/lựa chọn, CSV/backup, thử lại và các tình huống yêu cầu xen kẽ.
- Gán hàng loạt **1.000 ảnh** thành công; 1.001 ảnh bị từ chối. Các tình huống đồng thời được tạo chủ động bằng cách xen một cập nhật giữa bước đọc và bước ghi.
- `album-sections-browser.smoke.mjs`: đạt luồng tạo/đổi tên/xóa, kéo thả/nút sắp xếp, gán đơn/hàng loạt, phục hồi lỗi mạng, upload vào phần, lọc, lightbox, chọn/gửi lựa chọn, public album, áp dụng mẫu nhiều lần và sau đổi tên.
- `album-sections-ux.smoke.mjs`: **19/19 tình huống đạt** khi bật axe. Bao gồm upload lỗi một phần, tệp chờ qua đổi bộ lọc, mất phản hồi tạo phần, giữ focus, xác nhận/hủy xóa, bộ đếm ảnh đã chọn, lưu lựa chọn thất bại, hết phiên gallery/admin, giảm chuyển động và không có lỗi JavaScript trong trang.
- `album-slug-browser.smoke.mjs`: đạt kiểm tra hồi quy trang chủ, portfolio, tạo/sửa/preview/upload album, điều hướng, slug/canonical, ảnh responsive và lightbox.
- Kiểm tra responsive **320, 375, 390, 768, 1024, 1440 px**: không tràn ngang; tab đang chọn cuộn vào vùng nhìn thấy. Kiểm tra tên phần dài gần giới hạn và ảnh chụp bố cục quản trị/gallery.
- Axe trên admin, gallery và hộp thoại phần ảnh: **0 violations** trong các rule được gắn thẻ WCAG 2 A/AA, 2.1 AA, 2.2 AA. Kết quả này không phải chứng nhận tuân thủ WCAG. Một số phép đo tương phản cần đánh giá thủ công (ký hiệu mũi tên/trái tim và nhãn trong thanh điều hướng cuộn ngang); JSON giữ nguyên các mục `incomplete`.

## Môi trường & giới hạn

Chrome trên máy local, viewport desktop/mobile mô phỏng; chưa kiểm tra Safari/iOS/Android trên thiết bị thật hoặc screen reader. Chưa đo tải nhiều người dùng đồng thời hay bộ ảnh hàng chục nghìn ảnh. Kiểm thử migration/DB dùng database tạm và PostgreSQL Docker cô lập; không sử dụng database production. Docker kiểm thử được dừng sau khi chạy xong. Không deploy.

Ảnh chụp và kết quả axe nằm trong `output/sections-review/` (thư mục local được Git bỏ qua). Các test tạo dữ liệu tạm riêng và tự dọn. Playwright và axe được nạp từ đường dẫn module ngoài dự án, không thêm dependency chạy production.

## Chạy lại

```sh
npm run check
npm test
# PostgreSQL: trỏ biến này tới DB test riêng, không dùng DB production.
STUDIO_TEST_POSTGRES_URL='postgres://USER:PASSWORD@HOST:PORT/TEST_DB' npm test
node studio/tests/album-sections-browser.smoke.mjs
node studio/tests/album-sections-ux.smoke.mjs
node studio/tests/album-slug-browser.smoke.mjs
```

Nếu Playwright chưa có trong môi trường resolution của Node, đặt `STUDIO_PLAYWRIGHT_MODULE` tới file module đã cài. Để chạy audit axe trong UX smoke, đặt `STUDIO_AXE_MODULE` tới entry module của `@axe-core/playwright`; nếu bỏ qua biến này, suite chạy 18 tình huống. Có thể đặt `STUDIO_BROWSER_EVIDENCE_DIR` để chọn nơi lưu ảnh/báo cáo.

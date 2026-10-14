# Review gallery, upload và trải nghiệm xem ảnh — 15/10/2026

Phạm vi: phần upload, gallery riêng của khách, lightbox và tải JPG/ZIP; regression các phần album và website công khai. Thay đổi nằm trong working tree hiện tại, kế thừa cả phần sửa có sẵn trước review. Chưa commit, push hoặc deploy.

## Các lỗi đã sửa

| Vấn đề xác nhận được | Thay đổi và kiểm chứng |
| --- | --- |
| Masonry chia DOM theo cột làm Tab nhảy sai thứ tự ảnh; resize dựng lại cả lưới và mất vị trí đang xem | Giữ DOM theo thứ tự album, tính vị trí bằng kích thước thật; resize giữ nguyên nút, ảnh, focus và vị trí ảnh đang xem. Test 900 ảnh, cả 2 và 3 cột, cùng kiểm tra hình học không chồng lấn. |
| Bỏ ảnh cuối trong chế độ “Đã chọn” làm mất focus; phản hồi bỏ chọn chậm có thể đổi nhầm ảnh khi khách vừa bấm Next | Cập nhật đúng thẻ ảnh, trả focus về thao tác còn dùng được và giữ ảnh đang xem theo ID. Có test trì hoãn phản hồi rồi chuyển ảnh trước khi máy chủ xác nhận. |
| Kéo/vuốt có thể đóng nhầm lightbox; dialog và điều khiển không ổn định khi đổi màn hình | Kiểm tra vùng backdrop, xử lý pointer capture và hướng vuốt, giữ pinch/scroll của trình duyệt; Escape trả focus về ảnh. Test touch thật qua CDP trên Chrome và các luồng chia sẻ trên WebKit. |
| Ảnh dọc desktop tải bản lớn dù thumbnail đủ; ảnh tải trước có thể bị tải lại trên mobile | `sizes` theo phần ảnh thực sự hiển thị; tải trước tối đa hai ảnh bên cạnh, ưu tiên thấp và tránh mạng tiết kiệm dữ liệu/2G. Giữ tài nguyên preload đến khi ảnh chính nhận nó. Test 390 px từng phát hiện 2 GET cho cùng ảnh lớn, sau sửa còn 1. |
| Link tải ảnh có thể phát sinh GET thừa hoặc đưa khách sang trang lỗi JSON; nút tải ở album công khai bị CSS ẩn | Dùng nút và controller tải có trạng thái, hủy, thử lại, kiểm tra JPEG và xử lý hết phiên ngay trong gallery. Test tải file thật, xác nhận đúng một GET, hủy/retry và 401. |
| Các route tải JPG riêng/công khai trùng logic, chưa dùng chung giới hạn công việc với ZIP | Gộp xử lý, tối đa 2 lượt toàn hệ thống và 1 lượt/album; HEAD không đọc/chuyển ảnh; ngắt đọc storage khi khách hủy; kiểm tra lại quyền và ảnh trước khi gửi. Có test mất quyền trong lúc đọc, hết slot, hủy và giới hạn dung lượng. |
| Upload có thể coi phản hồi 2xx thiếu kết quả là thành công | Kiểm tra đủ acknowledgement theo từng file, index và kiểu dữ liệu; dừng an toàn khi phản hồi sai, giữ khóa retry, hiện lỗi theo file. Test phản hồi mất sau khi lưu, acknowledgement thiếu, retry và không tạo ảnh trùng. |

## UI/UX đã cải thiện

- Toolbar chọn ảnh rõ nhãn, đủ vùng chạm 44 px, bố trí hai hàng trên điện thoại; báo số ảnh đã chọn và trạng thái lưu/gửi.
- Giữ kiểu chữ thương hiệu ở tiêu đề, dùng chữ dễ đọc cho caption và thao tác chọn ảnh; thêm thao tác khóa gallery.
- Lightbox giữ trọn ảnh và điều khiển trong màn hình; lỗi ảnh có nút thử lại tại chỗ, tải JPG có tiến trình và hủy.
- Upload có thanh tiến độ thực, báo cáo từng file giữ trạng thái mở; hướng dẫn thông thường ngắn gọn và phần `.ccphoto` nâng cao có thể mở khi cần.
- Loại CSS masonry và hàm chia cột dư thừa; không dựng lại toàn gallery khi chọn hoặc bỏ một ảnh.

## Đo hiệu năng

Fixture 900 ảnh tổng hợp có texture, gồm ngang/dọc/vuông; HTTP local, Chrome 155, context mới cho từng lượt. So sánh frontend trước/sau trên cùng backend và dữ liệu. Cả hai bản được phục vụ bằng HTTP thật; không dùng `route.fulfill` cho asset trong phép đo mạng chậm.

Ba lượt mỗi bản, cấu hình 390 px, DPR 2, CPU chậm 4 lần, latency 100 ms, tải xuống 1,5 Mbps:
| Chỉ số | Trước | Sau |
| --- | ---: | ---: |
| Trung vị toolbar xuất hiện | 4,539 s | 4,254 s |
| Trung vị ảnh đầu decode xong | 4,584 s | 4,663 s |
| Request ảnh ban đầu | 16 | 16 |
| CLS trong profile này | 0,00074 | 0 |
| Long task lớn nhất, khoảng giữa các lượt | 124–141 ms | 186–196 ms |

Màn hình thao tác xuất hiện sớm hơn khoảng 285 ms. Ảnh đầu chậm hơn khoảng 79 ms trong fixture này; **không kết luận ảnh đầu tải nhanh hơn**. Dựng 900 thẻ vẫn tạo một long task khi giả lập CPU yếu, nên số liệu này không chứng minh mọi điện thoại đều cuộn mượt.

Các cải thiện có thể xác nhận độc lập với thời gian đo:
- Mở gallery chỉ tải 14 ảnh ở desktop, 16 ảnh trên mobile; không tải toàn bộ 900 ảnh. Chọn ảnh không tạo request ảnh mới.
- Ảnh dọc desktop trong fixture dùng thumbnail 21.498 byte thay cho bản 520.582 byte, đủ cho kích thước hiển thị ở DPR 1. Mobile DPR 2 vẫn dùng bản lớn khi cần chất lượng.
- Module tải JPG/ZIP chỉ nạp khi khách yêu cầu tải. Dòng thông báo loading dùng font có sẵn, tránh ba subset font italic khoảng 50 KiB. Trong hai trace cùng cấu hình, tổng byte ngoài media giảm từ 663.849 xuống 610.219.
- API gallery 1.500 ảnh: 5 query cố định, JSON 404.237 byte; lượt regression PostgreSQL local ghi nhận 24,7 ms. Đây là fixture local, không phải tốc độ R2/Render thực tế.
- DTO chỉ đọc các cột cần dùng; nhóm section một lần. Các ảnh khách hủy tải cũng hủy đọc storage tương ứng.

## Kiểm thử và bằng chứng

- `npm test` với Node 24 và PostgreSQL 16 riêng cho test: **208 pass, 0 fail, 0 skip**. Syntax check và `git diff --check` qua.
- Gallery 900 ảnh: **83/83 kiểm tra qua**, ở 1440, 390 và 320 px; Axe không ghi nhận vi phạm trong phạm vi quét, không có lỗi JavaScript runtime. Bao gồm thứ tự bàn phím, resize/focus, vuốt, lỗi media/retry, GET duy nhất, hủy, hết phiên và race khi bỏ chọn.
- Upload thường: JPEG trên 10 MiB, file vượt giới hạn, file lỗi, phản hồi trì hoãn 13 giây, mất phản hồi sau khi lưu, acknowledgement không đầy đủ, retry chống trùng và giao diện 320/390/768/1440 px.
- Upload `.ccphoto`: Chrome và WebKit, kiểu MIME khác nhau, lỗi/mất phản hồi/retry; kiểm tra rendition lưu đúng byte. Lượt bulk trước regression cuối: 66 ảnh, 67 request gồm một retry, 198 rendition, không trùng ảnh; 8,39 giây và peak RSS khoảng 316 MiB trong fixture local.
- JPG/ZIP: Chrome và WebKit, mở khóa, chọn/lọc/gửi, file JPEG và nội dung ZIP thật, hủy/thử lại, lựa chọn đã thay đổi, hết phiên, 51 ảnh chia 50 + 1.
- Regression liên quan: quản lý section, 19 tình huống UX mở rộng; home/portfolio/album/about/contact ở bốn kích thước, cả Chrome và WebKit. Hero đã kiểm tra thao tác tay, vuốt, bàn phím và reduced motion trong lượt regression trước thay đổi cuối.

Bằng chứng local (thư mục `output` được Git ignore):

- `output/gallery-review-root-final/browser-summary.json` và ảnh chụp gallery/lightbox.
- `output/gallery-review-perf/before-{1,2,3}/browser-summary.json`, `final-{1,2,3}/browser-summary.json`; các trace giữ resource timing.
- `output/gallery-review-root-postgres.log`.
- `output/gallery-review-root-regression/summary.json` và log từng bộ regression cuối.
- `output/upload-review/`, `output/prepared-upload-review/`, `output/gallery-review-public/`, `output/gallery-review-hero/`.

Chạy lại: `npm test`, `npm run check`; các file `studio/tests/*browser.smoke.mjs` chạy trực tiếp bằng Node. Cần Playwright và browser đã cài; có thể chỉ định module qua `STUDIO_PLAYWRIGHT_MODULE`, và Axe qua `STUDIO_AXE_MODULE`. Test PostgreSQL dùng `STUDIO_TEST_POSTGRES_URL` trỏ tới database dành riêng cho test. Gallery benchmark bật `STUDIO_GALLERY_MEASURE_ONLY=1 STUDIO_GALLERY_SLOW=1`; snapshot trước tùy chọn qua `STUDIO_GALLERY_ASSETS_DIR`.

## Giới hạn kiểm chứng

Kiểm thử dùng database/storage tạm; kiểm tra trang công khai dùng bản sao local chỉ đọc. Không ghi vào dữ liệu khách hay ảnh gốc. Form liên hệ trong browser test được chặn gửi thật. Chưa kiểm tra trên điện thoại vật lý hoặc tải đồng thời ở hạ tầng production; WebKit tự động không thay thế hoàn toàn Safari trên iPhone. Axe chỉ là kiểm tra accessibility tự động, không phải chứng nhận đầy đủ. Chưa deploy.

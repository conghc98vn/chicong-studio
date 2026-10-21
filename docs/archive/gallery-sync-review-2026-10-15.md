# Kiểm tra lại upload và gallery — 15/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

## Phạm vi và quyết định

Kiểm tra FE/BE trên bản có gallery không bắt buộc mật khẩu, zoom/pan, xác nhận gửi và hủy upload. Giữ các thay đổi/commit khác xuất hiện trong workspace trong lúc review.

Người dùng đã xác nhận: **một danh sách chọn ảnh chung cho cả gallery**. Nếu hai người thay đổi cùng một ảnh, lần lưu sau cùng được áp dụng. Chỉnh sửa sau khi gửi đưa danh sách về `draft`; người dùng cần gửi lại. Chưa chuyển sang danh sách riêng từng người hay khóa danh sách sau khi gửi.

## Lỗi tái hiện và sửa

| Vấn đề | Tái hiện / ảnh hưởng | Cách xử lý |
| --- | --- | --- |
| Xác nhận khác danh sách máy chủ | Hộp xác nhận ghi 1 ảnh, máy chủ nhận 2 sau khi phiên khác chọn thêm | Gửi kèm đúng ID đã xác nhận; kiểm tra trong transaction; trả 409 nếu khác, kể cả số lượng bằng nhau |
| Mất phản hồi sau khi lưu lựa chọn | DB có ảnh đã chọn nhưng UI hiển thị 0 và báo tự lưu | Đọc lại dữ liệu máy chủ; nếu chưa xác minh được, hiện “Đồng bộ lại”, chặn gửi/tải danh sách chưa chắc chắn |
| Gửi và bỏ chọn đồng thời | Album `submitted` dù không còn ảnh được chọn | Khóa album trong transaction trên PostgreSQL; tuần tự hóa connection SQLite; cập nhật danh sách/trạng thái cùng giao dịch |
| Retry tác động sai trạng thái | Gửi lại PUT chọn ảnh không đổi có thể đưa danh sách đã gửi về draft | PUT idempotent: chỉ đổi trạng thái khi lựa chọn thực sự thay đổi |
| Phiên hết hạn trong hộp xác nhận | Modal vẫn mở và làm màn hình nhập mật khẩu không thao tác được | Đóng modal/ảnh lớn/download trước khi mở lại màn hình khóa |
| Không cập nhật giữa thiết bị | Phiên khác chọn/bỏ chọn nhưng bộ đếm và bộ lọc giữ dữ liệu cũ | Đồng bộ khi quay lại trang, có mạng trở lại, trước gửi/tải; kiểm tra nền mỗi 20 giây khi trang đang hiển thị |
| Bỏ lỡ sự kiện khi đang đồng bộ | Quay lại trang đúng lúc GET cũ đang chạy có thể bỏ qua lần đọc mới | Xếp một lượt đồng bộ tiếp theo; không cho phản hồi cũ ghi đè thao tác mới |
| Thay đổi kho ảnh khi khách đang xem | Ảnh mới/xóa không xuất hiện ở danh sách đang mở | So sánh dấu phiên bản danh sách ảnh; lấy lại metadata khi thay đổi; giữ vị trí xem khi có thể |
| Xóa ảnh gặp lỗi storage giữa chừng | DB còn ảnh nhưng file hiển thị đã bị xóa; cover/lựa chọn có thể sai | Xóa bản ghi, cập nhật cover/trạng thái và ghi công việc dọn file trong một transaction; giữ công việc dọn file qua restart nếu storage lỗi |
| Hủy upload sau khi máy chủ đã lưu | Thông báo dễ khiến người dùng hiểu ảnh chắc chắn chưa được lưu | Nêu rõ ảnh có thể đã lưu; retry giữ cùng upload key và không tạo bản trùng. Kiểm tra bằng HTTP thật, giữ phản hồi sau khi DB đã ghi |
| Zoom dùng thumbnail | Ảnh lớn vẫn dùng nguồn thumbnail và bị mờ | Tăng `sizes` theo mức zoom; giữ cách tải nhẹ khi chỉ xem ảnh bình thường |
| Pan vượt vùng ảnh thật | Ảnh dọc trong khung rộng có thể bị kéo ra xa do lấy kích thước khung làm giới hạn | Tính giới hạn theo phần ảnh thực sự hiển thị với `object-fit: contain` |
| Double-tap / điều hướng | Double-tap không thu nhỏ; thao tác chạm có thể bị xử lý thêm như dblclick; nút trước bị figure che | Phân biệt tap với kéo, xử lý touch riêng, kiểm tra double-tap thật trên hai engine; đặt nút điều hướng phía trên ảnh |
| Font hộp xác nhận | Heading dùng font quản trị trong trang khách | Dùng font chung của giao diện public |

Bản ghi tái hiện trước sửa: `output/gallery-sync-review/probe.json`. Dữ liệu này là fixture tổng hợp, không phải dữ liệu khách hàng.

## Kiểm chứng

- PostgreSQL 16: **227/227 test unit/API**, không skip. Container riêng, schema tạm, xóa sau kiểm tra.
- SQLite: **218 pass / 220 test**, 2 test PostgreSQL được skip đúng điều kiện; không có test fail.
- Gallery 900 ảnh: **83/83 kiểm tra ở vòng regression cuối**, cộng một profile mạng/CPU chậm đã chạy qua ở vòng trước (84/84), gồm desktop 1440, mobile 390/320, keyboard/swipe, ảnh lỗi và retry, phiên hết hạn, thứ tự ảnh, bộ lọc, focus, không tràn ngang, kiểm tra accessibility và mạng/CPU chậm giả lập.
- Chrome và WebKit: kiểm tra đồng bộ giữa hai context độc lập, xác nhận cũ, mất ACK sau DB save, offline rồi khôi phục, hết phiên, zoom, touch thật, hủy upload sau khi lưu rồi retry.
- Chrome và WebKit: upload JPEG, lỗi từng file, ACK thiếu, mất kết nối, chờ phản hồi lâu hơn 12 giây, file lớn, `.ccphoto`, đo dung lượng, retry không trùng.
- Chrome và WebKit: tải đúng byte JPG lưu sẵn, ZIP nhiều ảnh, chia gói 50+1, lựa chọn thay đổi sau khi mở dialog, 401/413/503, hủy đang tải, retry, focus và accessibility 320/390/768/1440.
- Chrome: tạo gallery không mật khẩu → thêm mật khẩu → sai/đúng mật khẩu → khóa lại → bỏ mật khẩu; chọn/gửi/tải ảnh; drag/drop, hủy upload, xác nhận gửi.
- Syntax check và `git diff --check`.

Các test cũ được cập nhật để chờ hộp xác nhận sau bước đọc dữ liệu bất đồng bộ, và tạo xung đột download **sau** khi mở dialog. Đây là tình huống stale thực sự; danh sách thay đổi trước khi mở dialog nay đã được tự đồng bộ.

## Hiệu năng ghi nhận

Fixture 900 ảnh tổng hợp; HTTP local, Chrome, không suy diễn thành số liệu production.

| Điều kiện | Sẵn sàng gallery | Request ảnh ban đầu | Layout shift |
| --- | ---: | ---: | ---: |
| Desktop 1440, DPR 1 | 229 ms | 14 | 0 |
| Mobile 390, DPR 2 | 126 ms | 16 | 0 |
| Mobile 320, DPR 2 | 149 ms | 15 | 0 |
| Mobile, CPU chậm 4 lần, mạng 1.5 Mbps/100 ms | 4.46 giây; ảnh đầu 4.80 giây | 16 | 0 |

- Không tải toàn bộ 900 ảnh khi mở gallery. Chọn ảnh không phát sinh tải lại ảnh trong lần đo.
- Đồng bộ nền trả ID lựa chọn và dấu phiên bản; không gửi lại toàn bộ metadata nếu danh sách ảnh không đổi. Bỏ qua DOM update khi trạng thái giữ nguyên, ngừng polling khi tab ẩn.
- Bộ lọc ảnh đã chọn phản hồi ngay, đồng bộ chạy nền. Trước thao tác gửi/tải phải xác minh dữ liệu mới nhất.
- Zoom chỉ nâng chất lượng nguồn ảnh đang xem; preload ảnh lân cận vẫn dựa trên kích thước hiển thị bình thường.
- Truy vấn danh sách album quản trị giữ số lượng cố định; không thêm truy vấn cleanup mỗi lần khi hàng đợi rỗng.
- Profile CPU chậm có long task khoảng 299 ms. Đây vẫn là điểm cần đo thêm trên điện thoại thực; không khẳng định giao diện luôn mượt trên mọi thiết bị.

## Giới hạn cần biết

- Đồng bộ nền theo chu kỳ 20 giây, không phải realtime WebSocket. Trước khi xác nhận gửi, BE luôn kiểm tra chính xác danh sách, nên không âm thầm gửi danh sách khác.
- Danh sách chung vẫn cho phép một người bỏ chọn ảnh người khác đã chọn; đây là hệ quả của mô hình chung đã được xác nhận.
- Caption/tên phần/thông tin album được đọc lại khi quay lại trang hoặc chuẩn bị gửi/tải; không cam kết cập nhật mọi metadata tức thời ở một tab luôn mở.
- File xóa chưa dọn được khi storage lỗi được lưu trong `photo_cleanup`, thử lại ở lần xóa hoặc truy cập danh sách album quản trị sau đó. Không có worker nền riêng. Ảnh đã xóa không còn được cấp qua API dù file dọn chưa xong.
- Kiểm tra trên browser engine với thiết bị giả lập, chưa thay thế thử trực tiếp Safari/iPhone/Android và đo mạng Render/Supabase production. Không dùng dữ liệu production, không load `.env`, không sửa container DB đang tồn tại.

## Chạy lại

Yêu cầu Node >=22.13 (lượt kiểm tra này dùng Node 24). `npm test` chạy SQLite; đặt `STUDIO_TEST_POSTGRES_URL` trỏ tới database test riêng để chạy thêm các đường PostgreSQL. Không dùng database production.

Chạy browser bằng Node với `STUDIO_PLAYWRIGHT_MODULE` nếu Playwright nằm ngoài project. Các script: `gallery-sync-browser.smoke.mjs`, `gallery-view-browser.smoke.mjs`, `gallery-download-browser.smoke.mjs`, `upload-browser.smoke.mjs`, `prepared-upload-browser.smoke.mjs`, `gallery-upload-ux.smoke.mjs`, `gallery-password-flow.smoke.mjs` trong `studio/tests/`. Những script hỗ trợ nhiều engine dùng `STUDIO_BROWSER=webkit` để đối chiếu. `STUDIO_AXE_MODULE` bật kiểm tra accessibility trong các suite có hỗ trợ.

Log và ảnh chụp được giữ trong `output/gallery-sync-review/`; số liệu có profile mạng chậm ở `output/gallery-view-review/browser-summary.json`. Thư mục `output/` được gitignore.

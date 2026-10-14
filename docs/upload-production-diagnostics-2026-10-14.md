# Upload production vẫn hết hạn 180 giây

## Bằng chứng đã kiểm tra

- Render xác nhận bản `bc195f9` đã live qua manual deploy lúc 22:01 ngày 14/10/2026, giờ Việt Nam. Auto-Deploy vẫn Off.
- Service Free, giới hạn CPU 0,15 và RAM 512 MiB. Các mẫu phút 22:03–22:13 có RAM khoảng 75–76 MiB, CPU thấp; không thấy crash/OOM trong log đã đọc. Không có request logs đủ chi tiết để biết request upload dừng ở đâu.
- Health trên custom domain và onrender.com trả 200 trong khoảng 0,3–0,5 giây; API site có truy vấn database trả 200 khoảng 0,7 giây. Probe upload không có phiên đăng nhập trả 401 đúng dự kiến, không gửi ảnh hoặc tạo dữ liệu production.
- File đầu danh sách lỗi `CC - 0003.jpg` đọc và tối ưu được ở local: 4.640.889 byte, khoảng 1,4 giây.
- Benchmark Linux Node 24, Sharp theo lockfile, CPU quota 0,15, RAM/swap giới hạn 512 MiB: file trên mất 19,8 giây, RSS tối đa 155 MiB; `CC - 0546.jpg` mất 31,3 giây, RSS tối đa 264 MiB. Đây là mô phỏng tài nguyên, không phải phép đo trên Render và không bao gồm mạng/Supabase.

Chưa xác định nguyên nhân cuối cùng. Dữ liệu hiện có chưa đủ cơ sở quy lỗi cho thiếu CPU/RAM hoặc yêu cầu nâng gói. Không tiếp tục tăng timeout hay hạ chất lượng ảnh theo phỏng đoán.

## Thay đổi chẩn đoán

- Upload dùng XHR để hiển thị byte progress và phân biệt đang gửi với đã gửi nhưng chờ xác nhận lưu. 100% chỉ là trình duyệt đã gửi dữ liệu, không phải bằng chứng ứng dụng đã nhận/lưu ảnh.
- Giữ giới hạn 20 MiB/40 megapixel, 180 giây, gửi tuần tự, khóa retry và toàn bộ thông số chất lượng ảnh.
- Mỗi request có mã kiểm tra; lỗi truyền dữ liệu, timeout và lỗi từng ảnh hiển thị mã này.
- Production ghi JSON với tiền tố `[upload]`: request, xác thực, nhận body, kiểm tra trùng, decode, WebP, thumbnail, JPEG, lưu storage, database, rollback, kết thúc/ngắt kết nối. Trong khi chờ có heartbeat mỗi 15 giây, tự dọn khi kết nối kết thúc.
- Log gồm thời gian và RSS; lỗi storage giữ HTTP status. Không ghi filename, album ID, cookie, token, nội dung ảnh, URL storage hoặc error message có thể chứa bí mật.

## Cách xác minh trên production

Sau manual deploy, reload trang admin và chỉ chọn một ảnh để thử. Mở Render → Logs → Live tail, tìm `[upload]` hoặc mã kiểm tra.

- Chưa có `request_start`: ứng dụng chưa ghi nhận request; kiểm tra browser/đường truyền/proxy trước khi kết luận server encode chậm.
- Dừng `receive_body`: ứng dụng đang chờ nhận multipart.
- Dừng `authenticate` / `deduplicate` / `database_insert`: kiểm tra kết nối/truy vấn database.
- Dừng `optimize_*`: đo CPU/RAM và thời gian encoder.
- Dừng `store_*` hoặc có `storage_status`: kiểm tra Supabase Storage.
- `saved` rồi kết nối đóng: ảnh có thể đã lưu; retry trong cùng lượt giữ khóa chống trùng.

Không có upload thử hay sửa dữ liệu album production trong lượt chẩn đoán này. Bản bổ sung giúp xác định điểm nghẽn; chưa được coi là đã chữa xong lỗi production.

## Kiểm thử

- 161/161 test đạt, không skip, gồm PostgreSQL 16; kiểm tra thêm heartbeat cleanup, log không lộ bí mật, mã HTTP storage và thông báo lỗi theo giai đoạn truyền dữ liệu.
- Browser Chromium và WebKit đạt: JPEG thật >10 MiB, tiến trình chờ xác nhận, phản hồi chậm 13 giây, phản hồi bị cắt sau khi lưu rồi retry không trùng, lỗi từng file, portrait upload, reload, lightbox, responsive và accessibility.
- Browser test gây lỗi tại server sau khi nhận multipart thật. Không dùng route.fetch cho mô phỏng upload trên WebKit vì công cụ đó bỏ phần nội dung file trong thử nghiệm này.

## Kiểm thử

- 161/161 test đạt, không skip, gồm PostgreSQL 16; kiểm tra thêm heartbeat cleanup, log không lộ bí mật, mã HTTP storage và thông báo lỗi theo giai đoạn truyền dữ liệu.
- Browser Chromium và WebKit đạt: JPEG thật >10 MiB, tiến trình chờ xác nhận, phản hồi chậm 13 giây, phản hồi bị cắt sau khi lưu rồi retry không trùng, lỗi từng file, portrait upload, reload, lightbox, responsive và accessibility.
- Browser test gây lỗi tại server sau khi nhận multipart thật. Không dùng route.fetch cho mô phỏng upload trên WebKit vì công cụ đó bỏ phần nội dung file trong thử nghiệm này.

## Kiểm thử

- 161/161 test đạt, không skip, gồm PostgreSQL 16; kiểm tra thêm heartbeat cleanup, log không lộ bí mật, mã HTTP storage và thông báo lỗi theo giai đoạn truyền dữ liệu.
- Browser Chromium và WebKit đạt: JPEG thật >10 MiB, tiến trình chờ xác nhận, phản hồi chậm 13 giây, phản hồi bị cắt sau khi lưu rồi retry không trùng, lỗi từng file, portrait upload, reload, lightbox, responsive và accessibility.
- Browser test gây lỗi tại server sau khi nhận multipart thật. Không dùng route.fetch cho mô phỏng upload trên WebKit vì công cụ đó bỏ phần nội dung file trong thử nghiệm này.

# Review UI/UX và hiệu năng trình duyệt folder Drive — 20/10/2026

Phạm vi: luồng tạo/gắn album từ folder Drive, duyệt folder con, tổng số ảnh/folder và tối đa 6 thumbnail. Review source, kiểm tra độc lập, mô phỏng lỗi/mạng chậm, chạy UI Chrome với Drive thật trên local. Chưa triển khai VPS production.

## Phát hiện và xử lý

| Vấn đề đã xác minh | Thay đổi |
|---|---|
| Mobile phải cuộn dài mới đến nút chọn; danh sách nhiều folder đẩy cả nút đóng ra xa | Header và footer cố định trong dialog; chỉ phần nội dung cuộn. Nút chọn/đóng luôn hiện ở 320×568, kể cả danh sách 80 folder. Rút gọn hướng dẫn, ẩn breadcrumb một cấp; nút Làm mới không bị co và xuống dòng khi tên folder dài. |
| Đổi folder sớm chỉ ngừng polling, nhưng worker vẫn xử lý preview folder cũ | Chỉ hủy các browse job do chính cửa sổ tạo khi sửa link, chuyển folder, chọn hoặc đóng. ACK enqueue đến muộn cũng được hủy; không đụng job nhập ảnh. Worker kiểm fence của browse mỗi 500ms và thoát enrichment bị hủy. |
| Sau khi browse xong worker vẫn nghỉ idle 5 giây mặc định dù còn việc chờ | Browse kết thúc sẽ nhường event loop 1ms rồi nhận việc tiếp; hàng đợi rỗng và retry vẫn giữ polling/backoff. Test trước sửa tái hiện `[5000,5000,5000]`, sau sửa hai browse liên tiếp không chờ idle, rồi mới nghỉ khi hết việc. |
| Budget 8/12 giây của thumbnail/count không bao gồm lần kiểm quyền cuối; SDK/auth treo có thể giữ worker lâu | Toàn bộ enrichment và kiểm quyền cuối có deadline 15 giây. Timeout/cancel không xuất bản kết quả đến muộn; kiểm signal trong transaction cùng lease/generation. Test có adapter cố tình bỏ qua AbortSignal và trả muộn. |
| Job đã báo failed/canceled nhưng folder vẫn chọn được | Xóa kết quả/cache và vô hiệu nút chọn khi thất bại; Duyệt folder vẫn dùng để thử lại. Lỗi polling của lượt chính cũng bỏ kết quả vì job được hủy. Count/thumbnail không khả dụng trong một job hợp lệ vẫn cho chọn folder. |
| Làm mới trong lúc enrichment tạo thêm job, lỗi preview im lặng, live region bị ghi lại khi không đổi | Khóa Làm mới khi đang tải, giữ điều hướng/chọn hoạt động; hiện thông báo preview không khả dụng; cập nhật text khi thay đổi, giữ DOM ảnh/nút và focus qua polling/phân trang. |

Hủy job là best effort qua API: nếu trình duyệt mất mạng hoàn toàn, yêu cầu hủy có thể không tới server. Deadline vẫn giới hạn phần enrichment. Deadline 15 giây không phải SLA cho toàn luồng: thời gian chờ hàng đợi, kiểm quyền ban đầu và database có thể dài hơn. Bước kiểm tra folder trước khi tạo/gắn album và các fence lúc nhập ảnh vẫn được giữ.

## Kiểm chứng

- Regression Node 24: **408/408 đạt**, không fail/skip, với SQLite và PostgreSQL 17 riêng. Database PostgreSQL tạm đã dừng và xóa.
- Syntax và `git diff --check` đạt. Smoke picker kiểm exact/partial/unavailable counts, phân trang, cache, ảnh lỗi/URL không an toàn, focus/DOM ổn định, retry, đổi link nhanh, mất quyền/generation, polling lỗi, hủy job và ACK muộn. Smoke luồng nhập nguồn album được chạy riêng.
- UI thật với stylesheet đầy đủ: Chrome 1440×1000 và 320×568; không lỗi JavaScript/tràn ngang. Chọn folder giữ tên album đang nhập và chuyển focus về nút kiểm tra folder.
- Folder 33 ảnh: chọn được sau **3,34 giây**, có số đếm **4,59 giây**, hoàn tất **7,62 giây**, 6 thumbnail. Mở lại từ cache **33ms**, không tạo job mới.
- Khi Làm mới vẫn đang chạy, chuyển sang folder 346 ảnh: job cũ chuyển `running → canceled`, folder mới chọn được sau **3,36 giây**; số đếm đúng 346 ảnh/0 folder con. Chỉ hai bộ thumbnail hoàn tất được tải, tổng 12 request ảnh trong ba lượt browse gồm một lượt bị hủy.
- Trước/sau: **2 album, 346 ảnh, 1 admin, 1 mapping**. Không tạo/import/xóa ảnh hay đổi cấu hình kết nối trong lượt review.

Số thời gian trên là một lượt kiểm chứng local, gồm Google API, queue và polling UI; không phải benchmark nhiều mẫu. Fixture 5.000 metadata và 80 folder xác minh logic/DOM, không thay cho đo 5.000 JPEG full-resolution hoặc cây Drive lớn thật. Worker vẫn xử lý từng job/batch; khi có import nặng đang chạy, browse có thể phải chờ batch đó. Phần này cần đo với workload vận hành trước khi quyết định tách worker hoặc thêm ưu tiên hàng đợi.

Bằng chứng ngoài Git trong `output/drive-folder-browser-review-2026-10-20/`: `regression-tests.log`, `browser-smoke.log`, `live-review-report.json`, ảnh `review-desktop.png`, `review-mobile.png`, `review-mobile-footer.png`, các ảnh danh sách 80 folder và `final-state.json`. Runtime local được ghi ở `output/drive-local-preview/runtime-20261020.json`.

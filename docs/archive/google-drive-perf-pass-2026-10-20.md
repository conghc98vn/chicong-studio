# Tối ưu thêm hiệu năng Google Drive — 20/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Tiếp nối [review UI/UX và hiệu năng](google-drive-folder-browser-review-2026-10-20.md). Bản sửa đã nạp vào local `http://127.0.0.1:4175/admin`; chưa phát hành production.

## Thay đổi và số lượng công việc giảm được

| Đường chạy | Trước | Sau |
|---|---:|---:|
| Một lần polling browse/inspect không có bộ lọc | 3 truy vấn SQL | 1 truy vấn SQL, giảm 67% |
| Tải 6 thumbnail khi bảng cache đã khởi tạo | 6 SELECT + 6 DELETE | 6 SELECT, không DELETE |
| 30 tick idle cách nhau 1 giây: heartbeat | 60 UPSERT | 3 UPSERT |
| Cùng 30 tick idle: dọn hai cache tạm | 60 DELETE | 2 DELETE |
| Sau apply hoàn tất hoặc preview chuyển sang chờ duyệt, trước khi nhận job kế tiếp | Nghỉ idle 5.000ms mặc định (local 1.000ms) | Nhường event loop 1ms rồi nhận việc tiếp |

Đây là số câu lệnh SQL và khoảng chờ do ứng dụng đặt, không phải số lần ghi đĩa vật lý hoặc cam kết độ trễ Google. Baseline heartbeat/cleanup tính theo đường chạy cũ (hai heartbeat và hai DELETE mỗi tick); test mới đếm thực tế bằng clock kiểm soát. Hai truy vấn chi tiết thừa của polling được đo trực tiếp bằng helper cũ và so sánh hợp đồng phản hồi. Tổng housekeeping trong fixture giảm **120 → 5 câu lệnh ghi**; phép này không bao gồm truy vấn claim job, kiểm maintenance hoặc scheduler.

Polling chỉ bỏ truy vấn inventory với `check` không có mapping, operation `browse-folders`/`inspect-folder`, không lọc action/status. Pagination, counts rỗng và phản hồi giữ nguyên; import và yêu cầu có bộ lọc tiếp tục dùng đường chi tiết đầy đủ. Không tăng tần suất polling trình duyệt.

Đọc thumbnail kiểm expiry ngay trong SELECT, cùng trạng thái job, lease, cancel và connection generation. Ảnh hết hạn trả 404 ngay cả khi chưa chạy cleanup. Worker dọn cache khi khởi động và mỗi 60 giây; ghi cache vẫn kiểm dung lượng và dọn hạn. Heartbeat cùng trạng thái cách nhau tối thiểu 10 giây, còn chuyển running/idle/stopped ghi ngay. Cleanup lỗi được thử lại tick tiếp theo. Đã bỏ một lần đọc job lặp sau batch thành công.

Worker giữ FIFO, một batch tại một thời điểm, kiểm maintenance trước mỗi claim, gia hạn lease như trước và kiểm hủy browse mỗi 500ms. Job hoàn tất/lỗi/hủy/chờ duyệt giải phóng worker để nhận việc tiếp; queue rỗng, retry và lỗi trước khi claim vẫn giữ polling/backoff. Không tăng số tiến trình tải/encode ảnh.

## Kiểm chứng

- Node 24: **420/420 regression tests đạt**, không fail/skip, gồm SQLite và PostgreSQL 17 cách ly. Syntax và `git diff --check` đạt. Container PostgreSQL dùng cho lượt này đã xóa.
- Test đếm truy vấn polling và 6 thumbnail; kiểm ảnh hết hạn trước cleanup; heartbeat theo thời gian/chuyển trạng thái; cleanup lỗi; maintenance khóa job; apply → browse và chờ duyệt → browse có dãy chờ `[1, 1, 5000]`.
- Smoke trình duyệt folder và form tạo/gắn album đạt: phân trang, counts, cache, cancel, retry, focus, preview và màn hình 320px. Review độc lập không phát hiện regression trong các thay đổi trên.
- Chrome với Drive thật, 1440×1000 và 320×568: folder 33 ảnh chọn được sau **4,85s**, có số đếm **4,86s**, hoàn tất **6,09s**, 6 thumbnail; mở lại cache **43ms**, không tạo job mới. Chuyển từ lượt refresh đang chạy sang folder 346 ảnh chọn được sau **3,37s**, lượt cũ chuyển `running → canceled`. Số lượng chính xác 33/346 ảnh, 0 folder con. Không lỗi JavaScript hoặc tràn ngang.
- Trước/sau giữ **2 album, 346 ảnh, 1 admin, 1 mapping**; không nhập/xóa ảnh hoặc sửa kết nối. Health local trả 200.

Các thời gian UI là một lượt kiểm chứng, có biến động mạng, queue và chu kỳ polling 1,5 giây. Lần này mở folder 33 ảnh chậm hơn mẫu 3,34s ở review trước dù job hoàn tất sớm hơn; không dùng hai mẫu để kết luận tốc độ mạng tăng. Kết quả xác định của thay đổi là giảm truy vấn/ghi và loại bỏ khoảng nghỉ thừa đã tái hiện bằng test.

## Giới hạn còn lại

Browse vẫn có thể chờ một batch import đang chạy hoặc bước inventory ban đầu. Chưa ngắt batch giữa ảnh, đổi ưu tiên FIFO hoặc mở thêm worker ảnh. Chưa có phép đo 5.000 JPEG full-resolution thật; fixture 5.000 metadata trong regression không đại diện cho thời gian download/encode. Initial request/auth và thời gian database chưa có SLA toàn luồng. Giữ các giới hạn này khi nghiệm thu production.

Bằng chứng ngoài Git: `output/drive-perf-pass-2026-10-20/` gồm `regression-tests.log`, `browser-smoke.log`, `album-entry-smoke.log`, `live-review-report.json`, `before.json`, `final-state.json` và ảnh UI. Runtime local: `output/drive-local-preview/runtime-20261020.json`.

# Rà soát UI/UX và hiệu năng Google Drive Sync

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Ngày hoàn tất: 17/10/2026 (Asia/Ho_Chi_Minh). Phạm vi: source hiện tại, fixture cách ly 500/5.000 ảnh, Chromium trên desktop và mobile giả lập; không triển khai production hoặc sửa ảnh nguồn Drive.

## 1. Những vấn đề đã sửa

| Mức | Phát hiện | Kết quả sửa |
|---|---|---|
| Cao | Catalog 5.000 ảnh truyền hơn 1,6 MB JSON chưa nén, chậm trên mạng di động | Nén gzip bất đồng bộ cho response catalog khi trình duyệt chấp nhận; giữ nguyên dữ liệu, quyền xem và `no-store` |
| Cao | Worker nghỉ 5 giây sau mỗi batch dù còn ảnh đang chờ; batch 5/5.000 ảnh cộng khoảng 83 phút chờ | Tiếp tục theo `available_at` sau khi nhường batch; idle/retry vẫn dùng polling và cơ chế backoff |
| Cao | Sync ảnh không đổi đọc lại danh sách pending và xác minh từng file dù không xuất bản nội dung | Inventory đọc/cập nhật theo nhóm; xác nhận unchanged từ inventory hoàn chỉnh; không sửa rendition hoặc provenance đã nhập |
| Vừa | Người dùng khó nhận ra cách tạo album từ link Drive | Form tạo bộ ảnh có **Nguồn ảnh ban đầu → Google Drive**, tự mở phần gắn folder sau khi tạo; album trống có nút nhập Drive |
| Vừa | Có thể bấm đồng bộ trước baseline hoặc khi gallery cần duyệt | Hiển thị rõ 3 bước gắn folder → xem trước → duyệt; chỉ hiện Đồng bộ ngay khi phù hợp |
| Vừa | Cập nhật panel làm mất nội dung nhập, focus hoặc ô xác nhận | Giữ draft/focus và xác nhận đúng bản preview khi polling/phân trang; bản preview thay đổi thì phải xác nhận lại |
| Vừa | Refresh tạo request trùng; nhấp nhanh có thể gửi nhiều thao tác | Gom lượt refresh đang chạy, chặn thao tác khi đang gửi, giữ request key ổn định khi thử lại |
| Vừa | Poll lựa chọn gallery đọc và hash 5.000 ảnh dù không có thay đổi | Cache hai hash theo database/album/catalog revision; giới hạn 128 album, không lưu bản sao toàn bộ ảnh |
| Nhỏ | Link ảnh riêng, folder trùng và bảng tên file dài khó hiểu trên mobile | Thông báo cụ thể; nhãn từng cột trên màn hình nhỏ; nội dung dài xuống dòng; kiểm tra 320/390px |

Mục Drive chỉ nạp API khi được mở. Lưu thông tin album hoặc cập nhật danh sách ảnh giữ trạng thái mở của mục này. Việc chọn nguồn Drive trong form tạo album chưa tạo job; người dùng vẫn phải nhập folder và duyệt rõ ràng.

## 2. Số đo giao diện và truyền dữ liệu

Fixture SQLite local, 5.000 metadata ảnh tổng hợp. Mobile giả lập: 390px, mạng 1,6 Mbps, độ trễ 100 ms, CPU chậm 4 lần. Các lượt đo trước/sau dùng cùng harness; số thời gian là quan sát trong phòng thử, không phải SLA.

| Phép đo | Trước sửa | Sau sửa |
|---|---:|---:|
| Payload catalog gallery | 1.623.371 bytes | 93.830 bytes gzip (giảm 94,2%) |
| Truyền catalog trên mạng mobile giả lập | 8.250 ms | 598 ms |
| Gallery có danh sách ảnh để tương tác | 11.208 ms | 3.684 ms |
| Payload catalog admin | 1.813.503 bytes | 90.681 bytes gzip |
| Poll gallery không đổi, sau khi cache đã có | 6 SQL / 5.000 hàng ảnh | 4 SQL / 0 hàng ảnh |
| Số card gallery/admin đang dựng | 90 / 120 | 90 / 120 |

Desktop local sau sửa: gallery có danh sách trong khoảng 143 ms, admin 219 ms. Trang đầu yêu cầu 24 ảnh trên desktop và 30 ảnh trên mobile, không tải toàn bộ 5.000 ảnh. Đã kiểm lightbox từ ảnh 90 sang 91, trả focus về ảnh mở trước đó, phân trang và tìm ảnh cuối. Admin polling không đổi chỉ lấy trạng thái, không tải lại full catalog.

Nguồn đo: `output/gallery-scale-review/report.json` (trước nén/cache), `output/gallery-scale-compressed/report.json` (sau nén), `output/gallery-scale-final/report.json` (sau nén + cache). `transferSize` trình duyệt gồm thêm khoảng 300 bytes header; bảng trên dùng kích thước body. Ảnh fixture là ảnh đơn sắc nhẹ, vì vậy thời gian ảnh hiển thị không đại diện cho ảnh chụp thật.

## 3. Số đo worker

Harness `studio/tests/drive-performance.bench.mjs` dùng metadata giả lập, batch 5, file GET cố ý không có `parents`; không gọi Google, không tải/encode ảnh. So sánh lượt review trước và sau tối ưu:

| Công việc | Trước | Sau |
|---|---:|---:|
| Preview 500 ảnh: SQL | 2.069 | 83 |
| Preview 5.000 ảnh: SQL | 20.093 | 228 |
| Sync 500 ảnh không đổi: SQL / API giả lập | 12.458 / 2.005 | 103 / 5 |
| Sync 5.000 ảnh không đổi: SQL / API giả lập | 124.082 / 20.009 | 257 / 9 |
| Số hàng đọc, sync 5.000 ảnh không đổi | 2.608.566 | 25.092 |
| Số batch, sync 5.000 ảnh không đổi | 1.000 | 1 |

Lượt chạy lại của reviewer chính: sync 5.000 unchanged mất 472 ms trên SQLite và 3.834 ms trên PostgreSQL 16 local. Không dùng các số này để dự báo thời gian Drive thật. Bằng chứng sau sửa: `output/drive-metadata-performance.jsonl`, `output/drive-metadata-performance-postgres.jsonl`; số trước sửa được ghi lại bởi lượt review backend trước khi thay thuật toán.

Unchanged chỉ ghi nhận quan sát của inventory hoàn chỉnh, không tăng `imported_version`, không thay checksum đã nhập, không tải/PUT ảnh và không đổi catalog. Các thao tác thêm/đổi tên/thay ảnh tiếp tục kiểm root, membership, phiên bản nguồn và điều kiện duyệt tại ranh giới tải/xuất bản. Kiểm thử retry giữa batch xác nhận không bỏ ảnh pending hoặc làm sai thứ tự tự nhiên. Việc nguồn thay đổi sau một inventory unchanged được đối chiếu lại ở lượt sync tiếp theo.

## 4. Kiểm chứng

- Node 24.19.0, SQLite và PostgreSQL 16 cách ly: **342/342 test đạt, 0 fail/skip**; log `output/drive-ux-perf-final-regression.log`.
- Kiểm tra cú pháp server/frontend/tools và `git diff --check` đạt.
- Smoke trình duyệt: tạo album từ Drive; panel Drive; luồng import/gallery 5.001 ảnh; admin proofing; gallery đồng bộ hai thiết bị; benchmark 500/5.000 metadata.
- Kiểm gzip bằng HTTP thô: giải nén ra đúng payload, tôn trọng `gzip;q=0`/identity, gallery khóa vẫn khóa, admin chưa đăng nhập vẫn bị chặn.
- Kiểm cache: thay metadata, selection-only, database khác, rollback, cập nhật xen giữa lần đọc, eviction; admin byte counts vẫn nhận được thay đổi.
- Kiểm worker loop thật trên cả hai DB: batch còn ảnh tiếp tục ngay, trạng thái đã hoàn tất trở về khoảng nghỉ idle 5 giây.

## 5. Giới hạn còn lại

1. Catalog ban đầu vẫn gồm toàn bộ metadata; gzip giảm băng thông nhưng không giảm số hàng đọc ban đầu. 5.000 ảnh đạt bài đo này; chưa đo nhiều gallery đồng thời.
2. Poll admin vẫn đọc metadata ảnh để nhận biết đầy đủ byte counts và `created`, các trường chưa được revision trigger bao phủ. Cache hiện chỉ áp dụng cho gallery khách để giữ tính đúng đắn.
3. Chưa đo lại import 346 ảnh thật sau tối ưu và chưa encode 500/5.000 JPEG full-resolution trên staging. Bằng chứng r7 cũ vẫn giữ nguyên, không đổi thành kết quả của source mới.
4. Cần nghiệm thu trên thiết bị thật và hạ tầng triển khai trước khi chốt tài nguyên/production. Các cổng vận hành còn lại theo [runbook](../google-drive-sync-operations.md).

Để dùng thử: mở admin local, tải lại trang, chọn **Tạo bộ ảnh → Nguồn ảnh ban đầu: Google Drive → Tạo bộ ảnh**, rồi dán link folder. Với album có sẵn, mở **Nhập ảnh từ Google Drive**. Folder đã liên kết với album khác sẽ được báo rõ để tránh nhập nhầm.

Bản thử tại `http://127.0.0.1:4175/admin` đã được khởi động lại sau khi xác nhận không có job hoặc writer đang chạy. Health/gallery trả 200, catalog trả gzip; giữ nguyên 2 album, 346 ảnh và 1 tài khoản admin. Lịch vẫn tắt. Báo cáo tổng hợp cùng SHA-256 của source kiểm chứng: `output/drive-ux-perf-verification.json`.

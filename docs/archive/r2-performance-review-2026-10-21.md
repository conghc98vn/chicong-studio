# Review hiệu năng và chức năng sau chuyển R2 — 21/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Kết luận: không phát hiện regression chức năng trong phạm vi đã chạy. Chưa có cơ sở kết luận R2 làm toàn website nhanh hơn hoặc chậm hơn; phép đo so sánh cho kết quả khác nhau giữa các file. Không có baseline end-to-end trước migration để định lượng regression toàn trang. Không thay đổi runtime hoặc cấu hình production trong review này.

## Phạm vi và phương pháp

Đọc code adapter, media route, upload/ingest, download và Drive. Benchmark read-only từ VPS, đối chiếu byte bằng SHA-256 giữa R2 và kho Supabase nguồn; luân phiên thứ tự provider. Đo HTTP thật qua HTTPS/Cloudflare từ VPS. Burst giới hạn 24 thumbnail, tối đa 4 request đồng thời. Đây là mẫu đo ngắn, không phải kiểm thử tải cao, Core Web Vitals hay trải nghiệm mạng di động của khách.

Bằng chứng riêng tư: `output/r2-perf-review-2026-10-21/`. Benchmark không sửa bản ghi/ảnh khách. ZIP chỉ tải các ảnh đã chọn hiện có; không thêm lựa chọn. Không chạy import Drive hoặc upload production mới trong lượt này.

## Kết quả đọc storage

| Mẫu | R2 median | Supabase median |
| --- | ---: | ---: |
| Thumbnail 55.568 byte, cùng file, 6 lần/provider | 134 ms | 84 ms |
| WebP 248.192 byte, cùng file, 6 lần/provider | 175 ms | 87 ms |
| 4 thumbnail khác, 2 lần/file/provider | 135 ms | 954 ms |
| 4 WebP khác, 2 lần/file/provider | 144 ms | 1.165 ms |
| 4 JPEG, 2 lần/file/provider | 152 ms | 1.254 ms |

Mỗi phép đo bao gồm adapter nhận toàn bộ file; R2 còn kiểm SHA-256. Tất cả nội dung giữa hai provider khớp. Không kiểm soát được cache phía provider và tuyến mạng; không diễn giải chênh lệch này thành cam kết tốc độ hoặc phần trăm cải thiện toàn hệ thống.

## HTTP live và tài nguyên

- Thumbnail: median 461 ms; WebP: median 498 ms, mỗi loại 6 lượt. TTFB tương ứng 411/423 ms.
- Conditional GET trả 304, không body, 153 ms. Dùng request cache mode `no-cache` của fetch (max-age=0) để mô phỏng revalidation; default fetch với conditional header tự thêm no-cache và gây tải lại, nên lần thử mặc định không phải lỗi ứng dụng.
- 24 thumbnail ở concurrency 4: 3.185 ms tổng, median 446 ms/request, max 1.167 ms; không lỗi HTTP.
- ZIP 2 ảnh: 200, 2.243.904 byte, 2.205 ms; đúng MIME, photo count và chữ ký ZIP. Đây không phải kiểm tra giải nén toàn bộ archive live; bộ regression kiểm phần ZIP.
- Query DB đơn giản sau kết nối đầu tiên: 92–93 ms; lần mở kết nối đầu tiên 735 ms.
- Sau đo: health 200, worker idle/heartbeat mới, load average khoảng 0,14, RAM available khoảng 1,4 GB; swap không tăng trong các snapshot. Không thư mục tạm `chicong-download-*` còn sót. Snapshot tài nguyên không đại diện peak của tải lớn.

## Các điểm hiệu năng cần theo dõi

1. **Ảnh vẫn proxy qua VPS và kiểm DB.** `studio/server/app.mjs:165`–`186` kiểm quyền trước đọc và kiểm lại sau đọc. Header public là `private,no-cache`; Cloudflare trả DYNAMIC. Do đó việc chuyển kho không tự tạo CDN cache cho ảnh. Hai lượt DB qua mạng cùng storage GET đóng góp vào TTFB. Đây là kiến trúc có sẵn, không phải lỗi phát sinh do migration. Nếu tối ưu, cache bytes theo tên file bất biến sau kiểm quyền, hoặc thiết kế đường CDN chỉ cho ảnh thực sự public với xử lý thu hồi quyền; không đổi toàn bộ gallery sang public cache.
2. **284/1.223 ảnh chưa có JPEG tạo sẵn.** `studio/server/gallery-download.mjs:103` chuyển WebP sang JPEG khi tải các ảnh này. Download ZIP đọc/chuyển đổi từng ảnh tuần tự; latency storage cộng dồn theo số ảnh. Giới hạn hiện có 50 ảnh/100 MiB, tối đa 2 download và deadline 180 giây vẫn giữ. Có thể backfill JPEG theo batch nhỏ sau khi hoàn thiện backup; chưa chạy backfill trong review.
3. **GET giữ toàn bộ file trong RAM.** `studio/server/r2-storage.mjs:55`–`58` thu chunks, concat và kiểm checksum trước trả dữ liệu; adapter Supabase cũ cũng buffer toàn bộ file. R2 có thêm checksum và có thể tạo thêm bản sao buffer. Chưa thấy áp lực tài nguyên ở mẫu tải nhỏ; không xem đây là chứng nhận khả năng chịu nhiều download đồng thời.
4. **Upload có 3 PUT tuần tự.** `studio/server/photo-ingest.mjs:55`–`58` ghi WebP, thumbnail, JPEG rồi publish DB; latency PUT ảnh hưởng thời gian upload/Drive. Hành vi này có sẵn và giúp xử lý trạng thái ghi không rõ kết quả. GET benchmark không chứng minh throughput upload. Không tự tăng concurrency trên VPS 1 vCPU/2 GB.

## Kiểm chứng chức năng

- 81/81 test pass, 0 fail, 0 skip khi cấu hình PostgreSQL test riêng. Bao phủ R2/storage, upload request/queue/optimization API, ingest safety, download JPEG/ZIP, Drive gallery contract và metadata scale 500/5.000 ảnh. Fixture dùng schema test riêng, không dùng DB production.
- Smoke HTTPS live đạt: health, home/admin page, public WebP/thumbnail, portrait, JPEG đã chọn; draft trả 404. HTTP bytes khớp storage.
- Audit live: web/worker dùng cùng R2/config, DB URL giữ nguyên; 9 album/1.223 ảnh/1 admin/7 lượt chọn; 0 album thử, 0 ảnh mồ côi, 0 ingest chưa rõ kết quả.
- Upload R2 thật/password/logout đã được synthetic probe xác minh trong cutover (báo cáo riêng); không tuyên bố đã đo lại tốc độ upload production hoặc chạy mới Drive import ở review này.

Ưu tiên tiếp theo: hoàn thiện backup tự động, sau đó tối ưu 284 JPEG legacy và cache ảnh theo quyền. Không có lỗi chức năng được tái hiện cần hotfix hay rollback trong lượt review này.

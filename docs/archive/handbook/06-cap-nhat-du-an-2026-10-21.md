# 06 — Trạng thái dự án và bàn giao đến 21/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../../README.md).

Đọc cùng [mục lục handbook](../../handbook/README.md). Bản này thay trạng thái chờ trong [snapshot 20/10](05-cap-nhat-du-an-2026-10-20.md). Phạm vi lần rà soát: Git/source/config, tài liệu và log đã lưu; không SSH, gọi cloud, chạy lại test hoặc thay đổi production. Các kết quả production dưới đây là **REPORT** từ biên bản có ngày, không phải kiểm LIVE mới trong lượt handbook.

## 1. Code, cấu hình và hệ thống đang chạy

| Phạm vi | Mốc đã đối chiếu | Giới hạn |
|---|---|---|
| Source Git | HEAD `b772c00`, khớp `origin/main` khi fetch ngày 21/10 | Không dùng HEAD Git thay bằng chứng process/config đang chạy |
| Commit mới | `38059ce` bổ sung nghiệm thu Drive; `b772c00` bổ sung cutover/perf R2, `.env.example`, `render.yaml`, HOSTING | Không có thay đổi module runtime sau `87a756c`; chuyển R2 là thao tác cấu hình/binding trên adapter đã có |
| Runtime triển khai | Biên bản Drive ghi `5a9e83c`; 102/102 hash manifest đã lưu vẫn khớp source local | Chỉ đối chiếu manifest lưu trên máy; biên bản R2 kiểm lại 7 module quan trọng trên VPS, không phải kiểm lại toàn bộ 102 file trong lần này |
| Production | VPS iNET, Caddy/PM2; PostgreSQL Supabase; media R2 private `chicong-production` | Không chuyển database; không deploy Render. Blueprint chỉ là cấu hình tham chiếu nếu dùng lại Render |
| Dữ liệu sau cutover | 9 album, 1.223 ảnh, 1 admin, 7 lượt chọn; R2 có 3.386 object/1.431.587.015 byte | Số tại lần kiểm được báo cáo; không phải số đếm live liên tục |
| Drive | Shared scope, nhập thủ công bật; worker enabled, restart idle đạt, heartbeat R2 mới | Scheduler tắt; chưa reboot VPS hoặc kill giữa import |
| Feedback | [Spec hợp nhất](../../customer-feedback-spec.md) đã vào Git | Vẫn là yêu cầu/thiết kế, chưa triển khai tính năng |

Nguồn: [nghiệm thu Drive](../google-drive-sync-production-release-2026-10-20.md), [cutover R2](../r2-production-cutover-2026-10-21.md), [review hiệu năng](../r2-performance-review-2026-10-21.md). [Evidence 21/10](../../handbook/evidence/evidence-2026-10-21.json) lưu fingerprint, commit và phạm vi đối chiếu; evidence các ngày trước được giữ nguyên.

## 2. Nghiệm thu Drive đã đóng phần nào?

- Kết nối shared/check, browse folder 33/346 ảnh và 6 thumbnail mỗi folder đã đạt. Chênh lệch giữa bảng PENDING và runbook ngày 20/10 không còn trong biên bản cuối.
- Pilot nhập 33 ảnh vào album draft; đồng bộ lại 33 unchanged, không add/replace/rename/missing/conflict và không đổi fingerprint. 1.190 ảnh upload tay giữ nguyên.
- Decode 33 thumbnail, 3 WebP lớn và 1 JPG mẫu đạt; không suy thành decode mọi rendition. Anonymous API/media/download của album draft trả 404, no-store.
- Apply đầu dừng an toàn vì `drive_preview_stale` sau 7 ảnh: 3 file đổi version, checksum/tên/kích thước/MIME/quyền tải không đổi; chưa xác định tác nhân đổi version. Giữ guard, tạo preview mới 7 unchanged + 26 add, duyệt lại và hoàn tất. Không sửa DB để bỏ qua kiểm nguồn.
- **13 phút 38 giây** là thời gian job cho 26 ảnh còn lại, không phải toàn bộ 33 ảnh. Nguồn 33 JPEG tổng 350.069.257 byte; cgroup đỉnh khoảng 203 MiB trong khoảng trước restart, `NRestarts=0`. Không ngoại suy SLA cho 500/5.000 JPEG.
- Worker và `pm2-root` enabled, PM2 process list đã lưu; restart worker khi idle đạt. Enable và restart không chứng minh reboot máy hoặc resume khi process bị kill giữa import.

Pilot này chạy trước chuyển storage sang R2. Cutover sau đó kiểm upload R2 bằng probe synthetic và heartbeat/binding worker; review hiệu năng không chạy import Drive mới trên production. Studio tiếp tục UAT album draft hiện có, không tạo thêm album từ cùng folder chỉ để lặp nghiệm thu.

## 3. Cutover R2, backup và rollback

Trước chuyển, Supabase có 3.390 object, gồm 3.386 được tham chiếu và 4 dư; không xóa object dư. Copy cuối đưa 3.386 object được tham chiếu sang R2, GET kiểm SHA-256/bytes và HEAD kiểm MIME/hash metadata; 0 dư ở đích. Các lượt verify-only sau đó tiếp tục đạt. Mốc hoàn tất copy cuối 09:34:03 UTC+7, 137 giây là thời gian lượt copy cuối, không phải toàn bộ migration hay downtime.

Quy trình giữ lease/drain, dừng worker, đối chiếu mapping với snapshot, copy/verify rồi đổi binding và cấu hình cả web/worker. Sau restart, smoke và unlock: owner=null, deadline=0, 0 writer/unknown write/cleanup. R2 private: r2.dev tắt, không custom domain/CORS; token production giới hạn Object Read & Write trên đúng bucket. Quy tắc abort multipart sau 7 ngày không phải TTL xóa ảnh. Kho Supabase cũ và env rollback được giữ.

| Backup | Dữ liệu đã verify | Khôi phục và giới hạn |
|---|---|---|
| Baseline trước pilot 20/10 | 3.287 object, 8 album/1.190 ảnh; SQL/media copy ngoài VPS | Restore SQLite/media offline đạt; chưa chứa 33 ảnh nhập sau đó |
| Snapshot 21/10 | 3.386 object, 9 album/1.223 ảnh; bản độc lập trên Mac | integrity_check=ok, 0 lỗi FK; sessions bị thu hồi, Drive tắt trong bản restore |
| Cron SQL 03:00 | Dump DB trên VPS theo report | Không chứa bytes ảnh; không thay lịch backup media |

Snapshot mới là `2026-10-21T02-19-52-867Z-83c5216a-aee7-4e92-b7e4-ed0ce9e716e8`. Backup local vẫn giữ ở `output/r2-production-2026-10-21/backup`; hai working copy `restored-baseline` và `restored-current` đã dọn, kết quả giữ trong report. Manifest chứa dữ liệu khách/hash xác thực: không chép nội dung vào handbook hoặc Git. Snapshot baseline 20/10 ghi `appRevision=unknown` vì VPS không có Git; cần dùng manifest runtime riêng để truy vết source.

Restore ứng dụng offline đã đạt, nhưng **full Supabase/cloud restore chưa được nghiệm thu**. Chưa có lịch backup media tự động, cảnh báo tuổi snapshot hoặc RPO/RTO production đã chốt. Sau khi R2 có ảnh mới, rollback cần đồng bộ delta ngược dưới khóa và đổi binding; đổi env đơn thuần hoặc restore DB cũ có thể làm mất/đứt liên kết dữ liệu mới.

## 4. Hiệu năng và kiểm thử: không trộn phạm vi

| Bằng chứng | Kết quả | Không được suy ra |
|---|---|---|
| CI PR/main commit `87a756c`, Node 24/PG16 | 420/420, 0 fail/skip; đã sửa setup thư mục test cho checkout sạch | Không phải suite vừa chạy lại trong lượt handbook 21/10 |
| Cutover, bộ chọn lọc với PostgreSQL test riêng | 62/62, 0 fail/skip | Không thay full suite; các lượt trước có 2 PG-only skip đã được chạy lại |
| Review hiệu năng, bộ chọn lọc với PostgreSQL test riêng | 81/81, 0 fail/skip | Có test trùng bộ 62; không cộng hai số thành coverage mới |
| Smoke production và probe cutover | Quyền draft/password/logout, media/JPEG và upload synthetic đạt theo biên bản | Review perf không lặp upload hoặc import Drive production |

Đã đọc tail log 62 và 81 trong workspace, khớp báo cáo. Không copy manifest/private report chứa dữ liệu khách vào Git. CI vẫn không gọi browser smoke/axe.

[Review hiệu năng](../r2-performance-review-2026-10-21.md) đo read-only từ VPS, luân phiên provider và đối chiếu cùng bytes. Một file thumbnail lặp 6 lần/provider có median R2 134 ms, Supabase 84 ms; nhóm 4 thumbnail khác, 2 lần/file/provider lại là 135 ms và 954 ms. Không kiểm soát cache/provider/đường mạng, không có baseline end-to-end trước cutover: không kết luận toàn website nhanh hơn hoặc chậm hơn.

HTTP thumbnail/WebP median 461/498 ms trong mẫu 6 lượt; burst 24 thumbnail, concurrency 4 mất 3.185 ms, không lỗi. 304 không body đạt trong phép thử revalidation. ZIP 2 ảnh trả 200, đúng MIME/count/signature, nhưng không phải phép thử giải nén đầy đủ archive live. Số RAM/load sau đo không đại diện peak tải lớn.

Code giải thích những phần còn tốn thời gian:

- Media proxy qua VPS, kiểm DB/quyền trước và sau storage GET; published dùng `private,no-cache`, Cloudflare DYNAMIC. R2 không tự tạo CDN cache.
- 284/1.223 ảnh chưa có JPEG tạo sẵn, tải cần encode từ WebP; ZIP đọc/chuyển từng ảnh tuần tự.
- R2 GET buffer toàn bộ bytes và kiểm checksum; ingest ghi ba rendition tuần tự rồi publish DB. Benchmark GET không chứng minh throughput PUT/import.

Nguồn code: [media route](../../../studio/server/app.mjs), [R2 adapter](../../../studio/server/r2-storage.mjs), [download](../../../studio/server/gallery-download.mjs), [ingest](../../../studio/server/photo-ingest.mjs).

## 5. Việc tiếp theo còn thực sự mở

1. Chốt lịch backup media, retention, tuổi snapshot và cảnh báo độc lập; duy trì bản ngoài VPS và kiểm restore định kỳ.
2. Diễn tập full cloud restore, reboot và kill/resume khi import trên môi trường phù hợp; đo 500/5.000 JPEG thật trước mở rộng tải hoặc bật scheduler.
3. Sau khi backup ổn định, đánh giá backfill 284 JPEG legacy và cache bytes theo quyền; giữ cơ chế thu hồi quyền, không đổi mọi ảnh sang public cache.
4. Tiếp tục UAT album draft; giữ scheduler tắt đến khi lịch/quota/người vận hành được chốt. Không tự thực hiện backfill, tăng concurrency hoặc đổi cấu hình từ tài liệu này.

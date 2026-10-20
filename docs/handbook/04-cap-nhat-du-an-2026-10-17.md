# 04 — Cập nhật dự án đến 17/10/2026

Đối chiếu tài liệu mới và working tree; không SSH, deploy, chạy backup hay gọi Drive trong lượt chuẩn hóa này. **REPORT** là kết quả được nguồn ghi nhận, không phải phép thử vừa chạy lại. HEAD vẫn chưa bao gồm nhiều file mới.

## 1. Trạng thái và nguồn ưu tiên

| Phần | Hiện trạng theo nguồn mới | Nguồn |
|---|---|---|
| Web production | VPS iNET, Caddy → Node/PM2; Supabase PostgreSQL/Storage | [Biên bản VPS](../inet-vps-migration-2026-10-16.md), [workflow Drive](../google-drive-sync-workflow-2026-10-17.md) |
| Render/R2 | Rehearsal R2 là lịch sử staging; chưa có cutover R2 production | [Kế hoạch R2](../r2-implementation-plan.md) |
| Drive Sync | Code và UAT local; 346 JPEG thật đã nhập, lượt metadata 17/10 không thấy đổi nội dung | [Runbook](../google-drive-sync-operations.md), [workflow](../google-drive-sync-workflow-2026-10-17.md) |
| Quy mô 5.000 ảnh | Đạt fixture local và Linux VPS cách ly; không phải 5.000 JPEG full-resolution | [Workflow và giới hạn fixture](../google-drive-sync-workflow-2026-10-17.md) |
| Feedback sau bàn giao | Spec hợp nhất, đang review; chưa có tính năng chạy | [Spec feedback v1.2](../customer-feedback-spec.md) |

Đối chiếu 176 source hash trong `output/drive-workflow-release-verification.json`: 175 khớp, `scripts/deploy-vps.mjs` đã thay đổi so với baseline báo cáo. Vì vậy không gán kết quả 373 test cho phiên bản script deploy hiện tại.

Các báo cáo 270, 328, 342 và 373 test thuộc những baseline khác nhau. Báo cáo workflow cuối ghi **373/373, 0 fail/skip**, Node 24.19.0, SQLite/PostgreSQL 16. Giữ ngày, fingerprint và phạm vi khi trích dẫn; không cộng các số test hoặc gán chúng cho deployment hiện tại.

## 2. Hạ tầng và deploy VPS

Biên bản ghi Ubuntu 24.04, 1 vCPU/2 GB RAM và 2 GB swap; swap không tương đương RAM vật lý. App ở `/var/www/chicongphoto`, PM2 tên `chicong-photo`, Caddy proxy `127.0.0.1:4173`. Các version Node/Caddy, firewall, TLS mode, timezone cron và quyền SSH là trạng thái REPORT, cần đọc máy chủ khi vận hành thực tế.

Source [deploy-vps.mjs](../../scripts/deploy-vps.mjs) hiện yêu cầu `npm run deploy:vps -- --stage`. Lệnh này **ghi lên VPS**: tạo release riêng, upload allowlist source, kiểm hash và cài dependencies; không kích hoạt web hay migration. `--help` chỉ in hướng dẫn. PM2 cấu hình một app fork; kích hoạt có thể gián đoạn ngắn, không được gọi là zero-downtime.

Khi kích hoạt: giữ source/config/service definition hiện tại → lấy media lease và drain → dừng worker/runner cũ → backup DB + media và verify trong khi giữ lease hợp lệ → dừng web → thay source, giữ env/secret/data → một web process chạy migration với Drive tắt → cập nhật worker/backup cùng revision → kiểm health/quyền/ảnh/số lượng → mở ghi và thử album draft. Rollback phải hiểu schema Drive mới; không phục hồi DB cũ đè dữ liệu khách mới. Xem hướng dẫn đầy đủ trong script và [runbook Drive](../google-drive-sync-operations.md).

`npm run backup:db` gọi SSH để chạy dump thật. Biên bản ghi cron 03:00 giờ Việt Nam; script local ghi SQL gzip, quyền 0600, xóa file theo `-mtime +14` và loại dữ liệu `drive_comparison_cache`. Chưa xác nhận script mới đã được chép lên VPS. Dump nằm cùng máy không bảo vệ trước mất VPS; không chứa bytes Storage. File đuôi `.sql.gz` có thể còn lại sau lỗi pipeline, nên sự tồn tại/kích thước không đủ chứng minh backup thành công hoặc restore được.

Route `/media/:id` dùng chung cho public/private. Source trả `private,no-cache` cho public và `private,no-store` cho private, kiểm quyền trước đọc ảnh. Không áp rule cache theo prefix `/media/*` với override TTL: việc đó có thể bỏ qua ý nghĩa header/quyền của response. Thiết kế cache public cần phân tách rõ quyền, cache key và vô hiệu cache khi đổi trạng thái; chưa có bằng chứng cấu hình đó đã nghiệm thu.

## 3. Hai tích hợp Drive độc lập

| | Drive Sync nhập ảnh | Drive backup website |
|---|---|---|
| Identity | Service account, folder được chia sẻ quyền xem | OAuth user + refresh token |
| Scope | drive.readonly | drive.file |
| Luồng | Drive → worker → rendition → storage website | DB/media → manifest/blobs → Drive |
| Credential | DRIVE_SYNC_SERVICE_ACCOUNT_FILE, file key ngoài DB | BACKUP_DRIVE_* trên runner |
| Lịch | Global flag và opt-in album; mặc định tắt | Workflow GitHub chỉ dispatch; khác cron DB VPS |

Web enqueue; worker process riêng xử lý. Gallery đọc ảnh từ kho website. Luồng quản trị: check folder → tạo/gắn album → preview → xác nhận đúng revision/generation → duyệt → worker import → refresh catalog. Tạo album không tự import. `once` xử lý một batch, exit 0 không có nghĩa toàn job đã xong; `completed_with_errors` vẫn cần xử lý lỗi.

File đổi nội dung giữ photo ID/selection khi publish; đổi tên không tải lại bytes nếu không đổi nội dung. Missing trên Drive giữ ảnh web. Xóa khỏi web đặt suppressed; detach chuyển sang manual; sync không nhận quyền sửa ảnh manual cùng tên. Sau submission, thêm/thay/đổi tên cần duyệt kể cả khi khách quay lại draft. Approval cũ không được tái dùng sau thay revision/generation.

JPEG Drive mặc định tối đa 128 MiB/120 MP, encode 120 giây trong process con; PNG/WebP và upload tay vẫn 20 MiB/40 MP. Rendition web 2400px, thumbnail 900px, JPG download 2400px; không giữ JPEG nguồn trong backup website. Policy này chưa chứng minh VPS hiện đủ tài nguyên cho workload full-resolution.

Env đầy đủ, defaults và cách chạy ở [runbook Drive](../google-drive-sync-operations.md) và [.env.example](../../.env.example). Các nhóm gồm enable/scheduler, service-account file, interval/poll/batch, inventory limit, bytes/pixels, encode/request timeout và temp directory. Lịch không tự bật khi deploy source.

## 4. Schema và restore

Ngoài 17 bảng nền, [drive-schema.mjs](../../studio/server/drive-schema.mjs) thêm:

| Nhóm | Bảng và vai trò |
|---|---|
| Liên kết/nguồn | drive_connections, drive_album_links, drive_source_files: root, mapping, provenance và generation |
| Công việc/duyệt | drive_sync_jobs, drive_job_requests, drive_sync_job_items, drive_sync_approvals: lease, retry receipt, item và approval |
| Import/phục hồi | drive_reimport_intents, photo_ingest_attempts: ý định nhập lại và trạng thái publication |
| Khách/worker | gallery_submissions, drive_worker_heartbeats: receipt lựa chọn và trạng thái worker |

Photos thêm source; albums thêm catalog/selection revisions, submission generation và cờ review. Cache so sánh `drive_comparison_cache` khởi tạo khi cần, tối đa 20 thumbnail × 512 KiB, TTL 15 phút; cleanup phụ thuộc process chạy. Không coi đó là bảng nghiệp vụ được backup lâu dài.

Media snapshot schema v2 có 28 bảng; reader vẫn nhận v1. Cache tạm bị loại, bảng không nhận diện vẫn chặn snapshot. Restore giữ ảnh/lựa chọn/provenance, nhưng tắt connection/scheduler, pause mapping, hủy job chưa kết thúc, vô hiệu approvals và reset heartbeat/leases. Phải check/preview mới trước khi sync. Key service account và JPEG nguồn nằm ngoài snapshot; hash mật khẩu/dữ liệu khách vẫn nằm trong đó.

## 5. QA và giới hạn số đo mới

Catalog có gzip khi được chấp nhận, vẫn tôn trọng quyền và no-store. Gallery lớn render 90 card/trang, admin 120; API vẫn trả toàn bộ metadata ban đầu. Cache hash gallery theo DB/album/revision giới hạn 128 album; không suy admin cũng bỏ mọi lượt đọc metadata. Lightbox/tìm kiếm cần kiểm qua ranh giới trang và submission race.

Workflow mới ghi fixture 5.000 ảnh có 15.000 rendition reference nhưng chỉ **3 blob độc nhất**, do dùng lại JPEG 96×64/encode một lần. Test chứng minh catalog, receipts, resume và backup/restore bytes; không chứng minh tải/encode/backup nhiều GB. Worker được tạo lại trong cùng process ở bài này, không phải SIGKILL. Lượt VPS cách ly CPU 25%/512 MiB đạt 317,997 giây là số đo fixture, không phải sizing production.

Các bài QA bổ sung: check hết hạn 15 phút; retry tạo album không nhân đôi; preview/approval stale bị chặn; missing/detach/reimport không sửa manual; submit đồng thời sync; comparison cần admin và no-store; restore không tự bật lịch; gzip;q=0; tìm ảnh cuối và focus sau phân trang. Dùng harness trong workflow/runbook, dữ liệu cách ly và credential riêng khi cần API thật.

Trước pilot còn: thay/thu hồi khóa thử đã xuất hiện trong chat; UAT; workload JPEG full-resolution và tổng tài nguyên cây process; restart/restore với PostgreSQL/storage đích; web/worker/backup cùng revision; người vận hành và lịch đã chốt. Những cổng này không bị đóng chỉ vì fixture 5.000 đạt.

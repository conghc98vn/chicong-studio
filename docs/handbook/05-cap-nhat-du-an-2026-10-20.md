# 05 — Trạng thái dự án và bàn giao đến 20/10/2026

Đọc cùng [mục lục handbook](README.md). Đây là đối chiếu source, tài liệu và report local; không SSH, kiểm dashboard, gọi Drive hoặc triển khai trong lượt cập nhật này. REPORT giữ nguyên môi trường/thời điểm đã ghi; không biến thành kết quả LIVE mới.

**Cập nhật phát sinh trong lúc rà soát:** [biên bản release 20/10](../google-drive-sync-production-release-2026-10-20.md) ghi source `5a9e83c` đã lên VPS, nhập thủ công bật, scheduler tắt; thời gian chuyển dịch vụ 15:59:41–15:59:48 UTC+7 (7 giây). **Nghiệm thu chưa đóng.** Runbook/kế hoạch mới ghi heartbeat, unlock, shared và browse 33/346 ảnh đã thành công, pilot đang nhập; bảng nghiệm thu trong biên bản release vẫn để các mục đó PENDING. Handbook ghi rõ chênh lệch giữa nguồn đang cập nhật và không tự nâng pilot/no-op/reboot lên “đạt”.

## 1. Phiên bản nào đang ở đâu?

| Phạm vi | Điều đã được ghi nhận | Điều chưa được chứng minh |
|---|---|---|
| Git/source 20/10 | Commit `9da05ce` thêm Drive/VPS; merge `5a9e83c` hợp nhất R2 và giữ bằng chứng staging | Commit/merge không chứng minh production đã nhận bản mới |
| VPS production 20/10 | Source `5a9e83c` gồm folder browser đã chuyển; REPORT đối chiếu 102 file; iNET/Caddy/PM2/Supabase | Source chạy không đồng nghĩa pilot hoặc release hoàn tất |
| Drive worker production | Đã khởi động; nhập thủ công bật, scheduler tắt | Bảng nghiệm thu heartbeat/unlock/shared/browse, boot và trạng thái cuối còn PENDING; runbook ghi một phần đã đạt |
| Production sau migration, trước kết thúc pilot | REPORT giữ 8 album, 1.190 ảnh, 1 admin | Pilot đang nhập theo kế hoạch; chưa dùng các số này như số đếm cuối sau pilot |
| Local UAT 20/10 | Shared scope, picker/counts/thumbnail, tối ưu worker; report giữ 2 album, 346 ảnh, 1 admin, 1 mapping | Browse bộ 33 ảnh chưa tạo/import bộ đó; server local chỉ tồn tại khi process còn chạy |
| R2 | Adapter và rehearsal đã có trong Git; staging lịch sử đã kiểm | Production vẫn Supabase theo biên bản mới nhất; merge R2 không phải cutover |
| Feedback sau bàn giao | [Spec hợp nhất](../customer-feedback-spec.md), đang review | Chưa triển khai, chưa có luồng gửi feedback/email thật |

Nguồn: [release 20/10](../google-drive-sync-production-release-2026-10-20.md), [runbook hiện tại](../google-drive-sync-operations.md), [kế hoạch mục 17.8](../google-drive-sync-implementation-plan.md#178-phát-hành-production-ngày-20102026), [rollout 17/10](../google-drive-sync-production-release-2026-10-17.md), [follow-up 19/10](../google-drive-sync-followup-2026-10-19.md), [folder browser](../google-drive-folder-browser-2026-10-20.md), [perf 20/10](../google-drive-perf-pass-2026-10-20.md).

Manifest deploy 19/10 ghi 96/96 file khớp tại lần kiểm đó. Lần đối chiếu này thấy **13/96 file trong manifest khác source local hiện tại**; ngoài ra có module mới không thuộc manifest cũ. Đây là so sánh với manifest đã lưu, không phải đọc lại VPS. Không dùng hash local để khẳng định bản đang chạy. Danh sách/hash nằm trong [evidence 20/10](evidence-2026-10-20.json).

Manifest release 20/10 vừa được bổ sung có **102/102 hash khớp source local**. Báo cáo rollout xác nhận runtime tương ứng; lần handbook này chỉ đối chiếu manifest đã lưu, không tự kiểm lại runtime trên VPS. Manifest 19/10 trở thành mốc lịch sử.

## 2. Quyết định nguồn ảnh thay đổi thế nào?

Studio đã chọn **Các folder đã chia sẻ** thay cho yêu cầu một folder cha chung. Connection có `folder_scope`:

| Chế độ | Phạm vi | Khi nâng cấp |
|---|---|---|
| root | Folder được chọn hoặc hậu duệ trong thư viện cấu hình, tài khoản dịch vụ phải đọc được | Dữ liệu cũ mặc định giữ root |
| shared | Folder tài khoản dịch vụ đọc được; folder bắt đầu chỉ giúp mở picker | Phải lưu chế độ, check connection và tạo preview mới; không tự mở rộng bởi migration |

Đổi chế độ tăng generation và vô hiệu job/preview cũ, giữ album/ảnh/mapping. Shared không cấp thêm quyền Google, không phải đăng nhập Google của khách và không có nghĩa đọc mọi file trong tài khoản của studio. Chỉ nhập ảnh trực tiếp trong folder album; không import đệ quy, shortcut hoặc Shared Drive.

Luồng mới: dán link → **Duyệt và chọn folder** → mở folder con/quay lại/phân trang → chọn folder → **Kiểm tra folder** → tạo hoặc gắn album → xem trước thay đổi → duyệt nhập. Folder lá vẫn chọn được. Duyệt folder không thay bước kiểm tra/duyệt, không tạo album, không ghi/xóa Drive. Nguồn: [scope](../../studio/server/drive-folder-scope.mjs), [routes](../../studio/server/drive-routes.mjs), [schema](../../studio/server/drive-schema.mjs), [runbook](../google-drive-sync-operations.md).

## 3. Phân biệt ba loại xem trước và cache

| Loại | Mục đích và giới hạn | Bằng chứng/quyền |
|---|---|---|
| Thumbnail folder | Tối đa 6 ảnh nhận diện folder, dùng thumbnail Google; không tải JPEG gốc. 2 request đồng thời, 3 giây/request, budget preview 8 giây; đầu vào 512 KiB/4 MP, WebP đầu ra tối đa 240px/48 KiB | Worker giữ token; browser chỉ nhận API nội bộ có phiên admin, private/no-store |
| Preview thay đổi | Danh sách thêm/thay/đổi tên/missing; studio duyệt đúng revision/generation | Đây là approval cho import, không thay bằng hành động chọn folder |
| So sánh ảnh thay nội dung | Hiện ảnh đang dùng và thumbnail bản mới; cache tối đa 20 ảnh × 512 KiB, TTL 15 phút | Admin, kiểm revision; không xuất bản bản mới vào album |

Cache DB thumbnail folder `drive_folder_preview_cache` tối đa 60 ảnh/5 phút, gắn job/folder/generation. Route kiểm expiry ngay lúc đọc, cùng trạng thái job/connection/cancel; quá hạn trả 404 kể cả cleanup chưa chạy. Cache UI picker riêng: tối đa 12 folder/30 giây trong cửa sổ hiện tại, đóng là bỏ; **Làm mới** đọc lại. Hai cache DB so sánh/folder không nằm trong 28 bảng snapshot v2; logical dump loại dữ liệu cache nhưng có thể giữ schema.

Folder count chỉ gồm ảnh JPEG/PNG/WebP trực tiếp, folder con và tệp khác; số đã hiển thị qua phân trang không phải tổng folder. Phải giữ trạng thái loading/partial/unavailable; `≥ …` không phải tổng đầy đủ, lỗi không phải 0. Giới hạn đếm 1.000 mục/trang, 20.000 mục, 30 trang, 12 giây; kết quả có thể đổi khi nguồn bị sửa trong lúc quét.

Nút chọn mở sau kiểm folder trước khi enrichment hoàn tất. Job failed/canceled thì bỏ kết quả và quyền chọn; chỉ thiếu count/thumbnail trong job hợp lệ vẫn cho chọn. Đổi folder/đóng modal hủy riêng browse job do cửa sổ tạo, kể cả ACK muộn; mất mạng có thể khiến hủy không tới server. Worker kiểm hủy mỗi 500ms; deadline enrichment và kiểm quyền cuối 15 giây chặn publish kết quả muộn, **không phải SLA toàn luồng** (queue, auth đầu, DB có thể lâu hơn).

Nguồn: [folder preview](../../studio/server/drive-folder-preview.mjs), [overview](../../studio/server/drive-folder-overview.mjs), [review picker](../google-drive-folder-browser-review-2026-10-20.md).

## 4. Kết quả QA/hiệu năng mới và cách đọc đúng

Log đã lưu của lượt tối ưu cuối ghi **420/420 pass, 0 fail, 0 skip**, khoảng 51,51 giây; REPORT ghi Node 24, SQLite/PostgreSQL 17 cách ly. Đợt tài liệu chỉ đọc log và source, không chạy lại suite. CI trong repo vẫn dùng PostgreSQL 16 và không gọi browser smoke/axe. Các mốc 373/396/404/408 là lịch sử của những phiên bản trước.

| Phép đo có điều kiện trong fixture | Trước → sau | Giới hạn suy luận |
|---|---|---|
| Poll browse/inspect không mapping/filter | 3 → 1 SQL | Không áp cho mọi job/import hoặc request có filter |
| Đọc 6 thumbnail, cache đã khởi tạo | 6 SELECT + 6 DELETE → 6 SELECT | Vẫn kiểm expiry/quyền; không bỏ cleanup lúc ghi/worker |
| 30 tick idle, mỗi tick 1 giây | Heartbeat 60 → 3 UPSERT; cache 60 → 2 DELETE | Tổng housekeeping 120 → 5 lệnh ghi, không gồm claim/maintenance/scheduler hoặc ghi đĩa vật lý |
| Job vừa kết thúc hoặc chờ duyệt | Idle delay thừa → nhường event loop 1ms rồi claim tiếp | Queue rỗng/retry/lỗi trước claim vẫn backoff; không tăng concurrency encode |

Heartbeat cùng state tối thiểu 10 giây, đổi state ghi ngay; cache cleanup lúc startup và mỗi 60 giây, lỗi thử lại tick sau. Worker vẫn FIFO/một batch; browse có thể chờ batch import hoặc inventory. Tối ưu số truy vấn không chứng minh Google/mạng nhanh hơn.

Report UI cuối: Chrome desktop/320px, folder 33 ảnh chọn sau 4,85 giây, hoàn tất 6,09 giây, cache 43ms; đổi sang bộ 346 ảnh chọn sau 3,37 giây và browse cũ canceled. Đây là một lượt local; lần chọn chậm hơn mẫu review trước dù hoàn tất sớm hơn. Không gọi hai mẫu là benchmark tăng tốc tổng thời gian. Fixture 5.000 metadata và JPEG nhỏ tái dùng ở các bài quy mô trước vẫn không thay kiểm tải full-resolution/cloud.

Nguồn: [perf 20/10](../google-drive-perf-pass-2026-10-20.md), [log regression](../../output/drive-perf-pass-2026-10-20/regression-tests.log), [UI report](../../output/drive-perf-pass-2026-10-20/live-review-report.json). Các file output nằm ngoài Git; nếu chuyển máy cần lưu bản evidence đã che thông tin phù hợp.

## 5. Vận hành đã tiến thêm đến đâu?

- **Credential:** khóa thử cũ đã thu hồi 19/10; process mới dưới user worker VPS đọc/list bằng khóa thay thế thành công. Không yêu cầu lại bước thu hồi đã xong, không suy mọi key khác đã được kiểm.
- **Backup:** baseline production 17/10 verify 3.287 object tham chiếu. Release 20/10 có snapshot mới cũng verify 3.287 object trong cùng kho blob VPS. SQL baseline 17/10 đã copy về local và khớp hash; chưa có bằng chứng media baseline độc lập ngoài VPS. Dump không chứa bytes media.
- **Restore:** public subset đã điều chỉnh trên PG16 đạt 28 bảng/28 FK/60 index, số dòng khớp. Full dump thất bại trên PG16 vì `transaction_timeout`; trên PG17.11 vì thiếu role `supabase_admin`. Chưa có full Supabase + media restore đạt.
- **Tài nguyên:** pilot worker VPS giới hạn 128 MiB/60 MP, heap 256 MiB, cgroup CPU 50%/MemoryHigh 512 MiB/MemoryMax 768 MiB. JPEG synthetic 42,25 MP/51,2 MiB đã encode hai lần khoảng 69 giây, đỉnh cgroup 283 MiB ở cấu hình thử riêng CPU25%/512MiB; chưa chứng nhận ảnh 60/120 MP hay 5.000 JPEG gốc.
- **Lịch:** cron dump DB 03:00 giờ Việt Nam là REPORT; workflow backup Drive chỉ manual dispatch; Drive import thủ công bật nhưng scheduler vẫn tắt. Worker đang chạy không đồng nghĩa unit đã enable sau reboot hoặc lịch đã bật.

Các chi tiết này có nguồn trong [release 20/10](../google-drive-sync-production-release-2026-10-20.md), [rollout 17/10](../google-drive-sync-production-release-2026-10-17.md) và [follow-up](../google-drive-sync-followup-2026-10-19.md). Không sửa kết quả lịch sử thành một phép thử full restore thành công.

## 6. Phần còn lại để bàn giao production

| Việc tiếp theo | Điều kiện ghi nhận hoàn tất |
|---|---|
| Khép lại nghiệm thu release đang chạy | Source đã chuyển; đối chiếu và cập nhật kết quả heartbeat, unlock, shared/check, browse/counts/thumbnail giữa bảng PENDING và runbook; trạng thái cuối có bằng chứng |
| Pilot một album draft | Kế hoạch ghi đang nhập; cần kết quả import qua PostgreSQL/Supabase, rendition/JPG, no-op và các ảnh/lựa chọn đúng; chưa nghiệm thu xong, không tự publish album |
| Restart/resume và tài nguyên | Kiểm worker trên cấu hình storage thực tế, tổng RAM cây process/CPU/disk và workload đại diện; không dùng fixture để đóng phép đo full-resolution |
| Khôi phục độc lập | Media ngoài VPS và restore DB + media tương thích Supabase; kiểm quyền/session/mapping, các dữ liệu phát sinh sau baseline |
| Tự khởi động/lịch | Pilot đạt rồi enable unit, kiểm reboot; chỉ bật scheduler sau giờ/quota/người vận hành được chốt |

Lệnh `deploy:vps -- --stage` vẫn chỉ chuẩn bị release và có ghi lên VPS; activation theo lease/drain/backup và quy trình trong [runbook](../google-drive-sync-operations.md). PM2 fork có gián đoạn ngắn. Đợt cập nhật handbook này không thực hiện các thao tác trên.

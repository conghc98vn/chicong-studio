# 02 — Vận hành, bí mật và khôi phục

> **Cập nhật 29/10/2026:** release `30ce096` đã được kiểm trực tiếp trên production. Revision, baseline, live smoke và giới hạn còn lại nằm ở [biên bản production 29/10](09-production-release-2026-10-29.md); secret, cookie và dữ liệu khách không ghi trong repo.

**Cập nhật 29/10/2026 · Phạm vi:** production chạy VPS iNET, database Supabase, media R2 private; worker enabled, scheduler tắt. Live smoke đã kiểm health, media, route admin/freelancer/feedback và media lease; chưa reboot VPS, full cloud restore, hoặc thử email recipient thật. Danh mục Render dành cho hạ tầng cũ/staging.

## 1. Bộ hồ sơ cần có để tự quản lý website

| Nhóm | Cần lưu gì | Thiếu thì mất khả năng gì? |
|---|---|---|
| Tài khoản sở hữu | Chủ tài khoản iNET, Render lịch sử, Supabase, Cloudflare, registrar, GitHub, Resend, Google; 2FA và mã khôi phục | Key ứng dụng không giúp lấy lại quyền quản trị tài khoản |
| Source | Repo, commit triển khai, lockfile, diff và file mới chưa commit nếu cần khôi phục bản local | Không tái dựng đúng phiên bản/schema |
| Runtime/config | Build/start, Node version, domain, provider/bucket, CA, env không nhạy cảm và vị trí secret trong vault | Deploy chạy nhưng nối nhầm kho/DB hoặc không khởi động |
| Sổ xóa feedback | JSONL tối thiểu ngoài DB/thư mục data và snapshot, bản sao độc lập, quyền 0600 | Dữ liệu đã xóa có thể sống lại khi restore backup cũ |
| DB | Snapshot đủ bảng ứng dụng; thêm logical dump nếu cần cấu trúc DB/policy/index | Mất metadata, tài khoản, selections, đơn tư vấn |
| Media | Đúng object hiện hành, gồm portrait và rendition download khi tồn tại | Khôi phục DB xong vẫn hỏng ảnh |
| Manifest | Thời điểm, nguồn, app revision, key, bytes, checksum, mapping | Không biết DB và ảnh có thuộc cùng một mốc |
| Infra | DNS/nameserver, domain renewal, TLS mode, service IDs/region, quyền truy cập, lịch backup | Không phục hồi được đường truy cập và tác vụ nền |
| Bằng chứng restore | Kết quả verify, smoke, số bản ghi/object và thời gian khôi phục | Chỉ biết đã copy, chưa biết có dùng được |

Mật khẩu/key nên nằm trong kho bí mật được mã hóa do bạn kiểm soát. Sổ tay này giữ **tên, vai trò, nơi lấy lại, consumer và cách xác nhận**, để có thể chia sẻ phần kiến thức mà không cấp quyền tài khoản cho người đọc.

## 2. Danh mục cấu hình và credential

### 2.1. Web runtime

| Tên | Phân loại | Công dụng/điều kiện | Nơi đối chiếu hoặc phục hồi |
|---|---|---|---|
| NODE_ENV | Config | production bật ràng buộc production | Env VPS/PM2; Render nếu dùng staging |
| NODE_VERSION | Config nền tảng | Blueprint chọn 24 | Runtime VPS/PM2; Render build log lịch sử; không phải version do app tự đổi |
| PORT, HOST | Config | Port listen; HOST mặc định production 0.0.0.0, local 127.0.0.1 | Platform env/start.mjs |
| SITE_URL | Config | Origin chuẩn và URL SEO; production yêu cầu HTTPS | Env VPS + Cloudflare domain |
| TRUST_PROXY | Config bảo mật | Hop count hoặc proxy IP/CIDR đã kiểm; true bị từ chối | Đối chiếu topology thật, không sao chép theo cảm tính |
| SITE_INDEXING | Config | false để chặn indexing staging | Env của từng môi trường |
| ANALYTICS_ENABLED | Config | false để tắt analytics trong staging | Env + kiểm HTML |
| CF_BEACON_TOKEN | Identifier công khai | Token beacon; có alias CLOUDFLARE_ANALYTICS_TOKEN | Cloudflare Web Analytics; không có quyền sửa DNS/account |
| DATA_DIR | Config | Nơi SQLite và uploads local | Máy local, không dùng làm persistent storage prod trên ổ tạm |
| DATABASE_URL | **Secret** | Có user/password/host/port/database/SSL options | Supabase Connect + vault/env VPS; lấy đúng môi trường |
| NODE_EXTRA_CA_CERTS | Config, chứng chỉ công khai | CA cho Node; phải có khi process Node khởi động | File certs và env shell/platform |
| MEDIA_STORAGE_PROVIDER | Config bắt buộc prod | local/supabase/r2; prod không dùng local; phải khớp DB binding | Env VPS + media_control; render.yaml nếu dùng Render |
| SUPABASE_URL, SUPABASE_BUCKET | Config | Project API và bucket cho adapter Supabase | Dashboard Storage/project |
| SUPABASE_SERVICE_ROLE_KEY | **Secret đặc quyền** | Backend đọc/ghi object; không gửi xuống browser | Supabase API keys/vault; DB password là credential khác |
| R2_ENDPOINT, R2_BUCKET | Config | Chỉ cần khi provider R2 | Cloudflare R2 dashboard |
| R2_ACCESS_KEY_ID | Identifier đi cùng secret | Danh tính API credential server | Cloudflare R2 token/access-key record |
| R2_SECRET_ACCESS_KEY | **Secret** | Ký request S3; cấp quyền theo bucket cần dùng | Vault khi tạo token; mất secret thì tạo lại credential |
| MEDIA_CLEANUP_ENABLED | Config | false để tắt worker khởi động của app trong môi trường restore/staging | app.mjs; không phải công tắc vô hiệu mọi lệnh CLI cleanup |
| FEEDBACK_LINK_SECRET | **Secret** | Ký link feedback, base64url ít nhất 32 byte, ổn định qua restart và đồng nhất mọi instance; không có trong snapshot | Vault/env riêng từng môi trường; rotate sau restore |
| FEEDBACK_API_PAUSED, FEEDBACK_NOTIFICATIONS_PAUSED, INQUIRY_NOTIFICATIONS_PAUSED | Config | Pause API/admin/export feedback hoặc inquiry dispatcher; phải restart áp dụng, không thay bằng media lease | Env mọi web instance và runbook feedback/inquiry |
| SETUP_TOKEN | **Secret khởi tạo** | Thiết lập tài khoản admin đầu tiên theo điều kiện app | Vault/env VPS; không phải mật khẩu đăng nhập sau setup |
| RESEND_API_KEY | **Secret** | Chọn provider Resend | Resend API keys/vault |
| EMAIL_FROM | Config | Địa chỉ/tên gửi, cần phù hợp domain xác minh | Resend domains + env |
| NOTIFICATION_EMAIL | Thông tin liên hệ | Nơi studio nhận thư; có alias STUDIO_EMAIL | Env + người sở hữu email |
| SMTP_HOST/PORT/SECURE | Config | Chọn SMTP khi không chọn Resend; mặc định port 587 | Nhà cung cấp SMTP |
| SMTP_USER, SMTP_PASS | Credential | Tài khoản/app password SMTP | Vault/nhà cung cấp mail |
| GOOGLE_CALENDAR_ICS_URL | **Secret dạng URL** | Ai có URL có thể đọc feed; server chỉ chấp nhận nguồn Google ICS hợp lệ | Google Calendar settings, secret address; không đưa vào bug report |
| GOOGLE_CALENDAR_INCLUDE_FREE | Config | true tính cả event được đánh dấu Free | Nghiệp vụ studio + env |

Nguồn đầy đủ: [.env.example](../../.env.example), [render.yaml](../../render.yaml), các module [server](../../studio/server). Một biến không có trong Blueprint vẫn có thể được đặt trên Dashboard; ngược lại sync:false không chứng minh giá trị đã được điền.

### 2.2. Runner backup, migration và công cụ test

| Nhóm | Biến | Lưu ý |
|---|---|---|
| Drive OAuth | BACKUP_DRIVE_CLIENT_ID, BACKUP_DRIVE_CLIENT_SECRET, BACKUP_DRIVE_REFRESH_TOKEN | Refresh token cấp khả năng lấy access token; chỉ đặt ở runner/vault |
| Drive ownership | BACKUP_DRIVE_ACCOUNT_EMAIL, BACKUP_DRIVE_FOLDER_ID | Không phải mật khẩu nhưng là dữ liệu tài khoản; code kiểm đúng owner và folder riêng |
| Drive Sync riêng | DRIVE_SYNC_ENABLED, DRIVE_SYNC_SCHEDULER_ENABLED, DRIVE_SYNC_SERVICE_ACCOUNT_FILE | Không dùng OAuth backup cho import; key file chỉ ở worker. Default local và cấu hình pilot VPS khác nhau; xem runbook Drive |
| Giới hạn worker | DRIVE_SYNC_INTERVAL_MS, DRIVE_SYNC_POLL_MS, DRIVE_SYNC_BATCH_SIZE, DRIVE_SYNC_MAX_INVENTORY_FILES, DRIVE_SYNC_MAX_SOURCE_BYTES, DRIVE_SYNC_MAX_SOURCE_PIXELS, DRIVE_SYNC_ENCODE_TIMEOUT_MS, DRIVE_SYNC_REQUEST_TIMEOUT_MS, DRIVE_SYNC_TEMP_DIR | Defaults trong .env.example/runbook; không suy giá trị env đang chạy từ sample. folder_scope nằm trong connection DB, không phải biến env |
| Nguồn backup | DATABASE_URL + MEDIA_STORAGE_PROVIDER + credential provider tương ứng | Chỉ cấp quyền cần thiết; không cần mail/Calendar production |
| Đích migration | TARGET_MEDIA_STORAGE_PROVIDER, TARGET_R2_* hoặc TARGET_SUPABASE_* | CLI tách nguồn/đích; không lẫn source credential với target |
| DB test | STUDIO_TEST_POSTGRES_URL | Chỉ DB dùng một lần; test có CREATE/DROP SCHEMA |
| Browser/a11y | STUDIO_PLAYWRIGHT_MODULE, STUDIO_AXE_MODULE, STUDIO_BROWSER | Dependency test và lựa chọn browser, không phải env bắt buộc prod |
| Dữ liệu/evidence test | STUDIO_BROWSER_EVIDENCE_DIR, STUDIO_*SAMPLE*, STUDIO_GALLERY_*, STUDIO_PERF_*, PERF_RUNS | Chỉ dùng fixture/ảnh được phép; không suy ra tất cả test là an toàn khi trỏ PROD |
| Cờ rehearsal Render | RENDER_STAGING_REHEARSAL, RENDER_STAGING_SWITCH_REHEARSAL, RENDER_EXTERNAL_URL, RENDER_GIT_COMMIT | Guard/metadata cho script staging opt-in; không phải cấu hình web production và không tự bật bất kỳ migration nào |

GitHub workflow dùng environment **website-backup**; secrets và vars được đọc từ đó. File workflow tồn tại không chứng minh environment, permissions, schedule hoặc alert đã được cấu hình trên GitHub.

### 2.3. Kiểm kê file local ở mốc audit 16/10, không đọc ra giá trị

| File tại mốc kiểm tra | Nhóm biến có giá trị | Quyền file lúc kiểm tra | Ý nghĩa |
|---|---|---|---|
| .env | PORT, Resend, địa chỉ mail, Calendar ICS và include-free | 0600 | Không có DATABASE_URL trong file này; không phải bản backup đầy đủ env prod |
| .env.r2-staging | Provider và 4 biến R2, MEDIA_CLEANUP_ENABLED | 0600 | Credential bucket staging đã dùng cho validation, không dùng thay credential production |
| .env.render-staging | DATABASE_URL, SETUP_TOKEN, tài khoản/mật khẩu fixture staging | 0600 | Credential Render staging riêng; không đưa Drive/mail/Calendar production vào runtime staging |
| .env.oauth-client | Drive client ID/secret, email | 0600 | Hồ sơ OAuth; chưa đủ nếu thiếu refresh token |
| .env.backup-drive | Drive client ID/secret, refresh token, owner email/folder | 0600 | Bộ runner đang có local; không chứng minh token còn hiệu lực hiện tại |

Biên bản 21/10 bổ sung credential R2 production riêng, token giới hạn đúng bucket và lưu file 0600 ngoài Git; lượt handbook này không đọc lại giá trị secret. Bảng 16/10 không phải inventory đầy đủ của các file mới.

Git hiện chỉ track .env.example trong nhóm .env*. File 0600 và Git ignore ngăn một số cách lộ thông thường nhưng **không phải mã hóa**, không bảo vệ bản copy/upload nhầm. .env.backup-drive là tên file credential của runner, không phải file backup website.

### 2.4. Mẫu mục lưu trong vault

Mỗi credential cần: tên dịch vụ; environment; chủ tài khoản; project/service/bucket ID; consumer đang dùng; quyền được cấp; ngày tạo/hết hạn; nơi lưu giá trị; ngày kiểm tra lần cuối; các bước rotate; bằng chứng consumer hoạt động với key mới; bằng chứng key cũ bị thu hồi. Ghi riêng mã phục hồi 2FA và phương án lấy lại email chủ tài khoản.

Tài liệu hội thoại đã có giá trị DB password, service-role/API key và private ICS URL. Nên kiểm tra key nào còn hiệu lực và thay chúng theo từng dịch vụ. Không copy lại chuỗi đó vào README/issue/CV. Không thể kết luận đã bị khai thác nếu chưa có bằng chứng.

Quy trình rotate: kiểm kê consumer → tạo credential mới nếu dịch vụ hỗ trợ → cập nhật consumer và khởi động lại theo yêu cầu → kiểm chức năng cần thiết → thu hồi credential cũ → xác nhận cũ bị từ chối → cập nhật vault. Với DB password hoặc dịch vụ không hỗ trợ hai key đồng thời, chọn cửa sổ gián đoạn và chuẩn bị rollback phù hợp. Không tự thay key chỉ vì đang viết tài liệu.

## 3. Backup nào chứa gì?

| Loại | Có | Không có hoặc không được bảo đảm |
|---|---|---|
| Export JSON từ admin, GET /api/admin/export | Version 4: 8 bảng nghiệp vụ cũ + 6 bảng feedback + 1 bảng inquiry notification; cùng transaction, PostgreSQL REPEATABLE READ READ ONLY | Không có bytes media, admins, sessions, bảng Drive đầy đủ, env, DNS hoặc sổ xóa; không phải full backup |
| PostgreSQL logical dump | Cấu trúc/dữ liệu các schema đã chọn; phạm vi phụ thuộc options/quyền | Không có file Storage/R2, env, tài khoản nhà cung cấp; globals/role cần kế hoạch riêng |
| Công cụ media backup mới | Snapshot schema v4 gồm 35 bảng (28 bảng v2 + 6 bảng feedback + 1 bảng inquiry notification), manifest, media được tham chiếu, checksum, appRevision; reader nhận v1/v2/v3/v4 | Không chứa drive_comparison_cache, drive_folder_preview_cache, key service account, signing key feedback, sổ xóa độc lập, source repo, env, DNS, JPEG nguồn/RAW; appRevision chưa mô tả dirty tree |
| Cron DB trên VPS iNET | Theo biên bản: SQL gzip lúc 03:00 giờ Việt Nam vào /var/backups/chicongphoto; script có retention -mtime +14 | Chỉ DB trên cùng máy; chưa phải backup media/offsite, chưa xác minh cron thực tế trong lượt này; script local mới loại dữ liệu cả hai cache tạm nhưng vẫn có thể giữ schema cache |
| Bản offline export của công cụ | Manifest và toàn bộ blob mà snapshot chọn cần | Không tự chứa mọi lịch sử snapshot trong repository hoặc quyền truy cập cloud |
| Ảnh gốc trên ổ cứng/Drive | RAW/JPEG nguồn theo cách studio lưu | Không có selections, inquiries, album layout, password, slug history |

Supabase xác nhận backup database không bao gồm bytes object Storage; với Free họ khuyến nghị chủ động export và giữ bản ngoài hệ thống. Không coi backup của nhà cung cấp là bản sao media hoặc bản độc lập khi tài khoản/project bị mất. [Nguồn Supabase](https://supabase.com/docs/guides/platform/backups).

Snapshot public 284 ảnh/568 WebP được ghi trong tài liệu lịch sử chỉ là mốc cũ. Không chứng minh nó chứa gallery riêng, inquiry, rendition JPEG mới, portrait hoặc trạng thái hôm nay. Khôi phục ảnh gốc từ Lightroom cũng không tự khôi phục lựa chọn của khách.

### 3.1. Công cụ backup mới làm gì?

Theo [media-backup.mjs](../../studio/tools/media-backup.mjs), [media-control.mjs](../../studio/server/media-control.mjs), [drive-backup.mjs](../../studio/tools/drive-backup.mjs):

1. Gắn database với danh tính storage; lấy lease để khóa media mutation và chờ writer thực sự kết thúc.
2. Drain cleanup và chặn snapshot khi còn trạng thái ghi không rõ; không coi timeout là bằng chứng PUT chưa xảy ra.
3. Chụp DB snapshot trong transaction; PostgreSQL dùng REPEATABLE READ READ ONLY. Lấy mọi object đang được photos/portrait tham chiếu.
4. Ghi blob theo SHA-256, kiểm bytes/hash và mapping. Không suy ra filename từ photo.id sau overwrite.
5. Verify trước publish manifest complete. Chỉ manifest complete tương ứng toàn bộ blobs mới được dùng như bản tốt.
6. Nếu dùng Drive, kiểm owner/folder, publish dữ liệu rồi manifest; retention bảo vệ blobs vẫn được snapshot giữ lại tham chiếu.

Danh sách Drive phải đầy đủ trước khi quyết định retention. Nếu API báo `incompleteSearch`, trang sai cấu trúc hoặc lặp page token, công cụ dừng với lỗi và không xóa snapshot/blob từ kết quả đó. Kiểm lại dịch vụ/quyền rồi thử lại; không bỏ guard để tiếp tục dọn backup.

Tên `blob-*` và `snapshot-*` được dành riêng trong folder backup. Metadata thiếu/sai marker, loại, checksum, kích thước, thư mục cha hoặc tên/ID trùng đều chặn xử lý; tên snapshot phải khớp `runId` trong manifest. Không bỏ qua snapshot hỏng vì nó có thể vẫn tham chiếu blob dùng chung. Khi gặp lỗi, giữ nguyên dữ liệu để đối chiếu bản offline đã verify trước khi sửa metadata hoặc chạy lại retention.

Snapshot là dữ liệu ứng dụng theo schema version của công cụ, không phải bản sao vật lý toàn PostgreSQL. Restore local bỏ sessions, rate_limits, cleanup, locks/writers/journal cũ; backup_runs đang running được đánh dấu failed. Với Drive, restore tắt connection/lịch, pause mapping, hủy job chưa kết thúc, vô hiệu approval cũ và reset heartbeat; cần check/preview mới trước khi sync. Do đó “phục hồi chính xác” là khôi phục nghiệp vụ với state vận hành được reset có chủ đích, không phải mọi hàng nguyên xi.

**Tính nhất quán:** khóa media giúp mapping và file không đổi trong giai đoạn cần bảo vệ; inquiry/selection/feedback có thể tiếp tục trước/sau thời điểm DB snapshot. Mốc dữ liệu phục hồi là capturedAt của snapshot, không phải lúc upload Drive cuối cùng hoàn tất.

**Điều kiện trước khi chạy trên production:** bản app tương thích và schema media mới phải được triển khai, provider binding đúng, inventory/quota và cửa sổ khóa được kiểm tra. CLI mở DB với initialize:false; không dùng nó như lệnh tự migrate production cũ. Cloud test bằng ảnh giả không thay cổng này.

### 3.2. Staging R2 và những gì còn thiếu trước vận hành dài hạn

Kế hoạch R2 ghi nhận staging Render đã chạy Node 24 với PostgreSQL và bucket R2 riêng, noindex/analytics tắt. Bộ smoke HTTP, redeploy/cleanup, rehearsal backup/restore và client-abort/retry đều dùng dữ liệu tổng hợp. Các report JSON của lượt đó không còn trong workspace hiện tại; kế hoạch là nguồn biên bản còn lại. Staging là bằng chứng tích hợp hữu ích, nhưng không thay thế snapshot của production hoặc thử migration kho ảnh thật.

- Workflow hiện chỉ chạy thủ công, không có schedule; chưa có ngưỡng tuổi backup bắt buộc và cảnh báo độc lập nếu job không chạy.
- Report Drive xác nhận refresh tại thời điểm diễn tập, không chứng minh refresh token sống vô hạn. Hồ sơ setup ghi app External Testing; cần xác nhận publishing status/token lifetime trước vận hành dài hạn. [Google OAuth](https://developers.google.com/identity/protocols/oauth2#expiration).
- Chưa có client-side encryption cho bộ backup. Snapshot gốc có dữ liệu khách, hash admin và phiên; folder owner-only/TLS/0600 không tương đương mã hóa bằng khóa riêng của studio.
- Retention code giữ 30 ngày lịch theo UTC+7 và bảo toàn bản tốt mới nhất; không thể giữ đủ lịch sử nếu job không chạy hoặc không đủ dung lượng. Việc dọn lỗi phải được theo dõi riêng.
- Runner GitHub có ổ tạm; không coi thư mục trên runner sau khi job xong là bản offline đã giữ.
- Chưa ghi một RPO/RTO production đã đạt. Phải đo trên dữ liệu đại diện và diễn tập thực tế.

### 3.3. Baseline production và restore ngày 17–19/10

Rollout đã giữ baseline SQL gzip và snapshot v2 với **3.287 object được tham chiếu**, verify đạt; bucket có 3.291 object không có nghĩa snapshot phải thu cả object không được tham chiếu. Dữ liệu tại mốc đó là 8 album/1.190 ảnh/1 admin. Source/config cũ được lưu riêng, không đưa secret vào evidence chia sẻ.

Rollout 20/10 tạo snapshot mới trong cùng kho blob VPS, verify 3.287 object. Biên bản nghiệm thu cuối ghi SQL/media đã copy về Mac, verify và restore offline đạt; snapshot này trước pilot, chưa chứa 33 ảnh mới. Nguồn mới: [biên bản phát hành 20/10](../archive/google-drive-sync-production-release-2026-10-20.md).

Ngày 19/10, SQL baseline được copy về local, hash khớp VPS. Restore riêng schema `public` đã điều chỉnh cho PostgreSQL 16 đạt **28 bảng/28 foreign key/60 index** và số dòng khớp. Nguyên dump PostgreSQL 17 không restore được trên PG16 vì `transaction_timeout`; thử nguyên dump trên PG17.11 vẫn dừng do thiếu role `supabase_admin`. Đây chưa phải full Supabase restore. Đây là giới hạn của lần 19/10; bằng chứng restore ứng dụng offline ngoài VPS ngày 20–21/10 đã có, nhưng không thay full Supabase platform restore. Nguồn: [rollout](../archive/google-drive-sync-production-release-2026-10-17.md), [follow-up](../archive/google-drive-sync-followup-2026-10-19.md).

### 3.4. Rollout folder browser và nghiệm thu pilot

Source 20/10 thêm `folder_scope` và cache `drive_folder_preview_cache`. Cập nhật web, worker và mọi backup runner cùng bản tương thích; runner cũ không nhận diện cache mới có thể chặn snapshot theo cơ chế từ chối bảng lạ. Script dump mới loại dữ liệu cả hai cache; runbook và rollout 20/10 ghi đã phát hành cùng source. Dữ liệu cũ mặc định `root`; shared đã được studio chọn. Biên bản cuối đã xác nhận shared/check, browse, pilot 33 ảnh và no-op đạt; bảng PENDING trước đó được thay bằng kết quả thực tế. Không còn yêu cầu gom tất cả album vào một folder cha chung trong chế độ shared.

Khóa thử cũ đã thu hồi ngày 19/10; khóa thay thế được kiểm đọc/list từ user worker VPS. Unit đã enable cùng máy và restart khi idle thành công; chưa thử reboot VPS hoặc kill giữa import. Bật khởi động tự động và lịch là hai việc khác nhau. Pilot VPS cấu hình 128 MiB/60 MP, heap Node 256 MiB, cgroup CPU 50%/MemoryHigh 512 MiB/MemoryMax 768 MiB; không thay bằng default 120 MP của local. Xem [các bước còn lại](../archive/handbook/06-cap-nhat-du-an-2026-10-21.md).

### 3.5. Backup và rollback sau cutover R2 ngày 21/10

Snapshot `2026-10-21T02-19-52-867Z-83c5216a-aee7-4e92-b7e4-ed0ce9e716e8` gồm 3.386 object/1.431.587.015 byte và dữ liệu sau pilot: 9 album/1.223 ảnh. Có bản độc lập trên Mac, SHA-256 verify đạt; restore vào SQLite/media offline đạt integrity_check và 0 lỗi FK. Hai working copy restore đã dọn; backup và report vẫn giữ. Không xem đường dẫn working copy cũ là bản phục hồi còn mở được. Nguồn: [cutover R2](../archive/r2-production-cutover-2026-10-21.md).

Runtime dùng token Object Read & Write giới hạn bucket `chicong-production`, lưu ngoài Git; token staging không được dùng thay. Giữ nguyên kho Supabase nguồn và bản env rollback. Không công khai manifest/private backup vì chứa dữ liệu khách và hash xác thực. Bucket private: r2.dev tắt, không custom media domain/CORS; quy tắc hủy multipart dở sau 7 ngày không phải TTL xóa ảnh.

Cron SQL 03:00 vẫn không chứa bytes ảnh. Lịch backup media, kiểm tuổi snapshot và cảnh báo job không chạy còn phải hoàn thiện. Khôi phục ứng dụng offline đã đạt không có nghĩa một lệnh CLI dựng lại được PostgreSQL/Supabase, R2, DNS và quyền cloud.

### 3.6. Feedback: snapshot v3 và phục hồi từ SQL dump

Sáu bảng feedback mới là `handovers`, `handover_albums`, `feedback`, `feedback_revisions`, `feedback_request_receipts`, `feedback_notifications`; inquiry outbox nằm trong bảng `inquiry_notifications` của snapshot v4. Cập nhật mọi backup runner sau migration: bản v2 cũ từ chối bảng lạ; bản v3 chỉ hiểu feedback; bản v4 hiểu cả outbox inquiry. Khi hạ giao diện/app, vẫn giữ runtime backup đọc v4; không xóa bảng hoặc restore baseline cũ đè các cảm nhận/yêu cầu mới đã nhận.

`media-backup.mjs restore` hiện tạo **SQLite + media local ở đích mới**. Công cụ thu hồi link, đổi nonce, xóa receipt admin gần nhất, suppress mọi notification chưa accepted (gồm feedback và inquiry) và đặt `feedback_restore_pending=true`; cờ này cũng pause inquiry dispatcher khi app khởi động. Đây là bảo đảm của đường restore này, không phải hook chạy tự động mỗi lần DB được nhập lại. Sổ xóa phải được giữ ngoài backup được khôi phục; đối soát lại cả các ý định đã thực hiện trước đó, rotate signing key mọi instance, rồi mới bỏ gate bằng [feedback-ops.mjs](../../studio/tools/feedback-ops.mjs). Lệnh và điều kiện cụ thể nằm ở [đặc tả feedback](../customer-feedback-spec.md#implementation).

**SQL dump/PITR là đường khác:** `pg_dump` lưu nguyên các bảng feedback và pending mail, nhưng `psql`/khôi phục nhà cung cấp không gọi `restoreRow`, không tự đặt restore gate, revoke link hoặc suppress queue. Trước đưa bản SQL phục hồi cho web, giữ mọi process dừng và cả hai cờ pause; chỉ chạy DB ở môi trường cách ly. Chạy `feedback-ops.mjs prepare-restored` với DB đích tường minh, `--data-dir`, sổ xóa độc lập và `--processes-stopped yes`, theo lệnh trong [mục 13.4 đặc tả feedback](../customer-feedback-spec.md#implementation). Lệnh lưu gate bền vững trước, rồi thu hồi link và suppress queue trong transaction; giữ revisions, receipts khách và event accepted. Bản DB cũ chưa có feedback chỉ được bổ sung schema feedback, không khởi động ứng dụng hoặc dispatcher.

Nếu chuẩn bị lỗi, gate và dấu `feedback_restore_preparation_incomplete` vẫn giữ; `reconcile` không được bỏ gate cho tới khi chạy lại `prepare-restored` thành công. Sau chuẩn bị vẫn phải đối soát sổ xóa, triển khai signing key mới trên mọi instance rồi chạy `reconcile` riêng. Chỉ reconcile hoặc chỉ rotate key không thay cho bước chuẩn bị. Quy trình này xử lý trạng thái feedback trong DB ứng dụng; không phải công cụ tự khôi phục toàn bộ Supabase/PITR, storage, role hoặc hạ tầng.

Với mọi restore, giữ nguyên revision/receipt khách; dữ liệu bị yêu cầu xóa được purge lại theo sổ riêng. Không tự tạo sổ trống khi thiếu sổ cũ. Email accepted chỉ chứng minh provider đã nhận, không chứng minh inbox; event suppressed chỉ được thử lại sau review người nhận. Xóa dữ liệu trong DB không xóa thư đã gửi hoặc snapshot ngoài hệ thống.

## 4. Diễn tập phục hồi từ bộ offline

Thực hiện với **bản sao kiểm thử hoặc bộ backup đã được phép sử dụng**, đích mới chưa tồn tại và đủ dung lượng. Không bật public server, analytics, Calendar hoặc email thật cho bản phục hồi. Những lệnh dưới đây là hướng dẫn, chưa được chạy lên dữ liệu production trong đợt này.

~~~sh
(
set -eu
cd /Users/conghoang/Desktop/photo/web-porfolio-photography

# Chỉ xem trợ giúp, không kết nối cloud.
npm run media -- help

# Thay đường dẫn này bằng bộ OFFLINE ĐÃ CÓ, gồm snapshots/ và blobs/.
task_repository="$PWD/output/restore-drill/repository"
task_export="$PWD/output/restore-drill/export-new"
task_restore="$PWD/output/restore-drill/restored-new"

# verify/export/restore không tự đọc .env và dùng repository chỉ định.
node studio/tools/media-ops.mjs verify --repository "$task_repository"
node studio/tools/media-ops.mjs export --repository "$task_repository" --target "$task_export"
node studio/tools/media-ops.mjs restore --repository "$task_export" --target "$task_restore"

# Khởi chạy trực tiếp bằng Node trong môi trường sạch; KHÔNG dùng npm start
# ở đây vì npm start tự nạp .env của repo.
env -i PATH="$PATH" DATA_DIR="$task_restore" MEDIA_STORAGE_PROVIDER=local \
  MEDIA_CLEANUP_ENABLED=false SITE_INDEXING=false ANALYTICS_ENABLED=false \
  HOST=127.0.0.1 PORT=4179 SITE_URL=http://127.0.0.1:4179 \
  node studio/server/start.mjs
)
~~~

Export/restore từ chối đích đã tồn tại. Nếu lần trước lỗi để lại thư mục dở, chọn tên đích mới để giữ bằng chứng; không dùng lệnh xóa hàng loạt cho tiện. Có nhiều snapshot thì thêm **--run ID** để chọn mốc cụ thể. Không mặc định bản mới nhất là mốc trước sự cố xóa nhầm.

### Phiếu nghiệm thu restore

| Kiểm tra | Bằng chứng phải lưu |
|---|---|
| Manifest và blobs | verify thành công, runId/capturedAt/appRevision, số object và bytes, không thiếu checksum |
| Nghiệp vụ DB | Số album/ảnh/selection/inquiry đối chiếu snapshot; không lấy số cũ trong tài liệu làm expected |
| Album công khai | Mở trang, cover, section, caption, slug cũ redirect đúng |
| Gallery riêng | Phiên cũ bị từ chối, đăng nhập mới đúng password, không thấy ảnh album khác |
| Tải file | JPEG giải mã được; ZIP giải nén đủ, tên file và nội dung đúng; không chỉ HTTP 200 |
| Admin và inquiry | Đăng nhập, xem dữ liệu tư vấn/lựa chọn; không gửi mail thật từ môi trường restore |
| Provider | Chỉ filesystem local/DB local, không sửa/xóa object nguồn |
| Thời gian | Từ lúc bắt đầu ứng cứu tới lúc hoàn thành các bước trên; ghi riêng transfer/verify/restore/smoke |

Đăng nhập được trang chủ chưa đủ. Chỉ khi các kiểm tra này đạt mới gọi bản backup là **đã diễn tập phục hồi**.

## 5. Logical dump PostgreSQL đúng TLS

Lệnh trong hội thoại cũ gán NODE_EXTRA_CA_CERTS cho pg_dump là không đúng cơ chế. pg_dump/pg_restore dùng libpq: cấu hình sslrootcert hoặc PGSSLROOTCERT, và có thể dùng PGSERVICEFILE/PGPASSFILE để tránh đặt password trong command line. [PostgreSQL environment variables](https://www.postgresql.org/docs/current/libpq-envars.html).

Tạo hai profile kết nối riêng ngoài Git: **chicong_source** cho nguồn và **chicong_restore_drill** cho DB đích trống. Hồ sơ chứa host/port/db/user/sslmode=verify-full/sslrootcert; password lưu trong passfile 0600. Lấy endpoint từ Supabase Connect. Ưu tiên direct cho backup/restore; nếu mạng chỉ IPv4, đối chiếu lựa chọn session pooler được hỗ trợ. Không trộn session 5432 và transaction 6543. [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

~~~sh
(
set -eu
# Ví dụ sau CHỈ chạy sau khi đã tạo profile/passfile đúng môi trường.
# Đây là đường dẫn mẫu, không phải file credential có sẵn trong repo.
export PGSERVICEFILE="$HOME/.config/chicong/pg_service.conf"
export PGPASSFILE="$HOME/.config/chicong/pgpass"
task_dump_dir="$PWD/output/pg-restore-drill"
umask 077
mkdir -p "$task_dump_dir"
task_dump="$task_dump_dir/app-$(date +%Y%m%d-%H%M%S).dump"

# public chỉ là ví dụ schema ứng dụng. Đối chiếu trước khi dùng.
# Dùng pg_dump cùng major version server để đơn giản hóa tương thích.
pg_dump --dbname='service=chicong_source' --format=custom \
  --schema=public --no-owner --no-acl --file="$task_dump"

# Liệt kê archive chỉ kiểm cấu trúc đọc được; chưa chứng minh restore.
pg_restore --list "$task_dump"

# Profile đích phải là DB thử TRỐNG, không phải DB nguồn/production.
# Không dùng --clean trong mẫu diễn tập này.
pg_restore --dbname='service=chicong_restore_drill' \
  --no-owner --no-acl --exit-on-error --single-transaction "$task_dump"
)
~~~

Mẫu dump này bỏ owner/ACL để tăng khả năng chuyển sang đích thử, nên **không phải bản backup mọi quyền của toàn cluster**. Cần kiểm schema, extensions, policies, role/grant và managed schema của Supabase trước phục hồi lên project mới. Không dump/restore đè auth/storage/internal schema bằng một lệnh chung không kiểm tra. Dump DB cần đi cùng snapshot media nhất quán và kế hoạch thu hồi sessions sau restore. [PostgreSQL SQL dump](https://www.postgresql.org/docs/current/backup-dump.html).

Khác với CLI restore local, pg_restore giữ cả sessions, storage binding, media_control, media_writers, media_writes và photo_cleanup. Trước khi chạy app trên đích phục hồi, cần đối chiếu và xử lý các trạng thái vận hành này trong môi trường cô lập, xác nhận nguồn/đích và mapping. Không khởi động worker với queue/binding cũ rồi hy vọng nó tự sửa, cũng không DELETE journal/lock trong DB live để vượt kiểm tra. Đây là một bước hòa giải trạng thái riêng của ứng dụng cần được diễn tập trước chuyển traffic.

## 6. Runbook sự cố

| Sự cố | Chẩn đoán trước | Hành động và điều kiện hoàn thành |
|---|---|---|
| Không vào được domain | DNS, certificate, Cloudflare, Caddy và PM2 logs; phân biệt lỗi ở edge với app | Sửa đúng cấu hình nguyên nhân; home/health và một media hợp lệ hoạt động. Không đổi DNS khi chưa biết origin |
| Health 503 | Log DB connect/TLS, trạng thái Supabase, connection pool | Phục hồi DB/kết nối; query thành công và kiểm một luồng nghiệp vụ, không chỉ restart liên tục |
| Ảnh 403/404 hoặc upload hỏng | Provider/binding, object key, bucket permission, trace stage/status | Sửa đúng credential/mapping/file; không đổi provider để “thử” trên live |
| Đơn tư vấn có nhưng không có email | Tìm reference trong admin, provider log, sender verification, quota | Khôi phục mail rồi xử lý thông báo còn thiếu theo danh sách; tránh gửi lại form gây đơn trùng |
| Calendar lỗi | unavailable/lastSynced, feed URL, thay đổi secret address | Cập nhật feed, xác nhận ngày thử bận/rảnh. Không coi cache cũ là bằng chứng chắc chắn ngày trống |
| Quên mật khẩu admin | Chốt DB đích và email tài khoản; không đoán từ hash | Chạy reset-admin trong TTY với env DB rõ ràng; login mới được, session admin cũ mất hiệu lực |
| Xóa nhầm album | Chọn snapshot trước thời điểm xóa; giữ bản hiện tại | Restore riêng, kiểm album+files+selection; lên kế hoạch phục hồi chọn lọc hoặc toàn bộ, tính dữ liệu mới sẽ bị mất |
| Backup failed hoặc quá cũ | Last complete, manifest, log runner, dung lượng, OAuth, lease | Sửa nguyên nhân, backup và verify lại, diễn tập restore nếu định dạng/đích thay đổi |
| Media bị khóa quá lâu | Xem owner/deadline, writers, unknown writes; xác định process còn sống | Không xóa hàng lock/journal thủ công. Dùng runbook recover/reconcile sau khi chứng minh writer dừng/provider settled |
| Mất VPS/web service | Source/deploy revision, env vault, custom domain và DB/storage hiện hữu | Tái tạo web runtime, kiểm provider trước startup, smoke đọc/ghi trên môi trường thử rồi chuyển domain |
| Mất cả DB/storage | Bộ offline đầy đủ + source/schema + tài khoản đích | Restore vào hệ thống mới, kiểm quyền/private/media, thay config, thu hồi session/key cũ, chuyển traffic sau nghiệm thu |

**Reset admin có tác động ghi DB:** script mở DB theo DATABASE_URL hoặc DATA_DIR và có thể chạy initialization/migration. Vì npm run admin:reset tự đọc .env, nên khi ứng cứu phải dùng môi trường đã xác định rõ và chạy trực tiếp script với env riêng. Tối thiểu xác minh host/database/schema mà không in password, sao lưu trước nếu cần, rồi kiểm kết quả. Không dán URL có password vào history. Xem [reset-admin.mjs](../../studio/server/reset-admin.mjs).

**Khôi phục cloud chưa phải một nút bấm:** CLI restore hiện tạo SQLite + filesystem mới ở local. Để quay lại PostgreSQL/R2/Supabase cần quy trình tạo schema/dữ liệu, copy/verify objects và binding đích; không có bằng chứng một lệnh restore hiện tại sẽ tự dựng cả production. Đừng thay DATABASE_URL rồi giả định các bước chuyển dữ liệu đã xảy ra.

## 7. Chuyển storage: các cổng phải đạt

Trình tự đã thiết kế là **bản tương thích → inventory → khóa → drain → backup/delta/verify → switch → restart mọi instance → smoke khi còn khóa → unlock**. Chi tiết và các bước reconcile được giữ trong [kế hoạch R2, mục 16–17](../archive/r2-implementation-plan.md).

- Production đã chuyển sang R2 ngày 21/10; trước mọi lần đổi kho tiếp theo vẫn phải đối chiếu binding DB, cấu hình web/worker và snapshot mới nhất. Không coi config Supabase lịch sử là cấu hình đang chạy.
- Tách staging DB/schema và bucket; bucket thử riêng nhưng DB thật vẫn có thể gây hại dữ liệu thật.
- Còn writer/unknown writes/cleanup chưa drain thì dừng tại cổng đó; không xóa journal để làm trạng thái trông sạch.
- Copy đúng object được snapshot tham chiếu, verify hash/size/type; không chỉ đếm file hoặc dùng id thay filename.
- Switch cập nhật binding; mọi instance phải dùng config đích khớp. Cập nhật cả Blueprint để lần sync sau không đảo provider.
- Có kế hoạch rollback trước khi mở lại ghi. Sau khi đích nhận dữ liệu mới, nguồn cũ đã stale; rollback không chỉ là đổi env về nguồn.
- Chốt quota, cửa sổ vận hành, người xử lý và điều kiện dừng trước thực hiện.

Các kiểm thử R2 lịch sử gồm **máy local → bucket thử** và **Render staging → R2**. Cutover 21/10 bổ sung verify toàn kho production và probe quyền/upload thật; vẫn chưa chứng minh tải nhiều instance hay mọi timeout/ghi muộn. Khi R2 đã có ảnh mới, rollback cần đồng bộ delta ngược dưới lease và đổi binding; không chỉ đổi env hoặc restore DB cũ đè dữ liệu hiện tại.

## 8. Theo dõi để phát hiện lỗi trước khách

Các mức bên dưới là **đề xuất ban đầu**, chưa phải monitor/SLA đang hoạt động.

| Tín hiệu | Cần đo | Ví dụ ngưỡng để thảo luận |
|---|---|---|
| Availability | Home + health + ảnh public mẫu | Cảnh báo khi lỗi lặp lại trong nhiều lượt kiểm, tránh một timeout đơn lẻ |
| Inquiry | Tỉ lệ lưu thành công, lỗi 409/422/429/5xx theo nguyên nhân | Tách business rejection khỏi sự cố server |
| Upload | X-Upload-Id, stage, thời gian, RSS, trạng thái ack | Cảnh báo tăng timeout/unknown write/OOM; heartbeat 15 giây chỉ là log, không phải alert |
| Cleanup | Số job, tuổi job cũ nhất, tốc độ drain | Queue tồn lâu sau khi service đã ổn cần điều tra |
| Email | Provider accept/reject và phản hồi delivery nếu có | Feedback và inquiry đều có queue bền vững, lease/retry và trạng thái trong admin; chưa có monitor delivery/inbox chung |
| Backup | Tuổi snapshot complete đã verify | Nếu chọn daily, có thể bắt đầu thảo luận ngưỡng 30 giờ; cần monitor độc lập phát hiện job không chạy |
| Quota/cost | DB, storage, egress, operations, mail, Drive | Theo dõi xu hướng và cảnh báo trước hết; không suy diễn từ số ảnh thành số GB |

**RPO** là dữ liệu tối đa chấp nhận mất theo thời gian; **RTO** là thời gian phục hồi dịch vụ được chấp nhận. Ví dụ daily backup thành công có thể hướng tới RPO gần 24 giờ, nhưng nếu job thất bại hai ngày thì không còn đạt. RTO phải gồm lấy quyền truy cập, tải backup, verify, restore, sửa config và smoke, không chỉ thời gian một hàm restore. Chưa có số production đã đo trong tài liệu này.

## 9. Checklist bàn giao và tự kiểm định kỳ

- [ ] Có quyền vào các tài khoản sở hữu, email khôi phục và 2FA; biết ai là registrar, ngày gia hạn domain.
- [ ] Biết deploy revision đang chạy, Node version, region/plan, DB host/schema/version, provider/bucket thực tế.
- [ ] Vault có credential hiện hành và danh sách consumer; key cũ từng lộ đã xử lý và xác minh.
- [ ] Có ít nhất một bộ DB + media nhất quán ngoài hạ tầng đang chạy, đủ source/config để dựng lại.
- [ ] Đã phục hồi trên đích mới và lưu phiếu nghiệm thu; chưa coi export JSON admin là full backup.
- [ ] Biết tuổi bản backup tốt cuối, lịch chạy thật và người nhận cảnh báo; không nhầm file workflow với scheduler đã bật.
- [ ] Có baseline dung lượng/latency trên dữ liệu đại diện; các con số có ngày đo và phương pháp.
- [ ] Gallery cần riêng tư đã có password và được kiểm bằng phiên chưa đăng nhập.
- [ ] Khi release có schema/storage changes, đã kiểm migration/rollback và dữ liệu sau migration.

## 10. Khoảng trống chính sách cần chốt trước khi vận hành lâu dài

Code cho biết dữ liệu nào được lưu, nhưng **không tự tạo ra chính sách lưu giữ, người chịu trách nhiệm hoặc quy trình thông báo**. Các mục dưới đây chưa có giá trị được phê duyệt trong source; không tự điền số ngày hay tên người chỉ để checklist trông hoàn chỉnh.

### 10.1. Ownership và bàn giao quyền

Lập một bản lưu ngoài Git, có ít nhất chủ chính và người dự phòng cho iNET, Render nếu còn dùng, Supabase, Cloudflare/registrar, GitHub, Resend/SMTP, Google Drive và vault. Mỗi dòng cần ghi: tài khoản sở hữu, 2FA/recovery codes ở đâu, quyền tối thiểu của người vận hành, ngày rà soát cuối và cách liên hệ khẩn.

Khi bàn giao hoặc một người rời dự án: thu hồi quyền cá nhân, đổi credential mà người đó từng thấy khi hợp lý, chuyển ownership của repository/Drive/domain, kiểm thử người còn lại đăng nhập được và cập nhật danh mục consumer. Không gửi recovery code hoặc refresh token qua chat/ticket.

### 10.2. Retention, xóa và yêu cầu dữ liệu khách

Album, ảnh, selections, inquiry, feedback và lịch sử, email thông báo, snapshot Drive và evidence QA có thể chứa dữ liệu cá nhân. Trước khi thu thập hoặc lưu dài hạn, chủ studio cần phê duyệt bằng văn bản: mục đích, người được truy cập, thời hạn của từng loại dữ liệu, thời điểm xóa gallery/ảnh gốc/snapshot và cách xử lý yêu cầu xem-xóa-sửa dữ liệu.

Xóa album trong app không chứng minh dữ liệu đã biến mất khỏi backup, Drive, log hoặc máy xuất ảnh. Khi xử lý một yêu cầu xóa, lập phiếu gồm định danh tối thiểu, nguồn cần kiểm, ngày yêu cầu, hành động đã thực hiện, bản backup còn giữ theo retention hợp lệ và ngày sẽ hết hạn. Không đưa tên, email, ảnh hoặc private URL của khách vào report chia sẻ.

### 10.3. Sự cố lộ secret hoặc dữ liệu

Khi secret, private ICS URL, refresh token, service-role key, password hoặc dữ liệu khách xuất hiện sai nơi: dừng chia sẻ/thu hẹp quyền truy cập trước; ghi thời điểm và phạm vi mà không chép lại secret; thu hồi hoặc rotate credential; cập nhật mọi consumer; kiểm log/provider ở mức phù hợp; kiểm thử credential mới và xác nhận credential cũ bị từ chối. Sau đó đánh giá dữ liệu nào có thể bị truy cập, người cần thông báo và yêu cầu pháp lý áp dụng với địa bàn của studio. Không coi việc xóa tin nhắn là thu hồi secret.

Nếu app nghi bị ghi hoặc xóa media sai: giữ backup/log/bằng chứng, khóa media theo runbook khi cần, không chạy cleanup hay cutover để "dọn" hiện trường. Tách môi trường phục hồi và chỉ mở lại ghi sau khi kiểm mapping, object, sessions và quyền truy cập.

### 10.4. Release gate tối thiểu

Mỗi release nên có một record ngắn: commit/PR, người thực hiện và người review, môi trường, migration/config thay đổi, rollback point, kết quả `npm run check`/`npm test`, smoke public/admin/gallery/upload/inquiry, trạng thái browser/a11y nếu có chạy, và link evidence đã che dữ liệu. Với thay đổi DB/storage, thêm manifest hoặc snapshot trước thay đổi, kết quả backup/verify và cổng rollback cụ thể.

Không deploy chỉ vì CI xanh: workflow hiện chạy test và browser smoke, nhưng không chạy backup hoặc xác minh dashboard/provider production. Ngược lại, một smoke thủ công không thay thế test regression. Quyết định release cần ghi rõ phần nào đã chạy, phần nào chưa chạy và người chấp nhận rủi ro còn lại.

Đánh dấu chỉ khi có bằng chứng; bảng này được để trống vì phiên lập tài liệu chưa kiểm toàn bộ các mục.

Trạng thái hiện hành và ba lịch độc lập nằm ở [mục lục handbook](README.md). Snapshot bàn giao, gồm kiểm kê file và số đo cũ, được giữ trong [lưu trữ](../archive/README.md); không suy file/cron/key còn đúng chỉ từ ngày ghi nhận cũ.

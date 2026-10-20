# ChiCong Studio — Sổ tay hệ thống, vận hành và thực hành QA

**Phiên bản tài liệu 1.3 · Cập nhật 20/10/2026 · Giờ Việt Nam (UTC+7)**

**Mốc hiện hành:** biên bản phát hành 20/10 vừa bổ sung trong lúc rà soát ghi source `5a9e83c` đã lên VPS, nhập Drive thủ công bật, scheduler tắt. Nghiệm thu pilot và trạng thái cuối vẫn đang cập nhật; chưa gọi phát hành hoàn tất. Khóa cũ đã thu hồi 19/10. Xem [cập nhật 20/10 và các mục chờ](05-cap-nhat-du-an-2026-10-20.md). Không có kiểm tra live mới trong lượt cập nhật handbook này.

Bộ tài liệu này giúp bạn hiểu website mình đang sở hữu, có căn cứ để vận hành và khôi phục, đồng thời dùng chính dự án làm phòng lab QA. Nội dung được đối chiếu với mã nguồn hiện tại, cấu hình và báo cáo đã lưu, gồm kiểm tra endpoint production ngày 16/10. Không coi nội dung hội thoại cũ là bằng chứng cấu hình đang chạy.

## Đọc theo nhu cầu

| Bạn muốn làm gì? | Tài liệu |
|---|---|
| Hiểu công nghệ, dịch vụ, dữ liệu và cách một thao tác chạy qua hệ thống | [01 — Kiến trúc và công nghệ](01-kien-truc-va-cong-nghe.md) |
| Kiểm kê tài khoản/key, sao lưu, diễn tập phục hồi và xử lý sự cố | [02 — Vận hành, bí mật và khôi phục](02-van-hanh-bi-mat-va-khoi-phuc.md) |
| Học test design, API, SQL, concurrency, automation và viết case study QA | [03 — Phòng lab QA](03-phong-lab-qa.md) |
| Nhập ảnh từ Drive studio và kết hợp upload tay | [Runbook Drive Sync](../google-drive-sync-operations.md): source hỗ trợ root/shared, đã phát hành production và bật import thủ công; pilot chưa nghiệm thu. [Cập nhật 20/10](05-cap-nhat-du-an-2026-10-20.md) phân biệt từng phiên bản |
| Kiểm tra kết quả mới nhất và giới hạn triển khai | [QA](03-phong-lab-qa.md): REPORT 420/420, SQLite/PostgreSQL 17; [bản ghi 17/10](04-cap-nhat-du-an-2026-10-17.md) giữ lịch sử 373/373 |
| Phân biệt điều đã biết với điều cần xác minh lại | Phần bằng chứng và đính chính bên dưới |

Lần đầu, đọc mục 1–3 của tài liệu kiến trúc, sau đó làm Lab 1 của tài liệu QA. Khi cần thao tác backup/restore, đọc các điều kiện và tiêu chí xác nhận trước lệnh trong tài liệu vận hành.

## 1. Mốc tham chiếu và mức độ chắc chắn

| Nhãn | Ý nghĩa | Không được suy ra |
|---|---|---|
| **CODE** | Có trong working tree đã đọc | Đã deploy hoặc hoạt động trên cloud |
| **CONFIG** | Được khai báo trong file cấu hình | Dashboard production giống hoàn toàn file |
| **REPORT** | Có báo cáo một lần kiểm thử trước đó | Trạng thái dịch vụ hiện tại hoặc hiệu năng kho khách thật |
| **LIVE** | Đã đọc trực tiếp trong phiên kiểm tra này | Mọi tính năng liên quan đều hoạt động |
| **ĐỀ XUẤT** | Thực hành hoặc cải tiến nên thực hiện | Tính năng đã có hoặc lịch đã được bật |

- Repo: ChiCong Studio, package **chicong-photo 2.2.1**.
- Commit runtime đối chiếu 20/10: **5a9e83c0efd2bce1e18789cf1d227a7ea3414e2d**; các thay đổi Drive/VPS đã commit ở `9da05ce`, R2 được hợp nhất ở `5a9e83c`. Evidence chụp working tree trước commit tài liệu; commit tài liệu tiếp theo không thay đổi runtime được đối chiếu. Không suy bản VPS đã nhận source mới chỉ từ Git.
- [evidence-2026-10-20.json](evidence-2026-10-20.json) lưu hash và phạm vi đối chiếu lần này. [evidence.json](evidence.json) và [evidence-2026-10-17.json](evidence-2026-10-17.json) là lịch sử, không được ghi đè thành bằng chứng mới.
- Test audit 16/10 dùng **Node v23.6.0**; REPORT mới ngày 20/10 dùng Node 24 và PostgreSQL 17 cách ly. CI vẫn khai báo Node 24/PostgreSQL 16. Không chạy lại suite trong lượt chỉnh tài liệu này.
- Tài liệu không chứa giá trị mật khẩu, private ICS URL, API secret, refresh token hay password hash của tài khoản thật. Danh mục nơi lưu và cách phục hồi nằm trong tài liệu 02.
- Không thực hiện deploy, migration/cutover production, reset mật khẩu, gửi email thử, thay đổi DNS hoặc bật lịch backup trong đợt viết tài liệu này.

## 2. Trạng thái hiện biết

| Thành phần | Bằng chứng | Kết luận tại thời điểm lập tài liệu |
|---|---|---|
| Website công khai | **REPORT kiểm live 16/10**, 10:27: trang chủ HTTP 200; header server=cloudflare | Website truy cập được qua Cloudflare ở thời điểm kiểm tra |
| Health check | **REPORT kiểm live 16/10**: /api/health trả HTTP 200 và {"ok":true}; **CODE**: chỉ truy vấn settings | App trả lời được và truy vấn DB thành công; không xác nhận các dịch vụ khác |
| SEO bootstrap | **REPORT kiểm live 16/10**: homepage có page-data; robots.txt trả 200 và chặn /admin, /gallery/, /api/ | Có bootstrap dữ liệu và robots; robots không phải cơ chế phân quyền |
| Analytics | **REPORT kiểm live 16/10**: HTML có beacon Cloudflare | Có mã nhúng; chưa xác nhận dashboard nhận dữ liệu hoặc toàn bộ cấu hình analytics |
| Hosting production | **REPORT** rollout 20/10 | VPS iNET + Caddy + PM2; sau migration, trước pilot giữ 8 album/1.190 ảnh/1 admin; chưa dùng làm số cuối sau pilot |
| Drive trên VPS | **REPORT** rollout 20/10: source đã chuyển, web bật nhập thủ công, worker đã khởi động | Scheduler tắt; pilot/no-op, boot và trạng thái cuối chưa nghiệm thu; report còn PENDING |
| Folder browser/perf 20/10 | **CODE + REPORT** root/shared, browse, thumbnail/counts, tối ưu SQL/worker; log 420 pass trước phát hành | Source đã lên VPS; runbook báo shared/browse thành công nhưng bảng nghiệm thu rollout chưa cập nhật tương ứng |
| Credential Drive Sync | **REPORT** 19/10: khóa cũ thu hồi, khóa thay thế đọc/list thành công từ user worker | Đã đóng việc thay khóa thử đó; không suy mọi credential khác đã được rotate |
| Media production | **REPORT** iNET: Supabase DB/Storage; **CONFIG** render.yaml vẫn chọn Supabase | Chưa có bằng chứng cutover R2; Blueprint Render không còn là nguồn duy nhất mô tả production |
| Backup DB trên VPS | **REPORT** iNET: cron 03:00 giờ Việt Nam; **CODE** backup-db.sh ghi SQL gzip trên VPS | Khác backup DB + media lên Drive; chưa kiểm cron, timezone máy chủ hoặc file mới nhất trong lần này |
| Baseline production | **REPORT** 17/10: verify 3.287 object tham chiếu; 19/10: restore phần public đạt 28 bảng | Media baseline còn cùng VPS; full dump chưa restore thành công trên PostgreSQL 17 do thiếu role Supabase; chưa có DR đầy đủ |
| R2 staging | **REPORT** trong kế hoạch: Render + PostgreSQL + R2 riêng qua HTTP smoke, redeploy, backup/restore, rehearsal binding R2 → local → R2, ảnh lớn và client-abort/retry bằng dữ liệu giả | Staging đã được diễn tập; chưa chứng minh production dùng R2 hoặc chịu tải ảnh khách thật |
| Google Drive backup | **REPORT** trong kế hoạch: Drive upload/refresh/download/restore với dữ liệu giả | Đã diễn tập đường backup; chưa có lịch định kỳ hay bằng chứng backup production |
| Backup scheduler | **CODE**: media-backup.yml chỉ workflow_dispatch | Workflow không có lịch tự động; khác cron dump DB trên VPS và scheduler nhập Drive |
| Render staging | **REPORT** trong kế hoạch: service/DB staging riêng tại Singapore, Node 24, auto-deploy tắt | Đây là biên bản triển khai staging; không phải xác minh dashboard trong phiên chuẩn hóa này |
| Quota, chi phí, DB version thật, email deliverability | Chưa truy vấn dashboard tương ứng | Cần kiểm tra trực tiếp; không dùng số lịch sử làm số hiện tại |

Bằng chứng công khai ngày 16/10 nằm ở [public-checks.json](../../output/system-handbook-2026-10-16/public-checks.json). Biên bản R2, Render staging và Drive nằm trong [kế hoạch R2, mục 17](../r2-implementation-plan.md#17-triển-khai-và-kiểm-chứng-cloud-ngày-16102026). Theo biên bản, thư mục report local `output/r2-implementation-2026-10-16` đã được dọn sau khi số liệu cần thiết được chép vào mục 17; vì vậy các đường dẫn `output/...` cũ không được trình bày như file còn mở được. Các lần diễn tập sau cần lưu report bền vững hoặc xuất bản bản đã che dữ liệu nhạy cảm trước khi dọn workspace.

Kết quả kiểm tra local và phạm vi bỏ qua được ghi trong [tài liệu QA](03-phong-lab-qa.md). Không dùng số “56 test” trong tài liệu cũ làm số test hiện tại.

## 3. Những điểm được sửa so với bản hội thoại

| Mô tả cũ | Mô tả chính xác hơn và hệ quả |
|---|---|
| Tất cả thông tin đều là production hiện tại | Working tree, Blueprint, báo cáo cũ và live là bốn nguồn khác nhau. Muốn biết bản đang chạy phải đối chiếu deploy và env |
| SMTP tự dự phòng khi Resend lỗi; có circuit breaker | Mailer chọn provider khi khởi tạo. Có Resend key thì chọn Resend; không thấy tự failover SMTP, durable email queue hoặc circuit breaker |
| Calendar lỗi thì yêu cầu có ngày vẫn luôn được lưu | Khi cần xác nhận ngày và Calendar đang unavailable, code từ chối 409. Khách có thể bỏ ngày để gửi tư vấn |
| Mật khẩu “mã hóa chuẩn quân đội”, chống timing hoàn toàn | Mật khẩu được băm bằng scrypt với salt. timingSafeEqual bảo vệ bước so sánh, không chứng minh toàn bộ endpoint có thời gian đồng nhất |
| RLS bảo đảm toàn bộ phân quyền | RLS được enable; không thấy policy hoặc FORCE RLS trong migration này. Backend đặc quyền vẫn phải kiểm tra quyền album/ảnh |
| Gallery private nghĩa là luôn phải có mật khẩu | CODE cho phép gallery private không có password truy cập bằng link. Muốn giới hạn người xem cần đặt mật khẩu và kiểm tra từ phiên chưa đăng nhập |
| Pooler 5432 là transaction/PgBouncer | Cần phân biệt direct/session/transaction. Shared pooler Supabase dùng Supavisor; session thường 5432, transaction 6543; lấy chuỗi từ Dashboard |
| Có 12 bảng | Source có 28 bảng lâu dài; hai cache tạm so sánh và thumbnail folder khởi tạo khi cần. Snapshot v2 vẫn gồm 28 bảng; không lấy số bảng cache làm số bảng backup |
| Luôn tạo 3 rendition đồng thời | optimizePhoto hiện encode lần lượt. Vẫn có thể có nhiều HTTP upload đồng thời; chưa có giới hạn toàn cục cho toàn bộ upload |
| Prepared .ccphoto tiết kiệm 100% CPU/RAM server | Chuyển phần encode về máy local, nhưng server vẫn nhận buffer, parse, kiểm hash/ảnh, ghi storage và DB. Có mẫu ảnh giả mà prepared lớn hơn JPEG nguồn |
| ZIP stream thẳng từ cloud ra khách, không dùng RAM | Từng ảnh được đọc thành buffer rồi ghi file tạm; ZIP được tạo ra file tạm và stream ra response. Browser vẫn gom chunks thành Blob |
| Kiểm JPEG magic bytes cũng chứng minh ZIP hợp lệ | Kiểm 3 byte JPEG nằm ở tải ảnh đơn; không thể áp dụng chữ ký JPEG cho ZIP, và signature không chứng minh giải mã đầy đủ |
| Gallery realtime như WebSocket | Có polling/refetch và version checks; không thấy WebSocket hoặc Supabase Realtime trong luồng này |
| Health xanh là toàn bộ hệ thống ổn | Health hiện chỉ kiểm DB; ảnh lỗi/email lỗi/Calendar lỗi có thể cùng tồn tại với health 200 |
| CI chạy Playwright, axe và mọi test | CI hiện chạy syntax và *.test.mjs; các *.smoke.mjs không được gọi, axe chỉ chạy khi cấp module tương ứng |
| NODE_EXTRA_CA_CERTS cấu hình TLS cho pg_dump | Biến này của Node. Công cụ PostgreSQL dùng libpq, cấu hình CA bằng sslrootcert/PGSSLROOTCERT |
| Backup JSON admin là backup toàn hệ thống | Export chỉ có 8 bảng nghiệp vụ, không kèm file ảnh, admins, cấu hình dịch vụ; không đủ DR độc lập |
| Có thể đưa tích hợp thanh toán vào CV | Không có bằng chứng tích hợp thanh toán trong phạm vi code đã đọc. Case study phải phản ánh đúng phần đã làm |

Nguồn của các đính chính: [app.mjs](../../studio/server/app.mjs), [db.mjs](../../studio/server/db.mjs), [mailer.mjs](../../studio/server/mailer.mjs), [google-calendar.mjs](../../studio/server/google-calendar.mjs), [gallery-download.mjs](../../studio/server/gallery-download.mjs), [image-optimizer.mjs](../../studio/server/image-optimizer.mjs), [check.yml](../../.github/workflows/check.yml). Hai điểm về dịch vụ ngoài được kiểm tra thêm trong tài liệu chính thức: [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [PostgreSQL libpq environment](https://www.postgresql.org/docs/current/libpq-envars.html).

## 4. Thứ tự ưu tiên thực tế

1. **Pilot Drive:** source mới đã phát hành; hoàn tất import/no-op album draft, đối chiếu heartbeat/unlock/shared/browse và trạng thái cuối giữa các biên bản. Khóa thử cũ đã thu hồi, không yêu cầu làm lại việc này.
2. **Khả năng phục hồi:** giữ baseline đã verify, có bản media ngoài VPS và diễn tập DB + media trên môi trường tương thích Supabase. Restore riêng public chưa đóng cổng DR toàn hệ thống. Giữ ảnh gốc/RAW riêng.
3. **Độ tin cậy vận hành:** xác nhận commit/env live, schedule backup, tuổi bản backup tốt cuối và kênh cảnh báo. Phân biệt “job thất bại” với “job không chạy”.
4. **Chất lượng kiểm thử:** chuẩn hóa môi trường Node 24, bổ sung browser/a11y vào quy trình release nếu muốn coi đó là cổng bắt buộc; không ghi đã có CI gate trước khi thực hiện.
5. **Học và cải tiến:** làm các lab theo invariant, lưu report, phân tích bug rồi mới mở rộng công cụ. Thêm công cụ không tự tạo ra chất lượng.

Các mục trên là việc tiếp theo được đề xuất; bộ tài liệu không tự thực hiện thay đổi production.

## 5. Giữ tài liệu không bị lỗi thời

Mỗi lần thay dependency, thêm service, đổi DNS/provider, thay schema hoặc hoàn thành restore drill: cập nhật ngày, nguồn bằng chứng, người xác nhận và phạm vi. Ghi riêng commit triển khai, hash manifest backup và config không nhạy cảm. Với working tree chưa commit, cần bảo toàn diff và file chưa tracked trong bản lưu riêng trước khi nói “có source để restore”.

Các tài liệu cũ trong docs là lịch sử theo thời điểm. Khi chúng mâu thuẫn, dùng code tương ứng với deploy và bằng chứng mới có phạm vi rõ ràng; không chỉ chọn tài liệu có tiêu đề “final”.

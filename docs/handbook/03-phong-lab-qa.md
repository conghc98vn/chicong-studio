# 03 — Dùng ChiCong Studio làm phòng lab QA

> **Cập nhật 29/10/2026:** release `7a6c039` đã được kiểm LIVE ở production. Audit local, test fixture và CI browser/axe vẫn là TEST/REPORT; kết quả runtime nằm trong [biên bản production 29/10](09-production-release-2026-10-29.md).

**Dành cho chủ website đang làm QA · Cập nhật 29/10/2026.** Mục tiêu là giải thích được vì sao hệ thống đúng, thiết kế cách làm nó sai có kiểm soát, và thu thập bằng chứng. Không cần biến mọi bài tập thành một framework automation mới.

## 1. Chiến lược kiểm thử theo rủi ro

Ba tài sản quan trọng nhất là **ảnh và quyền riêng tư**, **dữ liệu lựa chọn/đơn tư vấn**, **khả năng khôi phục**. Giao diện đẹp nhưng lộ gallery hoặc mất selection vẫn là lỗi nghiêm trọng. Ngược lại, một animation lệch nhẹ thường không nên được ưu tiên hơn lỗi mất dữ liệu.

| Tầng | Cần chứng minh | Ví dụ trong repo |
|---|---|---|
| Hàm/module | Quy tắc input, hashing/mapping, queue, cancellation | upload-queue, inquiry-form, prepared-photo, gallery-download-client tests |
| API + DB | Auth, transaction, idempotency, constraint và lỗi | security, photo-management, gallery-selection, studio tests |
| Adapter/contract | Request/response của Storage/Drive/email, timeout và failure | r2-storage, drive-backup, mailer, google-calendar tests |
| Browser | Event/timing/focus/download/UI không bị response cũ ghi đè | proofing-concurrency, gallery-download-browser, gallery-motion-browser |
| Hạ tầng/staging | TLS, proxy/IP, cloud IAM, quota, restart và nhiều process | r2-live, drive-live và staging runbook; không thay bằng mock |
| Khôi phục | Backup đúng, hỏng phải bị chặn, restore độc lập có dữ liệu dùng được | media-backup tests + restore drill |

Chọn test oracle độc lập với cách code đang viết. Ví dụ, kiểm DB có đúng một inquiry sau retry đáng tin hơn chỉ kiểm toast “thành công”. Test dùng mock chứng minh ứng dụng phản ứng với giả lập, không chứng minh dịch vụ ngoài hôm nay còn hoạt động.

## 2. Kết quả hiện hành và cách chạy

[Report 23/10](../review-2026-10-23.md) là kết quả kiểm chứng mới nhất. [Report 21/10](../review-2026-10-21.md) giữ mốc lịch sử **427/427 PostgreSQL**, **376 pass/44 skip SQLite** và benchmark của lượt đó; không dùng các số cũ làm kết quả checkout hôm nay. Các ca skip khi không cấp URL PostgreSQL không được tính là pass.

```sh
nvm use
npm ci
npm run check
npm run check:docs
npm test
STUDIO_TEST_POSTGRES_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/TEST_DB npm test
STUDIO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
```

`npm test` không nạp `.env`. Cấp URL DB disposable, các suite có quyền CREATE/DROP schema; test `database-recovery` ngắt duy nhất PID từ pool riêng để kiểm idle, transaction giữa các query, query đang chạy và rollback thất bại. `environment-isolation` dùng TCP trap local để xác nhận fixture không kết nối tới `DATABASE_URL` kế thừa. `openDatabase` mặc định SQLite; caller muốn PostgreSQL phải truyền URL rõ ràng. Kiểm tra fixture không gọi mail/Drive/cloud thật trước khi chọn một smoke script riêng.

`test:browser` chạy tuần tự 21 suite được chọn trong [runner](../../studio/tests/run-browser-smoke.mjs): public/login không tải Drive, admin phục hồi CSS lỗi/treo, quyền gallery, đồng bộ giữa tab, JPEG/ZIP, quản lý/thay/xóa ảnh, prepared upload, proofing, tạo album Drive, folder browser, polling và slug. Có kiểm response/export về muộn, xóa thành công nhưng refresh lỗi, validation mật khẩu album ẩn/hiện (`album-password-form`), CSS gallery khi không tải Drive (`gallery-layout-isolation`), phân trang nguồn Drive sau lỗi (`drive-panel-pagination`) và form tư vấn cũ/giữ bản nháp/tải lại lỗi (`inquiry-editor`). Bốn suite feedback kiểm luồng form/admin, mất ACK sau commit, context thay đổi, chuyển gallery atomic, hai tab, giữ bản nháp và thu hồi quyền giữa request. Runner không chạy các script `*-live`, `render-*` hay benchmark đọc `data/live`.

Runner chỉ truyền danh sách biến cần cho browser; loại URL database, credential, `NODE_OPTIONS` và biến chọn ảnh khách khỏi process con. Mỗi suite có timeout mặc định 180 giây, có thể đặt `STUDIO_BROWSER_SUITE_TIMEOUT_MS` (100–3.600.000 ms); timeout trả exit 124 và dừng runner. `STUDIO_BROWSER_EVIDENCE_DIR` được chia thành thư mục con theo suite. Local mặc định dùng Chrome đã cài; khi đặt `CHROME_BIN` là đường dẫn tuyệt đối, runner dùng executable đó cho các suite Chromium.

`npm run check` kiểm cú pháp đệ quy JavaScript trong `studio/`, scripts JavaScript/Bash/`.command` và `ecosystem.config.cjs`; chỉ parse, không chạy các tác vụ trong file. Cần Bash cho bước kiểm shell (macOS/Linux hoặc môi trường tương đương). `check:docs` kiểm file đích của link Markdown, chưa kiểm anchor hoặc URL ngoài. Project không có bước build frontend hay lệnh lint/typecheck riêng.

Playwright/axe là dependency ngoài, không tự được cài bởi `npm ci`. Các suite hỗ trợ WebKit có thể chạy riêng với `STUDIO_BROWSER=webkit` khi engine đã cài. `STUDIO_AXE_MODULE` là opt-in local ở suite có hỗ trợ; không cấp thì không được ghi “axe đã chạy”. Gallery layout, download, prepared upload và form tư vấn lưu kết quả scan trước assertion để còn chẩn đoán khi lỗi. Scan tự động không thay kiểm screen reader/keyboard và không chứng nhận WCAG.

CI [check.yml](../../.github/workflows/check.yml) dùng Node 24/PostgreSQL 16 cho `npm ci`, syntax, link tài liệu và `npm test`. Job `browser-smoke` riêng trên Ubuntu 24.04 cài Playwright **1.62.1**, axe **4.14.0** ngoài project, cài Chromium đi kèm và cấp cả hai module cho runner. Job không nhận secret cloud; log/ảnh fixture được upload kể cả khi lỗi và giữ 7 ngày. Release `7a6c039` đã chạy check local; run GitHub Actions tương ứng chưa có kết quả đọc được tại thời điểm cập nhật, nên không ghi là CI đã đạt. Không dùng CI xanh thay kiểm cloud/backup/rollback.

## 3. Chuẩn bị lab tách khỏi dữ liệu studio

Đối với bài manual đầu tiên, dùng fixture được repo thiết kế sẵn. Không dùng npm run dev cho lab email bởi script đó nạp .env có Resend/ICS thật.

~~~sh
cd /path/to/chicong-studio
env -i PATH="$PATH" node studio/tests/manual-fixture.mjs
~~~

Terminal in ra URL admin, URL gallery và ảnh thử trong thư mục tạm. Tài khoản **fixture công khai trong source**, không phải tài khoản thật: admin studio-test@example.com / temporary-test-password; gallery dùng client-test-password. Server chỉ listen loopback port 4180. Dùng Ctrl+C để fixture đóng DB và dọn thư mục tạm; không chạy hai fixture cùng cổng.

Với automation, dùng Node 24 để khớp CI khi có runtime đó. Trước khi chạy các script có STUDIO_TEST_POSTGRES_URL, kiểm DB thật sự là DB disposable. Isolation schema vẫn dùng quyền CREATE/DROP trên server được cấp URL; không trỏ URL production để “test cho thật”.

**Browser dependencies:** dùng phiên bản pin trong workflow khi muốn khớp CI; cài vào thư mục QA riêng bằng `npm install --prefix /absolute/path/to/qa-tools --no-package-lock --no-save playwright@1.62.1 @axe-core/playwright@4.14.0 axe-core@4.14.0`. Cài browser bằng CLI Playwright của thư mục đó, rồi cấp đường dẫn `STUDIO_PLAYWRIGHT_MODULE`, `STUDIO_AXE_MODULE` và `CHROME_BIN` cho runner như workflow. Không cần thay package.json/lockfile của ứng dụng. Khi chạy trực tiếp một smoke file ngoài runner, các script Chromium vẫn chọn Chrome channel; `CHROME_BIN` chỉ được runner áp dụng. Tham khảo [Playwright browser setup](https://playwright.dev/docs/browsers).

~~~sh
# Chỉ chạy sau khi module và browser đã được chuẩn bị trong môi trường QA.
env -u STUDIO_TEST_POSTGRES_URL NODE_ENV=test STUDIO_PLAYWRIGHT_MODULE=playwright STUDIO_BROWSER=webkit \
  STUDIO_BROWSER_EVIDENCE_DIR=output/qa-lab-concurrency \
  node studio/tests/proofing-concurrency.smoke.mjs

env -u STUDIO_TEST_POSTGRES_URL NODE_ENV=test STUDIO_PLAYWRIGHT_MODULE=playwright STUDIO_AXE_MODULE=@axe-core/playwright \
  STUDIO_BROWSER=webkit STUDIO_BROWSER_EVIDENCE_DIR=output/qa-lab-download \
  node studio/tests/gallery-download-browser.smoke.mjs
~~~

Các lệnh browser này là hướng dẫn có điều kiện, không phải kết quả đã chạy hôm nay. Nếu module nằm ngoài repo, cung cấp đường dẫn module thực sự import được thay tên package và ghi version trong report.

## 4. Ma trận truy vết rủi ro → yêu cầu → bằng chứng

| ID / ưu tiên | Invariant cần giữ | Kịch bản chính | Bằng chứng/source test |
|---|---|---|---|
| AUTH-01 / P0 | Người không có quyền không xem/tải ảnh private có password | Session thiếu/hết hạn, đổi album ID/photo ID, password đổi | security.test.mjs; gallery-download.test.mjs; kiểm HTTP/body/media |
| UP-01 / P0 | Một upload retry không tạo ảnh trùng hoặc mất ảnh | Commit rồi mất ack, same key/different content, overwrite | upload-optimization-api.test.mjs; photo-management.test.mjs; DB + objects + receipts |
| SEL-01 / P0 | Lựa chọn chỉ thuộc ảnh hợp lệ, không bị UI stale ghi đè | Hai context cùng chọn, xóa ảnh khi tab khác mở, response về muộn | gallery-selection.test.mjs; proofing-concurrency.smoke.mjs |
| BOOK-01 / P1 | Một key là một đơn, một ngày chỉ một confirmed | Double submit, response drop, confirm đồng thời | studio.test.mjs; security.test.mjs; inquiry counts/constraint |
| CAL-01 / P1 | Không coi lịch không kiểm được là lịch trống | Feed lỗi, cache stale, recurrence, ngày ngoài range | google-calendar.test.mjs; HTTP/fields và DB |
| MAIL-01 / P1 | Email lỗi không làm mất đơn đã lưu | Provider reject/timeout hoặc process ngừng sau insert | mailer.test.mjs; inquiry-notifications.test.mjs; feedback queue tests |
| DEL-01 / P0 | Xóa DB và job cleanup nhất quán | Storage remove fail rồi phục hồi, restart worker | photo-management.test.mjs; storage/object absence + queue drain |
| DL-01 / P1 | Chỉ tải đúng ảnh, file dùng được, hủy không giữ slot | 1/50/51 ảnh, 429, truncated response, abort | gallery-download*.test.mjs; browser smoke; decode/unzip |
| DR-01 / P0 | Chỉ backup đủ mới được publish/restore | Thiếu blob, sai hash, manifest lỗi, restore đích tồn tại | media-backup.test.mjs; drive-backup.test.mjs; restore độc lập |
| MIG-01 / P0 | Không switch khi còn writer/ghi chưa rõ | Lease expiry, late PUT, stale process, cleanup queue | media-control.test.mjs; r2-storage.test.mjs; PostgreSQL parity |
| SEO-01 / P2 | URL/metadata đúng, không index riêng tư | Rename slug, sitemap, canonical, staging noindex | album-slug*.test.mjs; schema-analytics.test.mjs |
| A11Y-01 / P1 | Thao tác cốt lõi dùng được bằng keyboard | Focus dialog, Escape, reduced motion, lỗi tải | browser smoke + axe thực sự bật + kiểm manual |
| DRIVE-01 / P0 | Scope/quyền/approval còn hợp lệ tại lúc publish | root/shared, đổi generation, missing/detach/reimport, submit đồng thời apply | drive-folder-scope.test.mjs; drive-workflow.test.mjs; drive-sync.test.mjs |
| BROWSE-01 / P1 | Browse chỉ xem; kết quả cũ/cancel không được chọn hoặc lộ ảnh | ACK muộn, count partial, thumbnail hết hạn, đóng/đổi folder, mất quyền | drive-folder-preview.test.mjs; drive-folder-browser.smoke.mjs; drive-folder-overview.test.mjs |

P0/P1/P2 ở đây là thứ tự kiểm thử đề xuất theo tác động sản phẩm, không phải severity mặc định của mọi bug trong dòng đó. Khi lập release report, ghi từng ID: pass/fail/skipped/not-run, môi trường, commit, dữ liệu và link evidence; “có test file” chưa phải “đã pass”.

## 5. Chín bài thực hành có đầu ra cụ thể

### Lab 1 — Theo dấu một request và kiểm quyền ở nhiều tầng

**Dữ liệu:** manual fixture, một gallery có password và ba ảnh giả. **Kỹ năng:** HTTP, cookie/session, negative testing và IDOR.

1. Mở gallery bằng cửa sổ chưa đăng nhập; ghi request GET /api/gallery/:id và response locked.
2. Nhập password fixture; quan sát POST unlock, Set-Cookie, request media kế tiếp. Che Cookie/Set-Cookie khi lưu evidence.
3. Đóng phiên đó, mở context mới và thử URL media/download đã biết. Không suy ra quyền chỉ từ khả năng đoán URL.
4. Tạo thêm album thử B; thử lấy ảnh B bằng phiên chỉ hợp lệ cho album A. Kiểm cả endpoint đọc, chọn và tải.
5. Lập bảng quyền cho guest, gallery A, gallery B, admin với draft/published/private có/không password.

**Oracle:** không lộ ảnh/nội dung bảo vệ hoặc tác động album khác; private không password được ghi đúng là truy cập bằng link theo hành vi hiện tại. **Evidence:** bảng quyền, URL route đã bỏ identifier nhạy cảm nếu cần, status/body đã che token, ảnh UI. **Cleanup:** Ctrl+C fixture. **Câu hỏi tự kiểm:** SameSite cookie ngăn vấn đề gì, và vì sao nó không thay kiểm quyền photo_id?

### Lab 2 — Idempotency khi DB đã lưu nhưng client không nhận phản hồi

**Dữ liệu:** consultation fixture, tên QA Lab, số liên hệ giả và email miền example.com. Không dùng mail thật. **Kỹ năng:** ranh giới commit/ack, retry và test oracle DB.

~~~sh
env -i PATH="$PATH" node studio/tests/consultation-fixture.mjs
~~~

Fixture cố tình làm một số API lỗi và làm mất response 201 đầu tiên sau khi inquiry đã commit; nếu có ngày, fixture còn khóa ngày đó sau khi lưu. Gửi đơn, quan sát lỗi phía browser rồi retry cùng request key. Tự mở DevTools xem payload và so reference; không tạo một request key mới để thay thế bài test.

**Oracle:** cùng key+cùng payload chỉ có một inquiry và cùng reference, dù ngày sau đó bị khóa; cùng key+payload khác phải bị từ chối theo logic replay. Kiểm DB trong thư mục fixture khi cần và số savedRequests mà script in khi dừng. Lỗi UI không đồng nghĩa DB rollback.

**Evidence:** timeline gửi → commit → mất response → retry → response; số inquiry trước/sau, key đã ẩn nếu chia sẻ. **Cleanup:** Ctrl+C. **Mở rộng:** upload có cùng dạng lỗi nhưng còn boundary giữa object storage và DB. Tại sao hash file không thay upload key, và upload key không chứng minh file không đổi?

### Lab 3 — Thiết kế race condition có tính quyết định

**Dữ liệu:** fixture tự sinh trong proofing-concurrency.smoke.mjs. **Kỹ năng:** synchronization, stale response và nhiều browser context.

Đọc các gate ở khoảng dòng 44–46, 59 và 71–79 của [script](../../studio/tests/proofing-concurrency.smoke.mjs). Script dùng page.route để giữ một request, chờ tín hiệu request đã tới, đổi album rồi mới thả request. Đây là cách ép thứ tự cần test; sleep một giây không bảo đảm thứ tự mạng.

**Bài tập:** dự đoán UI trước khi chạy; ghi rõ album A/B và response nào được giữ. Sau đó kiểm API selection từ context khách khác, đưa tab admin ra/vào focus và quan sát trạng thái hội tụ. Dùng test có sẵn làm baseline trước khi sửa thêm scenario.

**Oracle:** dữ liệu A về muộn không xuất hiện trong màn B; thao tác đang xử lý trên A không vô hiệu hoặc áp kết quả nhầm B; polling đọc đúng selection server. Browser clock fastForward được dùng để kiểm polling/timeout client, **không tua Date.now() của Node server hoặc thời gian hết hạn DB**.

**Evidence:** thứ tự request, assertion DOM + selection server, browser/version và trace nếu bật. **Cleanup:** finally đóng browser/server và thư mục tạm; giữ evidence riêng. Tài liệu nền tảng: [Playwright mock](https://playwright.dev/docs/mock), [Clock](https://playwright.dev/docs/clock).

### Lab 4 — Boundary value và contract cho pipeline ảnh

**Dữ liệu:** tạo ảnh giả bằng Sharp; không cần dùng ảnh khách. Bộ dữ liệu gồm JPEG/PNG/WebP tĩnh, ảnh alpha, orientation, file rỗng, bytes giả đuôi .jpg, ảnh lỗi, .ccphoto bị sửa hash/header.

**Thiết kế:** chia lớp hợp lệ/không hợp lệ, sau đó kiểm ngay dưới/bằng/trên 20 MiB và 40 MP khi fixture tạo được đúng ranh giới. Kiểm request 8/9 file riêng với giới hạn file. Một file 20 MiB + 1 byte nhưng bản thân không phải ảnh hợp lệ không chứng minh mọi validator ảnh đều đúng; ghi rõ lỗi nào được kỳ vọng trước.

~~~sh
env -i PATH="$PATH" NODE_ENV=test node --test studio/tests/image-optimizer.test.mjs studio/tests/prepared-photo.test.mjs \
  studio/tests/upload-optimization-api.test.mjs studio/tests/upload-request.test.mjs
~~~

**Oracle:** rendition đúng format/dimensions, không phóng to, metadata nhạy cảm không còn, JPEG alpha có nền theo policy, lỗi có thể retry được phân biệt với lỗi input vĩnh viễn, receipt/object/DB nhất quán. Giảm dung lượng không phải oracle duy nhất; không hạ chất lượng vô hạn chỉ để đạt một số byte.

**Evidence:** bảng input bytes/pixels/type → expected code → actual → dimensions/output bytes; kiểm ảnh thực bằng decoder. **Cleanup:** temp directories của test. **Câu hỏi:** upload %100 đang đo gì? Một queue tuần tự ở browser có ngăn 5 admin upload đồng thời không?

### Lab 5 — Fault injection tại dịch vụ ngoài và cleanup

**Dữ liệu:** adapter giả và DB local theo các test hiện có; không tắt dịch vụ production. **Kỹ năng:** lỗi phụ thuộc, fail-open/fail-closed, eventual consistency.

~~~sh
env -i PATH="$PATH" NODE_ENV=test node --test studio/tests/mailer.test.mjs studio/tests/inquiry-notifications.test.mjs studio/tests/google-calendar.test.mjs \
  studio/tests/photo-management.test.mjs studio/tests/storage.test.mjs
~~~

| Tiêm lỗi | Expected ở API/UI | Expected ở dữ liệu |
|---|---|---|
| Mail provider lỗi tạm thời/timeout | Inquiry đã lưu vẫn trả thành công; admin thấy trạng thái email chờ thử lại | Có đúng một đơn và outbox bền vững; dispatcher thử lại sau backoff, kể cả sau restart |
| Mail provider từ chối vĩnh viễn/hết lượt retry | Inquiry vẫn được giữ; admin thấy email lỗi và có thể thử lại sau khi xử lý nguyên nhân | Notification chuyển `failed`, không tự gửi vô hạn |
| Thiếu provider/người nhận studio | Inquiry vẫn được giữ; admin thấy email chờ cấu hình | Notification ở `blocked_config`; bật provider thì tự tiếp tục nếu có recipient, thiếu recipient cần xác nhận địa chỉ và retry trong admin |
| Calendar fetch fail, khách chọn ngày | 409/fields date khi không xác nhận được lịch | Không tạo đơn mới với ngày chưa kiểm; không ngày có thể gửi |
| Storage remove fail | Xóa logic hoàn tất theo luồng cleanup | Còn job bền vững để retry; không còn ảnh trong danh sách |
| Storage phục hồi | Lần cleanup tiếp theo có thể hoàn tất | Objects không còn; job được dọn, không đụng file khác |
| PUT timeout nhưng cloud có thể đã ghi | Không đánh dấu chắc chắn chưa có object | Journal unknown phải chặn các thao tác yêu cầu trạng thái chắc chắn |

**Evidence:** cả response và state DB/storage/queue trước-sau; kiểm retry không tạo thêm inquiry/notification và lease chặn hai dispatcher cùng nhận một lượt. `accepted_by_provider` chỉ chứng minh provider nhận yêu cầu, chưa chứng minh thư đến inbox. **Cleanup:** fixture và mocks. **Câu hỏi:** nếu provider đã nhận thư nhưng process dừng trước khi ghi nhận kết quả, vì sao outbox vẫn có thể gửi lại? Lease và request key giải quyết những ranh giới nào, và vì sao không thay được kiểm deliverability?

### Lab 6 — Download, cancellation và accessibility

**Dữ liệu:** gallery-download-browser.smoke.mjs và gallery-motion-browser.smoke.mjs tự tạo ảnh; dùng browser/module theo phần chuẩn bị. **Kỹ năng:** kiểm bytes, async UI, focus và khả năng dùng bằng bàn phím.

Kiểm 1 ảnh/50 ảnh/51 ảnh, file quá lớn, thiếu Content-Length, khai báo length sai, response HTML thay JPEG, 429 + Retry-After, hủy khi chờ và hủy khi nhận bytes. Không coi status 200 hoặc file đuôi .zip là đủ; giải nén và decode ảnh bên trong. Đóng dialog giữa chừng rồi tải lại để bắt slot hoặc object URL không được giải phóng.

Chạy axe với STUDIO_AXE_MODULE thật sự được cấp và lưu số scan/violations. Dùng Tab/Shift+Tab/Escape, kiểm focus trở về nút mở, thông báo lỗi nhận biết được và thao tác cốt lõi dùng được khi prefers-reduced-motion bật. Một số scan trong gallery-motion dùng cả tag WCAG 2.2 AA; không quy toàn bộ suite thành chứng nhận WCAG.

**Oracle:** đúng ảnh đã chọn, đúng quyền, bytes dùng được, cancel kết thúc trạng thái UI và giải phóng tài nguyên; không có focus mắc kẹt ngoài chủ đích modal. **Evidence:** tên browser/version, viewport, axe report, file download/decoder output, screen/keyboard notes. **Cleanup:** scripts finally và evidence không chứa dữ liệu khách. **Câu hỏi:** axe không thấy lỗi có chứng minh mọi thao tác screen reader đều dùng được không?

### Lab 7 — Chứng minh backup có thể phục hồi và dữ liệu hỏng bị chặn

**Dữ liệu:** bộ ảnh/DB giả của media-backup.test.mjs và drive-backup.test.mjs. **Kỹ năng:** toàn vẹn dữ liệu, negative testing, migration/DR.

~~~sh
env -i PATH="$PATH" NODE_ENV=test node --test studio/tests/media-backup.test.mjs studio/tests/drive-backup.test.mjs \
  studio/tests/media-control.test.mjs studio/tests/r2-storage.test.mjs
~~~

Vẽ quan hệ manifest → database blob → object blobs. Trên **bản copy fixture**, thử bỏ một blob, đổi một byte, sửa mapping hoặc restore vào đích đã tồn tại. Đọc test hiện có để biết helper tạo bộ backup; không sửa bản backup tốt duy nhất nhằm thực hành corruption.

Fixture media-backup dùng cả payload giả như Buffer.from('data'), không phải ảnh giải mã được. Suite đó chứng minh hash/mapping và bookkeeping khi restore; không chứng minh ảnh hiển thị được. Bài nghiệm thu tiếp theo phải dùng ảnh synthetic thật tạo bằng Sharp để kiểm decode, portrait và gallery.

**Oracle:** thiếu/sai checksum/mapping phải bị chặn trước khi công bố bản complete hoặc dùng để restore. Bản hợp lệ khôi phục đủ album/section/selection/portrait, phiên cũ không hoạt động. OAuth lỗi/Drive đầy không được xóa bản tốt mới nhất để giải quyết tạm thời. Khi có PostgreSQL disposable, chạy lại tests với URL đó để kiểm locking giữa process — SQLite pass không chứng minh lock PostgreSQL.

Thực hiện thêm [runbook offline restore](02-van-hanh-bi-mat-va-khoi-phuc.md) trên một bộ synthetic độc lập, ngắt kết nối tới nguồn và chứng minh vẫn khôi phục được. **Evidence:** runId, hash, record/object count, nguồn không bị gọi, session reset, thời gian từng giai đoạn. **Cleanup:** chỉ fixture, giữ report đã bỏ thông tin khách. **Câu hỏi:** checksum đúng nhưng snapshot chụp khi writer đang đổi mapping có thể vẫn không khôi phục đúng nghiệp vụ không?

### Lab 8 — Đo hiệu năng có phương pháp

**Dữ liệu:** album synthetic có ảnh ngang/dọc và độ lớn đại diện; cùng dataset cho baseline và bản thay đổi. **Kỹ năng:** hypothesis, measurement, confounders và capacity.

Viết giả thuyết trước: “preload đúng ảnh hero giảm thời gian ảnh chính xuất hiện trên mobile mạng chậm”. Giữ cố định browser, viewport/DPR, cache, tốc độ mạng, CPU throttle, dataset và provider. Đo ít nhất vài lượt mỗi cấu hình, ghi median và phân bố; không gọi một lần đo là p95 đáng tin.

[performance-benchmark.mjs](../../studio/tests/performance-benchmark.mjs) copy dữ liệu public từ SQLite nguồn ở chế độ read-only sang DB tạm, thêm độ trễ DB giả lập 20 ms, dùng CDP để throttle và đo LCP/CLS/navigation/resources. Nó mặc định đọc data/live, nên phải chỉ rõ STUDIO_PERF_DATA_DIR trỏ dataset synthetic đã chuẩn bị; không dùng mặc định mà quên nguồn. Script Chromium chọn Chrome channel và cần môi trường browser phù hợp.

Đối với tải server, chỉ chạy trên staging/loopback đã chuẩn bị: tăng 1 → 2 → 5 client, ghi latency/error/RSS và dừng nếu lỗi hoặc memory tăng mất kiểm soát. Tách xem trang, tải ảnh và upload/encode; GET homepage không kiểm sức chịu tải Sharp. Không bắn lệnh tải lên chicongphoto.vn như ví dụ trong hội thoại cũ.

**Oracle:** số liệu có thể tái lập, lỗi không tăng ngoài ngưỡng đã định và thay đổi được đo đúng đường thực thi. Cold start/warm, local→R2/Render→R2 và synthetic/ảnh khách là những thí nghiệm khác nhau. **Evidence:** conditions.json, raw samples, bảng baseline/after, biểu đồ nếu cần, giới hạn suy luận. **Cleanup:** stop load generator và fixture, kiểm không còn process sinh tải.

### Lab 9 — Folder Drive, hủy tác vụ và cache riêng tư

**Dữ liệu:** fixture scope/picker, Drive client giả; không sửa nguồn thật để tạo lỗi. Với API Google thật, dùng folder thử được phép và credential worker riêng. Đọc [runbook](../google-drive-sync-operations.md) trước khi mở local UAT.

1. Seed hai folder không cùng root: root mode phải từ chối folder ngoài phạm vi; shared chỉ nhận folder identity đọc được. Đổi mode phải vô hiệu preview cũ, giữ ảnh/mapping và yêu cầu check mới.
2. Gate response browse A, chuyển B rồi thả ACK/kết quả A. Chỉ B được chọn; browse A bị hủy theo khả năng API; job import độc lập không bị hủy. Kiểm đóng modal, mất mạng, failed/canceled và generation đổi.
3. Seed count đầy đủ/một phần/lỗi; không hiển thị lỗi thành 0. Folder không có con vẫn chọn được. Phân trang giữ focus và ảnh đã tải; refresh có job mới, cache 30 giây không tạo job mới trong phạm vi còn hợp lệ.
4. Thumbnail thiếu phiên phải bị chặn; hết hạn phải bị từ chối ngay khi đọc dù cleanup chưa chạy. Kiểm URL Google không được phép/redirect và kết quả trả muộn sau deadline không lọt cache. Snapshot không chứa pixels của hai cache tạm.
5. Đếm SQL cho đúng đường browse/inspect không filter, cache đã khởi tạo; dùng clock điều khiển để đo heartbeat/cleanup. Tách latency mạng Google khỏi số truy vấn và khoảng nghỉ code. Queue FIFO vẫn có thể phải đợi import batch.

**Oracle/evidence:** job ID/generation/status, số album/photo/source trước-sau không đổi khi chỉ browse, request thumbnail, response auth/no-store, số query thực tế, UI keyboard/mobile 320px. Giữ bí mật khỏi report; TTL 15 giây enrichment không phải thời hạn toàn request. **Cleanup:** đóng fixture, dọn riêng cache/report thử và không xóa job/ảnh production. **Câu hỏi:** vì sao giảm 3 SQL xuống 1 không chứng minh mọi lần mở folder nhanh hơn?

## 6. SQL cho QA: kiểm invariant thay vì nhìn UI

Các truy vấn dưới đây chỉ đọc. Dùng trên **DB fixture**, giữ field khách khỏi report chia sẻ. Chúng minh họa cách xác định oracle độc lập; kết quả expected được suy ra từ seed của từng test.

~~~sql
-- Không được có selection trỏ nhầm album hoặc ảnh đã mất.
SELECT s.album_id, s.photo_id
FROM selections s
LEFT JOIN photos p ON p.id = s.photo_id
WHERE p.id IS NULL OR p.album_id <> s.album_id;

-- Không được có hơn một inquiry confirmed cho một ngày không rỗng.
SELECT date, COUNT(*) AS total
FROM inquiries
WHERE status = 'confirmed' AND date <> ''
GROUP BY date HAVING COUNT(*) > 1;

-- Số bản ghi theo trạng thái để đối chiếu trước/sau kịch bản.
SELECT status, COUNT(*) AS total FROM inquiries GROUP BY status;
SELECT COUNT(*) AS pending_cleanup FROM photo_cleanup;

-- Bản local phục hồi bằng công cụ mới phải bắt đầu không có session cũ.
SELECT COUNT(*) AS restored_sessions FROM sessions;
~~~

Không JOIN một bảng rồi nhìn count tăng và kết luận “dữ liệu trùng” khi join một-nhiều tạo nhiều hàng hợp lệ. Kiểm cả quan hệ, unique constraint và trạng thái. Với race test, kiểm kết quả sau khi cả hai request hoàn tất; đọc giữa transaction có thể là một trạng thái trung gian hợp lệ.

## 7. Mẫu test case, bug report và release report

### Test case có thể bàn giao

| Trường | Ví dụ |
|---|---|
| ID / invariant | BOOK-RETRY-01; cùng request key không tạo đơn thứ hai |
| Tiền điều kiện | Fixture local, Calendar/mail mock, DB chưa có request key này |
| Dataset | Payload hợp lệ với thông tin giả; key K cố định cho lần replay |
| Kích hoạt | Gửi → commit → chặn response → retry cùng K/payload |
| Expected API | Lần replay trả reference của bản đã lưu |
| Expected DB | Đúng một inquiry mang K; không tiêu quota như hai đơn thành công |
| Expected UI | Hiển thị thành công hoặc trạng thái phục hồi rõ ràng, không kẹt loading |
| Evidence | Request/response đã che credential, count DB, screenshot/timeline |
| Cleanup | Fixture bị dọn, không mail thật, report giữ riêng |

### Bug report mẫu — ví dụ giả định, chưa phải bug đã phát hiện

**Tiêu đề:** Response album A về muộn làm bảng quản lý album B hiển thị ảnh A.

**Môi trường:** commit/diff hash, Node, browser, viewport, SQLite/PostgreSQL, fixture ID. **Tái hiện:** mở A; gate request detail A; chuyển B; xác nhận B đã render; thả response A. **Expected:** B vẫn hiển thị ảnh B. **Actual giả định:** ảnh A thay danh sách B. **Tác động:** admin có nguy cơ chọn/xóa nhầm; severity phải xét thao tác ghi có bị hướng sai hay chỉ hiển thị. **Evidence:** network timeline, URL/hash đang ở B, assertion ID ảnh, console đã bỏ PII. **Tần suất:** n/N lần với gate quyết định. **Phạm vi:** ghi rõ regression baseline và browser khác chưa chạy.

Một bug tốt mô tả **điều kiện, quan sát, expected và tác động**; không khẳng định nguyên nhân “do React” khi dự án không dùng React hoặc chưa điều tra.

### Release report ngắn, đúng phạm vi

~~~text
Build/source: <deploy commit hoặc working-tree hash>
Environment: <Node/browser/DB/provider>
Risk scope: AUTH-01, UP-01, SEL-01, DR-01
Executed: <tên suite + số pass/fail/skip>
Not run: <PostgreSQL/browser/cloud và lý do>
Evidence: <log/report/manifest/screenshot đã che dữ liệu>
Open risks: <tác động + workaround + người xử lý>
Decision: <có thể release trong phạm vi nào / điều kiện còn thiếu>
~~~

Ghi kết quả theo [report hiện hành](../review-2026-10-23.md), tách rõ SQLite, PostgreSQL, browser và cloud. Không cộng các suite có ca trùng thành phần trăm coverage; câu “toàn bộ production pass” vượt quá bằng chứng local.

## 8. Lộ trình bốn tuần và portfolio

| Giai đoạn | Việc thực hành | Sản phẩm có thể đánh giá |
|---|---|---|
| Tuần 1 | Đọc kiến trúc, Lab 1–2, HTTP/SQL và state | Sơ đồ request, bảng quyền, 10 test case theo rủi ro, report idempotency |
| Tuần 2 | Lab 3–5, race/contract/failure injection | Một test có gate quyết định, bảng lỗi dịch vụ và DB oracle |
| Tuần 3 | Lab 6, keyboard/axe/download, kiểm browser chéo | Report ghi rõ browser, scan thật, file decode/unzip và lỗi manual |
| Tuần 4 | Lab 7–8, restore drill và đo baseline | Manifest/restore report, RPO/RTO đo được cho fixture, báo cáo hiệu năng có conditions |

Đây là lịch học đề xuất, không phải automation đã được tạo. Mỗi tuần nên chọn một bug hoặc câu hỏi thật, tái hiện, thử giải thích, kiểm lại giả thuyết rồi viết một trang case study.

**Cách viết CV trung thực:** “Dùng ứng dụng studio ảnh làm case study QA: thiết kế kiểm thử quyền gallery, retry upload/inquiry và concurrency; xác minh dữ liệu API/DB; thực hiện browser test và restore drill trên môi trường cô lập.” Sau khi tự thực hiện, bổ sung số đo và bằng chứng của bạn. Phân biệt phần bạn trực tiếp thiết kế/thực hiện, phần code có sẵn và phần được trợ giúp bởi AI. Không ghi tích hợp thanh toán, 100% coverage, zero downtime hoặc hiệu năng production nếu chưa chứng minh.

## 9. Các cải tiến có thể lấy làm bài tập tiếp theo

| Ưu tiên | Khoảng trống | Điều kiện gọi là hoàn thành |
|---|---|---|
| Cao | Nghiệm thu job browser/axe mới trên GitHub | Run `40806115510` là bằng chứng lịch sử đã đạt trên Linux; release `7a6c039` chưa có kết quả workflow mới đọc được và vẫn cần đối chiếu branch protection |
| Cao | Email recipient thật và deliverability | Cấu hình recipient được studio cho phép, gửi hồ sơ thử, đối chiếu provider/inbox và giữ bằng chứng; không suy ra từ mock mailer |
| Cao | Backup DB + media lên Drive chưa có lịch/monitor được xác nhận | Job chạy thật trên dữ liệu được phép, tuổi snapshot được cảnh báo độc lập, restore drill đạt; phân biệt cron SQL 03:00 trên cùng VPS đã được báo cáo |
| Cao | Duy trì kiểm kê credential sau mỗi lần thay khóa | Khóa Drive thử cũ đã thu hồi 19/10; giữ bằng chứng consumer dùng key mới, key cũ vô hiệu và nơi lưu được cập nhật cho các lần rotate tiếp theo |
| Vừa | Upload chưa có semaphore toàn cục | Đo capacity trước; limit/cancel/timeout có oracle, kiểm nhiều request/process |
| Vừa | Private không password dễ gây hiểu nhầm | Quyết định sản phẩm rõ, copy/UI và test quyền thể hiện đúng ý chủ studio |
| Vừa | Chưa có baseline visual regression chuẩn hóa | Browser/font/viewport/data cố định, cơ chế review ảnh khác, không tự accept mọi diff |

Đây là backlog đề xuất, không phải những thay đổi đã thực hiện. Chọn từng mục theo rủi ro và nhu cầu studio, rồi dùng test để kiểm chứng cải tiến thay vì thêm công cụ chỉ để có tên trong portfolio.

## 10. Từ vựng cần dùng đúng

| Thuật ngữ | Ý nghĩa trong dự án |
|---|---|
| Authentication / Authorization | Ai đang truy cập / người đó được làm gì với album hoặc ảnh nào |
| Hash / Encryption | Hash phục vụ kiểm tra/định danh một chiều; encryption cho phép giải mã bằng khóa |
| Idempotency | Gọi lại cùng một thao tác theo identity đã quy định không tạo thêm tác động nghiệp vụ |
| Transaction | Các thay đổi DB trong phạm vi transaction commit hoặc rollback cùng nhau; không tự bao gồm cloud Storage |
| Outbox / Retry | Lưu ý định công việc bền vững / thực hiện lại; Promise nền không tự thành outbox |
| Optimistic check / Lock | Kiểm phiên bản trước khi chấp nhận trạng thái / phối hợp truy cập đồng thời bằng khóa |
| Eventual consistency | Các phần hội tụ sau một khoảng trễ khi điều kiện xử lý cho phép; không hứa tức thời |
| Contract test / E2E | Kiểm biên giao tiếp / kiểm luồng qua nhiều thành phần; mock contract không xác nhận cloud live |
| SLI / SLO | Chỉ số đo dịch vụ / mục tiêu của chỉ số, cần phạm vi và cửa sổ thời gian |
| RPO / RTO | Mức dữ liệu có thể mất theo thời gian / thời gian khôi phục chấp nhận được |
| Observability | Dữ liệu giúp suy luận trạng thái và nguyên nhân: log, metric, trace; log heartbeat đơn lẻ chưa đủ |
| Test coverage | Phạm vi được kiểm theo một thước đo xác định; số test/file không tự là phần trăm coverage |

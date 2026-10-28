# Prompt rà soát và cải thiện ChiCong Studio

Hãy thực hiện đợt rà soát chuyên sâu project ChiCong Studio hiện tại, trực tiếp sửa lỗi đã có căn cứ, dọn phần dư thừa, cải thiện UI trong phong cách hiện có và củng cố tài liệu. Ưu tiên tính đúng đắn và kiểm chứng; hoàn thành phần có thể tự thực hiện, không dừng ở đề xuất.

## 1. Bối cảnh và phạm vi thực tế

Đây là website nhiếp ảnh có khách truy cập công khai và quản trị viên, không phải công cụ chẩn đoán cá nhân. Stack hiện tại: Node 24, Express 5, HTML/CSS/ES modules thuần, SQLite local hoặc PostgreSQL, media local/Supabase/R2, Sharp, Google Drive, Google Calendar và SMTP. Không có bước build frontend, không tự thêm framework, bundler, lint/typecheck giả hoặc thay kiến trúc chỉ để refactor.

Kiểm kê và đọc theo quan hệ giữa các thành phần:

- `studio/server/`: app/routes, auth/session, DB/schema/migration, album/slug/section, ảnh, selection, ZIP/download, inquiry/calendar/mailer, storage, Drive client/jobs/worker/sync.
- `studio/web/`: public portfolio, slideshow, layout ảnh, inquiry, gallery private/proofing/download, admin, upload và Drive UI; HTML/CSS, font/icon và accessibility.
- `studio/tools/`: chuẩn bị `.ccphoto`, media inventory/backup/verify/restore/migrate, Drive authorize/worker/local preview.
- `studio/tests/`: unit/integration, fixture, browser smoke, benchmark, live smoke và công cụ kiểm tra.
- `scripts/`, `.github/workflows/`, `ecosystem.config.cjs`, `render.yaml`, `.env.example`, manifest và lockfile.
- README, OPERATIONS, HOSTING, handbook, runbooks, specs và archive. Phân biệt tài liệu hiện hành, thiết kế chưa triển khai và bằng chứng lịch sử.
- File cục bộ liên quan chưa được theo dõi; chỉ kiểm kê vai trò của data, backup, output, credential và artifact sinh tự động, không coi chúng là rác để xóa.

Với từng nhóm, ghi rõ đã kiểm kê, đã đọc/phân tích và đã chạy kiểm chứng. Không gọi việc liệt kê file là đã rà soát nội dung. Không khẳng định production đang ở trạng thái nào chỉ từ docs cũ.

## 2. Bảo toàn công việc và dữ liệu

Đọc AGENTS.md áp dụng. Ghi nhận Git status/diff và file untracked trước khi sửa; đọc phần thay đổi có sẵn, kiểm tra lại trước khi chạm file. Phân biệt thay đổi ban đầu với thay đổi của đợt này. Không reset, checkout đè, stash hoặc xóa công việc của người dùng. Khi xung đột ý định thật sự, giữ phần chưa rõ và tiếp tục phần độc lập.

Không commit, push, deploy, gọi SSH production, gửi email thật, cập nhật lịch thật, chạy Drive sync thật, reset admin thật, thực hiện migration/cutover/restore hay xóa dữ liệu thật trong đợt audit. Không chạy `npm run backup:db` vì script đi qua SSH. Không đổi credential hoặc giá trị vận hành trong `.env` để làm test đạt.

Bảo toàn ảnh gốc, metadata, sections, cover, slug/redirect cũ, gallery token/quyền truy cập, lựa chọn và lần gửi của khách, inquiry/ghi chú, job/checkpoint/retry, backup/history/logs. Không thay định dạng dữ liệu hoặc phá tương thích khi chưa có phương án được chấp thuận.

Với website có truy cập công khai, giữ auth, password hashing, quyền media private, kiểm tra Origin/CSRF, validation, rate limit, giới hạn upload/decode, URL/host checks và lease/fencing. Không áp dụng yêu cầu “hiển thị mọi token/credential” của công cụ chẩn đoán khác. API/UI/log công khai không được lộ password hash, cookie, credential Drive/R2/SMTP, thông tin khách hoặc ảnh private. Giữ thông tin lỗi hữu ích trong phạm vi được phân quyền; không đưa secret hay dữ liệu khách vào Git, docs hoặc fixtures.

## 3. Rà soát theo luồng

Lần theo đầu vào → validation/quyền → trạng thái/DB/storage/API → UI/kết quả → cleanup/logs cho:

1. Trang chủ/portfolio/album công khai: lọc và điều hướng, slug/redirect, cover/section, responsive images, SEO/schema và empty/error/loading states.
2. Setup/login/logout admin, session hết hạn, thay đổi cấu hình hợp lệ.
3. Tạo/sửa/trạng thái album, password private, sắp xếp/cover/sections, upload thường và `.ccphoto`, xử lý lỗi từng ảnh và xóa/khôi phục/cleanup.
4. Gallery riêng: link/token/mật khẩu, phân quyền media, chọn/bỏ chọn, đồng bộ nhiều tab, gửi lựa chọn, tải từng ảnh/ZIP và thay đổi quyền khi đang mở.
5. Tư vấn/availability: ngày hợp lệ, timezone, lưu inquiry, email lỗi/disabled, trạng thái lịch và dữ liệu khách.
6. Drive: cấu hình/check connection, browse/preview/count, attach/create album, compare/approve/apply, queue/cancel/retry, worker lease/checkpoint, thay đổi generation, album archived, thu hồi quyền, giới hạn bộ nhớ và bảo toàn ảnh đã nhập.
7. Công cụ chuẩn bị ảnh, backup/verify/restore và local preview; kiểm tra đường đi bằng dữ liệu tổng hợp và storage giả/cục bộ.

Kiểm tra thành công, thiếu/sai đầu vào, rỗng, giá trị dài, dữ liệu nhiều, double submit/concurrency, lỗi dịch vụ, timeout/cancel/retry theo những khả năng thực sự tồn tại. Đối chiếu code, tests, docs và hành vi quan sát được; không mặc định bên nào luôn đúng. Phân biệt lỗi xác nhận, nghi vấn và đề xuất tùy chọn.

## 4. Sửa và dọn có căn cứ

Ưu tiên lỗi mất dữ liệu/quyền riêng tư, luồng chính bị chặn, ổn định và UI gây thao tác sai. Tìm nguyên nhân và kiểm tra các vị trí dùng cùng cơ chế. Không nuốt lỗi, giả thành công, nới assertion hoặc vô hiệu hóa bảo vệ để làm test đạt.

Chỉ xóa/hợp nhất phần có bằng chứng không dùng sau khi kiểm tra import trực tiếp/động, CLI/config, browser entry, CI, tài liệu và peer dependencies. Không xóa font, chứng chỉ, scripts vận hành hay fixture chỉ vì không thấy import JS. Giữ manifest/lockfile nhất quán. Không nâng dependency hàng loạt; chỉ thay khi có lý do và kiểm tra tương thích.

Giữ phong cách giao diện nhiếp ảnh hiện tại. Sửa nhãn, trạng thái rỗng/tải/lỗi, keyboard/focus/dialog, mobile và thao tác lặp khi có vấn đề cụ thể. Không loại chức năng độc lập hoặc thêm chức năng kinh doanh mới như thanh toán/feedback chưa triển khai. Tránh format hàng loạt và tách module chỉ vì kích thước file.

## 5. Tài liệu

Rà soát độc lập toàn bộ tài liệu hiện hành, không chỉ docs của code vừa sửa. README là điểm bắt đầu; handbook/runbook chứa chi tiết, archive giữ nguyên ý nghĩa lịch sử. Kiểm tra lệnh, đường dẫn/liên kết, Node version, prerequisite, tên/default/điều kiện env, local vs production, quy trình backup/restore, nơi dữ liệu được lưu và troubleshooting có căn cứ.

Đối chiếu `.env.example` với code mà không sao chép `.env` thật. Ghi rõ lệnh nào có side effect bên ngoài. Browser QA cần Playwright và Chrome riêng; `npm ci` chưa cung cấp hai công cụ này. Chỉ PostgreSQL test URL riêng mới được dùng cho test tạo/xóa schema.

Kiểm chứng clean install trong thư mục tạm nếu khả thi; không coi lệnh thành công trên máy hiện có là đã xác minh toàn bộ hướng dẫn cài mới. Chỉ tạo docs mới khi có mục đích lâu dài; không sinh nhiều nhật ký audit trùng lặp.

## 6. Kiểm chứng

Đọc script/fixture trước khi chạy. Dùng Node 24 và dữ liệu tạm với `createApp({env: {}, dataDir: ..., seed: false})` hoặc cấu hình test tương đương; không nạp `.env` thật. Các kiểm tra chuẩn:

```sh
npm run check
npm run check:docs
npm test
STUDIO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
```

Chỉ cấp `STUDIO_TEST_POSTGRES_URL` trỏ database test riêng. Suite live/Render/R2/Drive, CLI deploy/backup/migration không tự chạy chỉ vì có file test. Kiểm tra dependency theo phiên bản lock, không coi cảnh báo đơn lẻ là lý do tự nâng mọi thứ.

Bổ sung regression test cho lỗi logic quan trọng và khi khả thi xác nhận test thất bại trước sửa, thành công sau sửa. Không cần test mới cho sửa câu chữ hoặc trình bày đơn giản. Với UI bị ảnh hưởng, chạy trình duyệt thực, kiểm tra desktop/mobile, keyboard, console, trạng thái lỗi/rỗng và thao tác hoàn chỉnh. Test dữ liệu/ảnh phải đối chiếu nội dung/metadata/quyền, không chỉ HTTP status.

Ghi riêng tự động, browser trực tiếp, đọc code và chưa kiểm chứng. Phân loại lỗi có sẵn, lỗi mới, lỗi môi trường và lỗi test. Chỉ công bố cải thiện hiệu năng khi có số đo tương đương trước/sau. Kiểm tra cuối phải áp dụng cho đúng trạng thái bàn giao.

## 7. Hoàn tất và bàn giao

Review toàn bộ diff cuối, bảo toàn thay đổi ban đầu và đối soát mọi phát hiện: đã sửa/kiểm chứng, đã sửa nhưng còn giới hạn, đã loại trừ, chờ quyết định hoặc bị chặn cụ thể. Không dùng báo cáo thay cho sửa vấn đề đã đủ căn cứ và quyền thực hiện. Dừng mở rộng khi không còn vấn đề cụ thể.

Chỉ hỏi khi thiếu quyết định nghiệp vụ, xung đột ý định, nguy cơ mất dữ liệu/phá tương thích, loại khả năng độc lập hoặc cần tác động hệ thống ngoài phạm vi cho phép. Chuẩn bị phương án có thể review trước khi hỏi và tiếp tục phần độc lập.

Báo cáo bằng tiếng Việt: phạm vi và mức độ rà soát; thay đổi của đợt này tách khỏi phần có sẵn; kết quả kiểm tra thực tế; giới hạn/chưa kiểm chứng; vấn đề còn lại và liên kết file quan trọng. Không tuyên bố hết lỗi, đã kiểm toàn bộ hoặc đã triển khai khi không có bằng chứng.

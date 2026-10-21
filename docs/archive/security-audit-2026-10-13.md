# Báo cáo kiểm tra bảo mật — ChiCong Studio

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Ngày: 13/10/2026, giờ Việt Nam. Mã nguồn: `754573d1a4b9d0a8458e8728fecfd613164b0a3a`.
Website đối chiếu: https://chicongphoto.vn. Không xác nhận được commit đang chạy trên hosting chỉ qua HTTP.

**Cập nhật sau audit:** bản vá trong working tree xử lý S-01, S-02 và S-03; C-01 bổ sung cấu hình proxy cùng kiểm thử, còn cần xác minh chuỗi proxy thực tế trước khi đổi cấu hình hosting. Nội dung và bằng chứng dưới đây ghi nhận trạng thái trước bản vá. Xem [biên bản bản vá](security-fixes-2026-10-13.md).

## Kết luận

Chưa phát hiện lỗ hổng Critical/High trong phạm vi đã kiểm tra. Có **hai điểm mức Trung bình cần xử lý**, một điểm tăng cường bảo vệ cho môi trường local, và một cấu hình proxy cần xác minh trên hosting. Mức độ được đánh giá theo tác động và điều kiện khai thác; không phải điểm CVSS được chứng nhận.

Dependency audit không báo lỗ hổng đã biết. Toàn bộ 80 bài kiểm thử hiện có đã chạy thành công qua hai lượt: 79 bài trong lượt mặc định và một bài PostgreSQL chạy riêng trên database tạm. Các probe bổ sung xác nhận bảo vệ API admin, cookie phiên, CSRF, đăng xuất và một số payload injection.

## Phạm vi và phương pháp

- Đọc các đường xử lý backend: xác thực, session, phân quyền album/media, upload, booking, export, database, Storage, email, Google Calendar và HTML/SEO.
- Rà frontend tại các điểm dựng HTML, URL, form và xử lý lỗi; kiểm tra cấu hình triển khai và CI.
- Chạy `npm audit --omit=dev --json`, `npm run check`, `npm test`.
- Chạy test PostgreSQL bằng image `postgres:16-alpine` có sẵn, container/database độc lập rồi dừng và xóa container.
- Quét secret theo mẫu trên 78 file tracked và 165 phiên bản blob trong 17 commit còn truy cập được qua các ref Git. Đối chiếu thêm các secret hiện có trong `.env` mà không in giá trị. Không thấy mẫu credential thực; URL `postgres://...` trong tài liệu là placeholder. Đây không phải quét mọi dạng secret hoặc các object Git đã mất ref.
- Probe local dùng SQLite, ảnh và tài khoản tạm; mail được stub, không nạp `.env`, không đụng `data/live`.
- Production: các request GET/HEAD giới hạn, kiểm tra trang, header, API quản trị không đăng nhập, đường dẫn nhạy cảm và một ảnh portfolio công khai. Không gửi booking/email, thử mật khẩu, đổi album hoặc chạy tải trên website thật.

## S-01 — Cache ảnh kéo dài sau khi chuyển sang riêng tư

**Mức độ: Trung bình.** Hành vi header đã xác nhận cả local và production; cửa sổ cache được suy ra từ quy tắc HTTP. Chưa tái hiện ảnh private bị trả từ CDN thật.

Vị trí: [app.mjs:76](../../studio/server/app.mjs).

Ảnh published có `Cache-Control: public,max-age=3600`, URL media giữ nguyên khi album chuyển sang private/archived. Cache đã giữ phản hồi cũ được phép dùng lại đến hết thời gian fresh mà không hỏi máy chủ. Máy chủ vẫn kiểm tra quyền đúng nếu nhận được request mới.

Bằng chứng local:
1. Tạo album công khai và một ảnh giả; request không đăng nhập nhận 200 với `public,max-age=3600`.
2. Chuyển album thành private.
3. Request mới tới origin trả 404. Tuy nhiên thay đổi này không sửa header của phản hồi đã nằm trong cache.

Bằng chứng production: HEAD một ảnh portfolio trả cùng header; `cf-cache-status: DYNAMIC` tại thời điểm kiểm tra, vì vậy **không kết luận Cloudflare đang giữ ảnh này trong shared cache**. Browser vẫn nhận chỉ dẫn cache một giờ.

Tác động: chức năng ẩn/đổi riêng tư không bảo đảm thu hồi tức thì mọi bản cache của ảnh từng công khai. Không ảnh hưởng theo cùng cách tới ảnh luôn private vì chúng có `private,no-store`. Ảnh người xem đã tải về trước đó không thể thu hồi bằng header.

Đề xuất: với media có thể đổi quyền, yêu cầu revalidation bằng `Cache-Control: private,no-cache` để server kiểm tra quyền mỗi lần tái sử dụng; hoặc `private,no-store` nếu ưu tiên bảo mật hơn cache. Nếu vẫn dùng CDN cache, cần quy trình purge khi đổi quyền. Đổi header hôm nay cũng không tự xóa cache cũ còn fresh. Tham khảo [MDN về Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control).

## S-02 — Gallery không tồn tại vẫn tạo bản ghi rate limit không giới hạn theo IP tổng

**Mức độ: Trung bình, nguy cơ tăng tải/tài nguyên.** Đã tái hiện tạo bản ghi; chưa đo ngưỡng gây chậm hoặc gián đoạn dịch vụ.

Vị trí: [app.mjs:48](../../studio/server/app.mjs), [app.mjs:72](../../studio/server/app.mjs), [db.mjs:24](../../studio/server/db.mjs).

Endpoint unlock tính quota theo `gallery:<id>:<ip>` và ghi database **trước** khi biết gallery có tồn tại. Người chưa đăng nhập có thể đổi ID tùy ý để mỗi request sử dụng một quota mới. Origin header không ngăn client HTTP tự động vì client tự đặt được header này.

Probe local gửi 12 request cho 12 ID không tồn tại, cùng IP: tất cả trả 401 nhưng tạo thêm 12 hàng trong `rate_limits`. Không có quota tổng cho thao tác unlock theo IP trước bước này. Mỗi request còn chạy xóa hàng hết hạn; schema không có index trên `rate_limits.expires`. Khi số hàng tăng, việc dọn dẹp có thể làm tăng chi phí truy vấn. Hàng có TTL 15 phút và được dọn theo request, không phải tích lũy vô hạn theo thời gian nếu việc dọn dẹp hoạt động bình thường.

Đề xuất: thêm quota tổng theo IP cho mọi lần unlock, kiểm tra định dạng ID, chỉ tạo quota riêng cho gallery thực sự tồn tại, thêm index cho `expires` và dọn theo chu kỳ. Kiểm tra định dạng ID một mình chưa đủ vì client vẫn tạo được nhiều ID ngẫu nhiên đúng định dạng. Giữ thông báo lỗi chung để tránh tiết lộ thông tin gallery không cần thiết.

## S-03 — Thiết lập local tin Host tùy ý

**Mức độ: Thấp, chỉ áp dụng local chưa có admin; khai thác trình duyệt chưa được chứng minh.**

Vị trí: [app.mjs:41](../../studio/server/app.mjs), [app.mjs:124](../../studio/server/app.mjs).

Ở nonproduction, kết nối loopback được tạo admin không cần setup token. Kiểm tra Origin cho phép Origin khớp Host do request cung cấp. Probe HTTP đến fixture local với `Host: attacker.example` và `Origin: http://attacker.example` nhận 201 và tạo admin mà không cung cấp token.

Đây là điều kiện thuận lợi cho DNS rebinding khi chủ máy mở website độc hại trong lúc chạy studio local lần đầu. Khả năng khai thác thực tế còn phụ thuộc trình duyệt và cơ chế bảo vệ truy cập mạng local; probe không thực hiện DNS rebinding trong trình duyệt. Trên production, code vẫn bắt buộc setup token; website thật đã có admin (`needsSetup: false`). Không coi đây là bypass tạo admin trên production.

Đề xuất: giới hạn Host/Origin local về các giá trị loopback được cấu hình; cân nhắc yêu cầu token thiết lập cả khi chạy local. Production nên so Origin với danh sách origin cấu hình rõ ràng thay vì fallback tùy Host.

## C-01 — Cần xác minh IP thật sau Cloudflare/Render

**Trạng thái: Chưa đủ bằng chứng để ghi nhận lỗ hổng production.**

Vị trí: [app.mjs:37](../../studio/server/app.mjs), [app.mjs:48](../../studio/server/app.mjs).

Production dùng `trust proxy = 1`; quota dựa vào `req.ip`. Trong fixture mô phỏng production, tám lần login sai với cùng X-Forwarded-For trả 401, lần chín trả 429; thay IP header nhận lại 401. Đây là hành vi mong đợi khi app tin proxy, chưa tự chứng minh attacker bên ngoài thay được IP mà proxy thật chuyển tới app.

Cần kiểm tra proxy cuối có ghi đè/nối X-Forwarded-For đúng hay không, đường truy cập trực tiếp Render, và IP Express nhận có phải IP khách hay IP Cloudflare. Nếu nhận IP Cloudflare, nhiều khách có thể dùng chung quota; nếu tin header attacker điều khiển thì có thể né quota. Chỉ cấu hình trusted proxy sau khi xác minh đường đi thực tế. Tham khảo [Express: behind proxies](https://expressjs.com/en/guide/behind-proxies.html).

## Các biện pháp bảo vệ đã xác minh

| Hạng mục | Kết quả và phạm vi |
|---|---|
| Dependency | npm audit: 0 critical/high/moderate/low; chỉ phản ánh advisory registry tại lúc chạy |
| Kiểm thử | Syntax qua; 79 test mặc định qua; 1 test PostgreSQL chạy riêng qua |
| Admin API | Sáu API quản trị trả 401 trong probe local; export và inquiries thật cũng trả 401 |
| Session | Token ngẫu nhiên, lưu digest; cookie production có HttpOnly/Secure/SameSite=Strict; logout thu hồi token |
| Gallery | Test quyền media, chọn ảnh chéo album và thu hồi phiên khi đổi mật khẩu qua |
| CSRF | Origin khác, rỗng và `null` bị từ chối trong fixture |
| SQL/HTML | Query ứng dụng dùng tham số; probe SQL login bị từ chối; markup album/settings được escape; không có kết luận exhaustive cho mọi payload |
| Upload | Chỉ admin, giới hạn file, kiểm tra nội dung bằng Sharp, encode WebP; test từ chối ảnh giả qua |
| File nhạy cảm | Các đường `.env`, `.git/config`, SQLite, source ZIP, wp-config và traversal thử trên production trả 404 |
| HTTP/TLS | HTTP chuyển 301 sang HTTPS; curl xác thực TLS thành công; CSP/HSTS/nosniff/frame DENY hiện diện |
| Dữ liệu riêng | API no-store, trang admin private/no-store; test ghi chú booking không lộ qua lịch công khai qua |
| Storage/Calendar | Code kiểm tra private bucket; test bucket public bị từ chối; URL Calendar giới hạn host HTTPS và không theo redirect |
| Secret | Không thấy secret theo mẫu và đối chiếu giá trị env trong các Git blob đã kiểm tra; giá trị secret không đưa vào báo cáo |

## Giới hạn

Không truy cập dashboard Render/Cloudflare/Supabase, cấu hình WAF, RLS policy thực tế trên database production, bucket production, log hay bản sao lưu production. Test PostgreSQL kiểm tra migration/RLS flag/concurrency trên container tạm; không chứng nhận toàn bộ quyền các role Supabase đang chạy thật. Chưa có pentest production có xác thực, browser exploit toàn diện, kiểm tra TLS cipher đầy đủ, SAST chuyên dụng như Semgrep, hay kiểm thử tải/DoS. Các GET/HEAD production không xác định chính xác commit triển khai.

Các thư mục WordPress/prototype và file ZIP local không thuộc ứng dụng mới được phục vụ; không audit toàn bộ hệ thống cũ. Quét Git theo mẫu không loại trừ secret kiểu khác hoặc dữ liệu nhạy cảm trong file ignored/backup.

## Bằng chứng và chạy lại

- Probe local (artifact local, ngoài Git: `output/security-audit-repro-2026-10-13.mjs`).
- Kết quả probe JSON (artifact local, ngoài Git: `output/security-probes-2026-10-13.json`).
- HTTP production (artifact local, ngoài Git: `output/security-live-2026-10-13.json`).
- Media/HTTPS production (artifact local, ngoài Git: `output/security-live-media-2026-10-13.json`).
- PostgreSQL test (artifact local, ngoài Git: `output/security-postgres-2026-10-13.txt`).

Chạy từ thư mục gốc repository:
```sh
npm run check
npm test
npm audit --omit=dev
```

Probe gốc trong `output/` (đang gitignored) dành cho commit trước bản vá và cố ý kiểm tra hành vi có lỗi, nên không dùng làm kiểm thử pass/fail cho mã mới. Các ca hồi quy sau bản vá nằm trong `studio/tests/security.test.mjs` và chạy qua `npm test`. Probe gốc chỉ dùng fixture tạm và tự dọn dữ liệu. Đợt audit ban đầu tạo báo cáo và artifact, chưa triển khai thay đổi.

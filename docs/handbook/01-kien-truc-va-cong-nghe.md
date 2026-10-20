# 01 — Kiến trúc và công nghệ ChiCong Studio

**Đối chiếu working tree và biên bản đến 17/10/2026.** Đọc [phạm vi bằng chứng](README.md) trước khi dùng các thông tin này để ra quyết định production.

## 1. Mô hình hệ thống

Website phục vụ ba nhóm việc: giới thiệu studio/portfolio, quản lý album và ảnh, nhận tư vấn và giao gallery cho khách chọn/tải ảnh. Đây là một ứng dụng Node/Express phục vụ cả HTML, static assets và API, với database và object storage bên ngoài khi chạy production.

~~~mermaid
flowchart LR
  U[Khách và Admin] -->|HTTPS| C[Cloudflare: domain và proxy]
  C -->|HTTPS| X[VPS iNET: Caddy]
  X -->|HTTP loopback| R[PM2: Node và Express]
  R -->|SQL qua TLS| D[(PostgreSQL trên Supabase)]
  R -->|Production theo biên bản iNET| S[Supabase private Storage]
  RS[Render staging lịch sử] -->|S3 API, đã diễn tập| O[R2 private: S3 API]
  R -->|HTTPS, gửi email| E[Resend]
  R -.->|Provider thay thế theo cấu hình| M[SMTP]
  R -->|Đọc HTTPS ICS| G[Google Calendar]
  U -->|Beacon trong browser| A[Cloudflare Web Analytics]
  B[Runner backup riêng] --> D
  B --> S
  B -.-> O
  B -->|OAuth và HTTPS| V[Google Drive: bộ backup]
  V --> L[Bộ offline: manifest và blobs]
~~~

**Ranh giới tin cậy:** browser gửi yêu cầu nhưng không được cầm database password, service-role key, R2 secret hoặc OAuth refresh token. Express xác thực phiên và quyền truy cập rồi mới lấy ảnh/ghi dữ liệu. Runner backup có quyền khác với web runtime. Cloudflare proxy không thay thế kiểm tra quyền ở ứng dụng.

Database lưu bản ghi: album, tên object, lựa chọn, yêu cầu tư vấn. Storage lưu bytes ảnh. Có DB mà thiếu file thì gallery có danh sách nhưng ảnh hỏng; có file mà thiếu DB thì mất quan hệ album, trạng thái và lựa chọn. Git lưu source, không tự sao lưu hai phần này.

## 2. Danh mục dịch vụ và các kết nối

| Thành phần | Vai trò và kết nối | Credential/cấu hình | Mức xác minh |
|---|---|---|---|
| VPS iNET, Caddy, PM2, systemd | Caddy proxy vào Node/Express; PM2 quản lý web process | SSH/vault, Caddyfile, ecosystem.config.cjs, env VPS | REPORT iNET 16/10 và workflow 17/10; chưa kiểm live trong lần cập nhật này |
| Render Web Service | Hạ tầng cũ và rehearsal R2 lịch sử; render.yaml vẫn có trong repo | Env và Blueprint nếu tái sử dụng Render | Biên bản ghi đã xóa web production cũ; không suy mọi resource staging đã bị xóa |
| Cloudflare DNS/proxy | Nhận HTTPS cho chicongphoto.vn, proxy đến origin | DNS record, custom domain, TLS mode | LIVE thấy header Cloudflare; chưa kiểm dashboard DNS/TLS |
| Cloudflare Web Analytics | Browser tải beacon và gửi telemetry | CF_BEACON_TOKEN, ANALYTICS_ENABLED | CODE + LIVE có beacon; token là mã nhận diện công khai, không phải quyền quản trị |
| Supabase PostgreSQL | Backend dùng pg.Pool qua SQL/TLS | DATABASE_URL và CA | CODE; health live truy vấn DB, không công bố version/project từ endpoint |
| Supabase Storage | REST /storage/v1, bucket private; backend proxy ảnh | SUPABASE_URL, SUPABASE_BUCKET, SUPABASE_SERVICE_ROLE_KEY | CONFIG baseline; không dùng Supabase SDK cho adapter này |
| Cloudflare R2 | Adapter object storage tương thích S3, region auto | R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY | CODE + REPORT: bucket staging private và Render staging đã diễn tập; production chưa cutover |
| Resend | Backend POST HTTPS tới api.resend.com/emails | RESEND_API_KEY, EMAIL_FROM, NOTIFICATION_EMAIL | CODE + CONFIG; chưa thử deliverability lần này |
| SMTP | Provider email thay thế theo cấu hình | SMTP_HOST/PORT/USER/PASS/SECURE | CODE; không phải failover tự động từ Resend |
| Google Calendar | Backend đọc private ICS qua HTTPS, một chiều | GOOGLE_CALENDAR_ICS_URL, GOOGLE_CALENDAR_INCLUDE_FREE | CODE; không phải OAuth Calendar, không ghi event ngược về Google |
| Google Cloud OAuth + Drive API | Runner đổi refresh token lấy access token, đọc/ghi backup | BACKUP_DRIVE_* | CODE + REPORT với dữ liệu giả; không đưa credential runner vào web |
| Google Drive Sync + service account | Worker riêng đọc folder ảnh bằng drive.readonly, tạo rendition vào kho website | DRIVE_SYNC_*, file key ngoài DB; khác identity OAuth backup | CODE + REPORT local/Linux cách ly; worker production chưa bật |
| GitHub | Source, pull request và CI qua GitHub Actions | Quyền repository; environment secrets nếu dùng workflow backup | CODE workflow; chưa kiểm quyền/settings repository |
| npm registry | Tải dependency khi cài/build | package-lock.json và quyền registry nếu có | CODE; không phải mỗi lượt xem web đều gọi npm |
| Máy Mac, Lightroom/ảnh xuất | Chuẩn bị nội dung và chạy công cụ .ccphoto | File nguồn, quyền ổ đĩa | Công cụ chuẩn bị ảnh có trong repo; Lightroom nằm ngoài runtime website |
| Nhà đăng ký tên miền | Gia hạn domain và quản lý nameserver cấp cao | Tài khoản registrar, 2FA/recovery | Chưa xác định nhà cung cấp; Cloudflare DNS không chứng minh Cloudflare là registrar |

Các trường Facebook/Zalo/điện thoại là liên kết liên hệ; chưa có bằng chứng dùng API nhắn tin, gửi SMS hoặc thanh toán. PostgreSQL trên Supabase không có nghĩa ứng dụng dùng Supabase Auth, Realtime hay Edge Functions. AWS SDK dùng cho giao thức S3 của R2, không chứng minh đang thuê AWS S3.

## 3. Dependency, runtime và công cụ

Chín dependency trực tiếp dưới đây lấy từ [package.json](../../package.json) và [package-lock.json](../../package-lock.json). Đây là phiên bản khóa trong source, chưa phải inventory process production. Dependency gián tiếp theo cây lockfile; không cần gọi từng package con là một dịch vụ độc lập.

| Dependency | Version trong lockfile | Vai trò |
|---|---|---|
| express | 5.2.1 | HTTP routing, middleware, static assets |
| multer | 2.4.0 | Multipart upload vào memory buffer |
| sharp | 0.35.5 | Decode, xoay, resize, màu và encode ảnh; dùng libvips |
| yazl | 3.3.1 | Tạo ZIP từ file tạm qua stream |
| pg | 8.23.1 | Driver PostgreSQL, pool và transaction |
| node-ical | 0.27.3 | Parse iCalendar và sự kiện lặp |
| nodemailer | 10.0.16 | Gửi email qua SMTP |
| @aws-sdk/client-s3 | 3.1152.0 | Adapter R2 qua S3 API |
| google-auth-library | 11.3.1 | Xác thực service account cho Drive Sync chỉ đọc |

- Node yêu cầu >=22.13.0; Blueprint/CI chọn 24. Native ES modules và các module crypto, fs, path, stream, sqlite, test, assert được sử dụng trực tiếp.
- Local dùng node:sqlite DatabaseSync với WAL và foreign_keys=ON; source bọc hàng đợi để tránh request khác chen vào transaction trên cùng connection. PostgreSQL dùng pool tối đa 3 connection **mỗi pool/process**, timeout kết nối 15 giây.
- Không có ORM hoặc framework frontend trong dependency trực tiếp. HTML/CSS/JavaScript được phục vụ trực tiếp, không có pipeline Vite/Webpack trong scripts hiện tại.
- Playwright và axe có trong mã kiểm thử nhưng không được khai báo dependency/devDependency hiện tại. Chúng được cung cấp qua module ngoài; cài npm ci một mình không làm browser suite sẵn sàng.
- Docker postgres:16-alpine trong CI cung cấp DB dùng một lần. Không suy ra app production chạy Docker hoặc DB production là PostgreSQL 16.

## 4. Frontend, SEO và trải nghiệm

| Nhóm | Cơ chế hiện có | Ý nghĩa với người dùng và QA |
|---|---|---|
| Cấu trúc frontend | bootstrap.js, main.js và ES modules theo chức năng | Kiểm cả tải lần đầu, chuyển trang, retry và response về muộn |
| Layout | CSS variables, Grid, Flexbox, responsive CSS | Kiểm viewport, zoom, nội dung dài, ảnh dọc/ngang |
| Font | Cormorant Garamond WOFF2 tự host, OFL | Không cần tải font từ Google Fonts cho các font này; vẫn kiểm glyph tiếng Việt và font fallback |
| SEO HTML | Server chèn nội dung ngữ nghĩa và JSON page-data | HTML có nội dung cho crawler, nhưng root còn hidden cho tới khi JS bootstrap thành công; không phải React hydration |
| SEO metadata | Canonical, Open Graph, JSON-LD Schema.org, sitemap động, robots | Kiểm URL/slug, dữ liệu công khai và không đưa gallery riêng vào sitemap |
| Slug | Chuẩn hóa tiếng Việt và lưu album_slugs để redirect | Đổi tiêu đề không làm mất link cũ nếu lịch sử được giữ trong backup |
| Resource hints | Image preload, fetchpriority, modulepreload và responsive image sources | Hint là gợi ý cho browser; cần đo tải thực để chứng minh LCP |
| Hiệu ứng | Pointer Events/capture, image.decode, Web Animations, IntersectionObserver | Kiểm swipe, ảnh lỗi/chậm, nhấn nhanh, hủy thao tác; decode không cam kết tuyệt đối hết giật |
| Trợ năng | dialog, keyboard/focus, aria, prefers-reduced-motion | Axe chỉ kiểm phần tự động hóa; vẫn phải kiểm bàn phím và đọc màn hình |
| Upload | XMLHttpRequest progress, queue/retry/report | % bytes đã gửi không bằng đã encode, lưu object và commit DB |
| Download | Fetch Streams, AbortController, Blob/object URL | Theo dõi bytes và hủy được; browser vẫn cần RAM cho toàn bộ Blob |

Nguồn: [studio/web](../../studio/web), [SSR/SEO trong app.mjs](../../studio/server/app.mjs), [schema-org.mjs](../../studio/server/schema-org.mjs), [album-slugs.mjs](../../studio/server/album-slugs.mjs).

## 5. Từ điển dữ liệu

Working tree hiện có **17 bảng nền + 11 bảng Drive lâu dài**; `drive_comparison_cache` được khởi tạo khi cần và không thuộc snapshot media. Bảng dưới đây mô tả 17 bảng nền; 11 bảng mới và revisions được giải thích trong [bản cập nhật 17/10](04-cap-nhat-du-an-2026-10-17.md). Schema ở [db.mjs](../../studio/server/db.mjs), [drive-schema.mjs](../../studio/server/drive-schema.mjs) và [album-slugs.mjs](../../studio/server/album-slugs.mjs); chưa xác nhận toàn bộ đã có trên production.

| Bảng | Nội dung/khóa quan trọng | Điều cần giữ khi test và restore |
|---|---|---|
| settings | key/value; nội dung studio, tuyển chọn ảnh, portrait | Portrait có thể tham chiếu object riêng ngoài photos |
| admins | id, email unique, password hash | Không thể khôi phục mật khẩu gốc từ hash; reset là đặt mật khẩu mới |
| sessions | token digest, admin_id hoặc album_id, expires | Admin 12 giờ; gallery 7 ngày; restore phải xử lý phiên cũ |
| albums | id, slug, status, password, cover_id, selection_status | Phân biệt draft/published/private và private có/không password |
| album_sections | id, album_id, title, position | Xóa phần không được làm mất ảnh ngoài ý muốn |
| album_slugs | slug → album_id | Lịch sử redirect, không được bỏ qua khi backup |
| photos | id, album_id, filename, original, section_id, dimensions, byte counts | filename không nhất thiết bằng id sau overwrite; original là tên file nguồn |
| selections | khóa kép album_id + photo_id, updated | Không chọn ảnh của album khác; không nhân đôi cùng lựa chọn |
| photo_upload_receipts | album_id + upload_key, file_hash, result | Retry cùng key/nội dung phải tái dùng kết quả; key không phải checksum |
| photo_cleanup | photo_id, filename, has_download | Job xóa file phải bền vững qua restart; không xóa tay để che lỗi |
| inquiries | dữ liệu tư vấn, status, date, request_key/hash | Một ngày không có hai đơn confirmed nhờ partial unique index |
| blocked_dates | date, note | Ngày khóa nội bộ độc lập với Calendar ngoài |
| rate_limits | digest của scope+IP, count, expires | Không nhầm mỗi gallery với mọi người dùng; IP/proxy ảnh hưởng quota |
| media_control | storage identity, lease owner/deadline, generation | Ràng buộc DB với đúng kho; không đổi provider tùy ý |
| media_writers | id, process_id, kind, started | Theo dõi writer đang chạy để drain an toàn |
| media_writes | object key, storage, sha256, bytes, state | Journal ghi storage, phát hiện kết quả ghi chưa rõ |
| backup_runs | id, created, state, manifest_hash, detail | Phân biệt running/complete/failed; không coi file bất kỳ là backup tốt |

RLS được enable cho các bảng PostgreSQL trong migration, nhưng code này không định nghĩa policy cho khách hoặc FORCE RLS. Bảo vệ qua RLS còn phụ thuộc role/quyền thực tế. Service-role Storage và kết nối DB đặc quyền phải ở server; việc cho phép một request vẫn phụ thuộc logic xác thực ứng dụng.

Một invariant có giá trị hơn câu “DB đúng”: **mọi ảnh đang tham chiếu trong snapshot phải có đúng các object mà snapshot yêu cầu, đúng số byte/checksum; selection chỉ trỏ tới ảnh thuộc album đó; phiên cũ không được sống lại sau restore.**

## 6. Các luồng cần hiểu từ đầu đến cuối

Sáu luồng nền bên dưới được bổ sung bởi luồng **Drive → preview → approval → worker ingest → gallery** trong [bản cập nhật](04-cap-nhat-du-an-2026-10-17.md). Giới hạn upload tay không áp dụng nguyên xi cho JPEG Drive.

### 6.1. Xem portfolio và album công khai

Browser yêu cầu trang → Cloudflare → Express tìm album/slug → DB trả nội dung → server tạo HTML, metadata và page-data → browser tải JS/ảnh → route media xác nhận quyền rồi đọc object.

Tên ảnh hoặc URL media không phải quyền truy cập. Dù browser có cache, request mới vẫn cần xử lý đúng khi album đổi trạng thái. Header private/no-cache cho phép lưu cache riêng nhưng yêu cầu revalidation; không đồng nghĩa no-store và không bảo đảm mọi ảnh đều được CDN cache. Báo cáo live chỉ thấy homepage DYNAMIC và robots REVALIDATED, không chứng minh chính sách toàn bộ assets.

**Oracle QA:** album draft/private không lộ trong dữ liệu công khai, slug cũ redirect về slug đúng, canonical không trỏ sai domain, ảnh và nội dung tương ứng cùng album. Kiểm cả HTML response ban đầu và DOM sau JS.

### 6.2. Upload ảnh

Admin đăng nhập → chọn file → client gửi multipart và upload key → server xác thực/rate/security → Multer nhận buffer → kiểm receipt/hash → encode ảnh thường hoặc parse/kiểm .ccphoto → ghi storage → ghi DB và receipt → trả kết quả → client cập nhật UI.

Ảnh thường được tạo thành ba rendition: WebP cạnh dài tối đa 2400/q88, thumb WebP 900/q80, JPEG 2400/q92/chroma 4:4:4. Resize không phóng to ảnh nhỏ. Encoder xử lý orientation/màu; JPEG có nền trắng cho ảnh có alpha. Ba lượt encode hiện chạy lần lượt từ source. Website **không giữ file RAW hoặc JPEG nguồn nguyên bản** trong luồng chuẩn; cần kho ảnh gốc riêng.

.ccphoto là container nội bộ, không phải định dạng mã hóa bảo mật: magic CCPHOTO\0, header-length uint32 big-endian, JSON header có version/tên nguồn/hash/metadata và các phần binary. Hash dùng kiểm toàn vẹn và nhận diện nội dung; không phải chữ ký của nhiếp ảnh gia. Server vẫn cần validate file. Không suy ra tỷ lệ tiết kiệm chung từ một ảnh giả hoặc một album.

**Oracle QA:** retry cùng key/cùng nội dung không tạo thêm photo; cùng key nhưng nội dung khác không âm thầm được coi là cùng ảnh; lỗi storage không để record thành công thiếu file; overwrite không làm selection/cover sai và file cũ được dọn theo chính sách. Xem [photo-upload.mjs](../../studio/server/photo-upload.mjs), [prepared-photo.mjs](../../studio/server/prepared-photo.mjs).

### 6.3. Xóa ảnh và dọn file

Thay đổi DB được kết hợp ghi photo_cleanup trong transaction → ảnh biến mất khỏi danh sách → worker trong process app xóa object → thành công thì xóa job, lỗi còn job để thử lại.

Đây là hàng đợi dọn file bền vững trong DB theo cách làm gần với transactional outbox. Không có Redis/BullMQ/Render background worker riêng trong luồng này. Worker ngừng khi process ngừng/ngủ; “eventual” không có nghĩa trong một khoảng thời gian đảm bảo nếu không có worker hoạt động.

**Oracle QA:** DB không còn ảnh nhưng job còn khi storage lỗi; chạy lại cleanup sau khi phục hồi phải xóa file và kết thúc job; thực hiện lại không làm hỏng dữ liệu khác. Không gọi email fire-and-forget là cùng một mẫu outbox này. Xem [photo-deletion.mjs](../../studio/server/photo-deletion.mjs).

### 6.4. Gallery riêng và chọn ảnh từ nhiều thiết bị

Gallery private có password cần phiên hợp lệ → cookie HttpOnly giữ token → API kiểm album và ảnh → selection ghi trong transaction → server trả trạng thái/version → UI cập nhật và polling/refetch để nhận thay đổi.

Có hash version để nhận diện dữ liệu cũ và lock transaction để giải quyết tranh chấp: PostgreSQL dùng FOR UPDATE tại các thao tác cần khóa; SQLite dùng BEGIN IMMEDIATE và hàng đợi connection. Đây là sự phối hợp kiểm phiên bản và khóa ghi, không nên gộp thành “chỉ optimistic locking”. Polling có độ trễ; không có cam kết realtime tức thời.

**Oracle QA:** response album A về muộn không ghi đè album B; request chọn ảnh đã bị xóa không hồi sinh lựa chọn; reload/thiết bị khác hội tụ về trạng thái server; password đổi làm phiên liên quan hết hiệu lực theo hành vi code. Gallery không password phải có test riêng phản ánh quyền truy cập bằng link. Xem [gallery-selection.mjs](../../studio/server/gallery-selection.mjs), [admin-proofing.mjs](../../studio/web/admin-proofing.mjs).

### 6.5. Tải ảnh đơn hoặc ZIP

API xác thực trước khi tiết lộ thông tin ảnh → kiểm danh sách/chọn ảnh → giữ slot → đọc JPEG có sẵn hoặc tạo JPEG từ WebP đời cũ → ghi file tạm → nhiều ảnh thì tạo ZIP vào file tạm → kiểm tra lại trạng thái liên quan → trả file và dọn tài nguyên.

Yazl dùng stream để không gom toàn bộ ZIP thành một buffer server, nhưng adapter đọc từng ảnh vào buffer và server cần đĩa tạm. Browser đọc stream thành chunks rồi Blob, nên tải 100 MiB vẫn có chi phí RAM đáng kể. Tải một ảnh kiểm JPEG signature; tải ZIP phải kiểm nội dung ZIP/giải nén, không dùng chữ ký JPEG.

**Oracle QA:** 401 khi phiên hết hạn, 409 khi selection thay đổi, 429 khi slot bận, filename an toàn, bytes đầy đủ, giải mã/giải nén được, hủy tải giải phóng slot và thư mục tạm. Xem [server download](../../studio/server/gallery-download.mjs), [client gallery download](../../studio/web/gallery-download.mjs), [client photo download](../../studio/web/photo-download.mjs).

### 6.6. Gửi yêu cầu tư vấn

Validate/honeypot/rate guard → nhận requestKey và hash dữ liệu → tìm bản ghi retry → nếu có ngày thì kiểm Calendar và lịch nội bộ → áp quota đơn hợp lệ → INSERT → trả reference → gửi email bất đồng bộ.

Calendar dùng cache 5 phút, timeout fetch 10 giây, giới hạn feed 5.000.000 byte. Nếu feed cấu hình nhưng unavailable hoặc ngoài phạm vi đã kiểm, assertAvailable từ chối ngày với 409. Gửi không có ngày có thể tiếp tục. Đây là lựa chọn fail closed cho tính đúng của lịch.

Mailer ưu tiên Resend nếu có key, nếu không mới xét SMTP. App không chờ email trước khi trả thành công; code gửi thông báo studio rồi xử lý email khách, không phải hai email luôn chạy song song. Không có durable email outbox/retry trong phần này. App restart ngay sau insert có thể làm mất thông báo trong khi đơn vẫn còn DB. Resend chấp nhận request cũng chưa đồng nghĩa email đã vào inbox.

**Oracle QA:** một requestKey không tạo hai đơn; same key/different payload bị từ chối; ngày bận không được nhận như ngày trống; email lỗi không làm mất đơn đã commit; hai thao tác confirm cùng ngày không cùng thành công. Xem [app.mjs](../../studio/server/app.mjs), [mailer.mjs](../../studio/server/mailer.mjs), [google-calendar.mjs](../../studio/server/google-calendar.mjs).

## 7. Bảo mật và giới hạn vận hành trong code

| Cơ chế | Hiện trạng và giới hạn |
|---|---|
| Password | scryptSync, salt ngẫu nhiên 16 byte, output 64 byte, lưu salt:hash; không lưu plaintext để “xem lại” |
| Session | Token ngẫu nhiên 32 byte; DB giữ SHA-256 digest; cookie HttpOnly, SameSite Strict, Secure trong prod |
| Origin/Host | Middleware kiểm nguồn request ghi và Host local; TRUST_PROXY=true bị từ chối; hop/IP phải phù hợp topology thật |
| HTTP headers | CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy; kiểm header không thay pentest |
| SQL | Giá trị qua parameter binding; migration và dynamic identifier phải được kiểm riêng |
| CSV | Quote/escape cell và prefix một số ký tự công thức; UTF-8 BOM hỗ trợ tiếng Việt; test cả whitespace/control character và ứng dụng mở file |
| Upload input | Tối đa 20 MiB/file, 40 megapixel, 8 file/request; JPEG/PNG/WebP tĩnh và prepared theo validator |
| Memory upload | Multer memoryStorage; 8 × 20 MiB chỉ là buffer đầu vào có thể có, chưa gồm encode/runtime; giới hạn một request không giới hạn tổng request đồng thời |
| Rendition storage | derivedFileSizeLimit 24 MiB là giới hạn trong adapter/cấu hình bucket, không phải quota tài khoản Supabase |
| ZIP | Tối đa 50 ảnh, 100 MiB; timeout xử lý 180 giây; 2 slot/process, 1 lượt/album/process |
| Rate limit | Cửa sổ 15 phút, khóa từ scope + req.ip; admin login 8; gallery outer attempt 60, password theo gallery+IP 8; inquiry outer 60, đơn hợp lệ 5 |
| Cleanup rate limits | Dọn cơ hội trong request, tối đa một lần/phút/process; không phải cron độc lập mỗi phút |
| Health | Chỉ query DB, chưa kiểm media, SMTP/Resend, Calendar hoặc tuổi backup |

Đây là giới hạn **ứng dụng**. RAM/CPU/disk VPS hoặc plan hosting, quota storage/egress/API, giá dịch vụ, pause policy và tuổi token thuộc **nhà cung cấp**; cần đọc dashboard/chính sách tại thời điểm vận hành. Số 3 connection là cấu hình pool ứng dụng, không phải toàn bộ quota Supabase.

## 8. Trạng thái R2 sau giai đoạn staging

Biên bản tại [kế hoạch R2, mục 17](../r2-implementation-plan.md#17-triển-khai-và-kiểm-chứng-cloud-ngày-16102026) ghi nhận bốn lớp bằng chứng: R2 local với bucket staging (9/9 bước), Drive với dữ liệu giả (5/5 bước), Render staging với PostgreSQL/R2 riêng (HTTP smoke, redeploy và cleanup), cùng rehearsal backup/restore, binding R2 → local → R2, ảnh lớn và client-abort/retry. Rehearsal binding dùng schema PostgreSQL cô lập và dữ liệu tổng hợp; không có bước nào là cutover dữ liệu hay biến môi trường production.

| Đã có | Còn phải làm trước production |
|---|---|
| R2 private, adapter S3, dữ liệu giả, retry/overwrite, media private, backup/restore, cleanup và rehearsal binding R2 → local → R2 trên staging | Inventory/quota production; migration Supabase → R2 toàn kho và delta cuối; rehearsal đa instance trên cloud; tập ảnh khách đại diện; R2 PUT timeout/ghi muộn; cửa sổ vận hành và người chịu trách nhiệm |
| Render staging tách DB, bucket và credential; Node 24; noindex/analytics tắt | Xác minh env/commit production thực tế và cập nhật cả Blueprint khi chuyển provider |
| Client upload bị ngắt vẫn giữ writer, retry dùng receipt; một ảnh tổng hợp khoảng 11 MiB đã được thử trên Render | Đo giới hạn tải với tập ảnh khách đại diện và xác minh deadline ở tầng provider, không chỉ HTTP abort |

Vì vậy cách gọi chính xác là **R2 đã hoàn thành staging validation**, không phải “R2 production đã hoàn thành”.

## 9. Mô hình hỏng để QA và chủ website cùng hiểu

| Chỗ hỏng | Dấu hiệu có thể thấy | Cách phân biệt |
|---|---|---|
| DNS/TLS/Cloudflare | Không vào site hoặc lỗi trước app | So sánh DNS, certificate, request domain/origin được phép; xem log có nhận request không |
| VPS/Caddy/PM2 | 5xx/restart/không tới app | Caddy/systemd/PM2 log, CPU/RSS/disk; phân biệt proxy với process Node |
| DB | Health 503, thao tác metadata lỗi | Lỗi kết nối/TLS/pool; không sửa bucket để chữa DB |
| Storage | Danh sách có nhưng ảnh lỗi, upload không xong | Media request, object key/provider, checksum, lỗi 403/404/timeout |
| Calendar | Site vẫn mở, chọn ngày bị từ chối | Trạng thái unavailable và thời điểm sync, không đồng nhất với “ngày đã bận” |
| Email | Đã có reference nhưng không có thư | Tìm inquiry trước; kiểm provider log/deliverability; tránh tạo đơn trùng để thử |
| Backup runner/Drive | Website vẫn chạy nhưng mất khả năng phục hồi | Tuổi snapshot complete, refresh token, checksum và restore drill |

Điều nên học từ dự án là khả năng xác định **ranh giới thành công**. HTTP 201 của inquiry chứng minh lưu đơn theo code, không chứng minh gửi email. Upload progress 100% chứng minh gửi bytes, không chứng minh DB commit. Backup complete phải đi cùng manifest và verify; restore thành công phải được xác nhận bằng nghiệp vụ.

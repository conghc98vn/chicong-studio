# Kế hoạch feedback sau bàn giao — ChiCong Studio

Ngày: 15/10/2026. Phiên bản: **v0.2 — đã review lại thiết kế**, chưa triển khai tính năng. Xem [biên bản xác minh](customer-feedback-plan-review-2026-10-15.md) để phân biệt bằng chứng đã kiểm tra với tiêu chí còn phải kiểm thử.

## 1. Phạm vi người dùng đã chốt

- Bàn giao kết hợp gallery trên website và Drive/kênh ngoài.
- Đợt đầu chỉ thu thập nội bộ.
- Một feedback chung cho mỗi đơn/buổi chụp, có thể liên quan nhiều gallery.
- Studio tự đánh dấu “Đã bàn giao đầy đủ”; chưa cần checklist sản phẩm.
- Studio sao chép link để gửi qua Zalo/tin nhắn; chưa cần gửi email mời.

Chỉ năm mục trên đã được người dùng chốt. Các lựa chọn về trường form, thời hạn link, quyền sửa và thiết kế kỹ thuật bên dưới là đề xuất đã qua review, chưa phải xác nhận triển khai. Không mở rộng sang công khai testimonials hoặc email trong lần sửa kế hoạch này.

## 2. Kết quả rà soát hiện trạng

Review dựa trên working tree đang có thay đổi gallery/proofing chưa commit. Đã đọc code và chạy 30 kiểm thử nền hiện có trên database/thư mục tạm: 30 đạt, 0 lỗi, 0 bỏ qua. Các migration chạy trong test chỉ áp dụng database tạm. Chưa chạy tính năng feedback, PostgreSQL, browser hoặc production trong lượt này; không sửa code ứng dụng. Tham chiếu dùng tên hàm/route vì số dòng đang dịch chuyển.

| Hiện trạng | Bằng chứng | Hệ quả cho thiết kế |
| --- | --- | --- |
| Express + JavaScript modules; SQLite local và PostgreSQL cloud | `package.json`; `studio/server/db.mjs`, `openDatabase` | Migration và test cho cả hai database |
| Album và inquiry chưa có quan hệ | `db.mjs`, DDL `albums`/`inquiries` | Không tự ghép khách theo tên hoặc tự tìm email từ album |
| Album status là quyền hiển thị; selection status là chọn ảnh | `db.mjs`; `studio/web/ui-copy.mjs` | Cần trạng thái bàn giao độc lập |
| Inquiry completed chỉ cập nhật nghiệp vụ tư vấn/lịch | `app.mjs`, `PATCH /api/admin/inquiries/:id` | Không dùng completed để tự mở feedback |
| Gallery có thể không mật khẩu, quyền xem chung theo album | `app.mjs`, `allowed`, `GET /api/gallery/:id` | Người xem gallery chưa chắc là người đại diện được mời |
| Tên khách chỉ thuộc DTO admin | `app.mjs`, `albumDTOs`; `performance.test.mjs` | Tự điền tên qua lời mời đã xác thực |
| Gallery dựng lại DOM khi đồng bộ/lọc | `main.js`, `refreshSharedSelection`, action `selected-only` | Form có lifecycle riêng, giữ bản nháp |
| Có rate limit DB, Origin, request key chống trùng | `app.mjs`, `rate`, `POST /api/inquiries`; `request-security.mjs` | Tái dùng mẫu có điều chỉnh, không gọi helper dùng `db` trong `tx` |
| Mailer Resend/SMTP hiện best-effort | `app.mjs`, `notifyNewInquiry`; `mailer.mjs` | Không cần email/outbox/worker trong MVP |
| Có navigation và guard kết quả admin đến trễ | `main.js`, `views`, `refreshAdmin`, `adminNavigation` | Nối mục Cảm nhận và bảo vệ chuyển hồ sơ |
| Export đọc tuần tự nhiều bảng ngoài transaction | `app.mjs`, `GET /api/admin/export` | Không coi JSON hiện tại là snapshot database nhất quán |

Working tree hiện chạm tim tự lưu; tài liệu cũ còn nói về nút “Gửi lựa chọn”. Số ảnh chọn, tải JPG/ZIP và trạng thái chọn ảnh đều không xác nhận đã giao đủ sản phẩm. Ảnh tải trên website cũng không thay thế việc bàn giao nguồn độ phân giải đầy đủ ở kênh khác.

## 3. Mô hình nghiệp vụ đề xuất

Tạo một **hồ sơ bàn giao nhẹ** cho mỗi đơn/buổi chụp. Hồ sơ giữ tên khách, tên buổi chụp/dịch vụ, ngày chụp tùy chọn, ngày bàn giao và các gallery liên quan. Đây là ngữ cảnh cho feedback; không mở rộng thành quản lý hợp đồng hoặc thanh toán.

- Một hồ sơ liên kết 0–N gallery; hỗ trợ khách chỉ nhận ảnh qua Drive.
- Liên kết inquiry là tùy chọn; khách đến từ Zalo không cần tạo inquiry giả.
- Một hồ sơ có tối đa một feedback hiện hành. Khách sửa là cập nhật bản này.
- Tạo hồ sơ từ mục Cảm nhận hoặc từ chi tiết gallery admin; chọn gallery khác bằng thao tác rõ ràng.
- Nếu gallery đã thuộc hồ sơ, ưu tiên mở hồ sơ đó. Cảnh báo hồ sơ có tên/ngày giống nhau để tránh tạo trùng; không coi tên khách là khóa duy nhất.
- Đề xuất thay quy tắc mơ hồ “một hồ sơ đang dùng” bằng **mỗi gallery có tối đa một liên kết hiện hành**, kể cả hồ sơ lưu trữ. Dùng `UNIQUE(album_id)` trên bảng liên kết; lưu trữ không tự giải phóng liên kết. Sửa gán nhầm là gỡ/gán rõ ràng trong transaction, không tự chuyển khi tìm thấy tên giống nhau.
- Tìm/cảnh báo trùng phải bao gồm hồ sơ lưu trữ. Unique feedback/hồ sơ không bảo đảm tuyệt đối một feedback/đơn ngoài đời nếu admin tạo hai hồ sơ khác nhau; chưa có entity đơn hàng để cưỡng chế điều đó. UI giúp nhận diện và dùng lại hồ sơ cũ, không tự gộp dữ liệu.
- Sau khi đã cấp link, hồ sơ không được tái sử dụng cho khách hoặc buổi chụp khác. Sửa lỗi chính tả/ngày của cùng buổi được phép; đổi đối tượng phải tạo hồ sơ mới. Không tự đồng bộ tên/ngữ cảnh từ inquiry hoặc gallery. Lần gửi đầu lưu snapshot ngữ cảnh vào feedback; sửa hồ sơ không sửa tên hoặc lời khách đã gửi.
- Phân biệt ngày bàn giao thực tế `delivered_on` với thời điểm admin xác nhận `delivery_confirmed_at`. Ngày thực tế/ngày chụp có thể ở quá khứ; không dùng validator inquiry yêu cầu ngày tương lai. Sửa ngày không tự gia hạn link. Hiển thị ngày theo Asia/Ho_Chi_Minh, lưu timestamp thao tác theo UTC.

Ví dụ: “An & Bình — Ngày cưới” liên kết gallery lễ và gallery tiệc. Sau khi giao đủ ảnh qua website/Drive và các sản phẩm đã thỏa thuận, studio đánh dấu hoàn tất. Khách nhận một link để phản hồi chung cho trải nghiệm này.

## 4. Hành trình và các màn hình

**Admin tạo hồ sơ → đánh dấu Đã bàn giao đầy đủ → sao chép link → gửi riêng qua Zalo → khách gửi cảm nhận → studio đọc trong admin.**

### Admin

Mục **Cảm nhận** có danh sách hồ sơ, tìm theo tên khách/buổi chụp, lọc chưa bàn giao/đang nhận/đã có phản hồi/đã đóng và chưa đọc/đã đọc. Tổng quan có số phản hồi chưa đọc.

Chi tiết hồ sơ gồm thông tin bàn giao, gallery liên quan, link mời, cảm nhận và ghi chú riêng. Admin không sửa lời khách. Thao tác thường dùng là bàn giao, copy và đọc; gia hạn/thu hồi/lưu trữ nằm trong menu phụ để giao diện không thành một bảng điều khiển nhiều nút.

Tách bốn trục trạng thái: bàn giao (`draft/delivered`, kèm cờ lưu trữ), lời mời (`unissued/active/paused/revoked`, hết hạn tính từ thời gian), phản hồi (chưa có/đã có), đọc (`read_version < version` là chưa đọc). Không dùng một dropdown trộn cả bốn trục.

| Thao tác | Điều kiện và kết quả |
| --- | --- |
| Tạo hồ sơ | Bản nháp, chưa có link; request key tránh tạo hai hồ sơ khi mất phản hồi |
| Đã bàn giao đầy đủ và mở feedback | Hồ sơ không lưu trữ, cấu hình khóa sẵn sàng; cập nhật bàn giao và cấp lời mời cùng transaction. Lần thử lại cùng operation trả kết quả cũ; thiếu cấu hình thì báo lỗi và không ghi một nửa |
| Sao chép link | Chỉ lấy link đang dùng, không đổi nonce/hạn/trạng thái. Toast “Đã sao chép” chỉ sau clipboard thành công; có ô readonly để copy thủ công khi clipboard bị chặn. Không ghi “đã gửi/đã nhận” |
| Tạm đóng / mở lại | Tạm đóng chặn mọi đọc/gửi/sửa qua link. Mở lại giữ nonce/hạn, chỉ thành công khi đã bàn giao, chưa lưu trữ và còn hạn |
| Gia hạn | Chọn thời điểm tương lai; giữ nonce, không tự mở một lời mời đang tạm đóng. Link đã thu hồi cần cấp mới, không gia hạn để hồi sinh |
| Thu hồi | Đổi nonce và đặt trạng thái revoked; link cũ không được mở lại. Giữ feedback nội bộ |
| Cấp link mới | Yêu cầu đã bàn giao/chưa lưu trữ; đổi nonce, bắt đầu lại issued_at/expires_at cho thế hệ mới. Thao tác riêng, có chống retry đổi nonce hai lần |
| Trả về chưa bàn giao | Chuyển draft và thu hồi nonce trong cùng transaction; giữ feedback. Hoàn tất lại phải cấp lời mời mới rõ ràng |
| Lưu trữ / bỏ lưu trữ | Lưu trữ chuyển active → paused, giữ nguyên unissued/paused/revoked, giữ liên kết gallery và feedback. Bỏ lưu trữ chỉ bỏ cờ, không đổi trạng thái lời mời; phải chọn mở lại hoặc cấp mới |
| Lưu không thay đổi | Không tăng version hoặc tạo lại link; báo trạng thái hiện hành |

Đổi mật khẩu/trạng thái gallery không làm đổi quyền feedback. Bàn giao không tự đổi inquiry, lịch chụp hoặc quyền hiển thị album. Link mất nhưng không nghi lộ: studio kiểm tra qua kênh liên hệ đã biết rồi copy lại; nghi lộ: thu hồi/cấp mới.

### Trang của khách

Trang riêng theo phong cách hiện có: nền kem, chữ dễ đọc, một cột, ưu tiên điện thoại. Shell chỉ có logo, form và liên hệ studio; không khởi tạo gallery/lightbox, không CTA đặt lịch hay tải danh sách ảnh. Có thông báo lỗi khởi tạo riêng cho feedback, tránh dùng catch chung “Không tìm thấy bộ ảnh”. Không cần đăng nhập hoặc nhập lại thông tin liên hệ. Lời mở đầu trung lập, ví dụ: “Cảm ơn bạn đã đồng hành cùng Công. Sau khi nhận sản phẩm, bạn có thể chia sẻ trải nghiệm để studio phục vụ tốt hơn.”

| Trường đề xuất | Quy tắc |
| --- | --- |
| Tên người gửi/cặp đôi | Điền sẵn từ hồ sơ, sửa được; bắt buộc, tối đa 150 ký tự |
| Mức hài lòng chung | Tùy chọn, đầy đủ 1–5 mức, không chọn sẵn; có nhãn chữ/bàn phím và nút “Bỏ đánh giá” trả về null |
| Cảm nhận sau khi nhận sản phẩm | Bắt buộc có nội dung sau khi bỏ khoảng trắng; tối đa 3.000 ký tự |
| Điều studio có thể làm tốt hơn | Tùy chọn, tối đa 1.500 ký tự |

Hiển thị “Chia sẻ này được gửi riêng cho studio.” Không dùng các tag chỉ khen tích cực. Không hỏi quyền công khai trong đợt nội bộ. Nếu làm testimonials sau này, phải xin sự đồng ý riêng; dữ liệu cũ không tự trở thành công khai.

Các trạng thái màn hình: đang tải; link không dùng được; form trống/đã điền; đang gửi; đã nhận; đang sửa; lỗi từng trường; mất mạng/chưa xác nhận; xung đột do thiết bị khác vừa cập nhật. Thành công chỉ sau máy chủ xác nhận lưu; mở lại hiển thị bản hiện hành và nút Sửa riêng.

Khi lỗi mạng giữ nội dung trong bộ nhớ của đúng trang; không tự lưu nội dung riêng hoặc token vào localStorage/sessionStorage. Nhắc ngắn bản chưa gửi chỉ được giữ trong trang. Theo dõi dirty state và cảnh báo điều hướng chủ động, nhưng không hứa `beforeunload` cứu được bản nháp khi Zalo/OS đóng webview. Retry form không reload. Có thể cho khách chủ động copy nội dung đang gõ khi gặp lỗi; không tự ghi clipboard. Việc chuyển Zalo sang trình duyệt ngoài cần thử trên thiết bị thật.

Đề xuất cho khách xem lại/sửa cùng feedback khi link còn hiệu lực. Hai người cùng giữ link chia sẻ một bản phản hồi, không phải hai tài khoản đã xác minh. Khi có xung đột, giữ bản đang nhập và cho xem bản mới trước khi gửi lại; không âm thầm ghi đè.

MVP dùng link gửi riêng, chưa đặt link ghi feedback vào gallery khách vì gallery có thể được chia sẻ cho người thân. Sau này muốn thêm nút trong gallery cần xác định quyền người đại diện trước.

### Vòng đời trang và bản nháp

- Context là cặp `(handoverId, token)`, không chỉ pathname. Xử lý hashchange/popstate riêng ở trang feedback; không dùng chung hash điều hướng admin. Khi context đổi, tăng epoch, hủy request cũ nếu có thể, xóa dữ liệu server cũ khỏi DOM và xác thực context mới. Response cũ không được render hoặc áp dụng vào context mới.
- Không chuyển bản nháp/request key từ lời mời này sang lời mời khác. Nếu đổi context khi còn bản nháp, cho người dùng giữ/copy bản của mình trước khi rời, không tự đưa nội dung đó vào form mới.
- Khi pageshow, quay lại tab/app hoặc online trở lại: xác thực lại, tạm che dữ liệu đã tải và khóa gửi trong lúc kiểm. Thành công không ghi đè bản đang gõ; bị thu hồi thì bỏ dữ liệu server khỏi UI. Lỗi mạng là chưa kiểm tra được, không khẳng định link đã bị thu hồi.
- Khi đã hiển thị, lịch hết hạn trên client chỉ phục vụ UX; server luôn là nguồn quyết định. Không có chế độ đọc lại qua link đã đóng/hết hạn. Không cần polling/WebSocket liên tục trong MVP.
- Thu hồi chặn truy cập mới sau khi cập nhật quyền có hiệu lực; không thể xóa nội dung người giữ link đã đọc/chụp hoặc phản hồi đã được cho phép trước đó. Không hứa làm nội dung biến mất tức thì ở tab khác đang mở.
- No-store không thay thế kiểm lại khi khôi phục trang. Chrome có cơ chế bfcache với một số trang no-store; cần test hành vi thực tế của cả Chromium/WebKit. [Tài liệu Chrome](https://developer.chrome.com/docs/web-platform/bfcache-ccns).

## 5. Dữ liệu và API dự kiến

| Bảng đề xuất | Dữ liệu chính |
| --- | --- |
| `handovers` | ID, tên/ngữ cảnh khách, dịch vụ/ngày chụp, inquiry tùy chọn, delivery_state/delivered_on/delivery_confirmed_at, archived_at, trạng thái/nonce/issued_at/expires_at lời mời, ghi chú studio, handover_version, create_request_key/hash, danh tính/kết quả operation gần nhất, timestamps |
| `handover_albums` | PK (handover_id, album_id), UNIQUE(album_id), FK và index tra cứu; không tải danh sách ảnh vào form feedback |
| `feedback` | Unique handover_id, snapshot ngữ cảnh lần gửi đầu, tên người gửi, rating nullable, nội dung/góp ý, version, read_version, request key/hash của lần lưu gần nhất, timestamps |

Inquiry tùy chọn dùng `ON DELETE SET NULL`; lưu snapshot ngữ cảnh để dữ liệu vẫn hiểu được khi nguồn thay đổi. Xóa gallery trong một tính năng tương lai chỉ xóa liên kết, không cascade mất feedback. Hiện repo chưa có route xóa album. Không tự tạo hồ sơ hoặc đánh dấu đã bàn giao cho dữ liệu cũ khi migration.

Ràng buộc: `rating` null hoặc số nguyên 1–5; feedback version nguyên dương; `0 <= read_version <= version`; handover_version nguyên dương; enum trạng thái hợp lệ; unique request key tạo hồ sơ. API kiểm integer và kiểu dữ liệu trước khi DB CHECK. Index/FK trên cả hai DB; SQLite không có RLS, còn PostgreSQL/Supabase phải bật RLS và kiểm quyền truy cập các bảng mới. Không có bảng lịch sử mọi lần sửa hay worker mới.

API quản trị dự kiến: danh sách/chi tiết/tạo/sửa hồ sơ; liên kết gallery; đánh dấu bàn giao; lấy link; đóng/mở/gia hạn/thu hồi; đánh dấu phiên bản feedback đã đọc. Mỗi hành động quyền có command riêng, không PATCH toàn bộ record từ form cũ. Tất cả route admin đăng ký sau middleware `app.use('/api/admin',requireAdmin)` và trước catch-all API. API khách chỉ xác thực token; không tái dùng `allowed()` hoặc cho cookie admin/gallery bỏ qua kiểm token.

Contract khách dự kiến: GET lời mời trả ngữ cảnh tối thiểu và feedback hiện hành; PUT feedback gửi đầy đủ trường nội dung, `rating:null` khi bỏ đánh giá, góp ý rỗng khi xóa, `requestKey`, `expectedVersion` (0 khi tạo). Chỉ nhận field cho phép, không nhận read_version, nonce hay trạng thái bàn giao từ khách. Response thành công có phiên bản/nội dung đã lưu; 422 có fields; 409 có code phân biệt xung đột phiên bản và tái dùng key sai; 429 có thời gian thử lại; lỗi quyền trả thông báo chung không lộ tên. Lỗi cấu hình/hạ tầng tạm thời không giả làm link không tồn tại.

Tách module nghiệp vụ/token và `feedback-form.mjs`, `admin-feedback.mjs`; chỉ nối route và điều hướng vào `app.mjs`/`main.js`. Tên file và endpoint cuối cùng được chốt cùng contract trước khi code. Danh sách admin phân trang, không join ảnh đầy đủ hoặc tạo truy vấn riêng cho từng hồ sơ.

## 6. Quyền truy cập, retry và đồng thời

**Phương án kỹ thuật đề xuất cần thử trước:** link dạng `/feedback/:feedbackId#token`; token ký HMAC bằng khóa riêng `FEEDBACK_LINK_SECRET` có ít nhất 32 byte ngẫu nhiên. Chữ ký gồm mục đích sử dụng, ID hồ sơ và nonce/phiên bản lời mời trong DB. Admin tái tạo được cùng link để sao chép; thay nonce vô hiệu riêng link cũ. Cách này giải quyết yêu cầu copy lại, thay vì chỉ lưu hash token rồi không thể lấy lại link.

- Khóa chỉ ở server, giữ ổn định qua deploy/restart thông thường, không tự tạo lại lúc khởi động. Thiếu/sai định dạng khóa chỉ vô hiệu cấp link và API khách; admin vẫn đọc feedback đã lưu, website/gallery vẫn chạy. Đổi khóa làm mất hiệu lực toàn bộ link. Khóa được tạo bằng bộ sinh ngẫu nhiên mật mã; runtime kiểm encoding cố định và độ dài sau giải mã ít nhất 32 byte, không thể suy ra tính ngẫu nhiên chỉ từ độ dài chuỗi.
- Dùng native HMAC-SHA256, serialization cố định có phiên bản và purpose riêng; kiểm độ dài/encoding trước so sánh constant-time. Link dùng origin HTTPS từ SITE_URL đã được kiểm tra, không lấy Host hoặc origin bất kỳ của tab admin. Các thao tác lấy link cũng no-store.
- Fragment không nằm trong HTTP request URL; frontend gửi quyền qua header API, không log token/header hoặc nội dung cảm nhận. Cần thử việc giữ fragment khi mở/chia sẻ bằng Zalo và iOS trước khi chốt phương án.
- Link cấp quyền đọc/sửa feedback của đúng hồ sơ, không mở gallery, ảnh, Drive hay dữ liệu inquiry. Ai có link có quyền này; đây không phải xác minh danh tính bằng OTP.
- Không trả token qua API gallery, portfolio, public HTML hoặc bootstrap data. Không gửi inquiry notes/contact, ID gallery hay link Drive trong dữ liệu cho khách.
- Trang/API feedback dùng no-store; trang noindex và X-Robots-Tag, không vào sitemap, title/description/OG chung không tên khách hoặc ID lời mời, không analytics/structured data/bootstrap riêng tư, Referrer-Policy no-referrer. HTML shell không cần xác thực fragment và không làm lộ hồ sơ có tồn tại. Preview Zalo/GET không tiêu thụ lời mời, không đánh dấu đã đọc.
- Feedback HTML có CSP riêng chỉ cho script/connect cùng origin; không kế thừa nguồn Cloudflare analytics từ policy toàn site. Kiểm cả response/DOM/network qua proxy, bao gồm đường lỗi. Cloudflare hỗ trợ tự chèn analytics theo rule nên bỏ beacon trong app chưa chứng minh đã tắt ở edge. Kiểm/loại trừ /feedback/* trong cấu hình nếu dùng tự chèn. Chưa kết luận cấu hình production hiện tại. [Cloudflare Rules](https://developers.cloudflare.com/web-analytics/configuration-options/rules/).
- Handler HTML hiện coi mọi `req.params.id` là gallery (`app.mjs`, biến `galleryPage`): cần handler riêng hoặc tên tham số/nhánh private rõ. Nối cả server/frontend và giữ đúng quyền ở route có chữ hoa/dấu / cuối hoặc URL lỗi; không redirect mang token sang origin khác.
- Rate limit theo IP và lời mời hợp lệ; giới hạn thử token sai tổng thể, không tạo bản ghi quota vô hạn theo ID bất kỳ. Validate độ dài/định dạng, escape HTML và ràng buộc dữ liệu phía server. Giữ chính sách Origin hiện có cho mutation: phải đúng origin đã cấu hình; thiếu, null hoặc khác origin bị từ chối. Test/API client cũng phải gửi Origin đúng; không thêm CORS wildcard để né lỗi.

Đề xuất link hết hạn sau **90 ngày từ lần cấp của thế hệ link hiện hành**, tính theo server; cấp lại đặt mốc mới. Copy/mở lại không gia hạn hoặc đổi link. Quy tắc 90 ngày chưa được người dùng chốt.

Khi ghi, transaction khóa hồ sơ rồi kiểm bàn giao/lưu trữ/đóng/hết hạn/nonce, kiểm replay, sau đó mới kiểm phiên bản và lưu. Đóng/thu hồi/gia hạn dùng cùng thứ tự khóa. Kết quả phụ thuộc thứ tự transaction: ghi đã commit trước revoke được giữ; ghi đến sau revoke phải bị từ chối. Đọc ngữ cảnh/feedback cùng snapshot đã xác thực, tránh hai query ghép nội dung của trạng thái khác nhau.

**Ràng buộc tích hợp:** mọi truy vấn/helper trong transaction dùng cùng `tx`. Limiter `rate()` hiện giữ `db` bên ngoài; gọi nó trong callback transaction có thể deadlock SQLite do hàng đợi connection. Đặt limiter ngoài transaction rồi xác thực quyền lại trong transaction, hoặc refactor nhận connection tường minh. Không gửi email, gọi storage/network hoặc làm tác vụ chậm khi đang giữ khóa.

Nếu sửa liên kết giữa hai hồ sơ, khóa các hồ sơ theo cùng thứ tự ID cố định để tránh deadlock, kiểm version/quyền sửa của cả hai rồi cập nhật liên kết. `UNIQUE(album_id)` vẫn là bảo vệ cuối cùng; không thực hiện việc chuyển bằng hai request gỡ rồi gán độc lập.

- Với request key gần nhất còn được lưu: cùng nội dung gửi lại trả kết quả đã lưu; cùng key khác nội dung trả conflict. Đây là receipt gần nhất, không phải sổ toàn bộ key đã từng dùng.
- Unique handover_id bảo đảm tối đa một feedback. Hai lần gửi đầu đồng thời không tạo hai bản.
- Chỉnh sửa dùng expected version; bản cũ không ghi đè bản mới. Khi key không còn được nhớ, xử lý bằng expectedVersion như request mới: phiên bản cũ hơn sau một chỉnh sửa mới trả conflict; nếu version chưa đổi thì xử lý bình thường, gồm trả bản hiện hành khi payload là no-op. Không cam kết replay hoặc phát hiện tái sử dụng key vô hạn.
- Khách thay đổi nội dung đã chuẩn hóa mới tăng version; phản hồi trở thành chưa đọc. No-op/replay không đổi version/updated_at/read_version. Admin chỉ đánh dấu phiên bản đã nhìn thấy, dùng giá trị lớn hơn giữa read_version cũ và observed_version hợp lệ, không tự đánh dấu phiên bản mới hơn vừa đến là đã đọc.
- Chốt chuẩn hóa trước khi tính hash: trim đầu/cuối, thống nhất xuống dòng, giữ nội dung xuống dòng bên trong; không tự bỏ dấu hoặc viết lại lời khách. Lượt no-op hợp lệ vẫn ghi nhận request key/hash gần nhất, nhưng không đổi thời gian/nội dung/phiên bản phản hồi. Ví dụ no-op A rồi no-op B cùng version: retry A có thể trả bản hiện hành, không thể nhận diện A là key cũ khi chỉ còn lưu B; tuyệt đối không tăng version/unread chỉ vì trường hợp đó.
- Hết hạn/thu hồi/đóng link không xóa feedback. Chỉ hiện thông báo an toàn và cách liên hệ studio khi link không dùng được.

Admin cũng có optimistic version riêng: save/assign/complete/close/rotate/renew gửi expected handover_version và identity thao tác. Retry tạo hồ sơ/rotate sau mất ACK không tạo thêm hồ sơ hoặc đổi nonce lần nữa. Giữ form admin khi conflict; không dùng khóa DB làm lý do cho phép last-write-wins. Copy/đọc không tăng handover_version. Guard điều hướng loại response hồ sơ A đến sau khi đã mở B.

Khi timeout hoặc response không đầy đủ, giữ snapshot bất biến `{context, payload, requestKey, expectedVersion}`. Retry đúng snapshot hoặc đối chiếu bản server trước khi tạo lượt sửa mới; không tự nâng expectedVersion để ghi đè bản khác. Nếu token đã bị thu hồi thì kiểm quyền vẫn đứng trước replay. Lỗi này không có nghĩa server chưa lưu.

Frontend transport phải chốt cấu trúc lỗi (`api-request.mjs` dùng error.data.fields, inquiry dùng error.fields). Helper API hiện tự ghi đè AbortSignal: dùng transport riêng hoặc mở rộng có kiểm soát nếu cần hủy theo context; abort không chứng minh server chưa ghi, luôn giữ epoch guard. Form module tự nhận submit và stopPropagation để không chạy trùng handler chung.

## 7. Lộ trình và điều kiện hoàn thành

| Chặng | Công việc | Điều kiện chuyển bước |
| --- | --- | --- |
| 1. Khóa bản thiết kế | Chốt ba lựa chọn UX; wireframe form/admin; tên endpoint, lỗi và chuyển trạng thái | Phân biệt quyết định đã chốt và giả định cần thử, không viết tính năng trong lượt review này |
| 2. Thử rủi ro kỹ thuật | Khi bắt đầu triển khai: prototype dùng dữ liệu giả cho fragment/Zalo, lifecycle và private shell qua proxy; thử transaction/retry trên hai DB | Nếu fragment không giữ được, quay lại chọn cách truyền token trước khi xây toàn bộ form; không âm thầm chuyển token sang query URL |
| 3. Dữ liệu và quyền | Migration additive SQLite/Postgres; ràng buộc; token; thu hồi; API; transaction; export | Dữ liệu cũ nguyên vẹn, quyền và retry/concurrency đúng, không deadlock SQLite |
| 4. Admin và form | Hồ sơ/gom gallery, copy link, inbox/chưa đọc, gửi/sửa feedback, xử lý lỗi | Chạy đủ hành trình với dữ liệu tạm, mobile và bàn phím |
| 5. Kiểm tra và đưa vào dùng | Regression, staging riêng, tài liệu vận hành/backup/khóa, kiểm thiết bị | Đạt ma trận dưới đây, hoàn tất diễn tập restore rồi mới xem xét deploy |

Không cam kết số ngày khi chưa chốt thiết kế và kiểm môi trường test. Việc lập kế hoạch không phải cho phép deploy hay gửi lời mời cho khách thật.

### Ma trận nghiệm thu cần thực hiện khi có implementation

**Toàn bộ các ca FB bên dưới chưa chạy.** 30 test nền hiện có không thay thế các ca này. Test DB/concurrency phải chạy trên SQLite và PostgreSQL thử riêng; test PostgreSQL không dùng database production.

| Mã | Tình huống và kết quả bắt buộc | Cách kiểm |
| --- | --- | --- |
| FB01 | Hồ sơ 0 gallery/không inquiry vẫn dùng được; nhiều gallery nhận chung một feedback | API + hành trình admin/khách |
| FB02 | Inquiry completed, tim, tải ảnh, đổi password hoặc publish album không tự mở/đóng feedback | Integration regression |
| FB03 | Hai admin gán cùng gallery: chỉ một liên kết thắng; archived vẫn giữ liên kết; sửa gán nhầm rõ ràng | Hai DB + admin UI |
| FB04 | Tạo hồ sơ trùng từ retry bị chặn; tìm/cảnh báo hồ sơ trùng gồm cả lưu trữ; không tự gộp khách trùng tên | API + admin UI |
| FB05 | Toàn bộ bảng chuyển trạng thái mục 4; ngày quá khứ hợp lệ; copy/no-op không đổi link/hạn | API + clock cố định |
| FB06 | Token sai/thiếu/quá dài/khác hồ sơ, draft, paused, revoked, archived, hết hạn không đọc/ghi; admin/gallery cookie không bỏ qua | API negative tests |
| FB07 | Token feedback không cho xem ảnh, inquiry/contact/Drive; API public/gallery/export không xác thực không đọc được feedback | API + DTO review |
| FB08 | GET/preview không tiêu thụ link, không đánh dấu đã đọc, HTML/OG lỗi không lộ tên | HTTP + preview thực tế |
| FB09 | Copy lại và restart với cùng key giữ link; rotate key làm link cũ vô hiệu; thiếu key chỉ khóa tính năng cần key | API + startup |
| FB10 | Gửi đúp, retry mất ACK: một bản; key gần nhất cùng payload trả kết quả, khác payload conflict; key cũ với version stale không ghi đè; no-op A→B→retry A không tăng version/unread | Hai DB |
| FB11 | Hai lần tạo feedback đồng thời không tạo hai bản; hai tab sửa cùng version có một thắng và một conflict | Hai DB + hai browser context |
| FB12 | Ghi đồng thời revoke/pause/archive/undo/renew theo thứ tự khóa; không có mutation vượt kiểm quyền sau revoke commit | Hai DB + concurrency có barrier |
| FB13 | Đọc feedback trong lúc thay quyền/ngữ cảnh không ghép kết quả từ hai snapshot khác nhau | Hai DB + concurrency |
| FB14 | Admin create/complete/rotate mất ACK thử lại không tạo thêm record/đổi nonce lần nữa; form admin cũ conflict | API + admin UI |
| FB15 | Admin đang xem v1, khách gửi v2, đánh dấu đọc v1 không làm v2 thành đã đọc; retry/no-op không phát sinh unread | Hai DB |
| FB16 | Tiếng Việt/Unicode, số thực/chuỗi rating, null, khoảng trắng, giới hạn độ dài, HTML; nội dung luôn escape khi render | Validation + DOM |
| FB17 | Bỏ rating/góp ý được lưu đúng; request thừa field không sửa trạng thái; lỗi 422/409/429/5xx hiển thị đúng, giữ bản nhập | API + form |
| FB18 | Timeout sau server commit, response hỏng và mất mạng giữ snapshot retry; không tự nâng version hoặc tự gửi bản đã đổi | Transport tests + browser |
| FB19 | Chuyển A→B, chỉ đổi token, Back/Forward, response A đến trễ: không hiện/ghi dữ liệu A vào B | Browser + delayed response |
| FB20 | pageshow/quay lại Zalo/tab/online kiểm lại quyền, che dữ liệu server lúc kiểm, giữ draft đúng context; không coi offline là revoke | Chromium/WebKit + thiết bị thật |
| FB21 | Dirty guard, lỗi khởi tạo, submit bubbling, bàn phím/focus, double click, không reload khi retry | Browser UX |
| FB22 | Form/admin ở 320/390/768/1440 px; Zalo iOS/Android mở link, fragment, chuyển trình duyệt ngoài; clipboard bị từ chối có fallback | Browser + thiết bị thật |
| FB23 | Origin thiếu/sai/cross-origin theo policy; rate limit IP/invitation, reset/thời gian thử lại; ID ngẫu nhiên không phình quota; không deadlock | API + hai DB |
| FB24 | HTML/API/error no-store, noindex, no-referrer, CSP riêng; không PII/token trong bootstrap/SEO/sitemap/log/analytics | HTTP + DOM/network/log review |
| FB25 | Qua hostname/proxy staging thực tế: không beacon hoặc bên thứ ba đọc token; exclude Cloudflare nếu đang tự chèn; URL lỗi/case/trailing slash vẫn private | Cấu hình edge + browser network |
| FB26 | Migration mới/cũ/chạy lặp; CHECK/unique/index/FK; PostgreSQL RLS không cho anon/authenticated đọc bảng; app role vẫn hoạt động | Hai DB + role tests |
| FB27 | Export gồm bảng mới, version định dạng rõ, snapshot nhất quán lúc có ghi; không chứa signing secret hoặc link có chữ ký | Export integration |
| FB28 | Restore snapshot cũ sau revoke không làm link cũ hoạt động vì đổi secret trước traffic; dữ liệu mới hơn snapshot có thể mất và được báo rõ | Diễn tập staging |
| FB29 | Rollback code không xóa bảng/dữ liệu mới hoặc khôi phục DB cũ; thiếu key không làm gallery/public dừng | Staging + regression |
| FB30 | Gallery password/tim/sync/lọc phần/upload/JPG/ZIP/lightbox; inquiry/admin/public không thay hành vi | Bộ regression tương ứng |

### Backup, khôi phục và vận hành

- JSON export hiện là bản metadata đọc tuần tự, không phải bản sao lưu database nhất quán hoặc cơ chế restore hoàn chỉnh. Khi thêm bảng mới, nâng version định dạng export và đọc một snapshot nhất quán: SQLite transaction phù hợp, PostgreSQL transaction read-only REPEATABLE READ hoặc cơ chế tương đương. Chỉ bọc BEGIN mặc định PostgreSQL chưa đủ cho nhiều SELECT. Nếu chưa làm được điều này, không quảng bá export đó là bản khôi phục đầy đủ.
- Backup vận hành dùng cơ chế snapshot/dump nhất quán của database, kèm quy trình phục hồi đang dùng; ảnh/tệp vẫn cần backup riêng. Metadata feedback và ghi chú studio là dữ liệu riêng tư. Giữ signing secret ngoài JSON export và ngoài repository; bảo quản riêng theo quy trình bí mật vận hành.
- **Restart/deploy thông thường khác restore dữ liệu cũ.** Restart/deploy giữ secret. Restore snapshot cũ có thể phục hồi nonce/trạng thái active trước lúc thu hồi: mặc định phải chặn API feedback trong thời gian phục hồi, đổi `FEEDBACK_LINK_SECRET` trước khi mở traffic feedback, rồi cấp lại những link thực sự cần dùng. Không giữ nguyên key chỉ để giữ link cũ, trừ khi đã đối soát được toàn bộ sự kiện thu hồi/thay quyền sau snapshot bằng nguồn đáng tin cậy; MVP không có sổ sự kiện đó.
- Secret mới phải có hiệu lực trên mọi instance còn phục vụ trước khi mở feedback; không để instance giữ key cũ tiếp nhận request trong quá trình phục hồi. Việc đổi key không cứu dữ liệu gửi sau thời điểm snapshot: đây là mất dữ liệu cần đánh giá riêng, không gọi restore thành công chỉ vì web lên lại.
- Trước phát hành: triển khai additive, cấu hình key/site URL, kiểm private shell/quyền/DB trên staging; sẵn sàng vô hiệu API khách khi cấu hình sai. Health check hiện chỉ đọc settings, chưa chứng minh feedback sẵn sàng; cần kiểm riêng readiness của tính năng và báo lỗi rõ cho admin.
- Rollback code bảo toàn bảng/dữ liệu mới. Không rollback bằng DROP hoặc nạp bản DB cũ. Trong thời gian rollback, link có thể tạm không dùng được; admin không nên gửi lời mời mới. Chỉ mở lại khi migration/key/quyền đã kiểm xong.
- Lưu trữ là đóng hồ sơ, **không phải xóa dữ liệu**. MVP không cần nút xóa hàng loạt, nhưng runbook phải có cách xử lý yêu cầu xóa gửi qua kênh studio đã biết: kiểm đúng hồ sơ, thu hồi link, xóa nội dung và dữ liệu nhận diện liên quan theo phạm vi yêu cầu, ghi nhận tối thiểu việc xử lý; không tự hứa đã xóa khỏi mọi backup. Chốt nơi lưu/ai truy cập/thời hạn giữ backup trong vận hành, không tự đặt một thời hạn pháp lý trong kế hoạch này.

## 8. Ngoài MVP và những đề xuất còn mở

Ngoài MVP: testimonials công khai, duyệt/ghim, ảnh đại diện, Review schema, xin quyền sử dụng công khai, email mời, tự nhắc khách, đồng bộ Drive, checklist sản phẩm, customer accounts/OTP, dashboard thống kê nâng cao. Email báo studio có thể bổ sung sau; badge/inbox admin là nguồn theo dõi trong MVP.

| Lựa chọn còn mở | Đề xuất hiện tại | Ảnh hưởng nếu thay đổi |
| --- | --- | --- |
| Nội dung form | Tên + cảm nhận bắt buộc; rating và góp ý tùy chọn | Chốt copy/validation và schema trước khi code |
| Khách xem lại/sửa | Cho sửa cùng feedback khi link còn hiệu lực | Nếu chỉ gửi một lần: bỏ UI sửa nhưng vẫn phải chống gửi trùng và xử lý mất ACK |
| Hạn link | 90 ngày từ lần cấp, studio có thể gia hạn/cấp lại | Ảnh hưởng trải nghiệm quay lại, không thay đổi quyền thu hồi |

Ba mục này chưa được người dùng xác nhận. Không hỏi lại năm quyết định đã chốt ở mục 1. Ràng buộc gallery–hồ sơ, cách truyền token, lifecycle trong Zalo và transaction trên PostgreSQL là các đề xuất/điều kiện kỹ thuật cần kiểm chứng khi triển khai, không yêu cầu người dùng quyết định chi tiết mật mã hoặc database. Không tự công khai feedback nội bộ nếu tương lai bổ sung testimonials.

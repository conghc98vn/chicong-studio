# Đặc tả feedback sau bàn giao — ChiCong Studio

**Bản hợp nhất: 21/10/2026 · v1.3 tài liệu · bản duy nhất để review và triển khai sau này.** Quyết định nghiệp vụ kế thừa v0.4; kết quả rà mới nhất nằm tại mục 11.4, lượt trước tại mục 11.3.

**Trạng thái: đang review thiết kế, chưa triển khai tính năng.** Đây là tài liệu chính duy nhất cho tính năng feedback sau bàn giao. Nội dung đã hợp nhất kế hoạch, câu chữ sản phẩm và kết quả review; có thể dùng độc lập làm ngữ cảnh cho AI triển khai sau này. Việc tạo tài liệu này không phải yêu cầu bắt đầu code, deploy hoặc gửi lời mời/email thật.

Luồng đã thống nhất: **studio xác nhận giao đủ → copy link gửi riêng → khách viết cảm nhận và chấm sao tùy chọn → khách được sửa khi hồ sơ mở → admin đọc bản mới nhất, xem toàn bộ lịch sử và nhận email.** Feedback chỉ dùng nội bộ, không có ngày hết hạn.

| Mức độ xác nhận | Cách hiểu trong tài liệu |
| --- | --- |
| Đã chốt với studio | Các quyết định nghiệp vụ ở mục 1; không hỏi lại nếu studio chưa yêu cầu đổi |
| Phương án kỹ thuật dự kiến | Mô hình dữ liệu, token, API, transaction và dispatcher; phải đối chiếu source hiện tại, hoàn thiện contract và kiểm thử khi được yêu cầu triển khai |
| Bản nháp câu chữ | Toàn bộ mẫu form/tin nhắn/email ở mục 9; đúng giọng “Chí Công — bạn”, còn có thể chỉnh câu chữ khi review giao diện |
| Bằng chứng hiện có | Review source và test nền ở mục 10; không chứng minh tính năng mới đã hoạt động |

Studio có thể đọc trước mục **1, 3, 4, 8, 9 và 12.1**. AI triển khai cần đọc toàn bộ, đặc biệt quyền/trạng thái, lịch sử/retry, email, vận hành và ma trận nghiệm thu. Nếu source thay đổi, cập nhật phương án tích hợp; không tự đổi những quyết định người dùng đã chốt để khớp code cũ.

## Mục lục

1. [Phạm vi đã chốt](#scope)
2. [Hiện trạng code và hệ quả](#current-code)
3. [Mô hình nghiệp vụ](#business-model)
4. [Hành trình, màn hình và trạng thái](#journeys)
5. [Dữ liệu và API](#data-api)
6. [Quyền, retry, đồng thời và email](#security-delivery)
7. [Lộ trình, 40 ca nghiệm thu và vận hành](#acceptance-operations)
8. [Ngoài MVP và phần còn cần review](#scope-boundary)
9. [Toàn bộ câu chữ form, Zalo và email](#product-copy)
10. [Bằng chứng review, source map và giới hạn xác minh](#review-evidence)
11. [Những điểm dễ triển khai sai và đề xuất đã bị thay thế](#review-decisions)
12. [Checklist của studio và bàn giao cho AI](#ai-handoff)

<a id="scope"></a>

## 1. Phạm vi người dùng đã chốt

- Bàn giao kết hợp gallery trên website và Drive/kênh ngoài.
- Đợt đầu chỉ thu thập nội bộ.
- Một feedback chung cho mỗi đơn/buổi chụp, có thể liên quan nhiều gallery.
- Studio tự đánh dấu “Đã bàn giao đầy đủ”; chưa cần checklist sản phẩm.
- Studio sao chép link để gửi qua Zalo/tin nhắn; chưa cần gửi email mời.

- Form gồm tên và lời chia sẻ tự do bắt buộc, bốn tiêu chí sao tùy chọn 1–5, và một ô riêng cho điều chưa tốt/cần cải thiện. Các sao không chọn sẵn. “Chat” được xác nhận là ô viết lời nhắn trong form.
- Bốn tiêu chí đã chốt: trải nghiệm chung, trải nghiệm buổi chụp, sản phẩm nhận được, quá trình bàn giao.
- Khách được gửi, xem lại và cập nhật khi hồ sơ đang mở nhận và link hợp lệ; chỉ thấy bản mới nhất. Admin được xem đầy đủ lịch sử các lần gửi/cập nhật thực sự.
- Không đặt hạn feedback. Admin chủ động quản lý trạng thái; không có trường ngày hết hạn, gia hạn, countdown hoặc tự đóng theo tuổi hồ sơ. Tạm đóng vẫn chặn cả xem và sửa theo quy tắc đã thống nhất.
- Hiện thường một khách/một gallery; mô hình cần hỗ trợ nhiều gallery về sau. Vẫn nhận feedback theo đơn/buổi chụp, không gộp vĩnh viễn mọi buổi của một khách.
- Studio đã đồng ý quy trình tạo hồ sơ/bàn giao/copy link, quy tắc đóng/thu hồi/lưu trữ và quản lý đã/chưa đọc, ghi chú riêng, không sửa lời khách.
- Có email báo studio ở lần gửi đầu và mỗi lần khách lưu thay đổi thực sự; dùng địa chỉ nhận thông báo hiện có. Retry/no-op không tạo thêm sự kiện email. Email mời khách vẫn chưa nằm trong đợt này.
- Email hiển thị đầy đủ nội dung feedback của đúng phiên bản được thông báo: tên người gửi, ngữ cảnh buổi chụp, bốn điểm sao, lời chia sẻ và góp ý, thời điểm/phiên bản/mã hồ sơ, link admin. Dùng cách xưng “Chí Công — bạn” trong nội dung dành cho khách.
- Đã yêu cầu soạn copy form, tin nhắn mời và lời cảm ơn. Copy là bản nháp để studio review, chưa phải nội dung đã được duyệt.

Thiết kế kỹ thuật dưới đây là phương án thực hiện các quyết định đó; chưa phải xác nhận bắt đầu code. Không hỏi lại các lựa chọn đã chốt; studio review luồng/trạng thái tại mục 4, câu chữ tại mục 9 và checklist tại mục 12.1.

<a id="current-code"></a>

## 2. Kết quả rà soát hiện trạng

Lượt v0.2 đã đọc code và chạy 30 kiểm thử nền hiện có trên database/thư mục tạm: 30 đạt, 0 lỗi, 0 bỏ qua. Lượt v0.3 bắt đầu từ working tree sạch tại commit `1ea50e8`, đối chiếu lại database, mailer, startup và các điểm nối; không coi kết quả test cũ là kiểm chứng tính năng mới. Chưa chạy tính năng feedback, PostgreSQL, browser hoặc production. Tham chiếu dùng tên hàm/route vì số dòng có thể dịch chuyển; chỉ sửa tài liệu.

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
| Mailer expose `sendEmail`; inquiry gửi best-effort, không lưu job/retry | `app.mjs`, `notifyNewInquiry`; `mailer.mjs`, `sendEmail` | Tái dùng transport; thêm notification bền vững riêng cho feedback, không gọi hàm còn gửi thư cho khách |
| Có navigation và guard kết quả admin đến trễ | `main.js`, `views`, `refreshAdmin`, `adminNavigation` | Nối mục Cảm nhận và bảo vệ chuyển hồ sơ |
| Export đọc tuần tự nhiều bảng ngoài transaction | `app.mjs`, `GET /api/admin/export` | Không coi JSON hiện tại là snapshot database nhất quán |
| Công việc media/R2 song song đã bổ sung công cụ snapshot/backup riêng, có registry bảng và kiểm schema | `studio/tools/media-backup.mjs`, `databaseSnapshot`, `verifyBackup`, `restoreBackup` tại lượt review 16/10/2026 | Thêm bảng feedback phải cập nhật cả công cụ này, không chỉ export admin; đây là code đang thay đổi, chưa phải bằng chứng đã vận hành trên production |
| Khóa bảo trì media chỉ chặn một số mutation ảnh/settings | `studio/server/media-control.mjs`, `mediaMutation` | Không dùng khóa này thay cho việc chặn API feedback hoặc dispatcher khi restore |

Luồng gallery hiện chạm tim tự lưu; tài liệu cũ còn nói về nút “Gửi lựa chọn”. Số ảnh chọn, tải JPG/ZIP và trạng thái chọn ảnh đều không xác nhận đã giao đủ sản phẩm. Ảnh tải trên website cũng không thay thế việc bàn giao nguồn độ phân giải đầy đủ ở kênh khác.

<a id="business-model"></a>

## 3. Mô hình nghiệp vụ đề xuất

Tạo một **hồ sơ bàn giao nhẹ** cho mỗi đơn/buổi chụp. Hồ sơ giữ tên khách, tên buổi chụp/dịch vụ, ngày chụp tùy chọn, ngày bàn giao và các gallery liên quan. Đây là ngữ cảnh cho feedback; không mở rộng thành quản lý hợp đồng hoặc thanh toán.

- Một hồ sơ liên kết 0–N gallery; hỗ trợ khách chỉ nhận ảnh qua Drive.
- Liên kết inquiry là tùy chọn; khách đến từ Zalo không cần tạo inquiry giả.
- Một hồ sơ có tối đa một feedback hiện hành, kèm toàn bộ các phiên bản nội dung đã lưu. Khách sửa tạo phiên bản mới của cùng feedback; không tạo feedback thứ hai.
- Tạo hồ sơ từ mục Cảm nhận hoặc từ chi tiết gallery admin; chọn gallery khác bằng thao tác rõ ràng.
- Nếu gallery đã thuộc hồ sơ, ưu tiên mở hồ sơ đó. Cảnh báo hồ sơ có tên/ngày giống nhau để tránh tạo trùng; không coi tên khách là khóa duy nhất.
- Đề xuất thay quy tắc mơ hồ “một hồ sơ đang dùng” bằng **mỗi gallery có tối đa một liên kết hiện hành**, kể cả hồ sơ lưu trữ. Dùng `UNIQUE(album_id)` trên bảng liên kết; lưu trữ không tự giải phóng liên kết. Sửa gán nhầm là gỡ/gán rõ ràng trong transaction, không tự chuyển khi tìm thấy tên giống nhau.
- Tìm/cảnh báo trùng phải bao gồm hồ sơ lưu trữ. Unique feedback/hồ sơ không bảo đảm tuyệt đối một feedback/đơn ngoài đời nếu admin tạo hai hồ sơ khác nhau; chưa có entity đơn hàng để cưỡng chế điều đó. UI giúp nhận diện và dùng lại hồ sơ cũ, không tự gộp dữ liệu.
- Sau khi đã cấp link, hồ sơ không được tái sử dụng cho khách hoặc buổi chụp khác. Sửa lỗi chính tả/ngày của cùng buổi được phép; đổi đối tượng phải tạo hồ sơ mới. Không tự đồng bộ tên/ngữ cảnh từ inquiry hoặc gallery. Lần gửi đầu lưu snapshot ngữ cảnh vào feedback; sửa hồ sơ không sửa tên hoặc lời khách đã gửi.
- Trước lần gửi đầu, trang khách lấy ngữ cảnh hiện tại của hồ sơ; transaction gửi đầu chốt snapshot đó. Từ khi đã có feedback, trang xem/sửa của khách và email dùng snapshot ngữ cảnh đã chốt, không trộn tên/ngày buổi chụp mới sửa ở admin vào phản hồi cũ. Admin vẫn thấy thông tin hồ sơ hiện tại và ngữ cảnh lúc nhận feedback với nhãn phân biệt nếu khác nhau. Tên người gửi thuộc từng revision, không bị ghi đè bằng tên hồ sơ.
- Ngữ cảnh khách nhìn thấy trước lần gửi đầu có `contextVersion` riêng, chỉ tăng khi các trường ngữ cảnh trả cho khách thay đổi; sửa ghi chú nội bộ không làm tăng giá trị này. GET trả version cùng ngữ cảnh trong một snapshot. PUT đầu tiên phải gửi `expectedContextVersion`; sau khi khóa hồ sơ, server so sánh với bản hiện tại trước khi chốt snapshot. Nếu khác, trả `409 CONTEXT_CHANGED`, không tạo feedback/receipt/notification; khách xem ngữ cảnh mới, giữ bản nháp và chủ động gửi lại bằng request key mới. Không tự nâng version rồi gửi lại. Khi đã có feedback, ngữ cảnh bất biến đã chốt được dùng cho mọi lần sửa; sửa thông tin hồ sơ sau đó không gây conflict ngữ cảnh cho feedback cũ. Replay request đã được nhận vẫn đối soát receipt trước kiểm ngữ cảnh mới.
- Phân biệt ngày bàn giao thực tế `delivered_on` với thời điểm admin xác nhận `delivery_confirmed_at`. Ngày thực tế/ngày chụp có thể ở quá khứ; không dùng validator inquiry yêu cầu ngày tương lai. Sửa ngày không đổi quyền feedback. Hiển thị ngày theo Asia/Ho_Chi_Minh, lưu timestamp thao tác theo UTC.

Ví dụ: “An & Bình — Ngày cưới” liên kết gallery lễ và gallery tiệc. Sau khi giao đủ ảnh qua website/Drive và các sản phẩm đã thỏa thuận, studio đánh dấu hoàn tất. Khách nhận một link để phản hồi chung cho trải nghiệm này.

<a id="journeys"></a>

## 4. Hành trình và các màn hình

**Admin tạo hồ sơ → đánh dấu Đã bàn giao đầy đủ và mở nhận → sao chép link → gửi riêng qua Zalo → khách gửi/cập nhật → lưu phiên bản và việc cần gửi email → studio nhận thông báo, đọc trong admin → chủ động tạm đóng/lưu trữ khi cần.**

### Admin

Mục **Cảm nhận** có danh sách hồ sơ, tìm theo tên khách/buổi chụp, lọc chưa bàn giao/đang nhận/đã có phản hồi/đã đóng và chưa đọc/đã đọc. Tổng quan có số phản hồi chưa đọc.

Chi tiết hồ sơ gồm thông tin bàn giao, gallery liên quan, link/trạng thái nhận, cảm nhận mới nhất, ghi chú riêng, lịch sử và tình trạng email. Admin không sửa lời khách hoặc phục hồi bản cũ thành lời khách hiện hành. Thao tác thường dùng là bàn giao, copy và đọc; tạm đóng/mở lại/thu hồi/lưu trữ nằm trong menu phụ.

Từ một gallery, “Bàn giao & cảm nhận” mở hồ sơ hiện có hoặc tạo hồ sơ điền sẵn gallery đó; “Thêm bộ ảnh” là thao tác phụ. Danh sách dùng tên khách/buổi chụp, trạng thái nhận, mới nhận/đã cập nhật, đã/chưa đọc và tình trạng link; không tự tính trung bình bốn tiêu chí thành một điểm đại diện. Lịch sử nằm dưới bản mới nhất, phân trang/thu gọn theo phiên bản giảm dần, mỗi bản mở xem đầy đủ nội dung và thời điểm server lưu. Xem bản cũ không tự đánh dấu bản mới hơn là đã đọc.

Tách bốn trục trạng thái: bàn giao (`draft/delivered`, kèm cờ lưu trữ), lời mời (`unissued/active/paused/revoked`), phản hồi (chưa có/đã có), đọc (`read_version < latest_version` là chưa đọc). Không dùng một dropdown trộn cả bốn trục. “Đã có phản hồi” không tự đóng nhận; “Đã đọc” cũng không khóa khách sửa.

Nhãn tổng hợp trên danh sách để đọc nhanh: **Chưa mở nhận**, **Đang nhận**, **Đã đóng**, **Đã lưu trữ**. Trong “Đã đóng” luôn ghi rõ Tạm đóng hay Link đã thu hồi, vì hành động tiếp theo khác nhau. Thứ tự suy ra: lưu trữ → chưa bàn giao → revoked/paused → active → chưa cấp lời mời; hiển thị lý do ở chi tiết. Đây là nhãn tính từ dữ liệu, không tạo thêm một cột trạng thái trùng lặp. Đã/chưa nhận phản hồi, đã/chưa đọc và trạng thái email là badge riêng.

| Thao tác | Điều kiện và kết quả |
| --- | --- |
| Tạo hồ sơ | Bản nháp, chưa có link; request key tránh tạo hai hồ sơ khi mất phản hồi |
| Đã bàn giao đầy đủ và mở feedback | Chỉ chuyển từ draft, hồ sơ không lưu trữ, cấu hình khóa sẵn sàng; cập nhật bàn giao và cấp lời mời cùng transaction. Replay cùng operation không làm lại. Command complete mới trên hồ sơ đã delivered báo trạng thái không phù hợp và không đổi quyền/nonce; paused dùng Mở lại, revoked dùng Cấp link mới. Thiếu cấu hình thì báo lỗi và không ghi một nửa |
| Sao chép link | Chỉ trả URL khi delivered + active + chưa lưu trữ và cấu hình link hợp lệ; không đổi nonce/trạng thái. Paused phải mở lại, revoked phải cấp mới, archived phải bỏ lưu trữ rồi xử lý trạng thái lời mời. Draft/unissued chưa có link để copy; delivered + unissued dùng thao tác cấp lời mời rõ ràng. Toast “Đã sao chép” chỉ sau clipboard thành công; có ô readonly để copy thủ công khi clipboard bị chặn. Không ghi “đã gửi/đã nhận” |
| Tạm đóng / mở lại | Tạm đóng chặn mọi đọc/gửi/sửa qua link. Mở lại từ paused giữ nonce, chỉ thành công khi đã bàn giao và chưa lưu trữ. Revoked phải cấp link mới, không mở lại link cũ |
| Thu hồi | Đổi nonce và đặt trạng thái revoked; link cũ không được mở lại. Giữ feedback nội bộ |
| Cấp link mới | Yêu cầu đã bàn giao/chưa lưu trữ; đổi nonce/issued_at, mở nhận qua thế hệ link mới, giữ toàn bộ lịch sử. Đây là thao tác có tác dụng mở nhận, không ẩn trong việc sửa hồ sơ; có chống retry đổi nonce hai lần |
| Trả về chưa bàn giao | Chuyển draft và thu hồi nonce trong cùng transaction; giữ feedback. Hoàn tất lại phải cấp lời mời mới rõ ràng |
| Lưu trữ / bỏ lưu trữ | Lưu trữ chuyển active → paused, giữ nguyên unissued/paused/revoked, giữ liên kết gallery và feedback. Bỏ lưu trữ chỉ bỏ cờ, không đổi trạng thái lời mời; phải chọn mở lại hoặc cấp mới |
| Lưu không thay đổi | Không tăng version hoặc tạo lại link; báo trạng thái hiện hành |

Thao tác có mục tiêu đã đạt như tạm đóng một hồ sơ paused hoặc lưu trữ một hồ sơ đã archived có thể trả no-op, không đổi nonce/version. Thu hồi một lời mời đã revoked cũng không tạo thêm thế hệ link. Riêng Cấp link mới là hành động đổi link có chủ đích; UI nêu rõ link cũ sẽ không dùng được và việc cấp mới mở nhận. Kiểm điều kiện và version ở server; ẩn/khóa nút trong UI không thay thế kiểm quyền.

Đổi mật khẩu/trạng thái gallery không làm đổi quyền feedback. Bàn giao không tự đổi inquiry, lịch chụp hoặc quyền hiển thị album. Link mất nhưng không nghi lộ: studio kiểm tra qua kênh liên hệ đã biết rồi copy lại; nghi lộ: thu hồi/cấp mới.

### Trang của khách

Trang riêng theo phong cách hiện có: nền kem, chữ dễ đọc, một cột, ưu tiên điện thoại. Shell chỉ có logo, form và liên hệ studio; không khởi tạo gallery/lightbox, không CTA đặt lịch hay tải danh sách ảnh. Có thông báo lỗi khởi tạo riêng cho feedback, tránh dùng catch chung “Không tìm thấy bộ ảnh”. Không cần đăng nhập hoặc nhập lại thông tin liên hệ. Dùng lời mở đầu và câu chữ thống nhất tại mục 9.2.

| Trường đề xuất | Quy tắc |
| --- | --- |
| Tên người gửi/cặp đôi | Điền sẵn từ hồ sơ, sửa được; bắt buộc, tối đa 150 ký tự |
| Bốn tiêu chí sao | Trải nghiệm chung; trải nghiệm buổi chụp; sản phẩm nhận được; quá trình bàn giao. Mỗi mục tùy chọn, số nguyên 1–5, không chọn sẵn; có nhãn chữ/bàn phím và “Bỏ đánh giá” trả về null |
| Cảm nhận sau khi nhận sản phẩm | Bắt buộc có nội dung sau khi bỏ khoảng trắng; tối đa 3.000 ký tự |
| Điều studio có thể làm tốt hơn | Tùy chọn, tối đa 1.500 ký tự |

Hiển thị câu riêng tư tại mục 9.2: “Chia sẻ này chỉ gửi riêng cho Chí Công và studio, không hiển thị công khai trên website.” Không dùng các tag chỉ khen tích cực. Không hỏi quyền công khai trong đợt nội bộ. Nếu làm testimonials sau này, phải xin sự đồng ý riêng; dữ liệu cũ không tự trở thành công khai.

Các tiêu chí có key ổn định `overall`, `shoot`, `product`, `delivery`; chưa trải nghiệm/không muốn chấm được bỏ trống, không coi là 0 sao. Dùng chung thang: 1 Rất không hài lòng, 2 Chưa hài lòng, 3 Bình thường, 4 Hài lòng, 5 Rất hài lòng. Tiêu chí chung là đánh giá trực tiếp của khách, không phải trung bình ba mục còn lại. Không có trình tự thiết kế khảo sát theo từng hồ sơ trong MVP.

Trước khi gửi, nói rõ: “Studio lưu các lần bạn gửi hoặc cập nhật để theo dõi đầy đủ góp ý. Trang này hiển thị nội dung mới nhất.” Không lưu lịch sử từng phím gõ/bản nháp chưa gửi. Sửa bản hiện hành không xóa những bản đã gửi trước; quy trình xóa theo yêu cầu phải xử lý cả lịch sử.

Các trạng thái màn hình: đang tải; link không dùng được; form trống/đã điền; đang gửi; đã nhận; đang sửa; lỗi từng trường; mất mạng/chưa xác nhận; xung đột do thiết bị khác vừa cập nhật. Thành công chỉ sau máy chủ xác nhận lưu; mở lại hiển thị bản hiện hành và nút Sửa riêng.

Khi lỗi mạng giữ nội dung trong bộ nhớ của đúng trang; không tự lưu nội dung riêng hoặc token vào localStorage/sessionStorage. Nhắc ngắn bản chưa gửi chỉ được giữ trong trang. Theo dõi dirty state và cảnh báo điều hướng chủ động, nhưng không hứa `beforeunload` cứu được bản nháp khi Zalo/OS đóng webview. Retry form không reload. Có thể cho khách chủ động copy nội dung đang gõ khi gặp lỗi; không tự ghi clipboard. Việc chuyển Zalo sang trình duyệt ngoài cần thử trên thiết bị thật.

Đã chốt cho khách xem lại/sửa cùng feedback khi hồ sơ đang mở nhận và link hợp lệ. Hai người cùng giữ link chia sẻ một bản phản hồi, không phải hai tài khoản đã xác minh; lịch sử không khẳng định danh tính người sửa ngoài tên họ tự điền. Khi có xung đột, giữ bản đang nhập và cho xem bản mới trước khi gửi lại; không âm thầm ghi đè. Khách không có đường dẫn/API xem phiên bản cũ.

Không có bộ chọn ngày hết hạn hoặc câu chữ đếm ngày. Thay bằng “Bạn có thể quay lại xem hoặc cập nhật khi hồ sơ đang mở nhận cảm nhận.” Tạm đóng/thu hồi/lưu trữ trả màn thông báo và liên hệ Chí Công; không trả body phản hồi cũ. Quyền chỉ đọc sau khi đóng chưa thuộc phạm vi đã thống nhất.

MVP dùng link gửi riêng, chưa đặt link ghi feedback vào gallery khách vì gallery có thể được chia sẻ cho người thân. Sau này muốn thêm nút trong gallery cần xác định quyền người đại diện trước.

### Vòng đời trang và bản nháp

- Context là cặp `(handoverId, token)`, không chỉ pathname. Xử lý hashchange/popstate riêng ở trang feedback; không dùng chung hash điều hướng admin. Khi context đổi, tăng epoch, hủy request cũ nếu có thể, xóa dữ liệu server cũ khỏi DOM và xác thực context mới. Response cũ không được render hoặc áp dụng vào context mới.
- Trong cùng context cũng có thứ tự request: mỗi lượt kiểm quyền có generation, kết quả của lượt cũ không áp dụng sau lượt mới. Khi PUT xác nhận v2, loại GET cũ đang chờ và không cho nội dung quay về v1; `latestVersion` đã nhận không được lùi. Kết quả active cũ không được mở lại UI sau một lượt mới hơn báo đóng/mất quyền. Chỉ một lượt kiểm mới, được khởi tạo sau đó, mới có thể xác nhận studio đã mở lại. Không bỏ qua ACK của PUT chỉ vì có GET mới hơn; tách đối soát thao tác lưu khỏi việc render/quyền hiện hành. Nếu thứ tự kết quả chưa đủ xác định, giữ trạng thái cần kiểm lại và lấy snapshot mới trước khi cho gửi tiếp.
- Không chuyển bản nháp/request key từ lời mời này sang lời mời khác. Nếu đổi context khi còn bản nháp, cho người dùng giữ/copy bản của mình trước khi rời, không tự đưa nội dung đó vào form mới.
- Khi pageshow, quay lại tab/app hoặc online trở lại: xác thực lại, tạm che dữ liệu đã tải và khóa gửi trong lúc kiểm. Thành công không ghi đè bản đang gõ; bị thu hồi thì bỏ dữ liệu server khỏi UI. Lỗi mạng là chưa kiểm tra được, không khẳng định link đã bị thu hồi.
- Trạng thái trên server luôn quyết định quyền; không có bộ hẹn giờ hết hạn feedback trên client. Không có chế độ đọc lại qua link đã đóng/thu hồi/lưu trữ. Không cần polling/WebSocket liên tục trong MVP.
- Thu hồi chặn truy cập mới sau khi cập nhật quyền có hiệu lực; không thể xóa nội dung người giữ link đã đọc/chụp hoặc phản hồi đã được cho phép trước đó. Không hứa làm nội dung biến mất tức thì ở tab khác đang mở.
- No-store không thay thế kiểm lại khi khôi phục trang. Chrome có cơ chế bfcache với một số trang no-store; cần test hành vi thực tế của cả Chromium/WebKit. [Tài liệu Chrome](https://developer.chrome.com/docs/web-platform/bfcache-ccns).

<a id="data-api"></a>

## 5. Dữ liệu và API dự kiến

| Bảng đề xuất | Dữ liệu chính |
| --- | --- |
| `handovers` | ID, tên/ngữ cảnh khách, dịch vụ/ngày chụp, inquiry tùy chọn, delivery_state/delivered_on/delivery_confirmed_at, archived_at, trạng thái/nonce/issued_at lời mời, ghi chú studio, handover_version, context_version, create_request_key/hash; key, command, request_hash và kết quả không chứa token của operation gần nhất; timestamps; không có trường hết hạn feedback |
| `handover_albums` | PK (handover_id, album_id), UNIQUE(album_id), FK và index tra cứu; không tải danh sách ảnh vào form feedback |
| `feedback` | ID, unique handover_id, snapshot ngữ cảnh và context_version lần gửi đầu, latest_version/read_version, created_at/updated_at; nội dung lấy từ revision tương ứng, không lưu song song một bản body nữa |
| `feedback_revisions` | FK feedback_id, unique (feedback_id, version), FULL snapshot tên người gửi, bốn cột rating nullable, cảm nhận/góp ý, form_version/nhãn tiêu chí lúc gửi, server_saved_at |
| `feedback_request_receipts` | Unique (handover_id, request_key), hash request chuẩn hóa, normalization_version, form_version của request, result_version, changed/no-op, created_at; chỉ phục vụ retry, không thay thế lịch sử nội dung |
| `feedback_notifications` | Unique event theo feedback/version, FK revision, loại new/updated, recipient đã chọn; null chỉ hợp lệ ở blocked_config hoặc suppressed khi chưa có người nhận. Các trạng thái có thể gửi/đã gửi yêu cầu recipient hợp lệ. Có state/attempts/next_attempt_at/lease và claim identity, provider reference, mã lỗi/lý do suppressed đã làm sạch, timestamps; không chứa token khách |

Inquiry tùy chọn dùng `ON DELETE SET NULL`; lưu snapshot ngữ cảnh để dữ liệu vẫn hiểu được khi nguồn thay đổi. Xóa gallery trong một tính năng tương lai chỉ xóa liên kết, không cascade mất feedback. Hiện repo chưa có route xóa album. Không tự tạo hồ sơ hoặc đánh dấu đã bàn giao cho dữ liệu cũ khi migration.

Ràng buộc: mỗi rating null hoặc số nguyên 1–5; latest/revision version nguyên dương; `0 <= read_version <= latest_version`; handover_version/context_version nguyên dương; enum hợp lệ; unique request key tạo hồ sơ. Dùng bốn cột integer nullable với CHECK, API trả/nhận object ratings theo whitelist. Form schema do server quản lý; nhãn/form_version của revision cũ không bị viết lại khi đổi copy sau này. Index/FK trên cả hai DB; SQLite không có RLS, PostgreSQL/Supabase bật RLS cho tất cả bảng mới. Revision là bất biến trong luồng sử dụng thông thường; quy trình xóa dữ liệu phải bao gồm chúng. Không cần dịch vụ worker/Redis mới cho phương án email tại mục 6.

Transaction lưu có thay đổi: khóa hồ sơ → kiểm trạng thái/quyền/nonce sau khi lấy khóa → kiểm receipt → kiểm formVersion đang được nhận và chuẩn hóa theo phiên bản → kiểm expectedVersion → kiểm expectedContextVersion nếu tạo lần đầu → so nội dung để phân biệt no-op/thay đổi → insert revision mới → cập nhật latest_version/updated_at → insert receipt → insert notification → commit. Mọi bước cùng transaction; lỗi bất kỳ rollback toàn bộ. Nếu tìm thấy receipt thì kết thúc nhánh replay bằng ACK/conflict theo hash và quyền hiện hành, không đi tiếp qua validator form mới hoặc kiểm version/ngữ cảnh của lượt ghi mới. Lần đầu tạo header và revision 1 cùng transaction. No-op chỉ tạo receipt, không tạo revision/notification hoặc unread. Rate-limit vẫn hạn chế cả request no-op để không tạo receipt vô hạn từ một nguồn. Receipts giữ cùng vòng đời dữ liệu feedback và được xử lý trong export/xóa dữ liệu.

API quản trị dự kiến: danh sách/chi tiết/tạo/sửa hồ sơ; liên kết gallery; đánh dấu bàn giao; lấy link; đóng/mở/thu hồi; đánh dấu phiên bản đã đọc; xem lịch sử phân trang và snapshot từng revision; xem/thử lại sự kiện email lỗi. Mỗi hành động quyền có command riêng, không PATCH toàn bộ record từ form cũ. Tất cả route admin đăng ký sau middleware `app.use('/api/admin',requireAdmin)` và trước catch-all API. API khách chỉ xác thực token; không tái dùng `allowed()` hoặc cho cookie admin/gallery bỏ qua kiểm token.

Contract khách dự kiến: GET trả ngữ cảnh tối thiểu, contextVersion, schema form đang được nhận (formVersion, nhãn, giới hạn, normalizationVersion) và bản hiện hành duy nhất khi hồ sơ đang mở nhận/link hợp lệ. PUT gửi đầy đủ tên/nội dung/góp ý, ratings gồm bốn key (null khi bỏ đánh giá), formVersion, requestKey và expectedVersion (0 khi tạo); expectedContextVersion bắt buộc khi expectedVersion=0, không dùng cho lần sửa. Server tự chọn normalizationVersion từ registry form/receipt, không tin phiên bản chuẩn hóa do khách tự khai. Chỉ nhận field cho phép; không nhận read_version, nonce, delivery state hay lịch sử từ khách. Response có latestVersion/latestFeedback và acknowledgedVersion/replayed để phân biệt thao tác đã nhận với bản hiện hành. Replay request tạo v1 khi hiện đã có v3 chỉ ACK v1 và trả nội dung v3; không đưa body v1 về khách qua retry, query version hoặc endpoint lịch sử. Đây là latest tại snapshot server xử lý, không cam kết tự cập nhật tức thì ở mọi tab.

422 có fields; 409 có code phân biệt xung đột phiên bản, tái dùng key sai, `CONTEXT_CHANGED` và `FORM_VERSION_UNSUPPORTED`; 429 có thời gian thử lại; lỗi quyền trả thông báo chung không lộ tên. Lỗi cấu hình/hạ tầng tạm thời không giả làm link không tồn tại. Form xử lý replay cũ bằng thông báo “Lần gửi trước đã được lưu; hiện đã có cập nhật mới hơn”, giữ bản đang viết để khách đối chiếu, không âm thầm ghi đè.

Error handler chung hiện trả fields/error và không giữ các mã `err.code` tùy ý. Route feedback cần serializer lỗi rõ ràng hoặc mở rộng có kiểm soát handler chung; chỉ gắn code vào Error chưa đủ. Kiểm response HTTP thực tế và cách form đọc code/fields, giữ nguyên contract lỗi của các tính năng khác.

Tách module nghiệp vụ/token và `feedback-form.mjs`, `admin-feedback.mjs`; chỉ nối route và điều hướng vào `app.mjs`/`main.js`. Tên file và endpoint cuối cùng được chốt cùng contract trước khi code. Danh sách admin phân trang, không join ảnh đầy đủ hoặc tạo truy vấn riêng cho từng hồ sơ.

<a id="security-delivery"></a>

## 6. Quyền truy cập, retry và đồng thời

**Phương án kỹ thuật đề xuất cần thử trước:** link dạng `/feedback/:handoverId#token`; token ký HMAC bằng khóa riêng `FEEDBACK_LINK_SECRET` có ít nhất 32 byte ngẫu nhiên. Chữ ký gồm mục đích sử dụng, ID hồ sơ và nonce/phiên bản lời mời trong DB. Admin tái tạo được cùng link để sao chép; thay nonce vô hiệu riêng link cũ. Cách này giải quyết yêu cầu copy lại, thay vì chỉ lưu hash token rồi không thể lấy lại link.

- Khóa chỉ ở server, giữ ổn định qua deploy/restart thông thường, không tự tạo lại lúc khởi động. Thiếu/sai định dạng khóa chỉ vô hiệu cấp link và API khách; admin vẫn đọc feedback đã lưu, website/gallery vẫn chạy. Đổi khóa làm mất hiệu lực toàn bộ link. Khóa được tạo bằng bộ sinh ngẫu nhiên mật mã; runtime kiểm encoding cố định và độ dài sau giải mã ít nhất 32 byte, không thể suy ra tính ngẫu nhiên chỉ từ độ dài chuỗi.
- Dùng native HMAC-SHA256, serialization cố định có phiên bản và purpose riêng; kiểm độ dài/encoding trước so sánh constant-time. Link dùng origin HTTPS từ SITE_URL đã được kiểm tra, không lấy Host hoặc origin bất kỳ của tab admin. Các thao tác lấy link cũng no-store.
- Fragment không nằm trong HTTP request URL; frontend gửi quyền qua header API, không log token/header hoặc nội dung cảm nhận. Cần thử việc giữ fragment khi mở/chia sẻ bằng Zalo và iOS trước khi chốt phương án.
- Fragment của trang feedback dành riêng cho token. Shell hiện có skip link `href="#main"`; không mang nguyên hành vi này vào trang feedback vì nó thay token. Giữ thao tác “Đến nội dung chính” bằng focus/scroll mà không đổi URL; các nút cuộn trong trang cũng không ghi đè hash. Link liên hệ/logo không nối fragment token sang URL đích.
- Link cấp quyền đọc/sửa feedback của đúng hồ sơ, không mở gallery, ảnh, Drive hay dữ liệu inquiry. Ai có link có quyền này; đây không phải xác minh danh tính bằng OTP.
- Không trả token qua API gallery, portfolio, public HTML hoặc bootstrap data. Không gửi inquiry notes/contact, ID gallery hay link Drive trong dữ liệu cho khách.
- Trang/API feedback dùng no-store; trang noindex và X-Robots-Tag, không vào sitemap, title/description/OG chung không tên khách hoặc ID lời mời, không analytics/structured data/bootstrap riêng tư, Referrer-Policy no-referrer. HTML shell không cần xác thực fragment và không làm lộ hồ sơ có tồn tại. Preview Zalo/GET không tiêu thụ lời mời, không đánh dấu đã đọc.
- Feedback HTML có CSP riêng chỉ cho script/connect cùng origin; không kế thừa nguồn Cloudflare analytics từ policy toàn site. Kiểm cả response/DOM/network qua proxy, bao gồm đường lỗi. Cloudflare hỗ trợ tự chèn analytics theo rule nên bỏ beacon trong app chưa chứng minh đã tắt ở edge. Kiểm/loại trừ /feedback/* trong cấu hình nếu dùng tự chèn. Chưa kết luận cấu hình production hiện tại. [Cloudflare Rules](https://developers.cloudflare.com/web-analytics/configuration-options/rules/).
- Handler HTML hiện coi mọi `req.params.id` là gallery (`app.mjs`, biến `galleryPage`): cần handler riêng hoặc tên tham số/nhánh private rõ. Nối cả server/frontend và giữ đúng quyền ở route có chữ hoa/dấu / cuối hoặc URL lỗi; không redirect mang token sang origin khác.
- Rate limit theo IP và lời mời hợp lệ; giới hạn thử token sai tổng thể, không tạo bản ghi quota vô hạn theo ID bất kỳ. Validate độ dài/định dạng, escape HTML và ràng buộc dữ liệu phía server. Giữ chính sách Origin hiện có cho mutation: phải đúng origin đã cấu hình; thiếu, null hoặc khác origin bị từ chối. Test/API client cũng phải gửi Origin đúng; không thêm CORS wildcard để né lỗi.

Quyền khách yêu cầu đồng thời: chữ ký/token hợp lệ, đúng ID/nonce hiện hành, `delivery_state=delivered`, không lưu trữ và lời mời active. Không có TTL ngầm dựa vào issued_at hoặc thời điểm feedback; issued_at chỉ phục vụ tra cứu. Bỏ hạn feedback không thay đổi timeout request, session admin/gallery, quota rate-limit, lease và backoff gửi email. Chưa có schema feedback được triển khai nên chỉ bỏ cột/endpoint dự kiến, không tạo migration xóa dữ liệu.

Khi ghi, transaction khóa hồ sơ rồi kiểm bàn giao/lưu trữ/đóng/nonce, kiểm replay, sau đó mới kiểm phiên bản và lưu. Đóng/mở/thu hồi dùng cùng thứ tự khóa. Kết quả phụ thuộc thứ tự transaction: ghi đã commit trước revoke được giữ; ghi đến sau revoke phải bị từ chối, kể cả request đã bắt đầu trước nhưng chờ khóa. Đọc ngữ cảnh/feedback cùng snapshot đã xác thực, tránh hai query ghép nội dung của trạng thái khác nhau.

**Ràng buộc tích hợp:** mọi truy vấn/helper trong transaction dùng cùng `tx`. Limiter `rate()` hiện giữ `db` bên ngoài; gọi nó trong callback transaction có thể deadlock SQLite do hàng đợi connection. Đặt limiter ngoài transaction rồi xác thực quyền lại trong transaction, hoặc refactor nhận connection tường minh. Không gửi email, gọi storage/network hoặc làm tác vụ chậm khi đang giữ khóa.

Nếu sửa liên kết giữa hai hồ sơ, khóa các hồ sơ theo cùng thứ tự ID cố định để tránh deadlock, kiểm version/quyền sửa của cả hai rồi cập nhật liên kết. `UNIQUE(album_id)` vẫn là bảo vệ cuối cùng; không thực hiện việc chuyển bằng hai request gỡ rồi gán độc lập.

- Receipt được giữ cho từng request đã được chấp nhận, kể cả no-op: cùng key/hash ACK kết quả thao tác và trả latest; cùng key khác hash trả conflict. Hash bao gồm payload chuẩn hóa, formVersion, expectedVersion và expectedContextVersion khi gửi đầu; không chứa token hoặc ghi chú admin.
- Unique handover_id bảo đảm tối đa một feedback. Hai lần gửi đầu đồng thời không tạo hai bản.
- Chỉnh sửa với key mới dùng expectedVersion; bản cũ không ghi đè bản mới. Request cũ đã có receipt được ACK, không append revision hoặc phát email lần nữa. Full receipt thay giới hạn chỉ nhớ key gần nhất trong v0.2; không tạo revision giả cho request no-op.
- Khách thay đổi nội dung đã chuẩn hóa mới tăng latest_version; phản hồi trở thành chưa đọc. No-op/replay không đổi latest_version/updated_at/read_version. Admin chỉ đánh dấu phiên bản đã nhìn thấy, dùng giá trị lớn hơn giữa read_version cũ và observed_version hợp lệ, không tự đánh dấu phiên bản mới hơn vừa đến là đã đọc. Unread là theo hồ sơ, không yêu cầu admin phải mở từng revision lịch sử để hết badge.
- Chốt chuẩn hóa trước khi tính hash: trim đầu/cuối, thống nhất xuống dòng, giữ xuống dòng bên trong; không tự bỏ dấu hoặc viết lại lời khách. Thay một tiêu chí sao, tên, lời chia sẻ hoặc góp ý đều là thay đổi nội dung. Thay ghi chú admin/trạng thái hồ sơ hoặc chỉ bấm Lưu không đổi nội dung không tạo phiên bản khách hay email.
- Registry form giữ ánh xạ bất biến từ formVersion sang nhãn, whitelist, giới hạn và normalizationVersion. Đổi nhãn/ý nghĩa hoặc quy tắc chuẩn hóa tạo phiên bản mới; không sửa định nghĩa bản cũ. GET trả rõ schema dùng để nhập mới và nhãn của revision đang xem; màn xem lại/email dùng nhãn revision, màn sửa dùng schema được server chấp nhận. MVP giữ nguyên bốn key/ý nghĩa; thay ý nghĩa tiêu chí về sau cần thiết kế chuyển đổi riêng.
- Tách “form được nhận cho request mới” khỏi “form còn được hiểu để replay”. Khi deploy đổi form, mặc định tiếp tục nhận bản cũ tương thích; nếu ngừng nhận phải trả `409 FORM_VERSION_UNSUPPORTED`, giữ bản nháp và cho khách tải schema mới để xem lại trước khi chủ động gửi với key mới. Không tự đổi formVersion hoặc tự gửi. Đổi riêng nhãn/schema nhưng nội dung khách không đổi vẫn là no-op, không tạo revision/email chỉ để thay nhãn.
- Sau kiểm kích thước/định dạng request cơ bản và xác thực quyền hiện hành, tra receipt trước validator của form mới. Có receipt thì tính hash theo normalizationVersion/formVersion đã lưu và so với request gốc; khớp thì ACK và trả latest, kể cả form cũ đã ngừng nhận request mới. Khác hash trả conflict. Không có receipt mới áp dụng danh sách form được nhận và validator tương ứng. Giữ các định nghĩa/thuật toán replay suốt vòng đời receipts, kể cả trong backup/restore và bản code dùng rollback; không mở API feedback bằng bản code bỏ khả năng đọc receipt còn tồn tại; rollback về bản không có feedback phải giữ tính năng tắt cho đến khi dùng lại runtime tương thích. Không đưa token hoặc dữ liệu nhận diện vào thông báo lỗi.
- Thu hồi/đóng link/lưu trữ không xóa feedback. Chỉ hiện thông báo an toàn và cách liên hệ studio khi link không dùng được.

Admin cũng có optimistic version riêng: save/assign/complete/close/resume/rotate/archive gửi expected handover_version và identity thao tác. Retry tạo hồ sơ/rotate sau mất ACK không tạo thêm hồ sơ hoặc đổi nonce lần nữa. Giữ form admin khi conflict; không dùng khóa DB làm lý do cho phép last-write-wins. Copy/đọc không tăng handover_version. Guard điều hướng loại response hồ sơ A đến sau khi đã mở B.

Operation admin phải gắn key với command và hash payload chuẩn hóa, gồm expected handover_version và ID các đối tượng liên quan; cùng key nhưng command/payload khác trả conflict. Operation còn lưu thì ACK mà không làm lại; operation cũ không còn lưu phải qua kiểm version, không tự áp dụng lại với version mới. Lưu kết quả không chứa token hoặc URL có chữ ký; sau replay UI đọc trạng thái hiện hành, chỉ lấy link theo điều kiện copy đang hiệu lực. Không trả lại link cũ từ receipt sau khi quyền đã đổi.

Khi timeout hoặc response không đầy đủ, giữ snapshot bất biến `{context, payload, requestKey, expectedVersion}`. Retry đúng snapshot hoặc đối chiếu bản server trước khi tạo lượt sửa mới; không tự nâng expectedVersion để ghi đè bản khác. Nếu token đã bị thu hồi thì kiểm quyền vẫn đứng trước replay. Lỗi này không có nghĩa server chưa lưu.

Nếu khách gõ thêm sau timeout, giữ phần đó thành draft riêng. Nút “Kiểm tra lần gửi trước” chỉ đối soát/retry snapshot cũ; không gửi phần đang gõ bằng key cũ. Chỉ tạo lượt lưu mới sau khi xác định kết quả trước và khách chủ động gửi. Nếu link đã đóng thì dừng gửi, không dùng retry để vượt quyền; không suy từ việc không đọc được thành kết luận lần trước chưa lưu.

Xác nhận lần gửi trước dựa trên ACK/receipt của đúng request key, có thể bằng retry PUT nguyên snapshot để nhận kết quả. Chỉ GET thấy nội dung giống nhau không chứng minh request đó đã được nhận; không suy đoán thành công bằng cách so sánh lời nhắn.

Frontend transport phải chốt cấu trúc lỗi (`api-request.mjs` dùng error.data.fields, inquiry dùng error.fields). Helper API hiện tự ghi đè AbortSignal: dùng transport riêng hoặc mở rộng có kiểm soát nếu cần hủy theo context; abort không chứng minh server chưa ghi, luôn giữ epoch guard. Form module tự nhận submit và stopPropagation để không chạy trùng handler chung.

### Email thông báo studio

- Đã chốt phát sinh ở phiên bản đầu và mỗi phiên bản nội dung mới. Feedback, revision, receipt và notification phải được commit cùng nhau; phản hồi thành công cho khách dựa trên việc lưu, không chờ email. Lỗi email không làm mất feedback hoặc yêu cầu khách gửi lại.
- Tái dùng `mailer.sendEmail` với template studio riêng; không dùng `notifyNewInquiry` vì hàm đó còn gửi xác nhận cho khách. Người nhận lấy từ cấu hình thông báo hiện có (`NOTIFICATION_EMAIL`, `STUDIO_EMAIL`, hoặc email studio trong settings); không fallback sang địa chỉ hardcode chưa xác nhận. Lưu recipient đã chọn theo event. Thiếu recipient/provider là trạng thái chờ cấu hình hiển thị trong admin, không đánh dấu đã gửi.
- Bộ xử lý nhỏ chạy trong Node process hiện tại: đánh thức sau commit, kiểm việc còn chờ khi startup và theo timer, batch hữu hạn. Claim/lease trong DB bảo đảm hai instance không cùng xử lý một job trong cùng khoảng lease. Gửi mail ngoài transaction; timeout thực tế phải hữu hạn, lease dài hơn thời gian gửi có chặn. SMTP cần cấu hình timeout/đóng transport thực sự, không chỉ Promise.race để bỏ mặc lần gửi cũ.
- Mỗi lần claim có identity riêng; ghi ACK/lỗi/retry bằng cập nhật có điều kiện theo identity đó. Kết quả đến trễ của worker đã mất lease không được ghi đè lượt mới hoặc chuyển event suppressed trở lại retry. Thao tác thử lại thủ công không lấy một job processing còn lease hợp lệ để gửi song song.
- Trạng thái: pending, processing có lease, retry_wait, blocked_config, failed, accepted_by_provider và suppressed. Suppressed có lý do/thời điểm, không được startup/timer tự claim, không đồng nghĩa gửi lỗi; chỉ thao tác chọn event cụ thể mới cho gửi lại. Retry lỗi tạm thời theo backoff có giới hạn; đề xuất 6 lần tổng cộng, các lần thử lại chờ 1/5/30/120/360 phút sau lỗi. Lỗi vĩnh viễn hoặc hết lượt hiển thị cần xử lý; thử lại thủ công dùng event cũ, không tạo một phiên bản feedback mới.
- Thiếu cấu hình không tiêu lượt retry. Bổ sung provider giữ nguyên recipient đã lưu; event thiếu recipient giữ null và không được gửi. Admin chọn “Cập nhật người nhận và thử lại” để xác nhận địa chỉ cho event thiếu/sai người nhận; không âm thầm chuyển email cũ sang địa chỉ mới khi settings thay đổi. Khi thoát blocked_config phải kiểm lại cấu hình hợp lệ trước khi chuyển pending.
- Event thiếu recipient có thể chuyển từ blocked_config sang suppressed sau restore mà vẫn giữ null. Khi chọn gửi lại event này, admin phải xác nhận người nhận trước; không tạo địa chỉ giả để thỏa constraint và không tự lấy địa chỉ mới trong settings để gửi event cũ.
- Provider chấp nhận không chứng minh thư đã đến inbox hoặc đã được đọc. Unique event chống sinh job trùng; không hứa email chỉ đến đúng một lần khi dịch vụ đã nhận nhưng process chết trước khi ghi ACK. Một thông báo trùng trong trường hợp đó phải giữ cùng mã hồ sơ/phiên bản, không tạo feedback trùng. Khi server ngủ/ngừng hoạt động, job vẫn còn nhưng việc gửi tiếp tục lúc process hoạt động lại; không hứa SLA tức thì.
- Email đầy đủ đã được yêu cầu: mã hồ sơ/ngữ cảnh buổi chụp đã snapshot, tên người gửi tại revision đó, loại sự kiện, phiên bản/thời điểm, bốn tiêu chí kèm nhãn và điểm (null = Chưa đánh giá), toàn bộ cảm nhận và góp ý, nút mở admin cần đăng nhập. Render từ revision mà notification trỏ đến và snapshot ngữ cảnh bất biến, không dùng latest hoặc tên khách hiện tại để dựng email cũ. v1 chờ gửi trong lúc đã có v3 vẫn phải gửi đầy đủ v1. Góp ý trống hiện Chưa có góp ý bổ sung; không tự diễn giải thành hoàn toàn hài lòng.
- Cả HTML và plain-text giữ đầy đủ nội dung/xuống dòng; escape dữ liệu khách và làm sạch CR/LF khi đưa tên vào subject. Full email là toàn bộ phản hồi khách gửi, không kéo thêm ghi chú nội bộ, token/link khách, inquiry contact, Drive/ảnh hoặc toàn bộ lịch sử các phiên bản khác. Không thêm reply-to khách vì form không thu email. Link admin mở latest trước và có lịch sử để đối chiếu; thư ghi rõ phiên bản/thời điểm, tránh hiểu thư đến sau là bản mới nhất.
- Email không đánh dấu feedback đã đọc, kể cả khi dịch vụ quét link hoặc người nhận chưa đăng nhập. Việc mở link admin vẫn tuân theo quy tắc observed_version khi admin thực sự xem.
- Shutdown dừng nhận job mới và chờ lượt gửi đang xử lý trong giới hạn trước khi đóng DB; crash được phục hồi bằng lease. Giữ các bước cleanup hiện có của photoCleanup, mediaControl và storage trong `start.mjs`; không thay chúng bằng dispatcher feedback. Không có request khách nào phải giữ transaction chờ gửi mail.
- Khi restore DB cũ, đặt cờ vận hành ngoài DB (đề xuất `FEEDBACK_NOTIFICATIONS_PAUSED=true`) trước restore/startup trên mọi instance; gate chặn cả lượt quét đầu, timer và wake sau commit. Đối soát toàn bộ event phục hồi chưa có ACK chắc chắn, gồm pending/retry_wait/processing/blocked_config/failed, rồi suppressed những event không được chủ động chọn gửi lại. Không tự tái tạo queue từ revision cũ. Chỉ mở dispatcher sau đối soát; đổi key link không thay thế gate email. Restart/deploy bình thường tiếp tục queue/lease mà không suppress hàng loạt.
- Tạm đóng/thu hồi/lưu trữ thông thường không hủy thông báo của feedback đã lưu hợp lệ trước đó. Quy trình xóa dữ liệu mới dừng claim, chờ lượt đang gửi kết thúc trong giới hạn, purge dữ liệu/job rồi mới mở lại bộ gửi; không để job đã giữ trong bộ nhớ được retry sau purge. Email đã gửi là bản sao của revision đó; sửa/xóa trên website không tự sửa/xóa thư trong hộp thư.

<a id="acceptance-operations"></a>

## 7. Lộ trình và điều kiện hoàn thành

| Chặng | Công việc | Điều kiện chuyển bước |
| --- | --- | --- |
| 1. Khóa bản thiết kế | Đối chiếu nhãn trạng thái, mẫu form/admin và email đầy đủ với luồng đã chốt; chốt tên endpoint/lỗi | Không còn câu hỏi về hạn/email ngắn/cách xưng hô; không viết tính năng trong lượt review này |
| 2. Thử rủi ro kỹ thuật | Khi bắt đầu triển khai: prototype dùng dữ liệu giả cho fragment/Zalo, lifecycle và private shell qua proxy; thử transaction/retry trên hai DB | Nếu fragment không giữ được, quay lại chọn cách truyền token trước khi xây toàn bộ form; không âm thầm chuyển token sang query URL |
| 3. Dữ liệu và quyền | Migration additive SQLite/Postgres; revision/receipt/notification; token; đóng/mở/thu hồi; API/transaction/export | Dữ liệu cũ nguyên vẹn, quyền và retry/concurrency đúng, không deadlock SQLite |
| 4. Admin và form | Hồ sơ/gom gallery, copy link, inbox/chưa đọc, lịch sử, bốn tiêu chí sao, gửi/sửa, trạng thái và xử lý email lỗi | Chạy đủ hành trình với dữ liệu tạm, mobile và bàn phím; email dùng transport giả khi test |
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
| FB05 | Toàn bộ bảng chuyển trạng thái mục 4; ngày quá khứ hợp lệ; copy chỉ khi delivered/active/chưa lưu trữ, giữ link; complete trên delivered active/paused/revoked không đổi nonce/quyền; no-op không mở lại hồ sơ | API + state transitions |
| FB06 | Token sai/thiếu/quá dài/khác hồ sơ, draft, paused, revoked, archived không đọc/ghi; admin/gallery cookie không bỏ qua | API negative tests |
| FB07 | Token feedback không cho xem ảnh, inquiry/contact/Drive; API public/gallery/export không xác thực không đọc được feedback | API + DTO review |
| FB08 | GET/preview không tiêu thụ link, không đánh dấu đã đọc, HTML/OG lỗi không lộ tên | HTTP + preview thực tế |
| FB09 | Copy lại và restart với cùng key giữ link; rotate key làm link cũ vô hiệu; thiếu key chỉ khóa tính năng cần key | API + startup |
| FB10 | Gửi đúp, retry mất ACK: một feedback; receipt cùng hash ACK, khác hash conflict; replay cũ trả latest, không tăng version/unread; no-op A→B→retry A có receipt riêng không tạo lịch sử/email | Hai DB |
| FB11 | Hai lần tạo feedback đồng thời không tạo hai bản; hai tab sửa cùng version có một thắng và một conflict | Hai DB + hai browser context |
| FB12 | Ghi đồng thời revoke/pause/archive/undo/resume theo thứ tự khóa; không có mutation vượt kiểm quyền sau revoke commit | Hai DB + concurrency có barrier |
| FB13 | Đọc feedback trong lúc thay quyền/ngữ cảnh không ghép kết quả từ hai snapshot khác nhau; mở form với ngữ cảnh A → admin sửa B → gửi đầu phải CONTEXT_CHANGED và không ghi dữ liệu; sửa ghi chú riêng không gây conflict | Hai DB + concurrency |
| FB14 | Admin create/complete/rotate mất ACK retry không tạo record/đổi nonce lần nữa; cùng key khác command/payload conflict; operation cũ/version cũ không làm lại; receipt/export không lưu token; form admin cũ conflict | API + admin UI |
| FB15 | Admin đang xem v1, khách gửi v2, đánh dấu đọc v1 không làm v2 thành đã đọc; xem lịch sử/email scan/retry/no-op không tự đánh dấu bản mới đã đọc | Hai DB |
| FB16 | Tiếng Việt/Unicode, số thực/chuỗi rating, null từng tiêu chí, thiếu/thừa key, khoảng trắng, giới hạn độ dài, HTML; nội dung luôn escape khi render | Validation + DOM |
| FB17 | Bỏ rating/góp ý lưu đúng; field thừa không sửa trạng thái; serializer trả đúng code/fields 422/409/429/5xx tới form, giữ bản nhập, không đổi error contract tính năng khác | API + form |
| FB18 | Timeout sau server commit, response hỏng/mất mạng giữ snapshot retry; phần gõ thêm là draft riêng; Kiểm tra lần gửi trước không gửi draft mới, không tự nâng version; mất ACK rồi deploy đổi/ngừng nhận form cũ: retry nguyên snapshot vẫn ACK theo receipt, không tạo thêm event | Transport tests + browser |
| FB19 | Chuyển A→B, đổi token, Back/Forward và response A đến trễ không trộn context; cùng context, GET v1 về sau PUT v2 không lùi nội dung hoặc xóa draft/ACK | Browser + delayed response |
| FB20 | pageshow/quay lại Zalo/tab/online kiểm quyền, che dữ liệu server, giữ draft; offline không phải revoke; response active cũ không mở lại UI sau kết quả đóng/mất quyền, cần kiểm mới để mở lại | Chromium/WebKit + thiết bị thật |
| FB21 | Dirty guard, lỗi khởi tạo, submit bubbling, bàn phím/focus, double click, không reload khi retry; skip-to-content/cuộn trang không thay fragment token | Browser UX |
| FB22 | Form/admin ở 320/390/768/1440 px; Zalo iOS/Android mở link, fragment, chuyển trình duyệt ngoài; clipboard bị từ chối có fallback | Browser + thiết bị thật |
| FB23 | Origin thiếu/sai/cross-origin theo policy; rate limit IP/invitation, reset/thời gian thử lại; ID ngẫu nhiên không phình quota; không deadlock | API + hai DB |
| FB24 | HTML/API/error no-store, noindex, no-referrer, CSP riêng; không PII/token trong bootstrap/SEO/sitemap/log/analytics | HTTP + DOM/network/log review |
| FB25 | Qua hostname/proxy staging thực tế: không beacon hoặc bên thứ ba đọc token; exclude Cloudflare nếu đang tự chèn; URL lỗi/case/trailing slash vẫn private | Cấu hình edge + browser network |
| FB26 | Migration mới/cũ/chạy lặp; CHECK/unique/index/FK; PostgreSQL RLS không cho anon/authenticated đọc bảng; app role vẫn hoạt động | Hai DB + role tests |
| FB27 | Export admin và registry/snapshot/verify media-backup đủ bảng; version và cách đọc backup trước feedback rõ; snapshot nhất quán lúc có ghi, không chứa signing secret/link có chữ ký; inventory không lỗi bảng chưa đăng ký; kiểm registry cố định v1/v2/v3, dữ liệu Drive vẫn đủ, snapshot mới thiếu bảng bắt buộc phải bị từ chối | Export/backup integration |
| FB28 | Restore snapshot cũ sau revoke không hồi sinh link: chặn API và đổi secret trước traffic; công cụ restore/startup giữ email gate; media lock không thay gate feedback; báo rõ dữ liệu sau snapshot có thể mất | Diễn tập staging |
| FB29 | Rollback code không xóa bảng/dữ liệu mới hoặc khôi phục DB cũ; thiếu key không làm gallery/public dừng; giữ runtime backup tương thích và kiểm snapshot/verify/restore sau rollback trên DB còn bảng feedback; replay receipts cũ khi bật lại | Staging + regression |
| FB30 | Gallery password/tim/sync/lọc phần/upload/JPG/ZIP/lightbox; inquiry/admin/public không thay hành vi | Bộ regression tương ứng |
| FB31 | v1→v2→v3 lưu full snapshot; đổi tên/sao về null/xóa góp ý giữ bản cũ; sửa ngữ cảnh hồ sơ không viết lại snapshot phản hồi/email; admin xem lịch sử phân trang và phân biệt ngữ cảnh, khách chỉ latest; expectedContextVersion chỉ bảo vệ lần tạo, replay đã có receipt vẫn ACK sau khi admin sửa ngữ cảnh | Hai DB + admin/customer API/UI |
| FB32 | Không thể lấy revision cũ qua token khách, ID đoán, query version, endpoint admin hoặc replay request cũ; response không chứa history | Security + API |
| FB33 | Lỗi giữa header/revision/receipt/notification rollback toàn bộ; hai cập nhật cùng version chỉ một thắng; retry không tạo revision/event trùng | Hai DB + fault injection |
| FB34 | Link active vẫn hợp lệ sau thời gian dài/restart; không TTL ngầm; pause/revoke khi request đang chờ khóa vẫn chặn; resume chỉ từ paused; unarchive không tự mở; đã đọc/đã có feedback không tự đóng | Hai DB + clock/state tests |
| FB35 | Bốn tiêu chí bỏ qua độc lập; không tự tính điểm chung; thay nhãn form tương lai không viết lại nhãn/snapshot lịch sử; form cũ còn hỗ trợ dùng đúng nhãn cũ; ngừng hỗ trợ request mới trả lỗi rõ và giữ draft; đổi schema riêng không tạo revision/email no-op; không tin nhãn từ client | UI + schema migration fixture |
| FB36 | Mỗi revision tạo một notification đúng loại/recipient; replay/no-op/admin note/state change không tạo email; email lỗi vẫn giữ feedback thành công | Hai DB + mocked mailer |
| FB37 | Restart/lease/hai process claim, timeout/429/5xx, lỗi vĩnh viễn, blocked_config/retry/shutdown; kết quả lease cũ không ghi đè lượt mới; không retry processing còn lease; sửa provider giữ recipient; blocked_config/suppressed null phải chọn recipient trước gửi | Worker integration giả lập, không gửi thư thật |
| FB38 | Crash sau provider nhận trước DB ACK thể hiện giới hạn có thể gửi trùng; không tạo revision/job mới, trạng thái accepted không đồng nghĩa inbox delivered | Fault injection + mailer fake |
| FB39 | Email đầy đủ đúng snapshot: trì hoãn v1 rồi lưu v2/v3 vẫn gửi tên/bốn sao/cảm nhận/góp ý/nhãn v1; null/HTML độc hại/newline render đúng; link admin không mang token khách; không rò nội dung vào log | Template/security tests + delayed fake mailer |
| FB40 | Export/backup/restore/RLS/xóa đủ revisions/receipts/notifications; restore đúng FK/schema, gate trước startup không gọi transport, suppressed giữ recipient null và không tự claim; job đã claim trước purge không retry; không hứa rút lại thư đã chuyển; backup → xóa → restore phải áp dụng lại sổ xóa độc lập trước mở admin/export/API; thiếu sổ giữ gate; crash/purge lặp không hồi sinh dữ liệu | Hai DB + diễn tập staging |

### Backup, khôi phục và vận hành

- JSON export hiện là bản metadata đọc tuần tự, không phải bản sao lưu database nhất quán hoặc cơ chế restore hoàn chỉnh. Khi thêm bảng mới, nâng version định dạng export và đọc một snapshot nhất quán: SQLite transaction phù hợp, PostgreSQL transaction read-only REPEATABLE READ hoặc cơ chế tương đương. Chỉ bọc BEGIN mặc định PostgreSQL chưa đủ cho nhiều SELECT. Nếu chưa làm được điều này, không quảng bá export đó là bản khôi phục đầy đủ.
- Công cụ `studio/tools/media-backup.mjs` hiện có `databaseSnapshot` riêng với transaction nhất quán, registry bảng và `schemaVersion: 2` ở source đối chiếu ngày 21/10/2026; validator đọc v1 (legacy) và v2 (legacy + Drive), có danh sách cache Drive tạm không sao lưu. Nó từ chối database có bảng chưa đăng ký ngoài các cache tạm đã biết. Phải cập nhật registry cho đủ sáu bảng feedback, thứ tự xóa/insert theo FK, phiên bản snapshot, `verifyBackup` và `restoreBackup` trong cùng đợt schema. Chỉ sửa `/api/admin/export` sẽ khiến inventory/backup mới lỗi. Không thay snapshot đang có bằng export admin yếu hơn.
- Định dạng feedback kế thừa đầy đủ v2, dự kiến nâng lên v3 nếu chưa có thay đổi schema khác trước lúc triển khai; không dùng lại số phiên bản đã tồn tại. Duy trì validator theo registry cố định của từng phiên bản: v1 thiếu các bảng Drive/feedback theo thiết kế, v2 thiếu feedback theo thiết kế; restore khởi tạo các bảng mới tương ứng rỗng. Với v3, thiếu bất kỳ bảng bắt buộc nào là lỗi, kể cả bảng được kỳ vọng rỗng. Giữ xử lý riêng của Drive khi restore (vô hiệu approvals/job không an toàn, reset heartbeat và cache), thứ tự FK và các bộ đếm hiện có; không áp dụng quy tắc notification để thay thế quy tắc Drive. Kiểm fixture v1/v2/v3 và từ chối schema không hỗ trợ; không xóa lịch sử để phục hồi bằng công cụ cũ.
- Backup vận hành dùng cơ chế snapshot/dump nhất quán của database, kèm quy trình phục hồi đang dùng; ảnh/tệp vẫn cần backup riêng. Metadata feedback và ghi chú studio là dữ liệu riêng tư. Giữ signing secret ngoài JSON export và ngoài repository; bảo quản riêng theo quy trình bí mật vận hành.
- **Restart/deploy thông thường khác restore dữ liệu cũ.** Restart/deploy giữ secret. Restore snapshot cũ có thể phục hồi nonce/trạng thái active trước lúc thu hồi: mặc định phải chặn API feedback trong thời gian phục hồi, đổi `FEEDBACK_LINK_SECRET` trước khi mở traffic feedback, rồi cấp lại những link thực sự cần dùng. Không giữ nguyên key chỉ để giữ link cũ, trừ khi đã đối soát được toàn bộ sự kiện thu hồi/thay quyền sau snapshot bằng nguồn đáng tin cậy; MVP không có sổ sự kiện đó.
- Secret mới phải có hiệu lực trên mọi instance còn phục vụ trước khi mở feedback; không để instance giữ key cũ tiếp nhận request trong quá trình phục hồi. Việc đổi key không cứu dữ liệu gửi sau thời điểm snapshot: đây là mất dữ liệu cần đánh giá riêng, không gọi restore thành công chỉ vì web lên lại.
- Restore cũng dừng bộ gửi email và đối soát notification đã phục hồi theo mục 6. Đổi secret không ngăn tự phát lại email; phải kiểm hai cơ chế riêng. Backup/export gồm header, đầy đủ revisions/receipts/notifications cùng một snapshot; không dùng receipt hoặc thông báo email làm bản thay thế lịch sử nội dung.
- Tích hợp quy tắc restore vào công cụ media đang có: `restoreBackup` hiện đặt dữ liệu ở thư mục mới, reset session/khóa media, nhưng chưa biết notification feedback. Khi bổ sung tính năng, công cụ và hướng dẫn startup phải bảo đảm API feedback bị chặn, gate email đã bật trên mọi process trước khi app chạy, và các job phục hồi chưa có ACK chắc chắn được đối soát/suppress trước khi mở gửi. Khóa bảo trì media không tự chặn API feedback hoặc dispatcher. Backup thông thường vẫn có thể nhận feedback nếu snapshot DB nhất quán; không biến mỗi lần backup thành tạm đóng hồ sơ khách.
- Trước phát hành: triển khai additive, cấu hình key/site URL, kiểm private shell/quyền/DB trên staging; sẵn sàng vô hiệu API khách khi cấu hình sai. Health check hiện chỉ đọc settings, chưa chứng minh feedback sẵn sàng; cần kiểm riêng readiness của tính năng và báo lỗi rõ cho admin.
- Rollback code bảo toàn bảng/dữ liệu mới. Không rollback bằng DROP hoặc nạp bản DB cũ. Trước phát hành ghi rõ revision ứng dụng có thể rollback và revision/runtime backup tương thích với schema mới, các form/normalizationVersion và receipts đang lưu. Công cụ trước feedback sẽ từ chối bảng mới chưa đăng ký; phải giữ công cụ backup tương thích đã kiểm trên DB sau migration, không rollback mù toàn bộ runtime backup theo ứng dụng. Trong thời gian rollback, link có thể tạm không dùng được; admin không nên gửi lời mời mới. Chỉ mở lại khi migration/key/quyền/replay đã kiểm xong. FB29 phải kiểm cả snapshot/verify/restore bằng công cụ được giữ lại sau rollback, không chỉ kiểm web lên được.
- Lưu trữ là đóng hồ sơ, **không phải xóa dữ liệu**. MVP không cần nút xóa hàng loạt, nhưng runbook phải có cách xử lý yêu cầu xóa gửi qua kênh studio đã biết: kiểm đúng hồ sơ, thu hồi link, xóa nội dung và dữ liệu nhận diện liên quan theo phạm vi yêu cầu, ghi nhận tối thiểu việc xử lý; không tự hứa đã xóa khỏi mọi backup. Chốt nơi lưu/ai truy cập/thời hạn giữ backup trong vận hành, không tự đặt một thời hạn pháp lý trong kế hoạch này.
- Phạm vi xóa phải bao gồm tất cả revision, receipt và notification liên quan. Runbook: ghi bền vững yêu cầu xóa tối thiểu ở sổ vận hành ngoài DB được phục hồi → thu hồi quyền khách → dừng claim mới trên mọi dispatcher → chờ các lượt đang gửi kết thúc trong giới hạn → purge dữ liệu liên quan trong transaction → mở lại dispatcher. Chỉ đánh dấu yêu cầu xóa đã áp dụng sau khi transaction purge thành công; nếu crash giữa các bước, tiếp tục cùng yêu cầu theo cách idempotent. Không giữ job hồ sơ đã xóa trong bộ nhớ để retry. Email đầy đủ đã được dịch vụ nhận là một bản sao ngoài website; quy trình xóa phải phân biệt bản trong ứng dụng với hộp thư/backup và không hứa thu hồi thư đã gửi.
- Sổ xử lý xóa là dữ liệu vận hành riêng có kiểm soát truy cập và backup độc lập, không bị ghi đè bằng snapshot ứng dụng cũ. Chỉ lưu ID yêu cầu, handoverId/feedbackId cần đối soát, phạm vi xóa, thời điểm và trạng thái xử lý; không lưu tên, lời khách, token hoặc email. Không tái sử dụng ID hồ sơ đã xóa. Giữ các dấu vết này ít nhất trong thời gian còn backup có thể phục hồi dữ liệu tương ứng; xác định vị trí, quyền truy cập và người phụ trách trong runbook trước phát hành.
- Sau restore, giữ gate API khách/email và chặn admin đọc/export dữ liệu feedback phục hồi cho đến khi đối soát sổ xóa độc lập. Áp dụng lại các yêu cầu có liên quan (kể cả yêu cầu đang xử lý), purge đủ lịch sử/receipts/notifications và phần nhận diện theo phạm vi; thực hiện lặp lại an toàn. Thiếu sổ hoặc không xác minh được tính đầy đủ thì chưa mở dữ liệu feedback phục hồi. Đổi secret và suppress email không thay thế bước này. FB40 phải diễn tập backup → xóa → restore, gồm crash giữa ghi yêu cầu và purge, và xác nhận dữ liệu đã xóa không xuất hiện lại qua admin/export/API hoặc queue. Quy trình không tuyên bố đã xóa bản sao trong mọi backup/hộp thư.

<a id="scope-boundary"></a>

## 8. Ngoài MVP và bước review tiếp theo

Ngoài MVP: testimonials công khai, duyệt/ghim, ảnh đại diện, Review schema, xin quyền sử dụng công khai, email mời khách, tự nhắc khách, đồng bộ Drive, checklist sản phẩm, customer accounts/OTP, dashboard thống kê nâng cao, hội thoại qua lại. Email báo studio và lịch sử đầy đủ đã vào phạm vi; badge/inbox admin là nguồn đầy đủ để theo dõi, email là thông báo bổ sung.

Không còn câu hỏi nghiệp vụ bắt buộc về hạn, độ đầy đủ email hoặc xưng hô. Bước review tiếp theo là đọc mẫu form/email và đối chiếu bốn nhãn danh sách với bảng chuyển trạng thái; chỉ ghi nhận ngoại lệ thực tế nếu studio có, không mở thêm chức năng chỉ để tiếp tục hỏi.

Các tiêu chí kỹ thuật chưa được xác minh khi chưa có implementation: fragment/Zalo, lifecycle, transaction/history trên PostgreSQL, retry/lease và email đúng snapshot. Đây là việc kiểm chứng của người triển khai, không yêu cầu studio chọn chi tiết mật mã/database. Tài liệu này vẫn ở giai đoạn lập kế hoạch, chưa bắt đầu code. Không tự công khai feedback nội bộ nếu tương lai bổ sung testimonials.

<a id="product-copy"></a>

## 9. Toàn bộ câu chữ form, Zalo và email

Đây là bản nháp để studio review, chưa được đưa vào ứng dụng hoặc gửi cho khách. Dùng “bạn” trên form cho cả chân dung và cặp đôi; tin nhắn mời có hai phiên bản. Không yêu cầu khách khen, không hứa Chí Công đã đọc hoặc email đã đến khi mới lưu thành công. Các đoạn dưới đây là nguồn câu chữ thống nhất, thay cho ví dụ rời rạc ở các tài liệu trước.

### 9.1. Tin nhắn mời gửi qua Zalo/tin nhắn

#### Một người

> Chào [Tên], Chí Công đã hoàn tất phần bàn giao cho [Tên buổi chụp]. Khi có chút thời gian, bạn chia sẻ với Chí Công cảm nhận về buổi chụp và sản phẩm đã nhận nhé. Điều bạn ưng ý hay điều Chí Công có thể làm tốt hơn đều rất hữu ích.
>
> Bạn gửi tại đây: [Link feedback]
>
> Phần chia sẻ này chỉ gửi riêng cho studio. Bạn có thể quay lại đường dẫn này để xem hoặc cập nhật khi studio đang mở nhận cảm nhận.
>
> Cảm ơn bạn đã tin tưởng Chí Công.

#### Cặp đôi

> Chào hai bạn, Chí Công đã hoàn tất phần bàn giao cho [Tên buổi chụp]. Khi có chút thời gian, hai bạn chia sẻ với Chí Công cảm nhận về buổi chụp và sản phẩm đã nhận nhé. Những điều hai bạn yêu thích hoặc thấy Chí Công có thể làm tốt hơn đều rất đáng quý.
>
> Hai bạn gửi tại đây: [Link feedback]
>
> Đây là một phần cảm nhận chung cho buổi chụp, chỉ gửi riêng cho studio. Hai bạn có thể quay lại đường dẫn này để xem hoặc cập nhật khi studio đang mở nhận cảm nhận.
>
> Cảm ơn hai bạn đã tin tưởng Chí Công ghi lại những khoảnh khắc này.

Chỉ dùng mẫu đã hoàn tất bàn giao sau khi studio xác nhận thực tế; placeholder phải được thay trước khi gửi. Đợt này admin copy/gửi thủ công, không có bot nhắn khách hoặc gửi email mời tự động.

### 9.2. Phần mở đầu form

**Nhãn nhỏ:** CẢM NHẬN CỦA BẠN

**Tiêu đề:** Kể Chí Công nghe về trải nghiệm của bạn

**Lời mở:**

> Cảm ơn bạn đã tin tưởng Chí Công. Sau khi nhận sản phẩm, nếu có điều ưng ý hoặc chưa như mong đợi, bạn cứ chia sẻ ở đây nhé. Chí Công sẽ đọc để hiểu trải nghiệm của bạn và làm tốt hơn.

**Ngữ cảnh:** [Tên buổi chụp] · [Ngày chụp, nếu có]

**Riêng tư:**

> Chia sẻ này chỉ gửi riêng cho Chí Công và studio, không hiển thị công khai trên website.

Tên buổi/ngày chụp chỉ hiện sau khi xác thực link thành công; không đưa vào title/OG/preview công khai.

### 9.3. Các trường và lời hướng dẫn

| Thành phần | Nội dung |
| --- | --- |
| Tên — nhãn | **Tên bạn muốn dùng \*** |
| Tên — hướng dẫn | Bạn có thể dùng tên riêng hoặc tên hai người. |
| Cảm nhận — nhãn | **Cảm nhận của bạn \*** |
| Cảm nhận — placeholder | Bạn cảm thấy thế nào về buổi chụp và sản phẩm đã nhận? Có điều gì bạn muốn kể với Chí Công? |
| Cảm nhận — hướng dẫn | Bạn cứ viết theo cách của mình. |
| Chấm sao — tiêu đề | **Một vài đánh giá thêm** |
| Chấm sao — hướng dẫn | Phần này không bắt buộc. Bạn có thể đánh giá những mục mình muốn chia sẻ và bỏ qua mục không phù hợp. |
| Góp ý — nhãn | **Điều Chí Công có thể làm tốt hơn** |
| Góp ý — placeholder | Nếu có điều chưa như mong đợi hoặc cần thay đổi, bạn chia sẻ thêm ở đây nhé. |
| Góp ý — hướng dẫn | Không bắt buộc. |

| Tiêu chí đã chốt | Hướng dẫn ngắn |
| --- | --- |
| **Trải nghiệm chung** | Cảm nhận tổng thể của bạn khi làm việc cùng studio. |
| **Trải nghiệm buổi chụp** | Sự thoải mái, cách hướng dẫn và tương tác trong buổi chụp. |
| **Sản phẩm nhận được** | Cảm xúc, chất lượng và mức độ phù hợp với mong đợi của bạn. |
| **Quá trình bàn giao** | Thời gian, cách nhận sản phẩm và hỗ trợ khi bàn giao. |

Thang chung: **1 — Rất không hài lòng · 2 — Chưa hài lòng · 3 — Bình thường · 4 — Hài lòng · 5 — Rất hài lòng**.

Chưa chọn hiển thị **Chưa đánh giá**. Sau khi chọn, hiện tên mức và nút **Bỏ đánh giá** cho riêng tiêu chí đó. Không chọn sẵn, không tô sao do hover thành lựa chọn đã lưu; thao tác bàn phím và màn hình đọc phải đọc được tên tiêu chí/số sao.

Giới hạn dự kiến: tên 150 ký tự, cảm nhận 3.000, góp ý 1.500. Dùng nhãn thật và dấu bắt buộc, không để placeholder thay nhãn. Nội dung dài có bộ đếm ký tự; không yêu cầu viết dài hoặc đánh giá tích cực.

### 9.4. Trước nút gửi

> Bạn có thể quay lại xem hoặc cập nhật khi hồ sơ đang mở nhận cảm nhận.

> Studio lưu các lần bạn gửi hoặc cập nhật để theo dõi đầy đủ góp ý. Trang này hiển thị nội dung mới nhất.

> Nội dung chưa gửi chỉ được giữ trong trang đang mở.

Nút lần đầu: **Gửi cảm nhận**. Đang gửi: **Đang gửi…**

Nút khi sửa: **Lưu cập nhật**. Đang lưu: **Đang lưu…**. Nút phụ: **Hủy chỉnh sửa**.

### 9.5. Cảm ơn và xem lại

#### Sau lần gửi đầu được máy chủ xác nhận

**Tiêu đề:** Cảm ơn bạn đã chia sẻ

> Cảm nhận của bạn đã được lưu trong hồ sơ của studio. Chí Công cảm ơn bạn đã dành thời gian kể lại trải nghiệm của mình.
>
> Bạn có thể quay lại xem hoặc bổ sung khi hồ sơ đang mở nhận cảm nhận.

Nút: **Xem cảm nhận đã gửi**.

#### Sau khi lưu thay đổi

**Tiêu đề:** Đã lưu cập nhật của bạn

> Bản cập nhật đã được lưu trong hồ sơ. Cảm ơn bạn đã chia sẻ thêm để Chí Công hiểu rõ hơn trải nghiệm của bạn.

Nút: **Xem cảm nhận mới nhất**.

#### Màn xem lại

Tiêu đề: **Cảm nhận bạn đã gửi**. Nhãn thời gian: **Cập nhật gần nhất: [HH:mm, DD/MM/YYYY]**.

Nút: **Chỉnh sửa cảm nhận**, chỉ dùng khi link hợp lệ và hồ sơ đang mở nhận. Trang chỉ hiển thị bản hiện hành; không có danh sách lịch sử dành cho khách. Hai người giữ cùng link dùng chung bản này.

### 9.6. Lỗi, trạng thái và thao tác khôi phục

| Tình huống | Thông báo | Nút phù hợp |
| --- | --- | --- |
| Chưa nhập tên | Bạn điền tên muốn dùng nhé. | Focus trường tên |
| Chưa nhập cảm nhận | Bạn viết lời cảm nhận trước khi gửi nhé. | Focus trường cảm nhận |
| Quá giới hạn | Nội dung vượt quá [giới hạn] ký tự. Bạn rút gọn một chút nhé. | Focus đúng trường |
| Không tải được form | Chưa tải được trang cảm nhận. Bạn kiểm tra kết nối rồi thử lại nhé. | Thử lại |
| Chưa rõ lần gửi có lưu chưa | Chưa xác nhận được lần gửi trước đã lưu. Bạn kiểm tra lại lần gửi đó nhé; phần sửa thêm vẫn được giữ riêng trong trang và chưa được gửi. | Kiểm tra lần gửi trước |
| Ngữ cảnh thay đổi trước lần gửi đầu | Thông tin buổi chụp vừa được studio cập nhật. Phần bạn đang viết vẫn được giữ; bạn xem lại thông tin trước khi gửi nhé. | Xem thông tin mới; Quay lại phần đang viết |
| Form cũ không còn được nhận | Biểu mẫu đã được cập nhật. Phần bạn đang viết vẫn được giữ; bạn tải mẫu mới và kiểm tra lại trước khi gửi nhé. | Tải mẫu mới |
| Có cập nhật mới từ thiết bị khác | Đã có một cập nhật mới từ đường dẫn này. Phần bạn đang viết vẫn được giữ. Bạn xem bản mới nhất trước khi tiếp tục nhé. | Xem bản mới nhất; Quay lại phần đang viết |
| Retry một lần gửi cũ đã được lưu | Lần gửi trước đã được lưu. Hiện hồ sơ có một bản cập nhật mới hơn. | Xem bản mới nhất |
| Đang kiểm lại khi quay về trang | Đang kiểm tra lại đường dẫn… | Tạm khóa gửi |
| Offline, chưa kiểm được quyền | Chưa kiểm tra lại được đường dẫn. Nội dung đang viết vẫn được giữ; bạn thử lại khi có kết nối nhé. | Thử lại |
| Link không dùng được | Đường dẫn này hiện không dùng được. Bạn nhắn Chí Công để kiểm tra hoặc nhận lại đường dẫn nhé. | Nhắn Chí Công |
| Hồ sơ tạm đóng, đã xác thực đúng link | Studio hiện đã đóng nhận cảm nhận cho hồ sơ này. Nếu muốn bổ sung, bạn có thể nhắn Chí Công để mở lại nhé. | Nhắn Chí Công |
| Lưu không đổi nội dung | Nội dung vẫn như lần gửi gần nhất. | Xem cảm nhận |
| Quá nhiều lần thử | Bạn đã thử gửi nhiều lần trong thời gian ngắn. Vui lòng thử lại sau [thời gian]. | Thử lại sau khi được phép |
| Rời trang khi đang sửa | Bỏ phần chưa gửi? Phần chỉnh sửa này chưa được lưu. Cảm nhận đã gửi trước đó vẫn giữ nguyên. | Viết tiếp; Bỏ phần chưa gửi |

Tải schema/ngữ cảnh mới là cập nhật trong trang, không reload làm mất bản nháp. Khách xác nhận sau khi xem dữ liệu mới; chỉ lúc chủ động gửi mới tạo request key mới. Nếu request cũ đã có receipt, ưu tiên đối soát theo quy tắc replay thay vì báo form/ngữ cảnh mới là lý do không thể xác nhận.

Nút “Nhắn Chí Công” dùng liên hệ studio đã cấu hình, không mang token/nội dung cảm nhận sang URL liên hệ. Thông báo link sai không lộ tên hoặc xác nhận hồ sơ tồn tại. Chỉ hiện lý do tạm đóng khi chữ ký/nonce đúng; không trả lại nội dung phản hồi khi hồ sơ đã đóng hoặc lưu trữ. Không khẳng định link bị thu hồi nếu chỉ gặp lỗi mạng.

### 9.7. Câu chữ trong admin

| Vị trí | Nội dung |
| --- | --- |
| Mục quản lý | Cảm nhận |
| Từ chi tiết gallery | Bàn giao & cảm nhận |
| Tạo mới | Tạo hồ sơ bàn giao |
| Trạng thái nhận | Chưa mở nhận / Đang nhận / Đã đóng / Đã lưu trữ |
| Lý do đã đóng | Tạm đóng / Link đã thu hồi |
| Mô tả khi đang nhận | Khách có thể gửi, xem lại và cập nhật cảm nhận. |
| Mô tả khi tạm đóng | Khách hiện không thể xem hoặc cập nhật. Mở lại để tiếp tục nhận cảm nhận. |
| Mở lời mời | Đã bàn giao đầy đủ và mở nhận cảm nhận |
| Copy | Sao chép link |
| Copy khi tạm đóng | Mở lại hồ sơ để sao chép link đang nhận cảm nhận. |
| Copy khi đã thu hồi | Link cũ đã thu hồi. Cấp link mới để tiếp tục nhận cảm nhận. |
| Copy thành công | Đã sao chép link. |
| Clipboard bị chặn | Chưa sao chép tự động được. Bạn có thể chọn và sao chép đường dẫn bên dưới. |
| Feedback hiện hành | Cảm nhận mới nhất |
| Lịch sử | Lịch sử gửi và cập nhật |
| Bản đầu | Lần gửi đầu · [thời gian] |
| Bản sau | Cập nhật [số thứ tự] · [thời gian] |
| Ghi chú | Ghi chú riêng của studio |
| Email pending/retry | Đang chờ gửi thông báo / Sẽ thử gửi lại |
| Email accepted | Đã gửi thông báo — dịch vụ email đã tiếp nhận, chưa xác nhận đến hộp thư hoặc được đọc. |
| Email lỗi | Chưa gửi được thông báo. Cảm nhận của khách đã được lưu. |
| Email chưa cấu hình | Cần kiểm tra cấu hình email nhận thông báo. |
| Email thao tác | Thử gửi lại thông báo |
| Email thiếu/sai người nhận | Cập nhật người nhận và thử lại |
| Email được ngưng sau restore | Đã tạm ngưng thông báo sau khôi phục dữ liệu. |

Lịch sử ghi số phiên bản kỹ thuật khi cần đối chiếu, nhưng ưu tiên “Lần gửi đầu”, “Cập nhật lần 1”, thời điểm và nội dung. Không suy diễn tên hiển thị là danh tính người đã xác minh. Một badge chưa đọc tính theo hồ sơ, không theo số email.

### 9.8. Email báo studio — đầy đủ phản hồi

**Subject lần đầu:** [ChiCong] Cảm nhận mới từ [Tên người gửi] · #[Mã]

**Subject cập nhật:** [ChiCong] [Tên người gửi] vừa cập nhật cảm nhận · #[Mã]

> **[Cảm nhận mới / Cảm nhận vừa được cập nhật]**
>
> Hồ sơ: #[Mã] <br>
> Buổi chụp/dịch vụ: [Tên/ngữ cảnh đã lưu] <br>
> Ngày chụp: [Ngày, nếu có] <br>
> Người gửi: [Tên của phiên bản được thông báo] <br>
> Thời điểm lưu: [HH:mm, DD/MM/YYYY] (giờ Việt Nam) <br>
> Phiên bản: [N]
>
> **Đánh giá của khách**
>
> Trải nghiệm chung: [N/5 — tên mức, hoặc Chưa đánh giá] <br>
> Trải nghiệm buổi chụp: [N/5 — tên mức, hoặc Chưa đánh giá] <br>
> Sản phẩm nhận được: [N/5 — tên mức, hoặc Chưa đánh giá] <br>
> Quá trình bàn giao: [N/5 — tên mức, hoặc Chưa đánh giá]
>
> **Cảm nhận của khách**
>
> [Toàn bộ lời chia sẻ của phiên bản này, giữ xuống dòng]
>
> **Điều Chí Công có thể làm tốt hơn**
>
> [Toàn bộ góp ý của phiên bản này, hoặc Chưa có góp ý bổ sung]
>
> **Xem hồ sơ trong quản trị**
>
> Email này ghi lại lần gửi lúc [thời gian]. Khách có thể đã cập nhật sau đó. Bạn xem bản mới nhất và lịch sử trong quản trị.

Mỗi email chứa đầy đủ **một phiên bản feedback**, không đính kèm toàn bộ lịch sử. Đọc revision mà sự kiện trỏ đến cùng snapshot ngữ cảnh; không lấy nội dung/tên mới nhất lúc gửi thư. Ngày không có thì bỏ dòng, không đoán. Bốn sao chưa chấm ghi “Chưa đánh giá”, không ghi 0.

Cả bản HTML và plain-text giữ nội dung đầy đủ; escape dữ liệu khách, giữ xuống dòng và làm sạch newline khi đưa tên vào subject. Không thêm ghi chú nội bộ, token/link của khách, ảnh/Drive hoặc dữ liệu liên hệ từ inquiry. Link admin yêu cầu đăng nhập. Email có thể đến khác thứ tự; nhãn thời điểm/phiên bản giúp đối chiếu. Sửa/xóa trong website không tự thay đổi email đã gửi.

<a id="review-evidence"></a>

## 10. Bằng chứng review, source map và giới hạn xác minh

### 10.1. Những gì đã làm và chưa làm

Các lượt trước đã đọc các nhóm code liên quan: database/migration hai DB, quyền admin/gallery, inquiry/booking, chọn và tải ảnh, HTML/routing/SEO/analytics, form/API transport, email, export/startup và tài liệu vận hành. Đã có các lượt review chuyên biệt backend, frontend và vòng đời trang. Đây là rà soát các điểm nối của tính năng dự kiến, không phải kết luận toàn bộ repository không còn lỗi.

- Review v0.2 diễn ra khi working tree có thay đổi gallery/proofing/upload từ công việc khác; bằng chứng gắn với nội dung đã đọc tại thời điểm đó.
- Review v0.3 bắt đầu từ working tree sạch tại commit `1ea50e8`, sau đó giữ nguyên các thay đổi song song ngoài phạm vi feedback.
- v0.4 cập nhật tài liệu theo quyết định bỏ hạn, email đầy đủ và xưng “Chí Công — bạn”. Lượt hợp nhất v1.0 chỉ chỉnh tài liệu; không tạo schema, API, form hoặc dispatcher.
- Lượt v1.1 ngày 16/10/2026 đọc lại file chính và đối chiếu source hiện tại qua ba nhánh review nghiệp vụ, backend và frontend. Phát hiện công việc media/R2 đang sửa song song nhiều file; cập nhật điểm nối backup/restore/shutdown trong đặc tả, không sửa các file đó. Những bổ sung ở mục 11.3 là kết quả review thiết kế/source, chưa phải test runtime của tính năng.
- Lượt v1.3 ngày 21/10/2026 đối chiếu source tại commit `b772c00`, với các thay đổi tài liệu vận hành/handbook ngoài phạm vi đang có trong working tree. Cập nhật ngữ cảnh lần gửi đầu, tương thích form/replay qua deploy, backup v2/Drive và rollback, đối soát xóa sau restore; chỉ sửa đặc tả này. Kiểm diff/tính nhất quán tài liệu, không chạy test ứng dụng hoặc ma trận FB.
- Không chạy thử tính năng feedback vì chưa có implementation. Chưa xác minh PostgreSQL của tính năng, Zalo, browser lifecycle, proxy/Cloudflare thực tế hoặc production. Không gửi thư/tin nhắn thật, không dùng dữ liệu khách thật để kiểm tính năng này.
- Không dùng kết quả test nền để đánh dấu FB01–FB40 đã đạt. Khi bắt đầu code, kiểm lại branch/working tree và các điểm nối; không giả định commit cũ vẫn là source hiện hành.

### 10.2. Bản đồ source dành cho người triển khai

Các mốc là tên file/hàm/route, tránh số dòng dễ thay đổi. Đối chiếu lại trước khi sửa.

| Nơi đọc | Điểm cần kiểm và liên hệ với tính năng |
| --- | --- |
| [package.json](../package.json) | Runtime, scripts test và dependency thực tế; không mặc định thêm framework hoặc queue service |
| [db.mjs](../studio/server/db.mjs) | `openDatabase`, DDL, RLS list; SQLite queue và `BEGIN IMMEDIATE`; PostgreSQL pool/transaction mặc định. Helper trong transaction phải nhận `tx`; snapshot export PostgreSQL cần isolation rõ |
| [app.mjs](../studio/server/app.mjs) | `rate` dùng connection ngoài; `allowed` chỉ là quyền gallery; `albumDTOs` chỉ đưa tên khách vào admin; middleware `/api/admin`, inquiry routes, catch-all; `galleryPage` dựa trên `req.params.id`; private HTML/CSP; export v2 liệt kê bảng và SELECT tuần tự |
| [gallery-selection.mjs](../studio/server/gallery-selection.mjs) | Mẫu xác thực lại trong transaction, no-op và retry; tham khảo có chọn lọc, không đồng nhất selection với feedback |
| [request-security.mjs](../studio/server/request-security.mjs) | SITE_URL/Host/proxy, Origin chính xác cho mutation, no-store API; giữ bảo vệ hiện có |
| [main.js](../studio/web/main.js) | Boot/routing, `adminNavigation`, guard kết quả đến trễ, submit handler chung, dirty guard hiện có, clipboard và catch lỗi gallery; thêm shell/luồng feedback riêng |
| [api-request.mjs](../studio/web/api-request.mjs) | Timeout, AbortSignal do helper tạo, lỗi ở `error.data.fields`; thống nhất với form mới, không cho response cũ áp dụng sang lời mời khác |
| [index.html](../studio/web/index.html) | Skip link `href="#main"` thay fragment; shell feedback phải giữ thao tác bàn phím bằng focus/scroll mà không đổi token trong URL |
| [inquiry-form.mjs](../studio/web/inquiry-form.mjs) | Cấu trúc lỗi/key của inquiry là mẫu tham khảo; không copy nguyên key/storage hoặc hành vi gửi email khách |
| [mailer.mjs](../studio/server/mailer.mjs) | `createMailer` expose `sendEmail`; `notifyNewInquiry` gửi cả thư khách; Resend có timeout 15 giây tại thời điểm review, SMTP chưa có timeout rõ; bổ sung giới hạn gửi thực tế cho dispatcher |
| [start.mjs](../studio/server/start.mjs) | Tạo app/migration trước listen; source tại lượt review v1.1 shutdown photoCleanup, mediaControl, storage rồi DB; thêm stop/drain dispatcher trước đóng DB và giữ các bước cleanup hiện có |
| [media-backup.mjs](../studio/tools/media-backup.mjs), [media-ops.mjs](../studio/tools/media-ops.mjs) | Source 21/10/2026 xuất snapshot v2 và đọc v1/v2, gồm Drive và cache tạm được loại trừ; kế thừa registry từng version, giữ quy tắc restore Drive, bổ sung feedback và gate/suppress/đối soát xóa trước mở dữ liệu |
| [media-control.mjs](../studio/server/media-control.mjs) | `mediaMutation` chỉ chặn một số route admin media/settings; không đồng nghĩa khóa API feedback hoặc email; không cần kéo feedback vào khóa media cho backup thông thường |
| [ui-copy.mjs](../studio/web/ui-copy.mjs) | Nhãn album/selection hiện tại không phải trạng thái bàn giao; giữ từ ngữ phân biệt |
| [OPERATIONS.md](../OPERATIONS.md), [HOSTING.md](../HOSTING.md) | Quy trình môi trường, proxy, backup/restore; bổ sung runbook feedback khi triển khai |
| [studio/tests](../studio/tests) | Test nền hiện có; mở rộng đúng hành vi/rủi ro của ma trận, không viết test chỉ phản chiếu implementation |

Các tài liệu nền từng được đối chiếu cho quyết định kiểm lifecycle/proxy: [Chrome về bfcache và Cache-Control no-store](https://developer.chrome.com/docs/web-platform/bfcache-ccns), [Cloudflare Web Analytics rules](https://developers.cloudflare.com/web-analytics/configuration-options/rules/). Chúng giải thích việc cần kiểm trên trình duyệt/edge; không xác nhận cấu hình production hiện tại. Người triển khai cần đối chiếu phiên bản và môi trường thực tế.

### 10.3. Test nền đã chạy ở các lượt review trước

**Lượt v0.2:** Node v23.6.0, test dùng database/thư mục tạm sau khi bỏ các biến kết nối DB ngoài:

```sh
env -u DATABASE_URL -u STUDIO_TEST_POSTGRES_URL -u NODE_OPTIONS NODE_ENV=test node --test \
  studio/tests/migration.test.mjs studio/tests/security.test.mjs \
  studio/tests/schema-analytics.test.mjs studio/tests/api-request.test.mjs \
  studio/tests/inquiry-form.test.mjs studio/tests/bootstrap.test.mjs
```

Kết quả đã ghi nhận: **30 đạt, 0 lỗi, 0 bỏ qua**, exit code 0. Đây là kiểm nền migration/bảo mật/schema-analytics/form/API/bootstrap tại thời điểm chạy, không phải kiểm chứng tính năng feedback hoặc toàn bộ regression gallery.

**Lượt v0.3:** đã đọc [mailer.test.mjs](../studio/tests/mailer.test.mjs) để xác nhận dùng transport giả, rồi chạy với Node v23.6.0:

```sh
env -u DATABASE_URL -u STUDIO_TEST_POSTGRES_URL -u NODE_OPTIONS NODE_ENV=test node --test studio/tests/mailer.test.mjs
```

Kết quả đã ghi nhận: **3 đạt, 0 lỗi, 0 bỏ qua**, exit code 0. Các dòng “Simulated mail network timeout” là lỗi giả lập có chủ đích; test không gửi email thật. Chưa kiểm queue hoặc template feedback dự kiến.

Hai bộ trên chạy ở hai thời điểm khác nhau, **không phải bộ 33 test feedback**. Không chạy lại test ứng dụng chỉ vì hợp nhất tài liệu. Khi triển khai, kiểm test script/fixture và môi trường thực tế trước khi chạy; việc bỏ biến kết nối không thay thế kiểm tra rằng test không trỏ vào production.

<a id="review-decisions"></a>

## 11. Những điểm dễ triển khai sai và đề xuất đã bị thay thế

### 11.1. Kết luận review còn hiệu lực

| Điểm dễ sai | Quy tắc cần giữ | Ca nghiệm thu liên quan |
| --- | --- | --- |
| Đồng nhất album hoặc inquiry với đơn chụp | Hồ sơ bàn giao riêng, 0–N gallery, inquiry tùy chọn; không tự ghép theo tên hay auto-complete từ tải ảnh/tim | FB01–05 |
| Trộn đã nhận/đã đọc với quyền mở nhận | Bốn trục riêng; đọc/nhận không đóng, archive không tự mở khi bỏ lưu trữ, copy không rotate | FB05–06, FB14–15, FB34 |
| Khôi phục DB khiến link đã thu hồi sống lại | Chặn feedback khi restore, đổi secret mọi instance trước traffic, cấp lại link cần dùng | FB09, FB28–29 |
| Khôi phục DB phát lại email đã gửi | Gate vận hành ngoài DB từ trước startup, đối soát/suppress event cũ; đổi key không chặn email | FB37–40 |
| Deadlock SQLite hoặc khóa khi chờ network | Cùng `tx`, cùng thứ tự khóa; rate limiter phù hợp; gửi mail ngoài transaction | FB03, FB11–13, FB23, FB33 |
| Mất ACK hoặc hai tab tạo bản/email trùng | Receipt cho mỗi request được chấp nhận, expectedVersion, snapshot retry bất biến; admin có version/operation riêng | FB10–11, FB14, FB18, FB33, FB36 |
| Retry làm lộ lời khách đã sửa/xóa ở bản cũ | Khách luôn latest-only, ACK version cũ không trả body cũ; chỉ admin có lịch sử | FB31–32 |
| Đã đọc bỏ sót cập nhật đến sau | Gửi observed_version; không đánh dấu vượt bản đã nhìn thấy; email scan không đọc thay admin | FB15 |
| Trang riêng vẫn rò qua shell/analytics | Handler/DTO tối thiểu, no-store/noindex/no-referrer/CSP riêng; kiểm cả proxy/edge và đường lỗi | FB06–09, FB24–25 |
| Draft hoặc response bị đưa nhầm hồ sơ | Context ID+token, epoch, lifecycle revalidation, không lưu token/draft vào browser storage | FB18–22 |
| Lịch sử/email bị dựng từ latest | Full immutable revision, snapshot ngữ cảnh/nhãn, notification trỏ đúng revision; v1 gửi chậm vẫn là v1 | FB31, FB35–36, FB39 |
| Unique event bị hiểu là thư đến đúng một lần | Lease/timeouts, trạng thái provider accepted; nêu rõ ACK mất có thể gửi trùng cùng phiên bản | FB37–38 |
| Export/rollback/xóa bỏ sót dữ liệu liên quan | Snapshot đủ 6 bảng, key riêng; rollback giữ dữ liệu; xóa cả lịch sử/receipts/queue sau drain | FB26–29, FB40 |
| “Nội bộ” bị dùng làm đồng ý công khai | Không testimonials hoặc consent mặc định; nếu làm sau phải xin riêng | FB07, FB24, kiểm scope |

### 11.2. Không khôi phục các đề xuất cũ

Bảng này chỉ ghi quyết định đã bị thay thế để AI không lấy lại từ lịch sử hội thoại/Git. Cột bên trái **không phải yêu cầu hiện hành**.

| Đề xuất cũ, không áp dụng | Quyết định hiện hành |
| --- | --- |
| Hạn 90 ngày hoặc admin chọn ngày hết hạn từng hồ sơ | Không có hạn feedback; chỉ quản lý bằng trạng thái; không thêm `feedback_expires_at`, gia hạn hoặc TTL ngầm |
| Chỉ lưu bản feedback mới nhất | Admin có full revision history; khách chỉ xem bản mới nhất |
| Chỉ nhớ request key cuối của khách | Receipts riêng cho từng request được chấp nhận, kể cả no-op |
| Replay trả snapshot cũ | ACK thao tác cũ nhưng body chỉ latest được phép đọc |
| Một tiêu chí sao chung | Bốn tiêu chí tùy chọn độc lập; không chọn sẵn, không lấy trung bình làm ý kiến chung |
| Trước mắt không email, hoặc email chỉ có mã/link | Email studio lần đầu và mỗi thay đổi thực sự, đầy đủ đúng revision; không gửi email mời/xác nhận khách |
| Xưng “Công — bạn” | “Chí Công — bạn”; thương hiệu ChiCong Studio |
| Khách “chat” với studio trong hồ sơ | Ô lời nhắn tự do trong form, không có hội thoại hai chiều |
| Nút feedback hiện cho mọi người xem gallery | Link gửi riêng trong MVP; gallery có thể được chia sẻ cho người thân |
| Approved/featured/pin và public testimonials trong bản tham khảo đầu | Thu thập nội bộ, không công khai hoặc xin quyền công khai ở đợt này |

### 11.3. Lượt rà cuối trước khi studio review — 16/10/2026

Đã đối chiếu lại toàn bộ đặc tả với các quyết định trong hội thoại và những điểm nối backend/frontend hiện có. Không phát hiện lựa chọn nghiệp vụ mới bắt buộc studio trả lời. Các điểm dưới đây đã được sửa ngay trong các mục tương ứng, không để thành ghi chú mâu thuẫn với phần chính:

| Điểm đã làm rõ | Kết quả trong v1.1 |
| --- | --- |
| Hoàn tất bàn giao và copy ở trạng thái đóng | Complete chỉ chuyển từ draft; không dùng complete để mở lại paused/revoked. Copy chỉ trả link active của hồ sơ đã bàn giao, chưa lưu trữ |
| Dữ liệu trả về chậm trong cùng hồ sơ | Chặn cả response sai context lẫn response cũ trong cùng context; không lùi version hoặc để active cũ mở lại màn đã báo đóng |
| Skip link làm mất token | Trang feedback giữ thao tác bàn phím/focus mà không đổi fragment `#token` |
| Retry sau timeout trong khi khách gõ thêm | Nút Kiểm tra lần gửi trước chỉ đối soát snapshot cũ; phần sửa thêm là draft riêng, chưa gửi |
| Retry admin dùng nhầm payload | Operation key gắn command/hash/version/target IDs; conflict khi khác payload, không lưu/trả signed link từ receipt |
| Người nhận trống khi phục hồi email | Cho phép null trong blocked_config và suppressed; chỉ gửi lại sau khi admin chọn người nhận hợp lệ; kết quả worker cũ không ghi đè lượt mới |
| Công cụ backup mới trong công việc media song song | Bổ sung registry/schema/verify/restore, hỗ trợ backup cũ, thứ tự FK, gate API/email và các bước shutdown hiện có |
| Ngữ cảnh hồ sơ được sửa sau khi đã nhận cảm nhận | Snapshot lúc gửi đầu dùng cho feedback/email; admin phân biệt hồ sơ hiện tại với ngữ cảnh đã chốt, không sửa lời khách |
| Mã lỗi API bị handler chung bỏ qua | Yêu cầu serializer phản hồi thực tế, để form phân biệt conflict/key/validation đúng như thiết kế |

Đã cập nhật các ca nghiệm thu liên quan, vẫn giữ FB01–FB40; tất cả chờ implementation để chạy. Lượt này chỉ sửa file đặc tả, đọc source và kiểm tính nhất quán tài liệu; không chạy test ứng dụng, không tạo UI/migration, không gửi email hoặc triển khai. Còn phải kiểm thực tế fragment/Zalo, giao diện, đồng thời trên hai DB, dispatcher và restore theo mục 7; review tài liệu không thay thế các kiểm chứng đó.

### 11.4. Bổ sung sau review source — 21/10/2026 · v1.3

Bốn khoảng trống đã được đưa vào quy tắc chính, contract, copy và ma trận; không đổi các lựa chọn nghiệp vụ đã chốt:

| Khoảng trống | Quy tắc bổ sung | Nghiệm thu |
| --- | --- | --- |
| Khách xem ngữ cảnh cũ nhưng lần gửi đầu chốt ngữ cảnh mới | contextVersion riêng; kiểm dưới khóa, giữ draft và xác nhận lại; replay đã có receipt vẫn ACK | FB13, FB31 |
| Deploy đổi form/chuẩn hóa khiến retry cũ bị từ chối hoặc sai nhãn | Registry version bất biến; đối soát receipt theo thuật toán cũ trước validator mới; form ngừng nhận giữ draft; đổi nhãn riêng không tạo email | FB18, FB35 |
| Source backup đã lên v2/Drive; rollback ứng dụng làm công cụ cũ không hiểu bảng mới | Kế thừa v2, định dạng feedback mới dự kiến v3, registry v1/v2/v3 riêng; giữ runtime backup tương thích khi rollback | FB27, FB29 |
| Restore hồi sinh dữ liệu từng xóa | Sổ xóa tối thiểu ngoài DB phục hồi; ghi ý định trước purge, đối soát và purge lại trước mở dữ liệu/email | FB40 |

Đây là kết quả review/cập nhật tài liệu tại source `b772c00`, không phải bằng chứng các cơ chế đã được lập trình hoặc chạy thành công. Toàn bộ FB01–FB40 vẫn chưa chạy. Không sửa code ứng dụng, dữ liệu hay cấu hình production trong lượt này.

<a id="ai-handoff"></a>

## 12. Checklist của studio và bàn giao cho AI

### 12.1. Studio cần đọc và chuẩn bị gì trước khi code

**Không còn câu hỏi nghiệp vụ bắt buộc phải trả lời lại.** Các lựa chọn về kênh bàn giao, một feedback/buổi, bốn sao, lịch sử, email, không đặt hạn và xưng hô đã được ghi rõ. Phần còn lại là đối chiếu thiết kế cụ thể và chuẩn bị kiểm chứng:

- Đọc luồng và bảng trạng thái ở mục 4: đặc biệt tạm đóng chặn cả xem/sửa, cấp link mới mở nhận, bỏ lưu trữ không tự mở, nhận/đọc không tự đóng. Chỉ báo lại nếu có ngoại lệ thực tế của studio chưa được phản ánh.
- Review câu chữ ở mục 9: form, lời mời cá nhân/cặp đôi, cảm ơn, lỗi và email đầy đủ. Có thể sửa giọng văn mà vẫn giữ hành vi/quyền đã chốt.
- Ở bước thiết kế tiếp theo, xem bố cục form điện thoại và admin danh sách/chi tiết/lịch sử. Tài liệu mô tả các màn hình nhưng chưa có mockup được duyệt hoặc UI đã chạy.
- Chuẩn bị ví dụ giả hoặc đã ẩn danh nếu thuận tiện: một buổi chân dung, một cặp đôi, một trường hợp chỉ giao qua Drive. AI cũng có thể tự tạo dữ liệu giả; không cần cung cấp hồ sơ khách thật để bắt đầu kiểm thử.
- Khi đến bước staging, cần môi trường PostgreSQL thử, domain/proxy và thiết bị Zalo iOS/Android để kiểm các ca tương ứng. Người triển khai xác định thứ gì sẵn có và báo thiếu cụ thể; không yêu cầu gửi mật khẩu/secret trong chat hoặc trong file này.
- Trước đưa vào dùng thật, kiểm địa chỉ email nhận thông báo và kênh liên hệ studio trong cấu hình hiện có; thống nhất người vận hành backup/restore và phạm vi truy cập. Không cần chọn một địa chỉ mới vì đã chốt dùng cấu hình studio hiện có.

Người triển khai tự giải quyết contract, constraints, mã hóa token và transaction theo yêu cầu nghiệm thu. Chỉ quay lại hỏi studio khi phát hiện lựa chọn làm thay đổi trải nghiệm/phạm vi đã chốt, chẳng hạn Zalo không giữ được fragment cần phương án truy cập khác. Không biến các chi tiết mật mã hoặc database thành câu hỏi nghiệp vụ cho studio.

### 12.2. Phần kỹ thuật phải cụ thể hóa trước khi triển khai đầy đủ

Đây là trách nhiệm thiết kế/kiểm chứng của AI, không phải quyết định đã được xác nhận chỉ bằng tài liệu:

| Việc cần cụ thể hóa | Kết quả cần có |
| --- | --- |
| Endpoint/module và lỗi | Chốt bảng method/path/quyền/request/response/error; dùng nhất quán `handoverId` cho hồ sơ, `feedbackId` cho nội dung đã có, revision version cho lịch sử; form phải dùng đúng cấu trúc lỗi |
| Token và shell | Prototype link fragment với dữ liệu giả trên Zalo/iOS/Android và proxy; kiểm private headers/HTML/CSP/error routes; không tự đổi sang query token khi chưa đánh giá hệ quả |
| Chuẩn hóa dữ liệu | Registry bất biến formVersion/normalizationVersion, nhãn và giới hạn; chốt Unicode/newline/null/hash, giữ replay theo receipt qua deploy/restore/rollback; tách form nhận mới với form còn được replay, không tự sửa lời khách |
| Ngữ cảnh lần đầu | GET trả contextVersion; PUT đầu kiểm expectedContextVersion dưới khóa, CONTEXT_CHANGED giữ draft; cập nhật ghi chú không gây conflict và feedback đã có dùng snapshot bất biến |
| Transaction và retry | Fixture cả SQLite/PostgreSQL cho lock order, request receipts/no-op/replay, observed_version và admin operation; stale request phải conflict thay vì lặp thao tác đổi link |
| Retry admin | Key gắn command/hash payload/expected version/target IDs; khác payload conflict. Operation còn lưu thì ACK không làm lại, không trả token từ kết quả cũ; operation mất receipt với version cũ phải conflict. Không hứa replay mọi command như receipts khách nếu chưa có ledger riêng |
| Notification dispatcher | Chốt finite transport timeout, lease/claim ownership, batch/backoff, trạng thái/lỗi, chọn recipient, restore gate và shutdown/drain; dùng mailer giả để test |
| Migrations/export/backup | Migration additive, constraints/RLS theo DB; cập nhật cả export admin và registry/schema/verify/restore trong media-backup, đọc backup cũ, gate API/email trước startup; readiness, rollback giữ runtime backup tương thích và diễn tập v1/v2/v3 |
| Xóa và phục hồi | Sổ xóa tối thiểu độc lập với snapshot ứng dụng, ghi ý định trước purge; đối soát/purge lặp an toàn trước mở admin/export/API/email; thiếu bằng chứng thì giữ gate |
| Giới hạn thực tế | Ghi rõ những ca chưa kiểm được trên thiết bị/môi trường thật; không thay bằng test giả rồi tuyên bố đã xác minh production |

Tên bảng, field và module hiện là thiết kế dự kiến. Có thể điều chỉnh để phù hợp conventions của repo khi triển khai, nhưng không giảm bảo đảm về quyền, lịch sử, no-op/retry, tính nhất quán của email hoặc vận hành. Nếu thay phương án, cập nhật chính file này và lý do trước khi tiếp tục phần phụ thuộc.

### 12.3. Trình tự cho AI tiếp nhận

1. Đọc file này và yêu cầu mới nhất của studio. Nếu chỉ được yêu cầu review, tiếp tục review; chỉ bắt đầu code khi người dùng yêu cầu triển khai. Không tự tạo việc triển khai từ trạng thái tài liệu đã rõ.
2. Kiểm `git status`, branch, hướng dẫn repository và source map mục 10.2. Bảo toàn thay đổi sẵn có; không reset/revert tài liệu hoặc code của công việc khác.
3. Đối chiếu code với các giả định đã ghi. Đánh dấu điểm đã thay đổi, cập nhật thiết kế tích hợp và contract ở mục 12.2; không coi kết quả test lịch sử là test của checkout hiện tại.
4. Khi được yêu cầu code: thử rủi ro truy cập/Zalo và transaction bằng dữ liệu giả, sau đó triển khai theo chặng ở mục 7. Tách logic nghiệp vụ/form/admin khỏi các file lớn khi phù hợp; tránh thêm framework hoặc hạ tầng ngoài nhu cầu.
5. Kiểm hành vi bằng ma trận FB01–FB40, chạy regression phù hợp, ghi bằng chứng theo môi trường và phân biệt đạt/chưa chạy/bị chặn. Không đánh dấu đã đạt chỉ vì đã viết test; không dùng database production để kiểm concurrency/migration/restore.
6. Hoàn thiện runbook key/restore/mail gate/xóa dữ liệu, cập nhật cấu hình mẫu không chứa secret. Chuẩn bị kết quả và rủi ro còn lại để studio review trước khi đưa vào dùng thật.
7. Cập nhật mục trạng thái/tiến độ ngay trong tài liệu chính khi có thay đổi được xác nhận. Không tạo nhiều bản đặc tả song song có quy tắc mâu thuẫn.

### 12.4. Prompt có thể dùng ở lần làm việc sau

> Đọc `docs/customer-feedback-spec.md` làm đặc tả chính cho tính năng feedback sau bàn giao của ChiCong Studio. Đối chiếu với source và working tree hiện tại; không hỏi lại các quyết định nghiệp vụ đã chốt. Trước hết báo những điểm source đã thay đổi, contract còn cần cụ thể hóa và kế hoạch kiểm chứng. Ở lượt này tiếp tục review, chưa sửa code ứng dụng. Khi tôi yêu cầu triển khai, thực hiện theo các chặng và ma trận nghiệm thu trong tài liệu; giữ nguyên mọi thay đổi ngoài phạm vi.

Nếu lúc đó studio đã muốn bắt đầu code, thay câu “Ở lượt này tiếp tục review, chưa sửa code ứng dụng” bằng yêu cầu triển khai cụ thể. File này không tự cấp quyền deploy hoặc gửi thư/tin nhắn cho khách thật.

### 12.5. Nguồn hợp nhất và cách duy trì

Tài liệu này tổng hợp bản kế hoạch v0.4, bộ copy cùng phiên bản và các kết luận review còn hiệu lực từ ba tài liệu ngày 15/10/2026. Các tài liệu trùng lặp đã được dọn để chỉ còn một nguồn đặc tả. Những lựa chọn lịch sử bị thay thế đã được tóm tắt ở mục 11.2, không trộn vào yêu cầu hiện hành.

Khi studio chốt thay đổi mới, cập nhật quy tắc, copy, dữ liệu/API và ca nghiệm thu liên quan cùng một lượt trong file này. Luôn giữ riêng phần đã chốt, phương án dự kiến và bằng chứng đã kiểm để người đọc không nhầm kế hoạch với tính năng đã có.

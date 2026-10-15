# Biên bản review kế hoạch feedback sau bàn giao

Ngày: 15/10/2026. Tài liệu được review: [kế hoạch v0.2](customer-feedback-plan-2026-10-15.md). Phạm vi: thiết kế và đối chiếu source của working tree hiện tại, không triển khai feedback hoặc thao tác production.

## 1. Kết luận

Hướng đi phù hợp với năm quyết định của studio: bàn giao đa kênh, thu thập nội bộ, một cảm nhận chung cho mỗi buổi/đơn, studio tự xác nhận hoàn tất, gửi link thủ công. Cần một hồ sơ bàn giao nhẹ vì dữ liệu hiện tại chưa có entity đơn hàng hoặc liên kết inquiry–album đáng tin cậy.

Bản trước còn thiếu contract cho chuyển trạng thái, retry, dữ liệu riêng tư và khôi phục backup. Đã bổ sung trong v0.2. Chưa có bằng chứng tính năng chạy đúng vì chưa viết tính năng; ba lựa chọn UX và các kiểm chứng runtime vẫn còn mở. Các vấn đề dưới đây là thiếu sót/rủi ro của **kế hoạch**, không phải tuyên bố website đang có lỗi feedback trong production.

## 2. Bằng chứng và giới hạn xác minh

Đã đối chiếu các nhóm liên quan trong source: schema/adapter hai DB; transaction/limiter; quyền admin/gallery; inquiry và booking; gallery selection/download; routing/HTML/SEO/analytics; API transport và form lifecycle; export/startup; test hiện có và tài liệu vận hành. Ba lượt review chuyên biệt xem backend, frontend và lifecycle; đã kiểm tra chéo bản v0.2 sau khi tổng hợp.

Các nguồn chính:

- [db.mjs](../studio/server/db.mjs): `openDatabase`, queue SQLite, transaction PostgreSQL, DDL và danh sách RLS.
- [app.mjs](../studio/server/app.mjs): `rate`, `allowed`, `albumDTOs`, middleware admin, inquiry routes, export, HTML `page`/`galleryPage`/`privatePage`, catch-all.
- [gallery-selection.mjs](../studio/server/gallery-selection.mjs): mẫu xác thực lại trong transaction và no-op.
- [request-security.mjs](../studio/server/request-security.mjs): kiểm Host/Origin, proxy và no-store cho API.
- [main.js](../studio/web/main.js): routing một lần lúc khởi tạo, admin navigation, submit chung, clipboard, dirty guard.
- [api-request.mjs](../studio/web/api-request.mjs), [inquiry-form.mjs](../studio/web/inquiry-form.mjs): timeout/AbortSignal, cấu trúc lỗi, request key và chống submit trùng.
- [start.mjs](../studio/server/start.mjs): mở app/migration trước khi listen; [OPERATIONS.md](../OPERATIONS.md): backup và vận hành.

Working tree có nhiều thay đổi gallery/proofing/upload từ công việc khác. Review dựa vào nội dung đã đọc, không dựa trên một commit đóng băng; vì vậy dùng tên hàm/route làm mốc. Trước khi code cần xem lại những điểm nối đã thay đổi, không ghi đè các thay đổi đó.

Đã chạy lệnh sau với Node **v23.6.0**, bỏ các biến DB để bộ test dùng database/thư mục tạm:

```sh
env -u DATABASE_URL -u STUDIO_TEST_POSTGRES_URL -u NODE_OPTIONS NODE_ENV=test node --test \
  studio/tests/migration.test.mjs studio/tests/security.test.mjs \
  studio/tests/schema-analytics.test.mjs studio/tests/api-request.test.mjs \
  studio/tests/inquiry-form.test.mjs studio/tests/bootstrap.test.mjs
```

Kết quả: **30 đạt, 0 lỗi, 0 bỏ qua**, exit code 0. Đây là kiểm thử nền hiện có cho migration/bảo mật/schema-analytics/form/API/bootstrap tại thời điểm chạy; không phải chứng nhận code feedback, không bao phủ mọi regression gallery.

Chưa chạy PostgreSQL, browser, Zalo, Cloudflare/proxy thật hoặc production. Không đọc dữ liệu khách thật, không gửi tin nhắn/email, không thay đổi môi trường/secret. Trong lượt review này chỉ chỉnh hai tài liệu: kế hoạch và biên bản này.

## 3. Những điểm đã sửa và lý do

### F01 — Không dùng gallery/inquiry làm đơn chụp

**Kịch bản:** một buổi có gallery lễ và tiệc, thêm ảnh Drive; nếu mở feedback theo từng gallery thì nhận nhiều bản cho cùng dịch vụ. Inquiry completed cũng chưa chứng minh giao đủ sản phẩm.

**Bằng chứng:** DDL albums/inquiries độc lập; album status điều khiển quyền hiển thị, selection status điều khiển chọn ảnh; không có quan hệ booking–gallery để tự suy ra.

**Sửa:** hồ sơ bàn giao liên kết 0–N gallery và inquiry tùy chọn; một feedback/hồ sơ. Gallery có một liên kết hiện hành kể cả hồ sơ archived, bảo vệ bằng unique và transaction. Tìm hồ sơ cũ/cảnh báo trùng cả dữ liệu lưu trữ. Không tự ghép theo tên, không tự gộp.

**Giới hạn còn lại:** admin vẫn có thể tạo hai hồ sơ cho cùng đơn ngoài đời; chưa có ID đơn hàng chuẩn để cưỡng chế tuyệt đối. Không tái sử dụng hồ sơ đã cấp link cho khách/buổi khác; lưu snapshot ngữ cảnh ở lần gửi đầu, không đồng bộ ngược lời khách từ album. Ngày bàn giao thực tế tách khỏi timestamp xác nhận để nhập các buổi cũ. Nghiệm thu: FB01–05.

### F02 — Đóng, thu hồi, hết hạn và lưu trữ cần kết quả khác nhau

**Kịch bản:** nếu archive chỉ thêm cờ, unarchive có thể làm một lời mời active hoạt động trở lại. Nếu copy đồng nghĩa cấp lại thì link khách đang giữ mất hiệu lực.

**Sửa:** bốn trục trạng thái riêng và bảng hành động trong kế hoạch. Archive chuyển active thành paused; unarchive không đổi invitation state. Copy giữ nguyên link/hạn; renew không tự mở paused; revoke đổi nonce; undo bàn giao thu hồi cùng transaction; cấp lại là command riêng. Chỉ ghi “đã sao chép”, không suy ra “đã gửi/đã nhận”. Nghiệm thu: FB05–06, FB14.

### F03 — Restore backup có thể làm sống lại link đã thu hồi

**Kịch bản:** ngày 1 link còn active; ngày 2 thu hồi; ngày 3 restore snapshot ngày 1 và giữ signing secret. Nonce cũ lại hợp lệ.

**Sửa:** phân biệt restart/deploy thường với restore dữ liệu cũ. Restart giữ secret; restore cũ mặc định khóa feedback trong quá trình phục hồi, đổi secret trên mọi instance trước traffic, sau đó cấp lại link cần thiết. MVP không có nhật ký toàn bộ lần thu hồi để giữ link cũ một cách đáng tin cậy. Không khẳng định rotate key cứu dữ liệu mới hơn snapshot. Nghiệm thu: FB09, FB28–29.

### F04 — Dùng lại helper DB sai chỗ có thể treo SQLite

**Kịch bản:** transaction đang giữ lượt trong queue SQLite, callback lại gọi `rate()` dùng `db` ngoài transaction. Lệnh limiter đợi transaction kết thúc, transaction lại đợi limiter.

**Bằng chứng:** `openDatabase` tuần tự hóa thao tác SQLite; `rate` đóng trên connection ngoài; gallery-selection hiện dùng `tx` để tránh tình trạng đó.

**Sửa:** tất cả helper trong transaction nhận cùng tx; limiter bên ngoài rồi xác thực lại bên trong, hoặc refactor connection rõ ràng. Khóa hồ sơ trước mutation, cùng thứ tự cho save/revoke; chuyển gallery giữa hai hồ sơ khóa theo ID cố định. Không giữ khóa trong lúc gọi network. Nghiệm thu: FB03, FB11–13, FB23.

### F05 — Gửi đúp, mất ACK và chỉnh sửa cần ba cơ chế phối hợp

**Kịch bản:** server đã lưu nhưng khách timeout; gửi lại với key mới dễ tạo thao tác khác. Admin mất ACK khi rotate rồi bấm lại có thể vô hiệu link vừa copy. Hai tab có thể ghi đè nhau dù database không tạo bản trùng.

**Sửa:** unique feedback/hồ sơ; request key/hash; expectedVersion; snapshot payload/key/version/context bất biến khi chưa rõ kết quả. Admin có handover_version và identity command riêng. Replay được kiểm sau quyền, trước version; không tự nâng version để ghi đè.

**Giới hạn có chủ ý:** chỉ nhớ receipt feedback gần nhất. Key không còn được nhớ xử lý theo expectedVersion: stale thì conflict; version chưa đổi thì có thể thành no-op hợp lệ. No-op A, no-op B rồi retry A không thể luôn bị nhận diện là key cũ. Không hứa nhận diện mọi key đã dùng hoặc replay vô hạn; không thêm ledger chỉ để đáp ứng lời hứa đó. Nghiệm thu: FB10–11, FB14, FB18.

### F06 — “Đã đọc” phải gắn với phiên bản đã nhìn thấy

**Kịch bản:** admin xem v1, khách vừa gửi v2, admin bấm đã đọc; nếu server đánh dấu version mới nhất thì bỏ sót nội dung chưa xem.

**Sửa:** read_version và observed_version; không đánh dấu quá phiên bản admin gửi lên và không giảm giá trị đã đọc. Nội dung thay đổi mới tăng version/unread; replay/no-op không đổi updated_at hoặc unread. Admin không sửa lời khách. Nghiệm thu: FB15.

### F07 — Route riêng vẫn có thể vô tình chạy shell/analytics công khai

**Bằng chứng:** HTML handler coi `req.params.id` là gallery; private branch hiện chủ yếu phục vụ gallery/admin. Frontend public shell khởi tạo các thành phần không cần cho form; lỗi khởi tạo dùng thông báo gallery. CSP toàn site cho phép Cloudflare, dù app có bỏ beacon ở private HTML.

**Sửa:** handler/shell feedback riêng, quyền token độc lập với cookie admin/gallery; DTO tối thiểu; OG chung, no-store/noindex/no-referrer, CSP chỉ script/connect cùng origin; API lỗi cũng private. Không trả token qua gallery, public HTML hay bootstrap.

**Cần kiểm ngoài source:** Cloudflare hỗ trợ tự chèn analytics và rule loại trừ. Code bỏ beacon chưa chứng minh cấu hình edge đã loại trừ đường feedback. Cần xem cấu hình và network qua proxy staging thực tế; chưa kết luận production đang chèn hay không. [Tài liệu Cloudflare](https://developers.cloudflare.com/web-analytics/configuration-options/rules/). Nghiệm thu: FB06–09, FB24–25.

### F08 — Bản nháp, token và response đến trễ phải cùng context

**Kịch bản:** khách chuyển từ link A sang B nhưng request A về sau; hoặc chỉ fragment đổi mà pathname giữ nguyên. Nếu chỉ dựa trên URL path, dữ liệu A có thể xuất hiện/gửi ở B. Quay lại tab cũ cũng có thể hiện nội dung tải từ trước khi revoke.

**Sửa:** context = ID + token; hashchange/popstate, epoch, bỏ kết quả cũ; không tái dùng draft/key giữa lời mời. Revalidate khi pageshow/quay lại tab/app/online, che dữ liệu server trong lúc kiểm; giữ bản đang gõ của đúng context. Phân biệt lỗi mạng với mất quyền.

**Giới hạn:** không thể thu hồi nội dung đã xem/chụp hoặc hứa xóa tức thì ở mọi tab. No-store không đủ để bỏ kiểm lifecycle: Chrome cho phép một số trang no-store vào bfcache theo điều kiện; cần test trang thực tế. [Tài liệu Chrome](https://developer.chrome.com/docs/web-platform/bfcache-ccns). Nghiệm thu: FB19–20.

### F09 — Không nên copy nguyên form inquiry và API helper

**Bằng chứng:** generic helper để field errors ở `error.data.fields`, inquiry dùng cấu trúc riêng; helper tự tạo AbortSignal; main có submit listener chung và dirty guard hiện chỉ phục vụ upload/sections. Clipboard có thể bị từ chối.

**Sửa:** contract lỗi thống nhất; signal có chủ đích và epoch luôn tồn tại; stopPropagation ở form riêng; giữ form khi lỗi, nút thử lại không reload. Rating nullable có cách bỏ chọn; góp ý rỗng có thể xóa; full PUT tránh nhập nhằng bỏ field. Canonical link từ SITE_URL; fallback copy thủ công khi clipboard lỗi.

**Giới hạn:** bản nháp trong bộ nhớ không được bảo đảm khi Zalo/OS đóng trang. Không tự lưu nội dung/token vào browser storage; không quảng bá “không bao giờ mất bản nháp”. Fragment/Zalo iOS/Android là điểm phải thử sớm. Nghiệm thu: FB16–18, FB21–22.

### F10 — JSON export hiện tại chưa phải snapshot nhất quán

**Bằng chứng:** route export đọc danh sách bảng cố định bằng nhiều SELECT ngoài transaction; dữ liệu mới sẽ bị bỏ sót nếu chỉ thêm schema. BEGIN mặc định PostgreSQL cũng chưa bảo đảm các SELECT cùng một snapshot.

**Sửa:** thêm bảng/định dạng export và snapshot nhất quán, PostgreSQL dùng isolation phù hợp; phân biệt metadata export với backup DB và restore thực sự. Key nằm ngoài JSON/repo. Migration additive, rollback code giữ dữ liệu, health check hiện có không đồng nghĩa feedback sẵn sàng.

**Khác biệt hai DB:** CHECK/index/FK cần cho cả hai; RLS chỉ PostgreSQL/Supabase, kiểm thêm bằng role không đặc quyền. Không viết yêu cầu RLS cho SQLite. Nghiệm thu: FB26–29.

### F11 — “Nội bộ” và “lưu trữ” cần được thể hiện đúng trong sản phẩm

**Sửa:** copy form nói rõ chỉ gửi riêng studio; không tag chỉ tích cực, không mặc định 5 sao, không xin công khai trong MVP. Future testimonials phải có đồng ý riêng. Archive không đồng nghĩa xóa: cần runbook tối thiểu để xác định hồ sơ, thu hồi và xử lý yêu cầu xóa nội dung; backup có vòng đời riêng, không tự hứa xóa mọi bản sao ngay lập tức. Không thêm màn quản trị xóa hàng loạt hoặc quy trình công khai vào MVP.

## 4. Điều kiện để chuyển từ review sang triển khai

1. Chốt ba lựa chọn với studio: bộ trường form, cho phép sửa khi link còn hạn, hạn mặc định 90 ngày. Những mục này vẫn là đề xuất; không hỏi lại năm quyết định đã có.
2. Khi bắt đầu làm: thử nhỏ bằng dữ liệu giả cho fragment trên Zalo, private shell qua proxy, lifecycle và transaction/retry hai DB. Nếu cơ chế truyền token không đáp ứng thực tế thì sửa contract trước khi xây đầy đủ.
3. Thực hiện ma trận **FB01–FB30** trong kế hoạch, bao gồm quyền, đồng thời, lost ACK, browser/device, export/restore và regression. Hiện toàn bộ ca FB chưa chạy.
4. Trước sử dụng thật: hoàn tất diễn tập restore và xác nhận readiness ở môi trường dùng để phát hành. Review này không thực hiện deploy hoặc gửi lời mời khách.

Không thấy lý do phải mở rộng MVP thành CRM, email automation hoặc testimonials. Sau các sửa trên, phần còn chưa chắc chắn đã có điều kiện kiểm chứng cụ thể, thay vì được coi là đã giải quyết chỉ bằng thiết kế.

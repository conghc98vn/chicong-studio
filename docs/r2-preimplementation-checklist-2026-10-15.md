**Danh sách chuẩn bị và xác nhận trước khi tích hợp R2 — 15/10/2026**

Tài liệu dành cho chủ website, đi cùng [kế hoạch](r2-migration-plan-2026-10-14.md) và [biên bản xác minh](r2-plan-verification-2026-10-15.md). Hiện vẫn là giai đoạn chuẩn bị; chưa bắt đầu viết tính năng R2 hoặc chuyển website thật. Các đề xuất dưới đây chưa trở thành lựa chọn của người dùng chỉ vì được ghi vào tài liệu.

Có hai mốc khác nhau: **bắt đầu code và kiểm thử riêng**, sau đó **đưa bản đã kiểm chứng lên website thật và chuyển kho**. Chưa cần có đủ tài khoản, dữ liệu thật hoặc lịch bảo trì để viết phần code local. Trước khi thử cloud và chuyển thật, các điều kiện vận hành tương ứng phải được giải quyết.

**Các lựa chọn đã chốt — chỉ cần báo nếu muốn thay đổi**

| Nội dung | Lựa chọn đã nhận |
|---|---|
| Nội dung đợt đầu | Ảnh portfolio và gallery khách; video để sau |
| Phiên bản ảnh | Các bản web/JPG như hiện tại, không thêm kho file gốc/RAW |
| Cách phục vụ ảnh | R2 private; website kiểm tra quyền rồi mới lấy ảnh |
| Khối lượng dự kiến | Dưới 1.000 ảnh mới mỗi tháng |
| Chi phí | Ưu tiên miễn phí, chấp nhận phí nhỏ khi vượt hạn mức; chưa có số tiền cụ thể |

Phương án kỹ thuật giữ database ở Supabase và website trên Render. Ảnh chân dung đang dùng cũng được kiểm kê để không mất chức năng hiện có. R2 thay kho file; không tự giải quyết mọi nguyên nhân upload chậm hay loại bỏ băng thông của Render.

**Sáu câu hỏi để người dùng trả lời ở vòng xác nhận này**

1. **Thời hạn giữ gallery:** có đồng ý giữ ảnh cho đến khi bạn chủ động xóa, chưa tự xóa theo ngày không? Đây là đề xuất cho đợt đầu. Nếu đã hứa với khách thời hạn cụ thể, ghi thêm thời hạn đó để lập kế hoạch dung lượng. Ẩn/lưu trữ album không đồng nghĩa xóa file hoặc giải phóng dung lượng. Việc xóa theo yêu cầu vẫn giữ hành vi hiện tại; không tự thêm thùng rác/khôi phục bằng một nút.

2. **Yêu cầu riêng của gallery khách:** có gallery nào bạn cần bắt buộc mật khẩu nhưng hiện chỉ đang chia sẻ bằng link không? Nếu không có yêu cầu bổ sung, giữ nguyên hai kiểu đang có. Người có link có thể xem gallery không đặt mật khẩu; R2 private không tự biến gallery đó thành gallery có mật khẩu. Không tự đặt mật khẩu mới hoặc đổi link đã gửi khách. Đây là kiểm tra yêu cầu còn thiếu, không hỏi lại lựa chọn giữ cơ chế kiểm tra quyền đã chốt.

3. **Lỗi mật khẩu đã phát hiện:** có đồng ý đưa việc sửa lỗi phiên truy cập cũ khi đổi mật khẩu vào bước đầu, với kiểm thử riêng, trước nghiệm thu R2 không? Đề xuất có. Review đã tái hiện một yêu cầu mở khóa bằng mật khẩu cũ đang xử lý có thể tạo phiên hợp lệ sau lúc đổi mật khẩu. Đây là lỗi có sẵn trong bản code đã kiểm tra, chưa được sửa và chưa phải bằng chứng xảy ra trên website thật. Khi bắt đầu code phải kiểm tra lại trên bản mới nhất để tránh sửa trùng công việc khác.

4. **Mức chi phí cần báo:** bạn muốn được cảnh báo khi chi phí R2 ước tính đạt bao nhiêu mỗi tháng? Có thể trả lời bằng VND hoặc USD; cũng có thể chọn “đề xuất sau khi đo dung lượng”. Đây là ngưỡng để xem xét, không phải cam kết hóa đơn không vượt mức hay cơ chế tự dừng upload. Chi phí R2, Render, đọc nguồn Supabase, môi trường thử và backup phải được trình bày riêng; ngân sách một lần để chuyển dữ liệu chốt sau kiểm kê. Chưa tự mua gói hoặc dịch vụ khác.

5. **Tài khoản Cloudflare:** bạn chưa có tài khoản, đã có nhưng chưa bật R2, hay đã bật R2? Bạn có tự quản lý được tài khoản và bước xác nhận thanh toán không? Chỉ cần trả lời trạng thái; không gửi mật khẩu, số thẻ, Access Key hoặc Secret Key trong chat.

6. **Bản sao hiện tại:** bạn đang giữ ảnh gốc ở đâu, và đã có nơi riêng để lưu backup website chưa — máy tính, ổ cứng/NAS, dịch vụ lưu trữ riêng hay chưa có? Chỉ cần mô tả loại nơi lưu và dung lượng trống ước tính nếu biết. Ảnh gốc giúp bảo vệ tác phẩm nhưng không thay backup database: chúng không lưu danh sách ảnh khách chọn, album, booking hay các liên kết của website. Nếu chưa có, ghi “chưa có” để đề xuất phương án sau kiểm kê.

Ba câu đầu xác nhận hành vi và phạm vi sửa code. Ba câu sau cung cấp đầu vào vận hành; có thể trả lời “chưa rõ” và xử lý trước mốc sử dụng cloud liên quan. Không bắt người dùng tự tính số request, dung lượng chính xác hay chọn thông số SDK.

**Những thứ cần chuẩn bị theo từng mốc**

| Mốc | Người dùng chuẩn bị/xác nhận | Phần mình thực hiện |
|---|---|---|
| Trước bắt đầu code | Trả lời các câu hỏi trên, nêu điều bắt buộc phải giữ hoặc vấn đề đang gặp | Cập nhật phạm vi, kiểm tra code mới nhất và các thay đổi đang làm song song, chia phần triển khai |
| Trước thử R2 thật | Quyền truy cập tài khoản Cloudflare; tự làm bước thanh toán nếu nhà cung cấp yêu cầu; có thể cung cấp ảnh thử không nhạy cảm | Chuẩn bị cấu hình có chỗ điền, hướng dẫn tạo kho và nhập secrets đúng nơi; thử với bucket và database riêng |
| Trước kiểm kê/copy dữ liệu thật | Xác định đúng website/dự án đang chạy; xác nhận dữ liệu nào được dùng thử; thống nhất ngân sách đọc nguồn và nơi backup | Kiểm tra gói/quota/region/commit thực tế qua quyền truy cập phù hợp; lập danh mục và dự toán lượt đọc trước khi tải toàn kho |
| Trước chuyển production | Chọn khung giờ, người thao tác deploy, thời gian tạm khóa quản trị ảnh có thể chấp nhận | Đưa thời lượng ước tính sau diễn tập; hướng dẫn rõ bước tiếp tục, dừng hoặc quay lại |
| Sau khi chuyển đạt yêu cầu | Thống nhất thời hạn giữ kho cũ và người theo dõi chi phí/backup | Báo cáo đủ file, hoạt động sau chuyển, nghĩa vụ dữ liệu mới; chỉ dọn kho cũ theo quyết định đã thống nhất |

Ảnh thử là tùy chọn khi viết test local: có thể tự tạo fixture. Khi thử chức năng thực tế nên có một nhóm ảnh đại diện nhỏ: ảnh thường, ảnh nhiều chi tiết/dung lượng lớn, ảnh dọc/ngang và gói .ccphoto nếu bạn đang dùng. Không cần cung cấp toàn bộ ảnh khách để bắt đầu code. Không gửi credentials, bản dump database hoặc ảnh khách nhạy cảm vào chat.

Không cần tự bật r2.dev, tạo domain media public hay đổi DNS website cho phương án này. Cấu hình bí mật sẽ nằm ở môi trường server/môi trường thử phù hợp; tài liệu và Git chỉ chứa ví dụ không có khóa thật. Không cài .env production vào môi trường thử.

**Những điểm bạn cần review trên bản thử**

Mình chuẩn bị kịch bản và bằng chứng; bạn xác nhận trải nghiệm đúng nhu cầu sử dụng studio:

- Link album đã gửi khách vẫn mở đúng; gallery có/không mật khẩu đúng như bạn mong muốn. Đổi mật khẩu, ẩn hoặc lưu trữ album được thử theo đúng chế độ chia sẻ. File khách đã tải về không thể thu hồi từ máy họ.
- Upload ảnh thường và .ccphoto hoạt động; thử lại không nhân đôi ngoài ý muốn. Ghi đè ảnh vẫn giữ lựa chọn của khách, ảnh bìa, chú thích và thứ tự.
- Khách xem, chọn ảnh, tải một JPG hoặc tải ZIP đúng chức năng hiện tại; kiểm tra trên điện thoại và máy tính. Ảnh cũ và ảnh mới đều tải được.
- Trang chủ, portfolio và chân dung vẫn đúng. Chất lượng/kích thước ảnh không bị âm thầm thay đổi để tạo kết quả tốc độ đẹp hơn.
- Khi storage lỗi hoặc tạm khóa thay đổi ảnh để chuyển kho, thông báo đủ rõ để bạn biết nên chờ hay thử lại. Không báo upload thành công nếu chưa xác nhận đủ dữ liệu.
- Báo cáo dung lượng/chi phí phân biệt số đo thực tế với ước tính; kết quả đo tốc độ không được trình bày thành lời hứa khi chưa thử thực tế.

Bạn không cần đọc source code hoặc tự kiểm tra checksum. Việc vượt qua kiểm thử kỹ thuật và diễn tập khôi phục là trách nhiệm của phần triển khai, không được thay bằng câu “chủ website thấy giao diện bình thường”.

**Các quyết định chỉ cần chốt trước chuyển thật**

| Câu hỏi sẽ cần chốt | Gợi ý cách quyết định |
|---|---|
| Backup định kỳ do ai thực hiện và lưu ở đâu? | Chọn sau khi biết kích thước thật, chi phí và khả năng vận hành; bản sao phải được bảo vệ và thử khôi phục |
| Nếu sự cố xảy ra giữa hai lần backup, cần khôi phục đến gần thời điểm nào? | Xác định có chấp nhận nhập lại thay đổi của tối đa một ngày không, hay cần khoảng ngắn hơn; bao gồm cả lựa chọn khách và booking, không chỉ ảnh |
| Muốn khôi phục hoạt động trong bao lâu khi gặp sự cố? | Dựa trên nhu cầu giao ảnh cho khách và thời gian khôi phục đã đo; chưa hứa SLA trước diễn tập |
| Khung giờ ít ảnh hưởng nhất và mức tạm ngừng chấp nhận được? | Phân biệt tạm khóa upload/ghi đè/xóa ảnh với gián đoạn ngắn khi deploy; chưa cam kết khách truy cập liên tục tuyệt đối |
| Giữ kho cũ bao lâu sau khi chuyển? | Có thể xem xét 7–14 ngày sau nghiệm thu nếu quota/chi phí cho phép; chưa coi đây là thời hạn đã được chọn |
| Ai nhận/xem cảnh báo chi phí, mức nào cần hành động? | Chọn người/kênh được hỗ trợ, kiểm tra cấu hình thực tế; không hứa cảnh báo tức thời hoặc trần hóa đơn |
| Ai thực hiện deploy và quyết định quay lại khi kiểm tra không đạt? | Thống nhất vai trò và tiêu chí trước cửa sổ chuyển; phương án quay lại phải bảo toàn ảnh và dữ liệu mới |

Kho Supabase cũ không tự cập nhật ảnh phát sinh trên R2 và không thay thế backup sau chuyển. Xóa file kho cũ và xóa bản backup là hai chính sách khác nhau. Không xóa Supabase project vì database vẫn sử dụng dịch vụ đó.

**Các điều kiện kỹ thuật mình phải chứng minh**

- Code chọn kho rõ ràng, thiếu cấu hình không tự ghi vào ổ đĩa tạm; đã thử kết nối và hành vi lỗi với R2 thật.
- Bucket private được xác minh qua cấu hình và đường truy cập; môi trường thử không thể sửa dữ liệu hoặc chạy việc xóa của website thật.
- Lỗi cấp phiên bằng mật khẩu cũ được xử lý và kiểm thử trên baseline triển khai; các luồng ảnh/tải xuống không hồi quy.
- Danh mục chuyển theo tên file hiện hành, kể cả ảnh đã ghi đè; số byte và checksum khớp ở đích. Mọi file thiếu hoặc dư đều có trạng thái giải thích được.
- Tạm khóa được mọi thao tác thay đổi media, đợi tác vụ đang chạy hoàn tất, dọn xong hàng đợi xóa trên đúng kho trước đổi cấu hình. Không chuyển nếu không chứng minh được điều này.
- Backup có cặp database/file phù hợp và đã thử restore riêng. Phương án quay lại không làm mất booking/lựa chọn mới hoặc làm sống lại ảnh đã xóa.
- Có kết quả diễn tập, dự toán chi phí và kịch bản chuyển cụ thể để người dùng review trước tác động production.

**Mẫu trả lời ngắn cho vòng hiện tại**

```text
1. Thời hạn giữ gallery: giữ tới khi tôi tự xóa / mong muốn khác: ...
2. Có yêu cầu bắt buộc mật khẩu nào chưa đáp ứng: không / có: ...
3. Sửa lỗi phiên truy cập khi đổi mật khẩu trong bước đầu: đồng ý / cần giải thích thêm.
4. Ngưỡng chi phí R2 cần báo mỗi tháng: ... / đề xuất sau kiểm kê.
5. Cloudflare: chưa có / có tài khoản chưa bật R2 / đã bật R2.
6. Ảnh gốc đang ở: ...; nơi backup website riêng: ... / chưa có.
```

Trả lời bảng này dùng để hoàn thiện kế hoạch. Chỉ bắt đầu code khi người dùng yêu cầu thực hiện; trả lời về tài khoản hay ngân sách không tự đồng nghĩa cho phép mua gói, triển khai production hoặc xóa dữ liệu.

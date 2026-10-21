> **Tài liệu lịch sử — đã hợp nhất ngày 16/10/2026.** Đọc [kế hoạch triển khai R2 và backup chính](r2-implementation-plan.md) để có các quyết định và điều kiện hiện hành. Nội dung bên dưới được giữ làm lịch sử review; những câu hỏi/trạng thái cũ có thể đã được giải quyết trong bản hợp nhất.

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

**Danh sách chuẩn bị và xác nhận trước khi tích hợp R2 — 15/10/2026**

Tài liệu dành cho chủ website, đi cùng [kế hoạch](r2-migration-plan-2026-10-14.md) và [biên bản xác minh](r2-plan-verification-2026-10-15.md). Cập nhật theo sáu bình luận và các câu trả lời bổ sung ngày 15/10. Hiện vẫn là giai đoạn chuẩn bị; chưa bắt đầu viết tính năng R2 hoặc chuyển website thật. Bảng dưới phân biệt lựa chọn đã nhận với phương án còn đang đề xuất.

Bổ sung giải thích vận hành ngày 16/10/2026 ở cuối tài liệu. HEAD vẫn là 1ea50e8; không chạy lại bộ kiểm thử hoặc coi đây là xác minh production mới. Các lựa chọn trước được giữ nguyên.

Có hai mốc khác nhau: **bắt đầu code và kiểm thử riêng**, sau đó **đưa bản đã kiểm chứng lên website thật và chuyển kho**. Chưa cần có đủ tài khoản, dữ liệu thật hoặc lịch bảo trì để viết phần code local. Trước khi thử cloud và chuyển thật, các điều kiện vận hành tương ứng phải được giải quyết.

**Các lựa chọn đã chốt — chỉ cần báo nếu muốn thay đổi**

| Nội dung | Lựa chọn đã nhận |
|---|---|
| Nội dung đợt đầu | Ảnh portfolio và gallery khách; video để sau |
| Phiên bản ảnh | Các bản web/JPG như hiện tại, không thêm kho file gốc/RAW |
| Cách phục vụ ảnh | R2 private; website kiểm tra quyền rồi mới lấy ảnh |
| Khối lượng dự kiến | Dưới 1.000 ảnh mới mỗi tháng |
| Chi phí | Ưu tiên miễn phí, chấp nhận phí nhỏ khi vượt hạn mức; chưa có số tiền cụ thể |
| Thời hạn gallery | Đã chốt giữ tới khi chủ website tự xóa, không tự xóa theo ngày |
| Mật khẩu | Giữ cách vào album hiện tại, không thêm bước bảo mật phức tạp |
| Lỗi phiên khi đổi mật khẩu | Đồng ý review/cải thiện, đưa thành phần việc riêng khi bắt đầu triển khai |
| Cloudflare | Đã có tài khoản, chưa kích hoạt R2 |
| Backup ảnh hiện tại | Ảnh gốc/ảnh xuất Lightroom trên Drive và ổ cứng; copy thành các bản riêng, xóa một nơi không tự xóa nơi kia |
| Backup website dự kiến | Ưu tiên tự động hằng ngày lên Drive nếu tận dụng được hạ tầng hiện có; người dùng tự copy thêm xuống ổ cứng khi thuận tiện; chưa triển khai/lập lịch |
| Drive dùng cho backup | Tài khoản Gmail cá nhân người dùng đã chỉ định trong cuộc trao đổi; còn khoảng 5TB theo người dùng, chưa truy vấn tài khoản |
| Lịch sử backup website | Đã chọn ngày 16/10: 30 ngày gần nhất nếu dung lượng đủ; không đổi thời hạn gallery |

Phương án kỹ thuật giữ database ở Supabase và website trên Render. Ảnh chân dung đang dùng cũng được kiểm kê để không mất chức năng hiện có. R2 thay kho file; không tự giải quyết mọi nguyên nhân upload chậm hay loại bỏ băng thông của Render.

**Ý nghĩa của sáu câu trả lời đã nhận**

1. **Giữ gallery tới khi tự xóa — đã chốt.** Không thiết lập lịch tự xóa ảnh/album trên R2. Ẩn/lưu trữ vẫn chiếm dung lượng. Xóa trên website tiếp tục xóa dữ liệu hoạt động theo chức năng hiện tại; không tác động các bản ảnh gốc trên Drive/ổ cứng. Không tự thêm thùng rác hoặc nút phục hồi. Lịch sử backup website được chốt riêng là 30 ngày, nếu đủ dung lượng.

2. **Mật khẩu đơn giản như hiện tại — đã chốt.** Khách nhập mật khẩu của album khi album được cấu hình yêu cầu. Không tự thêm tài khoản khách, OTP, mật khẩu cho mọi album hoặc đổi link đã gửi. Server vẫn phải kiểm tra quyền khi trả file; chỉ khóa trang album nhưng để file ở đường public sẽ không đáp ứng chức năng mật khẩu hiện tại. Đây là bảo toàn cách truy cập đã có, không thêm thao tác cho khách.

3. **Review/cải thiện lỗi phiên — người dùng đồng ý về phạm vi, chưa yêu cầu code ngay.** Mục tiêu: khi đổi mật khẩu xong, một yêu cầu đang xử lý với mật khẩu cũ không được cấp phiên mới còn hợp lệ; phiên cũ phải không dùng được cho yêu cầu tiếp theo. Không hứa thu hồi ảnh đã tải về hoặc mọi byte của yêu cầu đã chạy. Giải pháp kỹ thuật do bên triển khai chọn, kèm test cho thao tác mở khóa và đổi mật khẩu xảy ra đồng thời.

4. **Ưu tiên free, phát sinh ít nếu cần — giữ đúng lựa chọn.** Chưa ép chọn số tiền hoặc tự đặt trần/dừng upload. Sau kiểm kê sẽ trình bày riêng chi phí R2, Render, chuyển dữ liệu và backup. Giữ ảnh đến khi tự xóa khiến dung lượng tích lũy; không thể bảo đảm miễn phí mãi. Các số minh họa phải tách tiền lưu file khỏi lượt đọc/ghi và dịch vụ khác. Chưa tự mua gói hoặc dịch vụ bổ sung.

5. **Cloudflare mới có tài khoản — đã rõ.** Chưa cần tạo kho thật để tiếp tục kế hoạch. Trước thử cloud sẽ hướng dẫn kích hoạt R2, tạo bucket thử private, token đúng quyền và nhập secrets ở môi trường server. Người dùng tự xử lý phần tài khoản/thanh toán. Không gửi mật khẩu, số thẻ hoặc khóa bí mật trong chat.

6. **Drive + ổ cứng là hai bản ảnh riêng — đã rõ sau hỏi bổ sung.** Hiện chủ yếu có ảnh gốc và ảnh xuất Lightroom; chưa đủ để phục hồi album, lựa chọn khách và booking. Người dùng tiếp tục chọn ưu tiên backup website tự động hằng ngày nếu tận dụng được hạ tầng hiện có. Đề xuất giữ ảnh gốc nguyên cách đang làm, bổ sung bộ backup website có phiên bản riêng; chưa coi Google Drive đã kết nối với website hoặc máy chủ đã có tác vụ backup.

Không hỏi lại sáu lựa chọn này. Phần còn mở tập trung vào cách thực hiện backup tự động, dung lượng thật và điều kiện chuyển production. Không bắt người dùng tự tính số request hay chọn thông số SDK.

**Những thứ cần chuẩn bị theo từng mốc**

| Mốc | Người dùng chuẩn bị/xác nhận | Phần mình thực hiện |
|---|---|---|
| Trước bắt đầu code | Làm rõ phần backup còn mở, nêu yêu cầu sử dụng bổ sung nếu có | Cập nhật phạm vi đã nhận, kiểm tra code mới nhất và các thay đổi đang làm song song, chia phần triển khai |
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
| Backup tự động hằng ngày chạy ở đâu và ai theo dõi lỗi? | Ưu tiên hạ tầng hiện có theo lựa chọn mới; cần kiểm chứng nơi chạy, quyền, quota và cách lưu độc lập. Đây chưa phải lịch đã được bật |
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

**Backup website tự động: phần cần làm rõ tiếp**

- Một bộ backup gồm database tại một thời điểm, danh mục ảnh đúng phiên bản và bytes của các file đó. Chỉ có ảnh gốc hoặc chỉ JSON từ nút “Sao lưu dữ liệu” chưa đủ. Không lấy snapshot mới rồi ghép với media thiếu hoặc khác phiên bản.
- Đã chốt tự động lưu backup website lên Drive, người dùng tự copy thêm xuống ổ cứng khi thuận tiện. Đề xuất chạy ngoài tiến trình phục vụ khách, ưu tiên GitHub Actions đã có cấu trúc CI trong repo. Chưa có workflow backup, chưa xác minh quota/tình trạng remote, chưa chọn chính thức scheduler hoặc kết nối Drive. Bản local có thể cũ hơn bản Drive.
- Hằng ngày là lịch mong muốn, không tự bảo đảm mọi lần chạy thành công hoặc bảo vệ dữ liệu ngay trước sự cố. Cần biết lần thành công cuối và báo lỗi; phải đo mức trễ/lỡ lịch của nơi chạy được chọn.
- Phải bảo vệ các file đang được backup trước thao tác xóa/ghi đè đồng thời. Bộ thiếu file/checksum không được gắn nhãn thành công. Tải ảnh mới/đổi và giữ những file còn được các phiên bản backup tham chiếu giúp tránh tải lại toàn kho mỗi ngày; cách triển khai chỉ chọn sau khi đo.
- Lịch sử backup đã chọn 30 ngày nếu đủ dung lượng. Còn cần xác minh nơi chạy, quyền kết nối và cách theo dõi lỗi trước vận hành. Dọn lịch sử chỉ là phần sẽ triển khai theo chính sách này, chưa bật hoặc xóa gì trong lượt lập kế hoạch. Không áp chính sách đó lên ảnh gốc Drive/ổ cứng.

Các câu trả lời được dùng để hoàn thiện kế hoạch. Chỉ bắt đầu code khi người dùng yêu cầu thực hiện; lựa chọn backup tự động hằng ngày trong cuộc thảo luận này chưa phải lệnh bật lịch, mua gói, triển khai production hoặc xóa dữ liệu.

**Làm rõ cách vận hành — 16/10/2026**

**1. Giữ gallery và giữ lịch sử backup là hai thời hạn khác nhau**

Gallery giữ tới khi chủ website xóa, đã chốt. Người dùng đã chọn lịch sử backup 30 ngày gần nhất nếu đủ dung lượng. Đây là các mốc backup thành công trong 30 ngày lịch, không phải luôn đủ 30 bản nếu có ngày lỗi. Một ảnh còn được bất kỳ bản backup được giữ nào tham chiếu không được xóa khỏi kho backup chỉ vì bản thân file đã hơn 30 ngày tuổi. Chính sách này không xóa file hoạt động trong R2.

Ví dụ: một bản backup hôm qua có album A. Hôm nay chủ website xóa A. Album ngừng phục vụ trên website, còn bản backup hôm qua có thể dùng để cứu khi xóa nhầm, trong thời gian bản đó được giữ. Đây không phải tự xuất hiện lại album hoặc một nút thùng rác đã có sẵn.

Đề xuất khi triển khai dọn lịch sử: chỉ dọn bản hết hạn theo chính sách đã chọn và bytes không còn bản nào cần; giữ ít nhất bản hoàn chỉnh tốt gần nhất khi các lượt mới thất bại, kể cả bản đó đã quá thời hạn dự kiến. Phải báo bản sao quá cũ/dung lượng thiếu, không âm thầm xóa bản tốt cuối để giải phóng chỗ. Đây là đề xuất bảo vệ backup, chưa được bật.

**2. Giữ 30 ngày không cần nhân cả kho ảnh lên 30 lần**

Hướng thiết kế là lưu media mới hoặc thay đổi, tái dùng file không đổi giữa các mốc; mỗi mốc giữ dữ liệu website và danh mục file tương ứng. Dung lượng cần tính gồm ảnh hiện hành, phiên bản ảnh cũ còn cần cho lịch sử, database của các mốc và phần dự phòng trong lúc sao lưu.

Ví dụ thuần minh họa: 5GB ảnh hiện hành + 1GB các bản ảnh đã thay/xóa nhưng còn được lịch sử giữ + 30 bản database mỗi bản 10MB tương đương khoảng 6,3GB, trước phần dự phòng/metadata. Không phải 150GB. Đây chưa phải đo website hoặc cam kết phương án cuối; giá trị thực phụ thuộc số lần ghi đè/xóa và dung lượng database.

Nếu Drive thiếu chỗ: báo lượt backup không hoàn tất, giữ bản tốt trước và để website tiếp tục theo trạng thái hiện hành. Không tự mua thêm dung lượng, xóa gallery, xóa ảnh gốc hay xóa bản backup cuối. Tác vụ phải kết thúc và giải phóng khóa theo cơ chế lỗi đã kiểm chứng, không treo quản trị ảnh vô thời hạn.

**3. Copy xuống ổ cứng phải tạo được một bộ khôi phục độc lập**

Vì các mốc trên Drive có thể dùng chung bytes ảnh, chỉ tải folder theo ngày hoặc một file JSON chưa chắc đủ. Đầu ra cho chủ website cần là một bộ hoàn chỉnh của mốc đã chọn: database, toàn bộ media mà mốc đó cần, danh mục kiểm chứng, hướng dẫn và thông tin phiên bản ứng dụng phù hợp. Khóa giải mã nếu dùng phải được giữ riêng để người dùng vẫn khôi phục được khi server hiện tại không còn.

Tiêu chí kiểm tra: dùng bộ local để khôi phục vào môi trường riêng mà không đọc file từ Drive hoặc R2 đang hoạt động. Chọn mặc định lấy bản thành công mới nhất khi copy; nếu muốn cứu trạng thái cũ thì chọn mốc cụ thể. Chưa có công cụ xuất bộ độc lập hoặc nút restore trong giao diện; cần chuẩn bị hướng dẫn/công cụ hỗ trợ phù hợp, không hứa tính năng đã tồn tại.

**4. Hằng ngày vẫn có khoảng dữ liệu chưa kịp sao lưu**

Ví dụ minh họa: backup thành công lúc 03:00; khách chọn ảnh lúc 10:00; sự cố lúc 14:00. Bản 03:00 không chứa lựa chọn lúc 10:00. Lịch hằng ngày đã chọn không tự bảo vệ mọi thay đổi tới ngay trước sự cố. Nếu một lượt bị lỗi/bỏ qua thì khoảng dữ liệu chưa được sao lưu dài hơn một ngày.

Cần hiển thị/báo thời điểm bản thành công cuối, trạng thái từng lượt và có cách chạy lại thủ công sau một đợt thay đổi quan trọng. Đề xuất chọn giờ ít upload theo giờ Việt Nam sau khi rõ thói quen sử dụng; 03:00 ở ví dụ không phải giờ chạy đã chốt. Nơi chạy và kênh theo dõi lỗi sẽ chốt khi cấu hình, chưa tạo thông báo hay lịch.

**5. Khôi phục cần chọn đúng phạm vi sự cố**

| Tình huống | Hướng xử lý dự kiến |
|---|---|
| Thiếu một file ảnh nhưng database vẫn đúng | Lấy đúng file/key/phiên bản từ backup sau đối chiếu; không thay toàn bộ database |
| Xóa nhầm một album hoặc lựa chọn | Khôi phục bản cũ vào môi trường riêng, xem dữ liệu cần lấy và xung đột với hiện tại; không đè cả website về hôm qua |
| Mất database và kho file hoặc sự cố diện rộng | Khôi phục trọn một bộ đã kiểm chứng, báo rõ mốc dữ liệu và phần thay đổi sau mốc có thể mất |

Khôi phục một album cần đối chiếu ID, tên đường dẫn, bìa, sections, lựa chọn, receipts và cleanup; phương án thao tác cụ thể thuộc phần kỹ thuật. Đợt đầu không tự thêm UI restore hoặc cam kết khôi phục chọn lọc một chạm. Không phục hồi phiên đăng nhập cũ thành quyền còn hiệu lực; rà lại quyền/mật khẩu trước khi mở cho khách. Việc quay lại kho Supabase khi triển khai lỗi vẫn là quy trình khác với phục hồi toàn bộ website về một mốc quá khứ.

**Đã làm rõ thêm ngày 16/10**

- Drive là tài khoản Gmail cá nhân người dùng đã chỉ định, còn khoảng 5TB theo thông tin cung cấp. Chưa kiểm tra trực tiếp quota/gói tài khoản; ở quy mô dự kiến đây là nhiều dư địa, chưa có lý do đề nghị mua thêm dung lượng.
- Lịch sử backup website giữ 30 ngày gần nhất nếu đủ chỗ. Không rút ngắn thời hạn gallery, không xóa ảnh gốc và không bật tác vụ dọn dữ liệu ngay từ câu trả lời này.

Hướng kết nối dự kiến là chủ Drive đăng nhập cấp quyền cho công cụ backup, tạo một thư mục website riêng bằng phạm vi quyền hạn chế. Cần kiểm chứng khả năng tự làm mới quyền trên nơi chạy; không coi đăng nhập thành công một lần là bằng chứng job sẽ hoạt động lâu dài. [Quyền Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [vòng đời quyền OAuth](https://developers.google.com/identity/protocols/oauth2#expiration)

Những gì còn lại chủ yếu là xác minh kỹ thuật và vận hành: quota GitHub thực tế, thời gian backup, khả năng restore, giờ chạy ít ảnh hưởng và kênh báo lỗi. Giờ chuyển thật/người thao tác sẽ chốt khi có diễn tập. Người dùng không cần tự chọn OAuth, thư viện hoặc cách dọn file dùng chung. Chưa có lệnh bắt đầu code trong vòng trao đổi này.

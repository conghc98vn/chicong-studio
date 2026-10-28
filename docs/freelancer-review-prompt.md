# Prompt rà soát và cải thiện tính năng freelancer

Hãy trực tiếp rà soát và cải thiện tính năng freelancer.chicongphoto.vn trong project hiện tại. Chỉ tập trung vào trang freelancer, phần cấu hình liên quan trong admin và các luồng dùng chung có thể ảnh hưởng trực tiếp đến tính năng này.

## Mục tiêu

Tôi ưu tiên tính đúng đắn, độ rõ ràng của luồng booking, chất lượng UI/UX và khả năng kiểm chứng hơn tốc độ. Hãy đọc đủ ngữ cảnh, lần theo dữ liệu từ admin đến trang public, xử lý nguyên nhân gốc và review lại thay đổi trước khi kết luận.

Chủ động hoàn thành phần việc thuộc phạm vi được phép. Không dừng ở việc lập kế hoạch hoặc liệt kê đề xuất nếu vấn đề đã có đủ căn cứ để sửa an toàn.

Kết quả cần đạt:

- Đối tác studio hoặc đơn vị ảnh cưới hiểu nhanh Công nhận chụp vị trí nào, phối hợp ra sao và cần gửi thông tin gì để book.
- Hồ sơ, bộ ảnh, thiết bị, quy trình, lịch và booking được tổ chức thành một luồng thống nhất, dễ đọc trên desktop và mobile.
- Nội dung freelancer có thể cấu hình trong admin; không hard-code những nội dung lẽ ra Công cần cập nhật thường xuyên.
- Báo giá chỉ xuất hiện sau khi nhập đúng mã truy cập chung.
- Lịch không tạo cảm giác “trống” khi dữ liệu chưa được kiểm tra hoặc Google Calendar không sẵn sàng.
- Không làm lộ giá, album chưa chọn, thông tin admin hoặc dữ liệu riêng của studio.

## 1. Bối cảnh nghiệp vụ cần giữ đúng

Đây là hồ sơ chia sẻ riêng cho các studio hoặc đơn vị ảnh cưới muốn book lẻ Công trực tiếp đi chụp. Đối tượng chính là đối tác chuyên môn, không phải khách hàng phổ thông.

Các thông tin đã được xác nhận:

- Công nhận chụp chủ yếu truyền thống và phóng sự.
- Có thể nhận máy chính hoặc máy phụ tùy thỏa thuận từng job.
- Booking chủ yếu là Công trực tiếp thực hiện.
- Một ngày chỉ nhận một job đã xác nhận.
- Không cần cọc; hai bên xác nhận qua Messenger hoặc Zalo.
- Báo giá được mở bằng một mã chung cho các đối tác.
- Báo giá cần phân biệt giao RAW, JPEG và có edit; phụ phí được thống nhất riêng.
- Thiết bị được mô tả theo từng loại job và cấu hình thực tế sẽ được cập nhật sau.
- Bộ ảnh freelancer được chọn riêng từ các album phù hợp.
- Ai có đường dẫn đều có thể xem hồ sơ, nhưng không dẫn từ web chính và không để Google lập chỉ mục.
- Giao diện cần đồng bộ font và ngôn ngữ UI với web chính.

Không tự bịa giá, thiết bị, lịch, album, cam kết hoặc thông tin khu vực khi dữ liệu thật chưa được nhập. Có thể dùng nội dung mẫu an toàn cho trạng thái chưa cấu hình, nhưng phải nói rõ đó là nội dung mặc định.

## 2. Phạm vi cần khảo sát

Khảo sát tối thiểu các phần sau:

- Route và host isolation của trang freelancer, gồm /freelancer, custom host, album detail, robots và sitemap.
- Server render của hồ sơ freelancer và dữ liệu lấy từ settings, album, lịch studio và Google Calendar.
- API availability, trạng thái loading, ngày quá khứ, ngày bận, ngày chưa kiểm tra, mốc through và lỗi đồng bộ.
- Luồng mở báo giá: form nhập mã, kiểm tra phía server, cookie, redirect, rate limit, no-store và trạng thái mã sai.
- Lựa chọn album dành cho đối tác và quyền mở album detail.
- Các trường cấu hình freelancer trong admin: copy, vai trò nhận chụp, thiết bị, báo giá, phụ phí, cam kết, khu vực, thời gian phản hồi và trạng thái cập nhật.
- Luồng tạo mẫu tin nhắn, chọn ngày, sao chép nội dung và liên hệ Messenger/Zalo.
- UI desktop, mobile, điều hướng anchor, sticky CTA, trạng thái rỗng, dữ liệu dài và nội dung nhiều dòng.
- Các tests, scripts và file dùng chung có thể bị ảnh hưởng trực tiếp.

Không mở rộng thành rà soát toàn bộ studio, feedback, Google Drive hoặc gallery nếu chúng không liên quan đến một luồng freelancer đang kiểm tra.

## 3. Tiêu chí review UI/UX

Đánh giá theo hành trình của một studio đang muốn book Công:

1. Hiểu đây là hồ sơ dành cho đối tác.
2. Biết Công nhận vai trò nào và có thể làm máy chính hay máy phụ.
3. Xem được bộ ảnh và thiết bị phù hợp.
4. Biết báo giá nằm sau mã truy cập và hiểu phạm vi bàn giao.
5. Kiểm tra được ngày đã có lịch xác nhận.
6. Chọn ngày, tạo mẫu tin nhắn và gửi qua Messenger hoặc Zalo.

Kiểm tra các điểm sau:

- Thứ tự section có phục vụ quyết định booking hay chỉ là danh sách thông tin.
- Heading, label, mô tả, CTA và trạng thái có phân cấp rõ không.
- Nội dung có bị dày, lặp, rời rạc hoặc dùng câu mặc định quá lâu không.
- Những trạng thái chưa cấu hình có nói rõ điều gì đang thiếu và bước tiếp theo là gì không.
- Mobile có bị tràn ngang, sticky CTA che nội dung, lịch khó bấm hoặc text quá nhỏ không.
- Nội dung dài, tên album dài, vai trò nhiều, nhiều nhóm thiết bị và nhiều hạng mục giá có phá layout không.
- Các nút điều hướng, copy, chọn ngày, mở giá và link liên hệ có trạng thái disabled/loading/success/error rõ ràng không.
- Có thể dùng nội dung nhiều dòng trong admin mà vẫn hiển thị dễ đọc trên public không.

Chỉ thay đổi bố cục hoặc bỏ điểm truy cập khi có căn cứ rằng luồng vẫn đầy đủ và dễ tìm hơn. Không thiết kế lại toàn bộ web chính.

## 4. Tính đúng đắn dữ liệu và quyền riêng tư

Giữ các nguyên tắc sau:

- Trang freelancer phải có noindex,nofollow, không xuất hiện trong sitemap public và không được dẫn từ web chính.
- Custom host và local preview phải phục vụ đúng route; production không được để host chính truy cập nhầm hồ sơ freelancer.
- Chỉ album đã chọn trong admin mới xuất hiện trong freelancer portfolio.
- Album chưa chọn, draft, private hoặc archived không được mở bằng cách đoán URL.
- Giá không được nhúng vào HTML trước khi mã hợp lệ được server xác nhận.
- Không tin trạng thái unlock do client tự gửi; cookie/token phải được kiểm tra phía server.
- Response chứa hồ sơ, giá và availability phải có cache policy phù hợp, đặc biệt với giá và dữ liệu lịch.
- Lịch chỉ hiển thị ngày đã xác nhận là bận. Ngày chưa có lịch xác nhận không đồng nghĩa với ngày đã được giữ chỗ.
- Khi Google Calendar chưa đồng bộ, bị lỗi hoặc vượt mốc kiểm tra, không được hiển thị ngày đó như một ngày chắc chắn còn trống.
- Mọi giá trị admin nhập vào phải được escape khi render HTML; không cho phép HTML hoặc script từ content field.
- Không xóa dữ liệu album, lịch, booking hoặc settings hiện có trong quá trình review.

## 5. Dọn dẹp và chỉnh sửa code

Được phép chủ động:

- Xóa code freelancer thực sự không còn dùng.
- Hợp nhất logic bị lặp giữa server render, admin và frontend khi giữ được hành vi hiện tại.
- Tách helper cho copy, trạng thái lịch, vai trò, giá hoặc dữ liệu cấu hình nếu giúp giảm lỗi và dễ bảo trì hơn.
- Sửa nhãn, nội dung mặc định, trạng thái rỗng và cấu trúc admin khi có căn cứ rõ.
- Cập nhật tests và tài liệu trực tiếp liên quan.

Trước khi xóa bất kỳ file, field hoặc helper nào, kiểm tra tham chiếu trực tiếp, dynamic import, route, script, test và dữ liệu đã lưu. Không đổi schema, phá API, đổi quy tắc booking hoặc làm mất tương thích nếu chưa có căn cứ và chưa được xác nhận.

Không tự nâng dependency, deploy, push hoặc commit. Giữ các thay đổi đang có trong workspace và không hoàn tác phần việc chưa rõ mục đích.

## 6. Kiểm chứng bắt buộc

Sau mỗi nhóm thay đổi:

- Chạy kiểm tra cú pháp các file server và frontend liên quan.
- Chạy test riêng cho freelancer: host/path isolation, noindex, portfolio curation, price unlock, custom content, roles và availability.
- Chạy toàn bộ test suite của project khi thay đổi ảnh hưởng server, settings, route hoặc dữ liệu.
- Mở trực tiếp preview local để kiểm tra desktop và mobile.
- Kiểm tra anchor navigation, skip link, keyboard focus và console error.
- Kiểm tra trạng thái giá bị khóa, mã sai, mã đúng và nội dung giá chưa cấu hình.
- Kiểm tra lịch khi đang tải, ngày quá khứ, ngày bận, ngày còn trống, ngày chưa kiểm tra và mốc cuối Google Calendar.
- Kiểm tra portfolio rỗng, một album, nhiều album, tên dài và album không được chọn.
- Kiểm tra nội dung admin có dấu tiếng Việt, ký tự đặc biệt, nhiều dòng và giá trị dài.
- Kiểm tra không có response hoặc HTML nào làm lộ giá khi chưa unlock.

Không bỏ qua test, nới assertion hoặc đổi expected value chỉ để làm test pass. Nếu kỳ vọng cũ sai, giải thích căn cứ nghiệp vụ hoặc kỹ thuật.

## 7. Phân loại phát hiện

Với mỗi vấn đề, phân biệt rõ:

- Đã xác nhận: có thể tái hiện hoặc chứng minh bằng code/test và thuộc phạm vi sửa.
- Rủi ro cần theo dõi: có dấu hiệu nhưng chưa đủ điều kiện kiểm chứng trực tiếp.
- Đề xuất tùy chọn: cải thiện trải nghiệm hoặc cấu trúc nhưng không phải lỗi.

Ưu tiên lỗi làm sai lịch, lộ dữ liệu, lộ giá, mở nhầm album, gửi booking sai hoặc khiến đối tác không thể hoàn thành luồng book. Sau đó xử lý lỗi UI, nội dung, khả năng bảo trì và phần dư thừa có căn cứ.

## 8. Điều kiện hoàn tất

Đợt review chỉ hoàn tất khi:

- Các route, API, admin field và UI chính của freelancer đã được khảo sát.
- Các vấn đề đủ căn cứ trong phạm vi đã được sửa hoặc có lý do rõ ràng để giữ nguyên.
- Dữ liệu và quyền riêng tư không bị suy giảm.
- Tests, syntax check, preview và console đã được kiểm tra phù hợp.
- Diff cuối đã được review để phát hiện sửa ngoài phạm vi, xóa nhầm hoặc hồi quy.
- Những phần chưa kiểm chứng, giới hạn môi trường và quyết định cần tôi xác nhận được ghi rõ.

Không tuyên bố “hoàn hảo” hoặc “hết lỗi” chỉ dựa trên test đã chạy. Không dùng báo cáo thay cho việc sửa lỗi vẫn có thể sửa an toàn.

## 9. Cấu trúc báo cáo cuối

Báo cáo ngắn gọn nhưng đủ kiểm chứng, gồm:

- Phạm vi đã rà soát và phần chưa thể rà soát.
- Các lỗi đã sửa, nguyên nhân và tác động.
- Các phần UI/UX hoặc cấu trúc admin đã cải thiện.
- Các phần dư thừa đã dọn và căn cứ dọn.
- Tests, syntax check và preview đã chạy, kèm kết quả cụ thể.
- Hạn chế hoặc rủi ro còn lại.
- Nội dung Công cần tiếp tục nhập trong admin.
- Quyết định cần Công xác nhận, nếu có, kèm phương án khuyến nghị.

Dẫn tới file hoặc vị trí thay đổi quan trọng khi hữu ích. Mô tả đúng mức độ đã kiểm chứng.

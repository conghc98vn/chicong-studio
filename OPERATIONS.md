# Vận hành ChiCong Studio

Cập nhật 29/10/2026. Hướng dẫn thao tác hằng ngày; cấu hình máy chủ ở [HOSTING](HOSTING.md), credential và khôi phục ở [handbook vận hành](docs/handbook/02-van-hanh-bi-mat-va-khoi-phuc.md).

## 1. Thiết lập nội dung

Mở `/admin`, đăng nhập rồi vào **Cài đặt** để điền thương hiệu, giới thiệu, liên hệ và ảnh chân dung. Kiểm tra trang khách sau khi lưu. Tên thương hiệu/tên nhiếp ảnh gia/tiêu đề là bắt buộc; kênh liên hệ để trống sẽ không hiển thị. Lời hứa thời gian phản hồi chỉ điền khi studio có thể thực hiện.

## 2. Portfolio và quản lý ảnh

1. Tạo bộ ảnh **Nháp**, điền tên, thể loại, mô tả và ngày chụp.
2. Tải JPEG/PNG/WebP hoặc gói `.ccphoto`: tối đa 20 MiB/40 MP mỗi ảnh upload tay. Giao diện chia lượt, máy chủ nhận tối đa 8 file/request. [Chuẩn bị ảnh trên Mac](docs/local-photo-preparation.md) giúp giảm xử lý lúc upload.
3. Chọn **Bỏ qua ảnh trùng** hoặc **Ghi đè ảnh trùng** theo tên không phân biệt hoa/thường. Ghi đè giữ ID, lựa chọn, caption, vị trí và phần; nếu có nhiều ảnh cùng tên, dùng thao tác thay ảnh cụ thể.
4. Tạo phần, chuyển/sắp xếp ảnh, chọn bìa, kiểm caption và lightbox. Upload gián đoạn: giữ trang và file rồi thử lại để tái sử dụng mã lượt tải.
5. Chuyển sang **Công khai** khi đã kiểm tra. Chỉ album công khai xuất hiện trên portfolio/sitemap; nháp và lưu trữ chỉ admin được xem.

Album công khai dùng `/album/:slug`; sửa tiêu đề không tự đổi slug. Nếu sửa slug, URL cũ chuyển 301 tới slug hiện tại. Hệ thống tự thêm hậu tố khi trùng, kể cả trùng URL lịch sử. Gallery khách vẫn dùng ID.

Album lớn phân trang ở giao diện: admin 120 ảnh/trang khi hơn 240 ảnh, gallery 90 ảnh/trang khi hơn 360 ảnh. Tìm/lọc vẫn xét toàn bộ metadata. Chọn tất cả ở admin lớn chỉ chọn trang hiện tại. Chuyển phần/xóa tối đa 1.000 ảnh/lượt; endpoint sắp xếp toàn bộ tối đa 2.000 ảnh, album lớn dùng chuyển ảnh liền kề.

Ảnh mới có WebP tối đa 2400px, thumbnail 900px và JPEG download tối đa 2400px, đã loại metadata. Đây là bản giao xem/chọn; studio tự giữ RAW/JPEG nguồn riêng.

## 3. Gallery và lựa chọn của khách

Tạo bộ ảnh **Riêng tư**, chọn có hoặc không có mật khẩu. Có mật khẩu cần ít nhất 8 ký tự và nên gửi riêng với link. **Riêng tư không mật khẩu cho phép bất kỳ ai có link xem/chọn/tải ảnh.** Kiểm bằng cửa sổ chưa đăng nhập trước khi giao khách.

Khách lưu/bỏ lưu ảnh trong lưới hoặc lightbox; lựa chọn tự lưu và đồng bộ giữa các tab. **Gửi lựa chọn** xác nhận một phiên bản catalog/lựa chọn cụ thể. Nếu ảnh đổi trong lúc xem, khách cần cập nhật và xem lại; không bỏ qua thông báo xung đột.

Studio xem số ảnh đã lưu ở Tổng quan/bộ ảnh, lọc **Khách chọn**, xuất CSV tên file theo thứ tự phần. Lượt đã gửi được giữ thành lịch sử; thay ảnh làm lượt cũ được đánh dấu cần xem lại. Sau khi khách gửi, thay đổi từ Drive cần studio duyệt.

Khách tải từng ảnh hoặc tải ảnh đã chọn: mỗi phần tối đa 50 ảnh/100 MiB; nhiều phần được xử lý lần lượt. Máy chủ giới hạn hai lượt chuẩn bị download đồng thời, một lượt/album/process. Ảnh cũ thiếu JPEG sẽ chuyển từ WebP khi tải, có thể chậm hơn.

Đổi mật khẩu/trạng thái album thu hồi phiên gallery cũ. Ảnh đã tải về máy khách không thể thu hồi bằng thay đổi này. Xóa ảnh khỏi web giữ bytes cũ ít nhất năm phút để lượt đọc đang chạy kết thúc; không xóa ảnh nguồn Drive/ổ studio.

## 4. Nhập từ Google Drive

Tạo bộ ảnh → chọn nguồn Google Drive → **Duyệt và chọn folder → Chọn folder này → Kiểm tra folder** → tạo album → xem trước và duyệt nhập. Chỉ ảnh trực tiếp trong folder được nhập; browse không tự tạo/import album.

Dùng tài khoản dịch vụ quyền Người xem. `shared` nhận folder đã chia sẻ mà tài khoản đọc được; `root` chỉ nhận trong cây thư viện đã cấu hình. Thay phạm vi hoặc credential phải kiểm kết nối và tạo preview mới. Ảnh mất trên Drive vẫn giữ trên web; ảnh đã xóa/detach không tự hồi sinh.

Theo báo cáo triển khai gần nhất, nhập thủ công bật, worker enabled, scheduler tắt. Không bật lịch chỉ vì thấy tùy chọn trong UI. [Runbook Drive](docs/google-drive-sync-operations.md) là nguồn duy nhất cho thao tác job, lease và phục hồi.

## 5. Tư vấn, lịch và email

Biểu mẫu nhận email hoặc điện thoại, ngân sách tùy chọn. Gửi yêu cầu chưa giữ chỗ, chưa xác nhận lịch hoặc thu tiền. Trong quản trị, cập nhật trạng thái, ngày chụp và ghi chú nội bộ; một ngày chỉ có một lịch **Đã xác nhận**.

Nếu trạng thái/ngày/ghi chú đã được cập nhật ở tab khác kể từ khi mở form, lượt lưu cũ báo “Yêu cầu tư vấn đã thay đổi” và giữ bản nháp trên form. Đối chiếu hoặc sao chép phần cần giữ, rồi chọn **Tải lại yêu cầu (bỏ thay đổi chưa lưu)** để lấy dữ liệu mới. Tải lại lỗi vẫn giữ bản nháp và cho thử lại. API hỗ trợ snapshot `expected` để đối chiếu form; caller cũ không gửi snapshot vẫn được bảo vệ khỏi cập nhật cạnh tranh trong lúc request xử lý. Thao tác API không gửi trường ghi chú sẽ giữ ghi chú hiện có.

Lịch kết hợp ngày studio chặn, booking đã xác nhận và Google Calendar nếu cấu hình. Khi nguồn Google lỗi, ứng dụng không coi ngày đó là trống; khách có thể bỏ ngày để gửi tư vấn. [Hướng dẫn Calendar](docs/google-calendar.md).

Email dùng Resend/SMTP nếu đã cấu hình; yêu cầu được lưu cùng hai bản ghi outbox cho studio và khách (khi khách có email hợp lệ). Worker email chạy trong tiến trình web, tự nhận lại lượt đang giữ lease sau restart và retry lỗi vận chuyển theo backoff. Khi provider chưa cấu hình, bản ghi ở trạng thái chờ cấu hình và sẽ được nhận lại sau khi bật provider. Nếu thiếu người nhận hoặc đã hết lượt retry, mở chi tiết inquiry trong quản trị để xác nhận địa chỉ studio và thử lại bản ghi tương ứng. Có thể tạm dừng bằng `INQUIRY_NOTIFICATIONS_PAUSED=true`; kiểm tra trạng thái trong Tổng quan quản trị và luôn kiểm tra inquiry đã lưu. Cấu hình email nằm trong [danh mục biến](docs/handbook/02-van-hanh-bi-mat-va-khoi-phuc.md#21-web-runtime).

### Cảm nhận sau bàn giao

Tính năng đã được triển khai trên production. Trước khi cấp link thật vẫn phải kiểm `SITE_URL`, `FEEDBACK_LINK_SECRET`, trạng thái pause và người nhận email trên mọi instance. Mở **Cảm nhận → Tạo hồ sơ bàn giao**, hoặc **Bàn giao & cảm nhận** ở bộ ảnh. Một hồ sơ ứng với một khách/buổi chụp, có thể gắn nhiều bộ ảnh hoặc không gắn bộ nào. Chỉ chọn **Đã bàn giao đầy đủ & mở nhận** khi studio đã giao đủ; copy link/lời mời rồi tự gửi khách. Revision và checklist LIVE mới nhất xem ở [handbook](docs/handbook/README.md).

Khách có thể gửi và sửa cảm nhận qua link riêng không hết hạn. Studio xem bản mới nhất, toàn bộ lịch sử và đánh dấu bản đã đọc trong admin. Pause chặn khách đọc/gửi; thu hồi hoặc cấp mới vô hiệu link cũ. Hồ sơ đã cấp link không dùng lại cho khách/buổi khác. Cảm nhận chỉ dùng nội bộ, không tự công khai trên portfolio.

Email feedback có hàng đợi lưu trong DB, thử lại qua restart và ghi trạng thái từng revision; chỉ gửi studio. Gửi email lỗi không làm mất cảm nhận. Sau restore, API bị khóa cho đến khi đối soát sổ xóa; link cũ và email đang chờ không tự hoạt động lại. Release smoke đã kiểm route pause/link sai; trước khi gửi lời mời khách thật vẫn cần kiểm recipient/provider bằng hồ sơ thử được phép. Xem [contract, cấu hình và runbook khôi phục/xóa](docs/customer-feedback-spec.md#implementation) trước khi vận hành.

## 6. Sự cố và sao lưu

| Hiện tượng | Xử lý |
|---|---|
| Upload không rõ đã lưu hay chưa | Thử lại cùng lượt; kiểm báo cáo từng file, không kết luận thất bại chỉ từ timeout |
| Gallery bị khóa | Kiểm trạng thái, mật khẩu và phiên; đăng nhập lại sau đổi mật khẩu |
| Download báo đang bận | Đợi lượt trước kết thúc rồi thử lại; giảm số ảnh nếu vượt giới hạn |
| Web health tốt nhưng ảnh lỗi | Health chỉ kiểm DB; kiểm provider/binding, quyền bucket và đọc media thực tế |
| Drive lỗi quyền/stale | Sửa quyền/kết nối, kiểm folder và preview lại; không sửa DB để bỏ guard |
| PostgreSQL ngắt kết nối rảnh hoặc transaction | Bản vá local giữ process hoạt động và loại kết nối hỏng; thao tác đang chạy có thể báo lỗi, không tự ghi lại. Kiểm kết quả trong admin và dùng retry của lượt cũ; nếu kéo dài, kiểm DB/network/TLS |
| Quên mật khẩu admin | Chạy `npm run admin:reset` với đúng database, nhập kín trong terminal; phiên cũ bị thu hồi |

Local: dừng app trước khi sao chép cả `data/live/` cùng thời điểm. Production cần **DB + toàn bộ media được tham chiếu**, kiểm checksum và restore trên đích riêng; dump DB hoặc JSON admin không đủ. Cron SQL trên VPS khác lịch backup media/offsite, khác scheduler nhập Drive.

Theo report 21/10, backup ngoài VPS và restore ứng dụng offline đã đạt. Full cloud restore, lịch backup media và cảnh báo tuổi snapshot vẫn chưa nghiệm thu. [Quy trình backup/restore](docs/handbook/02-van-hanh-bi-mat-va-khoi-phuc.md), [trạng thái hiện hành](docs/handbook/README.md).

Cập nhật phiên bản theo [release gate trong HOSTING](HOSTING.md#3-chuẩn-bị-và-kích-hoạt-release). `deploy:vps -- --stage` chỉ chuẩn bị release, không tự thay mã đang chạy.

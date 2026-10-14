# ChiCong Studio · v2.2.1

Hệ thống nhiếp ảnh mới cho **chicongphoto.vn**, có portfolio công khai, studio quản trị, upload ảnh, gallery riêng cho khách chọn ảnh và yêu cầu đặt lịch. Portfolio bắt đầu trống để bạn tự đăng các bộ ảnh cưới; không nhập lại nội dung WordPress.

## Chạy trên máy

Cần Node.js 22.13+; dùng Node 24 LTS khi deploy.

```sh
npm ci
npm run dev
```

- Website: http://localhost:4173
- Quản trị: http://localhost:4173/admin

Lần đầu bạn tự tạo tài khoản email và mật khẩu từ 12 ký tự. Mã thiết lập bắt buộc trên hosting, khi truy cập từ máy khác, hoặc bất cứ khi nào đã đặt `SETUP_TOKEN`. Không có mật khẩu mặc định. Dữ liệu local nằm trong `data/live/`: `studio.sqlite` và `uploads/`. Dừng app bằng Ctrl+C. Sửa mã nguồn server cần khởi động lại; sửa frontend chỉ cần tải lại trình duyệt.

Local mặc định chỉ nhận hostname `localhost`, `127.0.0.1` và `[::1]`. Để chạy `npm run dev:lan`, đặt `SITE_URL` đúng địa chỉ bạn mở, ví dụ `http://192.168.1.25:4173`, và cấu hình `SETUP_TOKEN` nếu chưa tạo admin. Khi đã đặt `SITE_URL`, các thao tác ghi chỉ nhận Origin đó.

## Quy trình đăng portfolio

1. Mở **Portfolio → Tạo album**, nhập tên, thể loại và mô tả.
2. Thêm ảnh JPEG/PNG/WebP, chọn nhiều ảnh cùng lúc, tối đa 20MB/ảnh. Giao diện tự chia lượt upload và hiển thị tiến trình.
3. Chọn ảnh bìa; sửa chú thích, sắp xếp thứ tự bằng ↑/↓. Toàn bộ thứ tự lưu trong một yêu cầu, tối đa 2.000 ảnh/bộ cho thao tác sắp xếp.
4. Trong **Thông tin album**, đổi trạng thái từ bản nháp sang công khai.
5. Dùng **Đã lưu trữ** để ẩn album mà vẫn giữ dữ liệu. Xóa từng ảnh sẽ xóa file web; luôn giữ bản gốc trên máy.

Trong quản trị, bạn có thể tìm album/gallery theo tên bộ ảnh hoặc khách hàng, tìm không dấu và lọc trạng thái. Yêu cầu đặt lịch cũng có tìm kiếm và lọc trạng thái. Tải lại trình duyệt giữ trang quản trị hoặc album đang mở.

Nếu upload có ảnh hỏng, các ảnh thành công vẫn được lưu và hiện ngay; **Thử lại ảnh còn lại** bỏ qua những ảnh đã được máy chủ xác nhận. Giữ nguyên trang và danh sách file để tiếp tục. Khi mất kết nối giữa chừng, bấm thử lại trong cùng lượt chọn file: mỗi ảnh có mã upload riêng, máy chủ nhận diện ảnh đã lưu để không tạo bản trùng, kể cả khi phản hồi lượt trước bị mất. Nếu chọn lại file hoặc tải lại trang, mã upload mới sẽ được tạo; đó được xem là một lần đăng ảnh mới. Đổi trang hoặc tải lại sẽ mất tiến trình thử lại trên trình duyệt. Hệ thống nhắc trước khi rời trang lúc upload đang chạy.

## Gallery riêng cho khách

1. **Gallery khách → Tạo gallery**, đặt mật khẩu từ 8 ký tự.
2. Upload ảnh và sao chép link gallery. Bạn gửi link/mật khẩu cho khách qua kênh của mình.
3. Khách mở link, nhập mật khẩu, bấm ♡ trên danh sách hoặc **Chọn ảnh này** trong trình xem ảnh lớn. Có thể chuyển ảnh bằng phím ←/→ trên máy tính. Bấm **Gửi lựa chọn** khi xong.
4. Studio hiển thị số ảnh đã chọn và trạng thái khách đã gửi; có thể xuất danh sách tên file/chú thích dưới dạng CSV.
5. Khách có thể chỉnh lựa chọn và gửi lại. Nhiều thiết bị dùng cùng gallery chia sẻ một danh sách lựa chọn. Đổi mật khẩu vô hiệu phiên gallery cũ; khách có thể bấm **Đóng gallery** để thoát.

File media của gallery private yêu cầu session hợp lệ; có link ảnh đơn lẻ cũng không xem được nếu chưa đăng nhập. Ảnh công khai và chân dung dùng cache trình duyệt có kiểm tra lại với server (`private,no-cache`); gallery private dùng `private,no-store`. Khi ẩn album, request kiểm tra lại quyền trước khi trả 304. Gallery và admin có noindex. Không giữ ảnh gốc/RAW để giao file: ảnh web được tối ưu 2400px + thumbnail 900px; ảnh upload mới có thêm bản JPG tải xuống tối đa 2400px.

## Khách tải ảnh đã chọn

Trong gallery đã mở bằng mật khẩu, bấm **Tải ảnh đã chọn**. Danh sách tải gồm toàn bộ ảnh đã chọn trong album, kể cả các phần đang bị ẩn bởi bộ lọc. Một ảnh tải thành JPG; nhiều ảnh được gom vào ZIP với tên file gốc đã làm sạch và số thứ tự để tránh trùng. Không cần bấm **Gửi lựa chọn** trước; tải xuống không thay đổi trạng thái gửi hay danh sách đã chọn.

Các gói tối đa 50 ảnh, tải lần lượt; trên điện thoại mở ZIP bằng ứng dụng Tệp / Files rồi giải nén. Hộp tải có tiến độ nhận tệp, hủy và thử lại. Nếu vượt giới hạn dung lượng, bấm **Chia thành gói nhỏ hơn**; các ảnh đã chọn vẫn được giữ nguyên. Trình duyệt lưu vào mục Tải xuống; thông báo chuyển tệp cho trình duyệt không có nghĩa ảnh đã được lưu vào thư viện Ảnh. Nếu lựa chọn trên thiết bị khác thay đổi, bấm cập nhật danh sách; phiên hết hạn yêu cầu mở lại gallery.

Ảnh mới dùng bản JPG tạo trực tiếp từ file upload. **Ảnh cũ chưa có JPG** được chuyển từ bản WebP lớn nhất, không dùng thumbnail và không thể phục hồi chi tiết đã mất. Chuyển ảnh cũ dùng encoder nhanh để giảm thời gian đợi, giữ quality 92, 2400px, 4:4:4 và ICC sRGB; dung lượng có thể lớn hơn bản mozjpeg tạo khi upload. Không truy cập Google Drive. Muốn tạo JPG từ nguồn cho ảnh cũ cần đưa lại nguồn vào một quy trình nhập riêng; tính năng này không tự ghép hoặc thay thế ảnh cũ.

API `POST /api/gallery/:id/download` nhận 1–50 ID đang được chọn, kiểm tra phiên và quyền đúng album cả trước lẫn sau chuẩn bị. Mỗi lượt tối đa 100 MiB, một lượt đang xử lý/album và hai lượt/server. JPEG được đọc/tạo tuần tự vào thư mục tạm; ZIP được hoàn tất trước khi gửi, không gom cả album vào RAM server. Tệp tạm được xóa khi xong, hủy hoặc lỗi; giới hạn thời gian 3 phút. Trình duyệt nhận tối đa 100 MiB mỗi lượt và chỉ lưu khi nhận đủ tệp. Download dùng `private,no-store`; lỗi lưu trữ không trả ZIP thiếu ảnh. Supabase bucket vẫn riêng tư, tự bổ sung `image/jpeg` vào danh sách MIME nếu đang bị giới hạn. Giới hạn đối tượng lưu trữ tối thiểu 24 MiB để nhận JPG nhiều chi tiết có thể lớn hơn đầu vào; giữ nguyên giới hạn cao hơn hoặc không giới hạn. Giới hạn upload đầu vào là 20 MiB/ảnh (40 megapixel).

Kiểm thử: `node --test studio/tests/gallery-download.test.mjs studio/tests/gallery-download-client.test.mjs`. Browser smoke: `node studio/tests/gallery-download-browser.smoke.mjs` với `STUDIO_PLAYWRIGHT_MODULE`, tùy chọn `STUDIO_AXE_MODULE`, `STUDIO_DOWNLOAD_SAMPLE_FILES`. Các bài kiểm thử dùng database/ảnh tạm riêng.

## Upload ảnh Lightroom và tối ưu dung lượng

Theo dõi upload: trang admin hiển thị phần trăm dữ liệu đang gửi và trạng thái chờ xác nhận lưu. Trên Render, mở **Logs → Live tail** và tìm `[upload]` hoặc **Mã kiểm tra** trong lỗi. Log production ghi thời gian/RAM cho từng bước nhận file, tạo ảnh và lưu storage/database; không ghi tên file hay thông tin đăng nhập. Xem [hướng dẫn chẩn đoán](docs/upload-production-diagnostics-2026-10-14.md). Gửi đủ dữ liệu không đồng nghĩa đã lưu ảnh; chỉ số “Đã lưu” tăng khi máy chủ xác nhận.

Chọn trực tiếp JPEG, PNG hoặc WebP đã xuất từ Lightroom (tối đa 20 MiB và 40 megapixel/ảnh). Hệ thống tự tạo bản WebP cạnh dài tối đa 2400 px, quality 88 và ảnh thu nhỏ tối đa 900 px, quality 80. Cả hai dùng effort 6 và smart chroma subsampling, được tạo trực tiếp từ đầu vào, tự xoay đúng chiều và chuyển về sRGB. Không phóng lớn, không thêm sharpening hoặc chỉnh màu sáng/tối; EXIF/GPS được loại bỏ. Không ép một mức KB cố định vì ảnh nhiều chi tiết cần nhiều dữ liệu hơn.

Ảnh mới còn được tạo một bản **JPG tải xuống** trực tiếp từ đầu vào: cạnh dài tối đa 2400 px, quality 92, mozjpeg, chroma 4:4:4 và ICC sRGB. Giữ đúng chiều, không phóng lớn, không giữ EXIF/GPS; ảnh có nền trong suốt được đặt trên nền trắng. Bản này ưu tiên chi tiết để chia sẻ, không thay thế file Lightroom để in/chỉnh sửa.

Sau upload, quản trị hiển thị số byte đầu vào, bản web, thumbnail, JPG tải xuống, kích thước và phần trăm giảm **tổng dung lượng lưu trữ**. Từng ảnh mới có số liệu bên dưới trong danh sách; số liệu vẫn còn sau tải lại trang. Ảnh cũ chưa có số liệu đầu vào sẽ không hiển thị con số suy đoán. Nếu các bản cộng lại lớn hơn đầu vào, báo cáo nói rõ thay vì hiển thị phần trăm tiết kiệm sai.

File hỏng, rỗng, sai định dạng, ảnh động hoặc quá giới hạn được báo riêng. Các file hợp lệ vẫn được xử lý. Lỗi tạm thời có thể thử lại; ảnh đã được xác nhận lưu sẽ không được upload lại trong cùng lượt. Giao diện gửi lần lượt một ảnh mỗi request và chờ tối đa 3 phút để truyền, tối ưu và lưu ảnh; các API thông thường vẫn có timeout 12 giây. Nếu hết thời gian chờ, trạng thái là chưa được xác nhận, không khẳng định ảnh chưa lưu. Nếu phản hồi bị mất, cùng mã upload trả lại ảnh và số liệu đã lưu. Giữ nguyên trang để thử lại; mở lại trang và chọn lại file tạo một lượt upload mới.

Tối ưu diễn ra trên server: JPEG đầu vào vẫn phải được truyền lên qua mạng, nhưng chỉ WebP, thumbnail và JPG tải xuống được lưu; không giữ tệp nguồn. Tiếp tục giữ bản gốc trên ổ đĩa/Drive để giao ảnh chất lượng đầy đủ hoặc in. Để giảm thời gian truyền lên, có thể dùng preset Lightroom JPEG sRGB, quality 90, cạnh dài 2400 px; đây là lựa chọn thêm, không bắt buộc với file đã nằm trong giới hạn.

Kiểm thử: `node --test studio/tests/image-optimizer.test.mjs studio/tests/upload-optimization-api.test.mjs studio/tests/upload-queue.test.mjs`. Kiểm tra UI: `node studio/tests/upload-browser.smoke.mjs` (cần Playwright; hỗ trợ `STUDIO_PLAYWRIGHT_MODULE`, `STUDIO_AXE_MODULE` và `STUDIO_UPLOAD_SAMPLE_FILES` là mảng JSON các đường dẫn ảnh thử). Tất cả dùng database và thư mục ảnh tạm riêng.

## Chia album/gallery thành các phần

Trong quản trị, mở bộ ảnh → **Các phần trong bộ ảnh**:

1. Bấm **+ Thêm phần** để đặt tên, hoặc **Dùng mẫu ngày cưới** để thêm các phần thường dùng. Áp dụng lại mẫu sẽ bỏ qua các tên đã có.
2. Kéo tay nắm để đổi thứ tự phần; nút **↑/↓** cũng dùng được trên điện thoại và bằng bàn phím.
3. Chọn **Tải ảnh vào phần** trước khi upload, hoặc đổi mục **Phần** trên từng ảnh sau khi tải. Đổi bộ lọc vẫn giữ danh sách tệp đã chọn và phần đích upload. Lượt upload thử lại giữ nguyên phần đích ban đầu và không chuyển lại ảnh đã lưu.
4. Đánh dấu nhiều ảnh (hoặc **Chọn tất cả ảnh đang hiển thị**), chọn phần đích và bấm **Chuyển phần**; tối đa 1.000 ảnh mỗi lượt. Chọn **Chưa phân loại** để bỏ gán phần. Khi đổi bộ lọc phần, danh sách đánh dấu được xóa để tránh chuyển nhầm ảnh ngoài màn hình.
5. Lọc một phần rồi dùng **↑/↓** trên ảnh để đổi thứ tự trong phần đó.

Album công khai và gallery riêng đều có thanh lọc theo phần, cuộn ngang trên điện thoại. **Tất cả** hiển thị theo thứ tự phần, rồi thứ tự ảnh; ảnh chưa phân loại ở cuối. Trình xem ảnh lớn chỉ duyệt các ảnh đang lọc và hiển thị tên phần. Trong gallery riêng, bộ lọc phần kết hợp được với **Xem ảnh đã chọn**; số trên từng tab đếm ảnh theo chế độ đang xem; tổng lựa chọn và nút gửi luôn áp dụng cho cả album.

Xóa phần đưa ảnh về **Chưa phân loại**, vẫn giữ ảnh và lựa chọn của khách. CSV có thêm cột **Section**; JSON sao lưu có thêm `album_sections` và `photos.section_id`. Bộ ảnh không có phần tiếp tục dùng giao diện và thứ tự cũ. Migration chạy tự động khi khởi động server, bổ sung bảng/cột và giữ dữ liệu hiện có trên SQLite/PostgreSQL.

Kiểm tra tính năng: `node --test studio/tests/album-sections.test.mjs`. Kiểm tra giao diện bằng Chrome: `node studio/tests/album-sections-browser.smoke.mjs` (cần Playwright, hoặc đặt `STUDIO_PLAYWRIGHT_MODULE` tới module đã cài). Kiểm tra thêm lỗi mạng, upload một phần, phiên hết hạn, bàn phím và responsive: `node studio/tests/album-sections-ux.smoke.mjs`. Có thể đặt `STUDIO_AXE_MODULE` tới module `@axe-core/playwright` để kiểm tra khả năng truy cập. Các kiểm thử tạo database và ảnh tạm riêng.

## Liên hệ và đặt lịch

- Khách chọn ngày, dịch vụ, gửi thông tin và lời nhắn.
- Yêu cầu lưu thật vào database, xuất hiện trong **Yêu cầu đặt lịch**. Khi cấu hình Resend/SMTP, studio nhận email thông báo và khách có email nhận thư xác nhận.
- Admin cập nhật: mới nhận, đã liên hệ, đã xác nhận, hoàn thành hoặc đã hủy. Trong chi tiết yêu cầu, có thể đổi ngày chụp và lưu ghi chú riêng (tối đa 3.000 ký tự).
- Phải chọn ngày trước khi xác nhận. Đổi lịch đã xác nhận kiểm tra ngày bị chặn/lịch trùng; nếu không hợp lệ, ngày, trạng thái và ghi chú cũ được giữ nguyên. Đổi lịch hoặc hủy thành công mở lại ngày cũ nếu không bị chặn riêng.
- Lịch trên trang liên hệ đồng bộ với ô nhập ngày, giữ ngày đã chọn khi chuyển tháng và có nút bỏ chọn. Khách chưa biết ngày vẫn gửi được yêu cầu tư vấn; ngày bận nhập bằng tay cũng bị kiểm tra.
- **Lịch chụp** cho phép chặn ngày bận. Ngày bị chặn hoặc có một lịch đã xác nhận không nhận yêu cầu mới.
- Một ngày chỉ xác nhận một booking. Gửi yêu cầu chưa giữ chỗ, chưa nhận thanh toán và chưa xác nhận lịch.

## Theo dõi trạng thái studio

**Tổng quan → Chuẩn bị mở studio** cho biết đã có thông tin liên hệ, portfolio có ảnh và cấu hình lưu trữ cloud hay chưa. Trạng thái cloud phản ánh cấu hình đang chạy; không thay thế kiểm thử dữ liệu tồn tại sau restart trên hosting thật. Không có key hoặc mật khẩu hosting trong trình duyệt.

## Chỉnh website và sao lưu

Trong **Website**, chỉnh thương hiệu, tiêu đề, giới thiệu, email, điện thoại, khu vực, Instagram và lời nhắn đặt lịch. Không cần sửa code để đăng album hoặc thay nội dung. Cấu hình được kiểm tra toàn bộ trước khi lưu; một trường sai sẽ không làm các trường khác bị thay đổi một phần.

Tải JSON trong phần sao lưu để giữ cấu trúc album/lựa chọn/yêu cầu. JSON này chứa dữ liệu khách, ghi chú riêng của studio và hash mật khẩu gallery: lưu kín. Nó không chứa ảnh hoặc tài khoản admin. Sao lưu toàn bộ `data/live/` khi app local đã dừng; trên Supabase sao lưu database và Storage riêng. JSON chưa có luồng khôi phục qua giao diện.

## Hosting và Tên miền

Xem [HOSTING.md](HOSTING.md): Render Free + Supabase PostgreSQL/Storage, cấu hình chính thức cho [chicongphoto.vn](https://chicongphoto.vn). Production từ chối chạy nếu không cấu hình database và Storage lưu bền vững. Đây là app Node.js chạy server, không phải thư mục HTML tĩnh để upload vào hosting cPanel PHP.

Đã triển khai và kết nối tên miền chính thức ngày 09/10/2026: [website](https://chicongphoto.vn), [quản trị](https://chicongphoto.vn/admin). Tên miền `chicongphoto.vn` hoạt động qua HTTPS với proxy Cloudflare, kết hợp Cloudflare Web Analytics và Schema.org JSON-LD structured data. Database dùng TLS xác thực CA/hostname, bucket ảnh `chicong-private` trên Supabase giữ riêng tư.

Hệ thống đã xác minh 56 bài test tự động (gồm SEO URL slug, retry upload, bảo mật gallery, CSRF và Schema.org). Portfolio hiện đã công khai 7 album với 284 ảnh thực tế phục vụ định dạng WebP tối ưu. Đăng nhập tài khoản studio để cập nhật ảnh chân dung, thông tin liên hệ và quản trị album/gallery theo [HOSTING.md](HOSTING.md) và [OPERATIONS.md](OPERATIONS.md).

Nếu quên mật khẩu quản trị, chạy `npm run admin:reset` trong terminal của máy/server có đúng database; tự nhập email và mật khẩu mới. Mật khẩu không hiển thị khi nhập, các phiên cũ bị vô hiệu. Không có reset password công khai hoặc gửi mail khôi phục.

## Mã nguồn

- `studio/server/app.mjs`: API, auth/session, upload, album, gallery, lịch và serving.
- `studio/server/db.mjs`: SQLite local / PostgreSQL khi deploy, schema.
- `studio/server/storage.mjs`: file local / private Supabase Storage.
- `studio/web/`: giao diện khách và quản trị, vanilla JavaScript/CSS.
- `studio/tests/`: integration tests, mock cloud Storage và fixture trình duyệt tách biệt.
- `render.yaml`, `.env.example`: cấu hình hosting.

Bản prototype trước nằm trong `legacy-prototype/`; thư mục WordPress gốc được giữ nguyên và không phục vụ trên website mới. Không đưa các thư mục này lên host/repository public.

## Hiệu năng — 13/10/2026

Đã tối ưu tải ảnh hero, kích thước ảnh theo hàng album, dữ liệu khởi tạo trang và truy vấn danh sách album. Xem [số đo trước/sau và phạm vi kiểm thử](docs/performance-review-2026-10-13.md). Các thay đổi chưa triển khai production tại thời điểm lập báo cáo.

## Kiểm tra

```sh
npm run check
npm test
npm audit --omit=dev
```

Integration tests kiểm tra đăng nhập, CSRF, quyền truy cập album/ảnh, upload và từ chối ảnh sai, lưu lựa chọn/CSV, đổi mật khẩu gallery, lưu dữ liệu, booking conflicts và không lộ ghi chú riêng. Các kiểm thử bổ sung kiểm tra upload đồng thời/thử lại không trùng, mã upload không được dùng cho file khác, sắp xếp ảnh khác album bị từ chối, trạng thái chuẩn bị studio và nâng cấp schema giữ dữ liệu cũ. Kiểm tra trình duyệt dùng database/file tạm riêng; không tạo account hoặc yêu cầu giả trong studio của bạn.

## Vận hành bản 2.1

Xem [OPERATIONS.md](OPERATIONS.md) cho checklist dùng hằng ngày, cập nhật và xử lý sự cố. Khi khởi động, bản 2.1 tự thêm cột/index vào schema cũ; không xóa hay tạo lại album. Sao lưu trước khi cập nhật phiên bản.

Bản 2.1.1 hoàn thiện thao tác chọn ảnh trong lightbox, cập nhật lựa chọn tại chỗ để giữ vị trí xem, tăng cỡ chữ và vùng bấm trên điện thoại. Ở thời điểm phát hành 2.1.1, website chỉ chạy local; trạng thái hosting hiện tại nằm ở mục Hosting miễn phí phía trên.

## Hoàn thiện đặt lịch · 2.2.0

Bổ sung đổi ngày chụp và ghi chú riêng trong **Yêu cầu đặt lịch → Xem**. Một lần lưu cập nhật cả ngày, trạng thái và ghi chú. Ngày chụp mới không được nằm trong quá khứ; vẫn có thể cập nhật ghi chú/trạng thái hoàn thành cho các buổi chụp cũ. Ghi chú riêng chỉ có trong API quản trị và bản sao JSON, không xuất hiện trong thông tin lịch công khai.

Nâng cấp tự thêm cột `inquiries.notes` mặc định rỗng, giữ nguyên các yêu cầu hiện có. Sao lưu trước khi chạy bản mới. Bản 2.2.0 đã kiểm tra 24 bài test tự động trên SQLite và luồng trình duyệt desktop/mobile với database tạm riêng; kết quả kiểm thử cloud hiện tại nằm ở mục Hosting miễn phí phía trên.

## Giao diện tinh giản · 2.2.1

Website và studio dùng chung bảng màu trắng ngà/xanh rêu, hệ thống nút và ô nhập liệu, biểu tượng SVG nét mảnh. Tiêu đề quản trị ngắn hơn; thanh điều hướng mobile tự đưa mục đang chọn vào vùng nhìn thấy. Bảng yêu cầu đặt lịch chuyển thành danh sách thông tin trên điện thoại để không phải cuộn ngang. Các trạng thái chưa có album/ảnh cũng có bố cục riêng.

Kiểm tra trình duyệt trên 11 trang ở các độ rộng 320, 390, 768 và 1440px: không tràn ngang; tìm kiếm, lọc, lưu yêu cầu, tạo album, menu mobile, mở gallery, chọn ảnh và gửi lựa chọn hoạt động. Bộ 24 bài kiểm thử vẫn qua. Toàn bộ dữ liệu thử nằm trong fixture tạm; cập nhật giao diện không thay đổi database thật.

## Hoàn thiện tư vấn · 08/10/2026

Khách có thể để email hoặc điện thoại; ngân sách dự kiến không bắt buộc và báo giá vẫn gửi riêng. Form chỉ rõ trường sai, có trạng thái đang gửi và giữ nội dung khi lỗi mạng. Mã lần gửi bảo vệ thao tác thử lại khỏi tạo trùng; database tự bổ sung các cột, không xóa yêu cầu cũ. Ngày chụp vẫn được máy chủ kiểm tra kể cả khi lịch trên giao diện tạm chưa tải được.

Trong **Website**, điền **Thời gian phản hồi thực tế** nếu đã có cam kết; để trống sẽ không hiện lời hứa thời gian. Facebook chỉ hiện khi có đường dẫn được cấu hình. Studio quản lý yêu cầu trong trang quản trị; phiên bản hiện tại đã hỗ trợ email tự động qua Resend/SMTP.

Đã kiểm tra 43 tests cùng các tình huống lỗi trên trình duyệt. Xem [kết quả kiểm thử](docs/consultation-enhancements-2026-10-08.md) để biết phạm vi và giới hạn xác minh.

## Xác minh email và luồng nhận khách · 09/10/2026

Đã gửi form thử trên website thật và xác minh cả email studio lẫn email xác nhận có trạng thái Delivered trên Resend. Yêu cầu thử đã được đánh dấu Hoàn thành, không giữ lịch chụp. Xem [biên bản kiểm tra](docs/customer-flow-verification-2026-10-09.md) để phân biệt kết quả production, kiểm thử local và phạm vi chưa xác minh.

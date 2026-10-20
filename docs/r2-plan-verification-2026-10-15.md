> **Tài liệu lịch sử — đã hợp nhất ngày 16/10/2026.** Đọc [kế hoạch triển khai R2 và backup chính](r2-implementation-plan.md) để có các quyết định và điều kiện hiện hành. Nội dung bên dưới được giữ làm lịch sử review; những câu hỏi/trạng thái cũ có thể đã được giải quyết trong bản hợp nhất.

**Biên bản xác minh kế hoạch Cloudflare R2 — 15/10/2026**

Kết luận: kiến trúc Supabase PostgreSQL + Render + R2 private phù hợp với phạm vi người dùng đã chọn. Kế hoạch ngày 14/10 chưa đủ cụ thể để dùng làm quy trình chuyển production vì mã nguồn có thêm chức năng và công việc nền. Đã cập nhật kế hoạch, không triển khai R2 hay sửa ứng dụng trong lượt review này.

Biên bản giữ bằng chứng của lượt đầu ở snapshot 0c6a493 + thay đổi chưa commit. Phần bổ sung cuối tài liệu ghi lần rà lại HEAD 1ea50e8 và các quyết định mới của người dùng; không coi 69 test cũ là kiểm thử bản mới.

**Phạm vi và bằng chứng**

- Người dùng đã chọn ảnh portfolio/gallery, chỉ bản web/JPG hiện tại, giữ cách kiểm tra quyền, dưới 1.000 ảnh mới/tháng, ưu tiên miễn phí và chấp nhận phí nhỏ.
- Đọc kế hoạch, các module storage/upload/prepared/deletion/database/auth/download và các test liên quan. HEAD lúc lấy mẫu: 0c6a493, cộng các thay đổi chưa commit; không suy ra đó là code production.
- Do workspace có thay đổi đang diễn ra, sao chép studio và package.json sang thư mục tạm riêng; không sao chép .env, dữ liệu khách hoặc credentials. Dùng Node v24.19.0, module đã cài và SQLite tạm/in-memory storage.
- Sáu file kiểm thử: storage, prepared-photo, photo-management, security, gallery-download, photo-download. Kết quả **69 pass / 0 fail / 0 skip**, khoảng 8,3 giây. Đây là bộ kiểm thử chọn theo phạm vi, không phải toàn bộ regression hay chứng nhận cloud.
- Ba tình huống chồng lấn quyền được dựng riêng, kết quả ở bảng bên dưới. Các script này xác nhận giới hạn/lỗi có sẵn, không phải sửa chúng.
- Một tình huống riêng tái hiện queue xóa chạy nhầm kho sau đổi provider, với SQLite tạm và hai kho Map độc lập; không gọi cloud.
- Không chạy PostgreSQL, browser, R2 thật, Supabase thật hoặc Render production trong lượt này. Không kiểm kê/đọc nội dung kho ảnh thật, kích hoạt thanh toán, tạo bucket hay thay secrets.
- Bằng chứng: [kết quả chạy](../output/r2-plan-verification-2026-10-15/summary.json), [log 69 tests](../output/r2-plan-verification-2026-10-15/baseline-tests.log), [hash snapshot](../output/r2-plan-verification-2026-10-15/snapshot-sha256.json), [log tình huống quyền](../output/r2-plan-verification-2026-10-15/auth-race-reproduction.log), [script tái hiện](../output/r2-plan-verification-2026-10-15/source/auth-race-reproduction.mjs). Đây là bằng chứng local trong output được Git ignore; mã ứng dụng của snapshot nằm dưới thư mục output tương ứng/source.

Chạy lại các tình huống có điều khiển từ thư mục output/r2-plan-verification-2026-10-15/source với Node 24: chạy auth-race-reproduction.mjs và cleanup-provider-switch-repro.mjs. Thư mục này chứa bản sao studio/package và symlink node_modules tới dependencies của workspace; cần giữ dependencies tương ứng khi chạy lại. Không thêm --env-file, không dùng .env production. Script tạo dữ liệu thử riêng; ba tình huống quyền và một tình huống cleanup không gọi cloud. Bản script đã được chạy lại tại chính vị trí bằng chứng này.

**Các phát hiện quan trọng và điều chỉnh đã đưa vào kế hoạch**

| Mã | Mức ưu tiên | Vấn đề | Điều chỉnh/điều kiện đạt |
|---|---|---|---|
| V01 | Cao | Queue xóa không chứa provider/bucket, dùng kho đang cấu hình | Khóa ghi, drain queue trên đúng kho nguồn, xác nhận rỗng rồi dừng worker trước đổi kho; không xóa job để vượt qua lỗi |
| V02 | Cao | Đóng tab/HTTP không chứng minh tác vụ ghi đã dừng | Khóa bền vững qua restart, mọi tiến trình tuân thủ, theo dõi tác vụ đang chạy thật sự và đợi về 0 |
| V03 | Cao | Staging dùng bucket riêng nhưng DB thật vẫn có thể sửa dữ liệu/tiêu thụ cleanup thật | Cô lập DB/schema, credentials, bucket, worker, email và calendar; inventory dùng đường đọc riêng |
| V04 | Cao | Ghi đè giữ photo.id nhưng đổi photos.filename | Manifest theo filename thực, so delta thêm/thay/xóa; không dựng tên object từ ID ảnh |
| V05 | Cao | Mở khóa bằng mật khẩu cũ có thể tạo phiên sau khi đổi mật khẩu | Ghi thành lỗi baseline riêng, cần sửa và test race trước nghiệm thu bảo mật |
| V06 | Vừa | “private gallery” không nhất thiết có mật khẩu | Giữ/test cả gallery bằng link và gallery có mật khẩu, không áp kỳ vọng sai |
| V07 | Vừa | Kế hoạch bỏ sót .ccphoto, skip/overwrite, receipts, tải một JPG riêng | Bổ sung hai đường upload và đầy đủ đường tải, bảo toàn retry/phiên bản file |
| V08 | Vừa | Chi phí copy/hash/backup có thể đọc nguồn nhiều lần và phát sinh outbound | Chọn runner riêng, tính số lượt đọc trước; kiểm tra quota còn lại thật |
| V09 | Vừa | Audit private và tương đương chính sách MIME/size chưa đủ cụ thể | Audit từng đường public bằng object tồn tại; kiểm tra key/bytes ở ứng dụng, không coi 24MiB là trần đã xác minh |
| V10 | Vừa | SDK timeout/retry/checksum/body chưa được thử với R2 | Pin phiên bản, credential tường minh, deadline toàn thao tác, thử thật và giữ trạng thái ghi chưa rõ kết quả |

**V01–V03: quá trình chuyển kho cần một điểm dừng ghi có thể chứng minh**

Bảng photo_cleanup hiện lưu photo_id, filename, has_download; worker lấy storage đang được chọn để xóa rồi bỏ job. Nó tự khởi động khi createApp chạy. Nguồn: [schema snapshot](../output/r2-plan-verification-2026-10-15/source/studio/server/db.mjs), [worker snapshot](../output/r2-plan-verification-2026-10-15/source/studio/server/photo-deletion.mjs).

Nếu còn việc xóa từ Supabase mà khởi động bằng R2, xóa một object không có ở R2 có thể được coi là thành công; queue hết nhưng file ở Supabase vẫn còn. Ảnh này không tự hiển thị trở lại vì record đã mất, nhưng trạng thái xóa và chi phí kho cũ bị lệch.

Đã tái hiện: trước chuyển có 3 file nguồn, 0 file đích và 1 job; sau chạy worker với kho đích rỗng, vẫn còn 3 file nguồn nhưng job về 0. Khởi động worker lại với nguồn không còn job để dọn. Giả định của fixture: remove object không tồn tại thành công, đúng contract xóa lặp lại an toàn đang đề xuất. [Kết quả JSON](../output/r2-plan-verification-2026-10-15/cleanup-provider-switch-repro.json), [script](../output/r2-plan-verification-2026-10-15/source/cleanup-provider-switch-repro.mjs)

Phương án cơ sở đã chọn trong kế hoạch: triển khai trước một phiên bản hiểu khóa trong khi vẫn dùng Supabase; chặn mọi thao tác thay đổi media; đợi tác vụ ghi về 0; hoàn tất cleanup trên Supabase; xác nhận queue rỗng và dừng worker; lấy snapshot/manifest cuối; giữ khóa qua đổi provider. Rollback dùng quy trình tương tự trên R2.

Nếu cleanup không hoàn tất, chưa đi qua điểm chuyển. Việc ghi lại provider/bucket cho từng job là phương án thiết kế thay thế nếu sau này cần chuyển dù còn queue, không được âm thầm giả định đã có trong code.

Khóa phải bao phủ ảnh thường, package, overwrite, xóa đơn/hàng loạt/album, chân dung và thay tham chiếu chân dung qua settings. Upload đang xử lý sau khi client bỏ cuộc vẫn được tính là tác vụ ghi. Cần test restart và phiên bản server cũ/mới cùng tồn tại.

Môi trường thử chỉ có bucket riêng là chưa đủ: khởi động ứng dụng có thể tạo schema/defaults và chạy cleanup trên DB kết nối. Sao lưu/kiểm kê không được dùng createApp như một công cụ chỉ đọc. Restore được diễn tập với đích riêng và worker tắt cho tới khi kiểm chứng.

**V04/V07: bản ảnh hiện hành và các chức năng mới phải được giữ**

Overwrite đổi filename nhưng giữ ID/lựa chọn/bìa/caption/section/thứ tự. ETag và URL version dựa vào filename. Nếu copy theo ID hoặc chỉ tìm ảnh có ngày tạo mới, có thể bỏ sót bản thay thế dù tổng số ảnh không đổi. Nguồn: [upload snapshot](../output/r2-plan-verification-2026-10-15/source/studio/server/photo-upload.mjs), [app snapshot](../output/r2-plan-verification-2026-10-15/source/studio/server/app.mjs).

Manifest mới phải có album ID, photo ID, filename hiện hành, key từng bản, loại bản, Content-Type, số byte, SHA-256 nội dung, nguồn/đích và snapshot ID. Dữ liệu input/package hash không thay checksum của object. Không dùng tên gốc/caption làm đường dẫn lưu.

Ảnh thường encode trên server; .ccphoto đã chuẩn bị thì kiểm chứng và giữ nguyên ba bản. Cần giữ biên nhận upload và hành vi retry sau ghi đè/mất xác nhận COMMIT. Phiên bản rollback phải hỗ trợ các tính năng này cùng R2; không chỉ “một bản cũ có adapter”.

Xóa hiện là DB-first cùng queue bền vững: ảnh ngừng hiện sau transaction, bytes có thể được dọn sau. Không đổi hành vi thành trả lỗi xóa cho khách chỉ vì storage tạm lỗi sau khi DB đã xóa thành công.

Tải các ảnh đã chọn và tải một ảnh riêng là hai chức năng khác nhau. Tải một ảnh riêng cho phép ảnh chưa được chọn và album công khai; vẫn cần quyền tương ứng. Không áp điều kiện “đã chọn” lên tất cả download khi viết adapter.

**V05/V06: quyền truy cập — kết quả đã tái hiện**

| Tình huống có điều khiển thứ tự trên snapshot | Quan sát | Ý nghĩa |
|---|---|---|
| Một yêu cầu ảnh đang chờ storage; đổi mật khẩu rồi cho đọc tiếp | Yêu cầu cũ trả 200 và bytes; yêu cầu mới với cookie cũ trả 404 | Giới hạn của kiểm tra quyền trước lúc đọc, không cam kết thu hồi mọi request đang chạy |
| Yêu cầu unlock đã đọc mật khẩu cũ; đổi mật khẩu/xóa session xong rồi cho unlock tiếp | Unlock cũ trả 200, sinh một phiên mới, phiên đó xem ảnh được; unlock mới bằng mật khẩu cũ trả 401 | Lỗi đồng thời có hậu quả kéo dài hơn một request; cần sửa riêng |
| Đọc chân dung đang chờ; ẩn chân dung rồi cho đọc tiếp | Yêu cầu cũ 200, yêu cầu mới 404 | Giới hạn tương tự cho request đã bắt đầu |

Các test hiện có kiểm tra nhiều tình huống quyền và cache nhưng không bao phủ đầy đủ việc cấp session cũ đua với đổi mật khẩu. Vì vậy 69 test qua không phủ định lỗi tái hiện mới.

Hướng xử lý cần thiết cho lỗi session: đồng bộ việc đọc/kiểm tra trạng thái mật khẩu và cấp session với thao tác đổi mật khẩu, hoặc kiểm tra thế hệ quyền/session phù hợp. Chỉ đưa UPDATE mật khẩu và DELETE session vào cùng transaction chưa đủ nếu việc cấp session từ dữ liệu cũ ở ngoài cơ chế đồng bộ đó. Thêm test deterministic cho đúng thứ tự chồng lấn trước khi nghiệm thu.

Đây là phát hiện trên bản sao code, không có bằng chứng khai thác production. Không sửa ứng dụng trong lượt review. Kế hoạch liệt kê riêng việc xử lý lỗi này, không gán nó cho R2.

Gallery không mật khẩu hiện cho người có link vào; gallery có mật khẩu mới yêu cầu phiên. “Private bucket” nói về quyền truy cập kho file, “private album” nói về chế độ chia sẻ trong ứng dụng; hai khái niệm không thay thế nhau.

Download JPG/ZIP đã có kiểm tra lại quyền trước gửi. Điều đó giảm khoảng thời gian dùng quyền cũ, nhưng không phải lời hứa chặn nguyên tử mọi thay đổi đồng thời ngay trước/trong lúc gửi bytes. Không thu hồi được bytes người xem đã nhận.

**V08–V10: đối chiếu nhà cung cấp**

Các tài liệu chính thức được kiểm tra cho thiết kế, chưa kiểm tài khoản người dùng:

- R2 Standard có hạn mức miễn phí về dung lượng và requests; request vượt mức và quy tắc làm tròn cần được tính. Số upload không quyết định số lượt đọc. [Giá R2](https://developers.cloudflare.com/r2/pricing/)
- Supabase có egress quota dùng chung; copy, hash và backup riêng có thể nhân số lần tải nguồn. Ưu tiên một bản sao nguồn có checksum khi phù hợp và đối chiếu delta cuối. [Supabase egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- Render→R2 và Render→khách đều là outbound. Chuyển kho không bỏ được phí đường server, và chạy migration trên server phục vụ khách còn thêm tải. [Render bandwidth](https://render.com/docs/outbound-bandwidth)
- Object token chỉ cho đúng bucket; kiểm chứng private bằng cấu hình r2.dev, custom domains và các gateway đã cấu hình, thử object đã tồn tại. Không dùng bucket root hay S3 HEAD làm bằng chứng duy nhất. [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/), [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- R2 không có cùng chính sách MIME/size mà code Supabase đang thiết lập. 24MiB là mức nâng tối thiểu trong code, các cấu hình lớn hơn/unlimited được giữ. Giới hạn output mới phải dựa trên kiểm kê và tương thích file cũ; không âm thầm bỏ file vượt mức suy đoán. [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- SDK JS mới có checksum mặc định; cần kiểm phiên bản thực tế, không mặc định nó không tương thích R2 rồi tắt kiểm tra. GET có body stream, nên timeout phải bao gồm đọc body và retry; hủy phải đóng stream. [Cloudflare SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), [AWS checksums](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html)
- Một PUT bị timeout có thể hoàn tất sau đó; một HEAD “không tồn tại” ngay sau timeout chưa đủ kết luận. Giữ trạng thái chưa xác định và kiểm chứng lại. [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- Automatic/location hint không bảo đảm vị trí tối ưu cho khách website; đối với mô hình này đường Render↔R2 mới là đường cần đo. [Data location](https://developers.cloudflare.com/r2/reference/data-location/)

**Các điều kiện trước khi được coi là sẵn sàng chuyển thật**

| Điều kiện | Trạng thái sau review |
|---|---|
| Phạm vi sản phẩm và kiến trúc | Đã rõ; giữ phương án private R2 |
| Kế hoạch cập nhật theo code mới | Đã bổ sung; cần chốt lại baseline khi bắt đầu triển khai |
| Test hành vi nền được chọn | 69/69 đạt trên SQLite/local/mock |
| Lỗi cấp session đồng thời với đổi mật khẩu | Đã tái hiện, chưa sửa; cần xử lý trước nghiệm thu quyền |
| Adapter R2 và SDK thực tế | Chưa viết/chưa thử cloud |
| Khóa media + drain queue/tác vụ | Đã đặc tả; chưa có bằng chứng triển khai |
| Bucket/quyền/vùng/quota thực tế | Chưa truy cập tài khoản để xác minh |
| Dung lượng/manifest/checksum kho thật | Chưa chạy; cần dự toán lượt đọc trước |
| Diễn tập copy/restore/rollback | Chưa chạy |
| Backup độc lập và kiểm tra khôi phục | Chưa xác minh |
| Thời hạn giữ gallery | Đã được chốt trong trao đổi bổ sung: giữ tới khi người dùng tự xóa; không tự xóa theo ngày |
| Khung giờ và người deploy | Chốt khi có bản thử và kết quả diễn tập |

Các lựa chọn vận hành còn mở không làm mất giá trị của kiến trúc. Có thể chuẩn bị code sau khi người dùng yêu cầu, nhưng không coi bản kế hoạch hoặc bộ test local này là bằng chứng đủ để chuyển dữ liệu thật ngay.

**Bổ sung sau các bình luận và câu trả lời của chủ website ngày 15/10**

Đã chốt giữ gallery tới khi tự xóa, giữ mật khẩu album hiện tại không thêm thao tác bảo mật, đưa lỗi cấp phiên cũ vào phạm vi review/cải thiện trước nghiệm thu. Ưu tiên miễn phí và phí nhỏ được giữ, chưa đặt số tiền trần. Đã có Cloudflare nhưng chưa bật R2. Drive và ổ cứng là hai bản copy riêng của ảnh gốc/ảnh xuất Lightroom; chưa phải backup đầy đủ của website. Người dùng chọn ưu tiên backup website hằng ngày lên Drive bằng hạ tầng hiện có, tự copy xuống ổ cứng khi thuận tiện. Các lựa chọn là đầu vào kế hoạch; người dùng vẫn yêu cầu làm rõ trước khi code.

**Kiểm tra mã mới và bằng chứng thực nghiệm**

- HEAD được đọc: 1ea50e86f78e1de13010c736acdb367b6b35d247. So hash 18 file server với snapshot trước: app.mjs và photo-upload.mjs thay đổi. Không dùng hash HEAD thay cho việc xác minh production.
- Chạy lại riêng ba tình huống quyền trên bản sao code mới, Node 24.19.0, SQLite tạm và Map storage; không đọc .env/khóa/dữ liệu khách, không gọi cloud. Unlock bằng dữ liệu mật khẩu cũ vẫn tạo session sau khi đổi mật khẩu; session đó đọc media được (200), trong khi yêu cầu mới dùng mật khẩu cũ bị từ chối (401). Hai tình huống request media/portrait đang chạy vẫn hoàn tất, còn request mới bị chặn, giống kết quả trước.
- Bằng chứng mới nằm riêng: [metadata](../output/r2-plan-verification-2026-10-15/current-auth-review-1ea50e8/metadata.json), [log](../output/r2-plan-verification-2026-10-15/current-auth-review-1ea50e8/auth-race-reproduction.log), [hash source](../output/r2-plan-verification-2026-10-15/current-auth-review-1ea50e8/source-sha256.json), [cách chạy lại](../output/r2-plan-verification-2026-10-15/current-auth-review-1ea50e8/README.md). Không chạy lại bộ 69 test, không khẳng định đã kiểm PostgreSQL hay production.
- UPDATE mật khẩu và DELETE sessions hiện có transaction/khóa album; luồng unlock chưa dùng cùng cơ chế. Hướng sửa nhỏ là đồng bộ kiểm tra mật khẩu hiện hành và ghi session với đổi mật khẩu, chỉ trả cookie sau commit. Giữ album không mật khẩu, link và giao diện; thêm test đúng thứ tự chồng lấn trên cả hai loại DB khi triển khai.
- photo-upload.mjs thêm callback đánh thức cleanup khi đã ghi job nhưng dọn chưa xong/kết quả publish cần đối chiếu. Mapping filename, receipts và checksum không đổi trong diff. Upload trả lỗi vẫn có thể kích hoạt worker; bước drain phải đợi cả việc nền. Đây là đọc diff, chưa phải test callback mới.
- Giao diện HEAD mới ẩn nút JPG/zoom ở portfolio, giữ trong gallery. API tải theo album công khai vẫn tồn tại. Kế hoạch đã sửa mô tả giao diện, không khôi phục nút cũ hoặc coi endpoint public đã chặn.

**Phần backup mới cần triển khai riêng**

Đã đọc endpoint /api/admin/export: xuất tám bảng lần lượt, không bytes ảnh, admin, sessions, upload receipts hoặc cleanup queue. Giao diện đã nói rõ ảnh/admin phải sao lưu riêng. JSON này có ích để lưu một phần dữ liệu, chưa là snapshot đầy đủ để khôi phục cả website. [Mã export hiện tại](../studio/server/app.mjs), [giao diện hiện tại](../studio/web/main.js). Supabase cũng xác nhận backup database không chứa bytes Storage. [Tài liệu backup](https://supabase.com/docs/guides/platform/backups)

Repository chỉ có workflow CI test, chưa có schedule/script backup hoặc restore. Vì vậy đề xuất GitHub Actions → Drive là tận dụng nơi chạy có thể dùng, không phải một khả năng backup đang hoạt động. Cần xác minh remote/quota, xây công cụ backup/restore, quyền kết nối Drive và theo dõi lần thành công cuối. [Workflow hiện tại](../.github/workflows/check.yml), [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [giới hạn schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Phát hiện thiết kế: backup hằng ngày không được dump DB và copy ảnh độc lập khi cleanup đang xóa file. Snapshot có thể trỏ tới khóa A trong lúc overwrite đã thay B và worker dọn A. Kế hoạch bổ sung khóa/drain ban đầu, snapshot nhất quán, bảo vệ file được snapshot tham chiếu, không công bố thành công nếu thiếu file/mất bảo vệ, và diễn tập restore. Lượt backup không được chồng với migration; runner chết phải có cơ chế phục hồi khóa. Các yêu cầu này chưa được code hoặc test trong lần review.

Tại cuối trao đổi ngày 15/10, các điểm còn mở là dung lượng Drive, thời hạn lịch sử backup, nơi chạy sau kiểm tra quota, cách nhận biết backup quá cũ và khung giờ/chủ thể chuyển thật. Không hỏi lại chính sách mật khẩu, thời hạn gallery hoặc ép số tiền trần khi người dùng đã chọn ưu tiên free và ít phí nếu cần.

**Làm rõ tiếp ngày 16/10 — không có kiểm thử ứng dụng mới**

Người dùng xác nhận Drive Gmail cá nhân đã chỉ định còn khoảng 5TB, chọn giữ lịch sử backup website 30 ngày gần nhất nếu đủ dung lượng. Đây là thông tin do người dùng cung cấp và quyết định sản phẩm; chưa truy vấn tài khoản. HEAD vẫn 1ea50e8, không chạy lại các test trước hoặc thay đổi ứng dụng.

Kế hoạch/checklist đã bổ sung ba chi tiết vận hành: dọn theo thời gian snapshot, giữ bytes còn snapshot dùng và bảo vệ bản tốt cuối khi job lỗi; xuất một bộ local tự chứa đủ DB/media để restore khi không truy cập Drive; phân biệt cứu một file/album với khôi phục toàn bộ website để không đè mất booking/lựa chọn hiện hành. Phương án 30 ngày không hứa luôn có đủ 30 bản hoặc phục hồi được thay đổi sau snapshot thành công cuối.

Đã đối chiếu tài liệu Google cho hướng Drive cá nhân dùng OAuth với quyền hạn chế, kiểm thử làm mới quyền và hạn mức API hiện hành. Chưa tạo OAuth project, xin token, tạo folder, bật billing hoặc chạy lịch. Các lựa chọn chính đã đủ cụ thể cho thiết kế; các điểm còn lại là xác minh kỹ thuật trước chạy thật và khung giờ triển khai sau diễn tập. [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [OAuth expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Drive API limits](https://developers.google.com/workspace/drive/api/guides/limits)

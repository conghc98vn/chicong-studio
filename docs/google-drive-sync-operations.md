# Vận hành Google Drive Sync

Cập nhật 29/10/2026. Production đang chạy release `7a6c039` trên VPS iNET, PostgreSQL Supabase và R2 private; nhập thủ công bật, scheduler tắt, worker active. Pilot 33 ảnh/no-op là bằng chứng lịch sử trước cutover R2. [Trạng thái và giới hạn](handbook/README.md), [LIVE release hiện tại](handbook/09-production-release-2026-10-29.md), [nghiệm thu Drive lịch sử](archive/google-drive-sync-production-release-2026-10-20.md).

## 1. Nguồn ảnh và quyền kết nối

Drive Sync nhập ảnh từ folder studio đã chia sẻ cho **tài khoản dịch vụ riêng, quyền Người xem**. Worker dùng scope `drive.readonly`; không cần vai trò Cloud Owner/Editor hoặc domain-wide delegation. Identity này khác OAuth `drive.file` của backup website. Không dùng credential backup để nhập ảnh.

Trong **Cài đặt → Google Drive**, lưu email tài khoản dịch vụ, chọn **Phạm vi folder** và ID/đường dẫn folder bắt đầu. Theo lựa chọn của studio ngày 20/10, dùng **Các folder đã chia sẻ** (`shared`): nhận bất kỳ folder nào tài khoản dịch vụ đọc được; **Folder bắt đầu mặc định** chỉ là điểm mở đầu, không giới hạn tất cả album vào chung một root. Chế độ **Trong thư viện đã chọn** (`root`) vẫn yêu cầu folder nguồn là root hoặc nằm bên trong root. Migration giữ chế độ `root` cho dữ liệu cũ, không tự mở rộng phạm vi. Sau khi đổi chế độ, lưu và **Kiểm tra kết nối**; các job/preview cũ bị vô hiệu theo generation, ảnh và mapping hiện có được giữ, cần kiểm folder/tạo preview mới. Khóa JSON chỉ có trên máy worker, không dán vào admin, không lưu trong database hoặc snapshot. File khóa cần quyền `0600`; thư mục chứa khóa không được chia sẻ. Quyền chia sẻ trên Google quyết định tài liệu tài khoản dịch vụ có thể đọc; chỉ chế độ `root` kiểm thêm giới hạn root chung. Chế độ `shared` không phải đăng nhập Google của khách và không tự cấp quyền đọc toàn bộ Drive. Không chia sẻ thêm folder không liên quan cho identity này.

Credential thử đã được cấp và xác minh đọc/list/download folder thật thành công. Khóa thử từng gửi trong chat đã được thay và thu hồi ngày 19/10/2026; kiểm lại bằng khóa mới từ user worker trên VPS đọc/list thành công cả hai folder 346 và 160 file. Với những lần thay khóa tiếp theo: Nạp khóa mới trực tiếp vào secret file, chạy check/preview thành công, chuyển worker sang khóa mới rồi thu hồi khóa cũ; không gửi nội dung khóa vào chat hoặc tài liệu.

Trong album, mở **Google Drive**, dán link rồi **Duyệt và chọn folder**. Mở folder con, quay lại bằng đường dẫn hoặc tải thêm trang folder; bấm **Chọn folder này** để điền nguồn album. Folder không có folder con vẫn chọn được. Sau đó kiểm tra/gắn folder và xem trước, duyệt nhập. Chỉ file trực tiếp trong folder được nhập; duyệt folder không tự tạo album, section, nhập ảnh hoặc đổi chế độ công khai. Không quét đệ quy ảnh ở các folder con của album. Shortcut, Shared Drive, RAW/HEIC/video và Google Docs chưa được hỗ trợ trong bản đầu.

## 2. Chạy web và worker

Web và worker phải chạy cùng revision tương thích, dùng cùng database và storage identity. Worker là process riêng; web chỉ enqueue job. Gallery khách đọc rendition từ storage website, không gọi Drive. Không cài key lên web nếu web và worker chạy trên máy riêng.

Ví dụ cấu hình **local cách ly**, file `.env.drive-sync-local` ngoài Git:
```dotenv
HOST=127.0.0.1
PORT=4173
DATA_DIR=/absolute/private/path/drive-sync-local
MEDIA_STORAGE_PROVIDER=local
DRIVE_SYNC_ENABLED=true
DRIVE_SYNC_SCHEDULER_ENABLED=false
DRIVE_SYNC_SERVICE_ACCOUNT_FILE=/absolute/private/path/drive-sync-service-account.json
DRIVE_SYNC_INTERVAL_MS=900000
DRIVE_SYNC_POLL_MS=5000
DRIVE_SYNC_BATCH_SIZE=5
DRIVE_SYNC_MAX_INVENTORY_FILES=20000
DRIVE_SYNC_MAX_SOURCE_BYTES=134217728
DRIVE_SYNC_MAX_SOURCE_PIXELS=120000000
DRIVE_SYNC_ENCODE_TIMEOUT_MS=120000
DRIVE_SYNC_REQUEST_TIMEOUT_MS=120000
DRIVE_SYNC_TEMP_DIR=/absolute/private/path/drive-sync-temp
```

```sh
node --env-file=.env.drive-sync-local studio/server/start.mjs
node --env-file=.env.drive-sync-local studio/tools/drive-sync.mjs once
node --env-file=.env.drive-sync-local studio/tools/drive-sync.mjs worker
```

`once` xử lý **một batch** của một job; job lớn cần chạy tiếp hoặc dùng `worker`. `npm run drive:once` và `npm run drive:worker` dùng biến môi trường đã được cấp, không tự đọc `.env`. CLI trả exit 2 khi batch kết thúc với job lỗi; trạng thái `queued` vẫn có thể còn việc. Xem trạng thái job trong admin, không suy từ exit 0 rằng cả album đã nhập xong.

Trên cloud, dùng PostgreSQL riêng cho staging và provider/credential storage rõ ràng. Không dùng SQLite hoặc storage local trên filesystem tạm của nhiều instance. `openDatabase` có thể migrate schema: không chạy CLI mới vào production với mục đích “chỉ xem”. Web production ở VPS iNET đã bật Drive thủ công; worker systemd riêng hoạt động, lịch tự động vẫn tắt. Release hiện tại và trạng thái worker được kiểm LIVE trong [biên bản production 29/10](handbook/09-production-release-2026-10-29.md); pilot 33 ảnh vẫn là bằng chứng lịch sử. Phép diễn tập Linux cách ly dùng SQLite/storage tạm không thay cho nghiệm thu database/storage production.

## 3. Luồng nhập và duyệt

1. Lưu kết nối, bấm **Kiểm tra kết nối**, đợi job thành công. Nếu chưa có heartbeat worker, job vẫn nằm trong hàng đợi.
2. Với album mới, chọn **Google Drive**, nhập tên và link folder ngay trong form, bấm **Duyệt và chọn folder**, mở folder mong muốn rồi **Chọn folder này**. Bấm **Kiểm tra folder** rồi tạo album. Nếu đã có link đúng folder ảnh, có thể kiểm tra trực tiếp. Worker xác minh quyền và phạm vi đã chọn (`root` hoặc `shared`); kết quả có hiệu lực 15 phút. Album và liên kết được tạo cùng giao dịch, chưa nhập ảnh. Với album có sẵn, mở công cụ Google Drive, dùng **Duyệt và chọn folder** khi cần rồi **Kiểm tra và gắn folder**.
3. Chạy **Xem trước thay đổi**; xem các trang kết quả, lỗi nguồn và hành động thêm/thay/đổi tên/missing.
4. Tích xác nhận rồi **Duyệt và đồng bộ**. Approval gắn với đúng preview, revision và generation; nếu dữ liệu đã đổi, tạo preview mới.
5. Theo dõi job đến trạng thái kết thúc; dùng **Cập nhật bộ ảnh trên web** để nạp ảnh vừa nhập. `completed_with_errors` cần xử lý các file lỗi, không phải thành công toàn bộ.

Sau baseline đã duyệt, **Đồng bộ ngay** có thể áp dụng thay đổi nếu gallery chưa có submission. Sau khi khách bấm **Gửi lựa chọn**, mọi lần thêm ảnh, thay nội dung hoặc đổi tên đều chờ studio duyệt. Khách đổi lựa chọn về draft không gỡ khóa duyệt này. Gửi lựa chọn kiểm tra cả revision ảnh và lựa chọn; khi nhận 409, giao diện tải lại và yêu cầu khách xem rồi bấm gửi lại.

Ảnh mới dùng WebP cạnh dài tối đa 2400px, thumbnail 900px và JPG tải xuống 2400px. JPEG gốc chỉ được đọc vào file tạm để xử lý; không lưu vào kho website hoặc backup.

## 4. Những thao tác dễ nhầm

Trong cửa sổ **Duyệt và chọn folder**, mục **Xem nhanh** hiển thị tối đa 6 thumbnail nhỏ của folder hiện tại. Đây chỉ là ảnh mẫu để nhận diện bộ ảnh, chưa nhập vào album; ảnh gốc không được tải cho bước này. Nếu Google chưa có thumbnail hoặc ảnh lỗi, vẫn chọn và kiểm tra folder được. Chi tiết giới hạn/cache và kết quả kiểm tra nằm ở [biên bản duyệt folder](archive/google-drive-folder-browser-2026-10-20.md#xem-nhanh-ảnh-trong-folder).

Dòng tổng quan cho biết **số ảnh JPEG/PNG/WebP trực tiếp · số folder con** và số tệp khác nếu có; không cộng ảnh trong folder con. Số folder đã hiển thị trong danh sách phân trang là thông tin riêng. Có thể chọn hoặc mở folder con trong khi số lượng và thumbnail còn đang tải. `Chưa đếm hết` là kết quả một phần, không phải tổng cuối cùng; lỗi đếm không có nghĩa folder trống. Mở lại folder vừa xem có thể dùng cache 30 giây trong cửa sổ hiện tại; bấm **Làm mới** sau khi thêm/xóa/chuyển file trên Drive. Số lượng phản ánh metadata lúc quét, còn điều kiện nhập từng ảnh vẫn được kiểm ở bước xem trước thay đổi.

Nút chọn/đóng luôn hiện khi cuộn danh sách trên mobile. **Làm mới** tạm khóa trong lúc tải tổng quan để tránh tạo trùng tác vụ. Đổi folder hoặc đóng cửa sổ gửi hủy lượt duyệt cũ; việc này không hủy nhập ảnh của album. Nếu lượt duyệt thất bại hoặc kết nối thay đổi, kết quả cũ bị vô hiệu; bấm **Duyệt folder** để thử lại. Xem [review UI/UX và hiệu năng](archive/google-drive-folder-browser-review-2026-10-20.md) cho các giới hạn thời gian và bằng chứng.

| Tình huống | Kết quả |
|---|---|
| File Drive đổi tên | Cập nhật tên nguồn, không tải lại bytes nếu nội dung không đổi; ảnh giữ ID |
| File Drive thay nội dung | Tạo rendition mới rồi publish có kiểm tra phiên bản; giữ photo ID và lựa chọn |
| Xóa/chuyển file khỏi folder | Giữ ảnh web, báo `Không còn trên Drive`; không tự xóa lựa chọn |
| Ảnh manual trùng tên ảnh Drive | Hai nguồn riêng; sync không nhận quyền sửa ảnh manual |
| Xóa ảnh Drive khỏi web | Lưu trạng thái bỏ đồng bộ; lần sync thường không hồi sinh ảnh |
| Chuyển ảnh sang quản lý tay | Giữ ảnh hiện tại; Drive không còn được cập nhật ảnh đó |
| Nhập lại sau xóa/detach | Intent riêng tạo ảnh Drive mới; bản manual được giữ nguyên |
| Ngắt folder | Giữ ảnh web và lịch sử nguồn; tác vụ cũ bị vô hiệu theo generation |
| Thay ảnh manual | Chọn menu ảnh → thay ảnh theo photo ID, kèm catalog revision; không ghép theo tên mơ hồ |

Admin với hơn 240 ảnh phân trang 120 ảnh; gallery hơn 360 ảnh phân trang 90 ảnh. Tìm kiếm/lọc áp dụng trên bộ metadata đã tải, lightbox vẫn đi qua bộ đã lọc. Chọn tất cả trên admin lớn chỉ chọn trang hiện tại; giới hạn thao tác hàng loạt vẫn được áp dụng. Đây là giới hạn DOM, không phải API metadata phân trang toàn bộ album.

## 5. Giới hạn và lịch

Mặc định JPEG Drive tối đa **128 MiB / 120 MP**, encode tối đa 120 giây trong process con có watchdog. PNG/WebP giữ giới hạn **20 MiB / 40 MP**; upload tay cũng giữ policy cũ. Worker tải theo stream, kiểm bytes/checksum, kiểm lại metadata trước publish; từng ảnh xử lý tuần tự. Thư mục tạm có kiểm tra dung lượng trống và owner marker; chỉ dọn orphan đủ tuổi khi xác minh process cùng máy đã chết. Không coi giới hạn pixels hoặc Sharp cache là giới hạn RAM của process.

Các giới hạn trên là mặc định code local. Worker pilot VPS hiện giới hạn **60 MP / 128 MiB**, CPU 50%, MemoryHigh 512 MiB/MemoryMax 768 MiB cho toàn cgroup, heap Node 256 MiB; production đã bật nhập thủ công, pilot 33 ảnh đã đạt như ghi tại [biên bản ngày 20/10](archive/google-drive-sync-production-release-2026-10-20.md). JPEG synthetic 42,25 MP/51,2 MiB đã encode hai lần trên VPS (CPU 25%, cgroup đỉnh 283 MiB, khoảng 69 giây/lần); không chứng nhận toàn bộ policy 120 MP hoặc 5.000 JPEG full-resolution. Xem [biên bản tài nguyên và rollout](archive/google-drive-sync-production-release-2026-10-17.md). Đã đo bộ thật 346 JPEG trên local (mục 8), nhưng còn cần đo RAM toàn bộ cây process/CPU/disk và thời gian import 500/5.000 ảnh trên staging trước khi chọn instance. Fixture 5.000 metadata và kiểm thử UI không thay thế phép đo encode 5.000 ảnh full-resolution.

Lịch cần cả `DRIVE_SYNC_SCHEDULER_ENABLED=true` và album đã opt-in **Cho phép đồng bộ định kỳ** sau baseline được duyệt. Mặc định chu kỳ 15 phút; cấu hình global tắt vẫn cho lưu opt-in nhưng không tự enqueue. Pause album/ngắt liên kết sẽ ngừng xử lý theo trạng thái tương ứng. Chưa bật lịch khi chưa hoàn tất cổng staging và chốt tài nguyên.

## 6. Lỗi, dừng và phục hồi

Drive 429/5xx được retry có giới hạn; mất quyền/key cần sửa cấu hình, kiểm tra kết nối rồi preview lại. Nếu folder nằm ngoài root ở chế độ `root`, kiểm lại chế độ đã cấu hình; chế độ `shared` cho phép các folder đã chia sẻ mà không cần đổi root cho từng album. Đổi chế độ không cấp thêm quyền Google: lỗi mất quyền/key vẫn phải sửa quyền hoặc credential. Không xóa rows jobs, attempts, writer hoặc journal để “gỡ kẹt”.

`SIGTERM`/`SIGINT` yêu cầu worker dừng và nhường job an toàn. Nếu bị kill trong lúc PUT/COMMIT, giữ bằng chứng, tắt claim/schedule và dùng công cụ media dưới maintenance lease. `npm run media -- help` liệt kê cú pháp hiện hành. Quy trình:
1. `lock --lease FILE` để chặn writer mới; xem `status` và xác định process cũ.
2. Xác minh process/deployment đã dừng. `retire-writers --lease FILE --process-ids ID,ID --writers-stopped yes` chỉ retire các process được chỉ định. Không suy “đã dừng” chỉ từ heartbeat cũ.
3. `reconcile --lease FILE --provider-settled yes` chỉ sau khi chắc các thao tác provider cũ đã kết thúc. Đối chiếu receipt, reference và storage identity trước queue orphan.
4. `drain --lease FILE`; cleanup rendition đã từng publish có retention ít nhất 5 phút kể từ lần quan sát retirement đã commit. HTTP media có deadline 180 giây; không có force bỏ qua retention.
5. Chỉ `unlock --lease FILE` khi writer/unknown đã được giải quyết và drain hoàn tất; resume worker bằng fence mới. Nếu maintenance lease cũ hết hạn, dùng `recover --lease NEW_FILE --writers-stopped yes`, vẫn giữ khóa cho đến khi đối chiếu xong.

Các lệnh trên cần truyền file env cụ thể bằng Node, giống worker. Dữ liệu lease chứa quyền điều khiển vận hành: lưu riêng và không đưa vào Git. Không tự động khẳng định `provider-settled` từ một lần GET/HEAD 404.

## 7. Backup, restore và rollout

Snapshot schema v2 gồm nguồn, generations, submissions và dữ liệu Drive cần khôi phục; reader vẫn nhận snapshot v1. Snapshot database dùng transaction nhất quán. Credential không nằm trong snapshot. Restore offline giữ ảnh/lựa chọn/khóa duyệt, tắt connection và lịch, hủy tác vụ chưa kết thúc, vô hiệu approval cũ và reset leases/heartbeat. Sau restore phải cấu hình credential, check và tạo preview mới.

Trước production: backup baseline → dừng worker/runner cũ → migration có một owner → triển khai web hiểu source/revisions khi flag tắt → xác minh instance cũ đã drain → cập nhật worker và mọi backup runner cùng revision → kiểm upload/backup → pilot một album draft. Không rollback về runtime cũ không hiểu nguồn Drive; dùng revision rollback tương thích schema hoặc bản restore đã diễn tập.

## 8. Kiểm thử và dùng thử

Chạy `npm run check`, `npm test`; cấp PostgreSQL disposable để không bỏ các ca cần DB thật. `npm run test:browser` chọn các suite fixture cách ly; module Playwright/Chrome cần có sẵn. [Hướng dẫn QA](handbook/03-phong-lab-qa.md), [kết quả audit mới](review-2026-10-23.md).

Để dùng thử Drive thật, chọn folder riêng chứa bản sao vài ảnh và một album draft. Check → preview → approve → kiểm rendition/quyền → sync no-op; kiểm thay tên/nội dung/missing, ảnh manual cùng tên, submission hold và detach. Không sửa folder studio đang dùng chỉ để làm test. Sau restore phải check và preview mới.

`npm run drive:preview -- --help` hướng dẫn tạo/chạy bản sao từ bằng chứng local đủ điều kiện; output mới được đánh dấu riêng. Không giả định server 4175 hoặc thư mục preview của lần trước vẫn tồn tại. Không dùng URL album cụ thể trong lịch sử để tự chạy thêm import.

[Phụ lục lịch sử](archive/google-drive-runbook-history-2026-10-21.md) giữ số đo 346 JPEG, các lượt 328/342/373/420 test và UAT cũ. Những kết quả đó không thay benchmark mới, full cloud restore, reboot/kill worker giữa import hoặc thử tải JPEG thật 500/5.000 ảnh trên staging.

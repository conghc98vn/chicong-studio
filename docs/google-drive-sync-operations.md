# Vận hành Google Drive Sync

Cập nhật 20/10/2026. Bản duyệt folder và chế độ các folder đã chia sẻ đã bật trên local, qua 420/420 regression test cùng kiểm tra Drive thật và giao diện máy tính/320px, xem [biên bản tính năng](google-drive-folder-browser-2026-10-20.md) và [lượt tối ưu hiệu năng mới nhất](google-drive-perf-pass-2026-10-20.md). Production vẫn dùng bản phát hành ngày 19/10, chưa có thay đổi này; **nhập Drive production và scheduler vẫn tắt**. Worker riêng đang kiểm kết nối, chưa enable khởi động cùng máy. Các mốc trước đã nhập 346 JPEG thật trên local, sync lại không tạo ảnh/objects mới và diễn tập 5.000 ảnh giả/backup/restore offline; giới hạn ở [báo cáo workflow](google-drive-sync-workflow-2026-10-17.md). Xem [biên bản rollout production](google-drive-sync-production-release-2026-10-17.md) và [kế hoạch triển khai](google-drive-sync-implementation-plan.md) cho các cổng nghiệm thu còn lại.

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

Trên cloud, dùng PostgreSQL riêng cho staging và provider/credential storage rõ ràng. Không dùng SQLite hoặc storage local trên filesystem tạm của nhiều instance. `openDatabase` có thể migrate schema: không chạy CLI mới vào production với mục đích “chỉ xem”. Web production ở VPS iNET; worker systemd riêng đã cài và đang chạy kiểm kết nối, chưa enable khởi động cùng máy. Web chưa bật tính năng Drive, lịch tự động vẫn tắt. Phép diễn tập Linux cách ly dùng SQLite/storage tạm không thay cho nghiệm thu database/storage production.

## 3. Luồng nhập và duyệt

1. Lưu kết nối, bấm **Kiểm tra kết nối**, đợi job thành công. Nếu chưa có heartbeat worker, job vẫn nằm trong hàng đợi.
2. Với album mới, chọn **Google Drive**, nhập tên và link folder ngay trong form, bấm **Duyệt và chọn folder**, mở folder mong muốn rồi **Chọn folder này**. Bấm **Kiểm tra folder** rồi tạo album. Nếu đã có link đúng folder ảnh, có thể kiểm tra trực tiếp. Worker xác minh quyền và phạm vi đã chọn (`root` hoặc `shared`); kết quả có hiệu lực 15 phút. Album và liên kết được tạo cùng giao dịch, chưa nhập ảnh. Với album có sẵn, mở công cụ Google Drive, dùng **Duyệt và chọn folder** khi cần rồi **Kiểm tra và gắn folder**.
3. Chạy **Xem trước thay đổi**; xem các trang kết quả, lỗi nguồn và hành động thêm/thay/đổi tên/missing.
4. Tích xác nhận rồi **Duyệt và đồng bộ**. Approval gắn với đúng preview, revision và generation; nếu dữ liệu đã đổi, tạo preview mới.
5. Theo dõi job đến trạng thái kết thúc; dùng **Cập nhật bộ ảnh trên web** để nạp ảnh vừa nhập. `completed_with_errors` cần xử lý các file lỗi, không phải thành công toàn bộ.

Sau baseline đã duyệt, **Đồng bộ ngay** có thể áp dụng thay đổi nếu gallery chưa có submission. Sau khi khách bấm **Gửi lựa chọn**, mọi lần thêm ảnh, thay nội dung hoặc đổi tên đều chờ studio duyệt. Khách đổi lựa chọn về draft không gỡ khóa duyệt này. Gửi lựa chọn kiểm tra cả revision ảnh và lựa chọn; khi nhận 409, giao diện tải lại và yêu cầu khách xem rồi bấm gửi lại.

Ảnh mới dùng WebP cạnh dài tối đa 2400px, thumbnail 900px và JPG tải xuống 2400px. JPEG gốc chỉ được đọc vào file tạm để xử lý; không lưu vào kho website hoặc backup.

## 4. Những thao tác dễ nhầm

Trong cửa sổ **Duyệt và chọn folder**, mục **Xem nhanh** hiển thị tối đa 6 thumbnail nhỏ của folder hiện tại. Đây chỉ là ảnh mẫu để nhận diện bộ ảnh, chưa nhập vào album; ảnh gốc không được tải cho bước này. Nếu Google chưa có thumbnail hoặc ảnh lỗi, vẫn chọn và kiểm tra folder được. Chi tiết giới hạn/cache và kết quả kiểm tra nằm ở [biên bản duyệt folder](google-drive-folder-browser-2026-10-20.md#xem-nhanh-ảnh-trong-folder).

Dòng tổng quan cho biết **số ảnh JPEG/PNG/WebP trực tiếp · số folder con** và số tệp khác nếu có; không cộng ảnh trong folder con. Số folder đã hiển thị trong danh sách phân trang là thông tin riêng. Có thể chọn hoặc mở folder con trong khi số lượng và thumbnail còn đang tải. `Chưa đếm hết` là kết quả một phần, không phải tổng cuối cùng; lỗi đếm không có nghĩa folder trống. Mở lại folder vừa xem có thể dùng cache 30 giây trong cửa sổ hiện tại; bấm **Làm mới** sau khi thêm/xóa/chuyển file trên Drive. Số lượng phản ánh metadata lúc quét, còn điều kiện nhập từng ảnh vẫn được kiểm ở bước xem trước thay đổi.

Nút chọn/đóng luôn hiện khi cuộn danh sách trên mobile. **Làm mới** tạm khóa trong lúc tải tổng quan để tránh tạo trùng tác vụ. Đổi folder hoặc đóng cửa sổ gửi hủy lượt duyệt cũ; việc này không hủy nhập ảnh của album. Nếu lượt duyệt thất bại hoặc kết nối thay đổi, kết quả cũ bị vô hiệu; bấm **Duyệt folder** để thử lại. Xem [review UI/UX và hiệu năng](google-drive-folder-browser-review-2026-10-20.md) cho các giới hạn thời gian và bằng chứng.

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

Các giới hạn trên là mặc định code local. Worker pilot VPS hiện giới hạn **60 MP / 128 MiB**, CPU 50%, MemoryHigh 512 MiB/MemoryMax 768 MiB cho toàn cgroup, heap Node 256 MiB; nhập production vẫn tắt. JPEG synthetic 42,25 MP/51,2 MiB đã encode hai lần trên VPS (CPU 25%, cgroup đỉnh 283 MiB, khoảng 69 giây/lần); không chứng nhận toàn bộ policy 120 MP hoặc 5.000 JPEG full-resolution. Xem [biên bản tài nguyên và rollout](google-drive-sync-production-release-2026-10-17.md). Đã đo bộ thật 346 JPEG trên local (mục 8), nhưng còn cần đo RAM toàn bộ cây process/CPU/disk và thời gian import 500/5.000 ảnh trên staging trước khi chọn instance. Fixture 5.000 metadata và kiểm thử UI không thay thế phép đo encode 5.000 ảnh full-resolution.

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

## 8. Bằng chứng kiểm thử và phần còn lại

Kiểm thử nội bộ có SQLite/PostgreSQL, Drive giả kiểm pagination/race/permission, encode JPEG thật vượt 20 MiB/40 MP, kill process sau PUT, backup v1/v2, nguồn manual cùng tên, missing/detach/reimport, approval/submission và UI 5.000 ảnh ở 320/390px. Các file kiểm thử Drive nằm trong `studio/tests/drive-*.test.mjs`; luồng trình duyệt trong `drive-sync-browser.smoke.mjs`.

Lệnh kiểm tra:
```sh
npm run check
npm test
STUDIO_TEST_POSTGRES_URL=postgresql://... npm test
node studio/tests/drive-sync-browser.smoke.mjs
node studio/tests/admin-proofing-browser.smoke.mjs
node studio/tests/gallery-sync-browser.smoke.mjs
```

Các smoke trình duyệt cần Playwright có Chromium/Chrome; có thể truyền đường dẫn module qua `STUDIO_PLAYWRIGHT_MODULE`. PostgreSQL test phải là database dùng riêng cho kiểm thử, không production. Báo cáo lần chạy cuối và trạng thái live được ghi tại mục 17 của kế hoạch; không dùng số test R2/backup cũ để suy rằng Drive Sync thật đã qua.

Lượt Drive thật ngày 16/10/2026 đã đạt, bằng chứng ngoài Git tại `output/drive-live-2026-10-16-r7/report.json`:

| Phép đo local | Kết quả |
|---|---|
| Nguồn trực tiếp trong folder | 346 JPEG, 1.986.196.647 bytes (~1,99 GB); file lớn nhất 8.165.163 bytes |
| Preview | 346 hành động thêm; 2,20 giây |
| Import được duyệt | 346/346 ảnh, 44 phút 1,27 giây; batch 1 ảnh |
| Đầu ra | 1.038 rendition đều decode được; 411.983.664 bytes; cạnh dài WebP/JPG ≤2400px, thumbnail ≤900px |
| Sync lần hai | 6 phút 14,13 giây; 346 ảnh không đổi; 0 tải ảnh, 0 PUT, 0 ảnh mới; hash 1.038 objects giữ nguyên |
| Resume | 345 lần tiếp tục giữa batch ở mỗi lượt; 690 lần tạo lại worker trong cùng một Node process |
| RAM đo được | RSS đỉnh của Node cha 304.218.112 bytes (~290 MiB); chưa gồm process encode |
| Toàn lượt | 50 phút 53,04 giây; 3.127 yêu cầu Drive đều GET/200; OAuth token exchange không thuộc bộ đếm này |
| Ảnh gốc trong output | 0; chỉ giữ rendition và dữ liệu kiểm chứng local |

Đây là số đo trên SQLite/storage local với batch 1 để kiểm resume, không phải SLA hay cấu hình worker cloud. Bộ 346 file thật này không có file vượt 20 MiB; bằng chứng nguồn vượt 20 MiB/40 MP thuộc fixture nội bộ riêng. Tạo lại worker giữa batch không thay thế bài kiểm kill process, deploy restart hoặc restore cloud.

Có thể chạy lại harness bằng Node 24 với một thư mục output **mới** (không tái dùng báo cáo đã đạt):
```sh
DRIVE_SYNC_SERVICE_ACCOUNT_FILE=/absolute/private/path/drive-sync-service-account.json \
  node studio/tests/drive-sync-live.smoke.mjs \
  --folder FOLDER_ID --output output/drive-live-new-run --max-files 5000
```
`--max-files` là giới hạn được cho phép nhập, không phải số ảnh đã kiểm chứng. Harness dùng database/storage cách ly, không đọc `.env` của ứng dụng; lượt mới tải lại ảnh vào output mới và có thể mất nhiều thời gian.

Cập nhật 20/10/2026: cổng thay/thu hồi khóa đã hoàn tất ngày 19/10. Studio đã chọn nhận các folder đã chia sẻ, không còn cổng chốt folder cha chung cho chế độ này. Còn cổng trước production: nghiệm thu và phát hành chế độ/phần duyệt folder mới; nghiệm thu thao tác local; đo workload full-resolution 500/5.000 trên staging; rehearsal kill/restart/restore cloud; chốt ngân sách worker; rollout một album draft và lịch. Không chuyển các mục chưa đo thành kết quả “đã hoàn tất”.

## 9. Checklist dùng thử local

Bản bàn giao đã sao chép 346 ảnh và 1.038 rendition sang `output/drive-local-preview`, giữ nguyên bằng chứng r7. Mở [trang quản trị local](http://127.0.0.1:4175/admin) bằng tài khoản local đã tạo; hiện có 1 admin và 2 album, không đặt lại mật khẩu. Chỉ bản sao khởi tạo lần đầu mới yêu cầu tạo email/mật khẩu ít nhất 12 ký tự. [Gallery thử 346 ảnh](http://127.0.0.1:4175/gallery/3632390de2bbbb43ce10aeeefdd37b2e) đã có thể xem, chọn và tải ảnh. Đây là bản sao trên máy này, không phải tài khoản hoặc dữ liệu production.

Khởi động lại từ thư mục dự án bằng **Node 24**:
```sh
npm run drive:preview -- --service-account-file /absolute/private/path/drive-sync-service-account.json
```
Trên máy bàn giao hiện tại, Node mặc định của shell là 23.6.0; dùng runtime 24 đã kiểm chứng:
```sh
/Users/conghoang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  studio/tools/drive-local-preview.mjs \
  --service-account-file "$PWD/.env.drive-sync-service-account.json"
```
Runner chỉ lắng nghe `127.0.0.1:4175`, không nạp `.env` và không kế thừa database/storage/email cloud. Worker chạy cùng tiến trình để phục vụ thử local, lịch luôn tắt; triển khai cloud vẫn dùng process riêng như mục 2. Chạy lại giữ tài khoản và thay đổi thử nghiệm; Ctrl+C dừng web/worker. Bỏ `--service-account-file` nếu chỉ cần xem/chỉnh bản sao và tắt thao tác Drive. Không dùng `npm start` để mở bản thử này vì lệnh đó đọc cấu hình chính của dự án.

1. Vào **Cài đặt → Google Drive**: xác nhận email và **Phạm vi folder → Các folder đã chia sẻ** đúng với nhu cầu đã chốt, giữ folder bắt đầu hợp lệ, **Kiểm tra kết nối** thành công và heartbeat worker mới cập nhật. Đối chiếu [biên bản ngày 20/10](google-drive-folder-browser-2026-10-20.md) để biết bản local đã kích hoạt/kiểm chứng tới đâu; không suy từ source rằng VPS đã đổi chế độ.
2. Mở album thử đã nhập hoặc tạo album draft riêng. Với album mới, chọn **Nguồn ảnh ban đầu → Google Drive**, nhập tên + link folder, **Duyệt và chọn folder → Chọn folder này → Kiểm tra folder → Tạo bộ ảnh**. Thử mở folder con, quay lại bằng đường dẫn và tải thêm nếu có; folder lá vẫn chọn được. Đóng trình duyệt folder khi chưa chọn không tạo album hoặc nhập ảnh. Phần Drive tự mở với folder đã gắn; chọn **Xem trước thay đổi**, kiểm số ảnh rồi **Duyệt và đồng bộ**. Folder đang gắn với bộ 346 ảnh không thể dùng cho album khác; thử tạo bằng folder riêng đã chia sẻ. Với album có sẵn, mở **Nhập ảnh từ Google Drive**. Chờ job `completed`; không coi `queued`, `awaiting_review` hoặc `completed_with_errors` là nhập xong toàn bộ.
3. Kiểm số ảnh, nhãn nguồn Google Drive, trang đầu/cuối, tìm theo tên, lightbox và tải JPG. Kiểm caption/bìa/thứ tự có thể sửa trên web; JPG không vượt 2400px cạnh dài.
4. Bấm **Đồng bộ ngay** lần nữa khi Drive không đổi: số ảnh giữ nguyên, không nhân đôi. Với bộ thử r7, kết quả mong đợi là 346 ảnh không đổi.
5. Trên gallery thử, chọn vài ảnh, **Gửi lựa chọn**, tải lại trang; lựa chọn và trạng thái đã gửi phải giữ nguyên. Kiểm UI ở cả máy tính và điện thoại.
6. Nếu muốn thử thêm/đổi tên/thay bytes/missing: dùng folder riêng chứa bản sao vài JPEG và một album draft riêng. Sau submission, thêm/đổi tên/thay bytes phải chờ duyệt; khi chuyển bản sao khỏi folder thì ảnh web vẫn còn và được báo thiếu. Không sửa bộ ảnh nguồn studio chỉ để chạy checklist.
7. Upload tay một ảnh cùng tên trong album thử: ảnh manual vẫn riêng. Thử ngắt đồng bộ một ảnh Drive: bản hiện tại được giữ để quản lý tay; sync không ghi đè bản đó.

Ghi nhận album/job, thao tác, kết quả mong đợi/thực tế và ảnh màn hình nếu có lỗi; không đính kèm khóa JSON. Giữ lịch tự động tắt trong đợt dùng thử. Kết thúc có thể dừng worker/web; không xóa folder Drive hoặc dữ liệu kiểm chứng đã đạt để “reset”.

## 10. Rà soát source bàn giao ngày 16/10/2026

- Đã khắc phục trường hợp `files.get` bỏ `parents`: worker kiểm lại membership bằng truy vấn trong folder và tên chính xác, đối chiếu theo file ID. Kiểm trước/sau download và trước publish; không suy membership từ inventory đã lưu qua các batch. Thử metadata với Drive thật đã qua; các ca chuyển folder mà version không đổi, trùng tên và restart đã qua trên SQLite/PostgreSQL.
- Giao diện hiển thị số file đã xử lý/tổng và số lỗi. Harness live xuất tiến độ định kỳ, không chỉ chờ log kết thúc.
- Node 24.19.0 + PostgreSQL 16 riêng: **328/328 test pass, 0 fail/skip**. Cú pháp, `git diff --check` và ba smoke Drive/admin/gallery đều đạt. Hai test mới của runner kiểm sao chép, auth, gallery/media, bảo toàn DB nguồn và giới hạn cấu hình local.
- Đã mở trang setup admin và gallery thật của bản sao trên trình duyệt; ảnh lớn hiển thị, không có lỗi console. Chưa tạo tài khoản thay người dùng, chưa bật scheduler hoặc deploy Drive Sync lên production.

Báo cáo r7 phản ánh lượt import trước bổ sung kiểm membership cuối cùng. Kiểm metadata thật và hồi quy revision cuối xác nhận phần sửa mới; không ghi lần import 346 ảnh thành phép đo hiệu năng của revision cuối. Các số đo 500/5.000 ảnh full-resolution và restart/restore cloud vẫn chưa nghiệm thu.

## 11. Rà soát UI/UX và hiệu năng ngày 17/10/2026

Đã bổ sung chọn nguồn Drive khi tạo album, hướng dẫn 3 bước và bảo toàn draft/xác nhận khi panel cập nhật. Catalog được nén gzip; poll gallery không đổi dùng cache hash theo revision; worker gom xử lý unchanged và tiếp tục batch theo thời điểm đủ điều kiện thay vì nghỉ cố định 5 giây. Các thao tác xuất bản ảnh vẫn giữ kiểm quyền, membership và approval.

Hồi quy source mới: **342/342 đạt, không fail/skip**. Fixture gallery 5.000 ảnh trên mạng giả lập 1,6 Mbps: 11,2 → 3,7 giây để có danh sách tương tác; payload 1,62 MB → 93,8 KB. Đây là phép đo metadata/DOM, không phải nhập ảnh full-resolution. Chi tiết phát hiện, số đo, giới hạn và bằng chứng nằm tại [báo cáo UI/UX và hiệu năng](google-drive-sync-ui-perf-review-2026-10-17.md).

## 12. Quy trình mới: tạo album từ link, so sánh và retry

Bổ sung ngày 17/10/2026: form tạo album nhận link folder ngay từ đầu; bấm **Kiểm tra folder**, rồi tạo album và mapping trong cùng giao dịch. Kết quả kiểm tra hết hạn sau 15 phút. Bước sau vẫn là **Xem trước → kiểm tra → Duyệt nhập**. Danh sách album hiện trạng thái/tiến độ/lần sync; preview có bộ lọc loại thay đổi và trạng thái, ảnh trước/sau, thử lại riêng file lỗi. Nếu preview cũ, tạo preview mới thay vì bỏ qua khóa duyệt.

Cache ảnh so sánh riêng tư hết hạn sau 15 phút, tối đa 20 ảnh × 512 KiB; không thuộc snapshot media. Script pg_dump đã thêm loại dữ liệu `drive_comparison_cache`; phải cập nhật script này cùng web và worker khi rollout. Sau restore tạo lại so sánh từ preview mới.

Chi tiết thay đổi, kiểm chứng và phần cần nghiệm thu nằm tại [báo cáo hoàn thiện workflow](google-drive-sync-workflow-2026-10-17.md). Phạm vi nghiệm thu được người dùng chốt: 346 ảnh thật hiện có + 5.000 ảnh giả trước; chưa coi đây là thử tải 5.000 JPEG full-resolution trên production.

Mốc lịch sử ngày 19/10 — bản hiện còn trên VPS, chỉ có chế độ root: form tạo album và panel Drive có link **Mở folder gốc hiện tại trên Drive**. Nếu gặp lỗi folder ngoài root, kiểm folder ảnh có nằm trong phạm vi đó không; quyền Người xem hoặc link công khai không tự mở rộng phạm vi. Để dùng nhiều bộ ảnh, chọn folder cha chung trong Cài đặt → Google Drive, giữ cả các bộ đã liên kết trong phạm vi mới, kiểm kết nối rồi kiểm folder/tạo preview lại. Trạng thái rollout, kiểm thử giao diện và backup mới nằm trong [biên bản ngày 19/10](google-drive-sync-followup-2026-10-19.md).


Ngày 20/10, studio chọn dán bất kỳ link folder nào đã chia sẻ cho tài khoản dịch vụ rồi duyệt/chọn folder nguồn. Bản mới bổ sung chế độ `shared` và trình duyệt folder dùng chung khi tạo album/gắn nguồn; yêu cầu chọn folder cha chung ở mốc 19/10 chỉ còn áp dụng cho chế độ `root`. Thay đổi này chưa phát hành lên VPS; trạng thái kiểm thử/kích hoạt local và bằng chứng bảo toàn bộ ảnh cũ được cập nhật tại [biên bản duyệt folder ngày 20/10](google-drive-folder-browser-2026-10-20.md).

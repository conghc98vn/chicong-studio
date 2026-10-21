# Lịch sử kiểm chứng Drive trước audit 21/10/2026

> REPORT lịch sử; dùng [runbook hiện hành](../google-drive-sync-operations.md) cho thao tác.

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

Cập nhật 20/10/2026: cổng thay/thu hồi khóa đã hoàn tất ngày 19/10. Studio đã chọn nhận các folder đã chia sẻ, không còn cổng chốt folder cha chung cho chế độ này. Source và phần duyệt folder đã phát hành lên production, chế độ `shared` đã kiểm thành công. Pilot album nháp 33 ảnh và no-op đã đạt; worker đã kiểm restart khi rảnh. Backup baseline gồm SQL/media đã sao chép ra máy Mac; restore offline SQLite/local và hash toàn bộ 3.287 object đạt. Đây không phải restore Supabase cloud. Xem [biên bản phát hành](google-drive-sync-production-release-2026-10-20.md); còn UAT người dùng, đo workload full-resolution 500/5.000 trên staging, diễn tập mất process giữa import/restore cloud và chốt ngân sách tải trước mở rộng hoặc bật lịch. Không chuyển các mục chưa đo thành kết quả “đã hoàn tất”.

## 9. Checklist dùng thử local

Production đã có [album nháp 33 ảnh để nghiệm thu](https://chicongphoto.vn/admin#album/3c9ab377835fabf363c1f6b93605885e); xem [biên bản phát hành hiện tại](google-drive-sync-production-release-2026-10-20.md). Checklist dưới đây dành riêng cho bản sao local.

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

Cache ảnh so sánh riêng tư hết hạn sau 15 phút, tối đa 20 ảnh × 512 KiB; không thuộc snapshot media. Script pg_dump hiện loại dữ liệu cả `drive_comparison_cache` và `drive_folder_preview_cache`; script này đã được phát hành cùng web và worker ngày 20/10. Sau restore tạo lại so sánh từ preview mới.

Chi tiết thay đổi, kiểm chứng và phần cần nghiệm thu nằm tại [báo cáo hoàn thiện workflow](google-drive-sync-workflow-2026-10-17.md). Phạm vi nghiệm thu được người dùng chốt: 346 ảnh thật hiện có + 5.000 ảnh giả trước; chưa coi đây là thử tải 5.000 JPEG full-resolution trên production.

Mốc lịch sử ngày 19/10 — bản VPS trước phát hành ngày 20/10, chỉ có chế độ root: form tạo album và panel Drive có link **Mở folder gốc hiện tại trên Drive**. Nếu gặp lỗi folder ngoài root, kiểm folder ảnh có nằm trong phạm vi đó không; quyền Người xem hoặc link công khai không tự mở rộng phạm vi. Để dùng nhiều bộ ảnh, chọn folder cha chung trong Cài đặt → Google Drive, giữ cả các bộ đã liên kết trong phạm vi mới, kiểm kết nối rồi kiểm folder/tạo preview lại. Trạng thái rollout, kiểm thử giao diện và backup mới nằm trong [biên bản ngày 19/10](google-drive-sync-followup-2026-10-19.md).


Ngày 20/10, studio chọn dán bất kỳ link folder nào đã chia sẻ cho tài khoản dịch vụ rồi duyệt/chọn folder nguồn. Bản mới bổ sung chế độ `shared` và trình duyệt folder dùng chung khi tạo album/gắn nguồn; yêu cầu chọn folder cha chung ở mốc 19/10 chỉ còn áp dụng cho chế độ `root`. Thay đổi này đã phát hành lên VPS và kết nối `shared` đã kiểm thành công; trạng thái production hiện tại nằm ở [biên bản phát hành ngày 20/10](google-drive-sync-production-release-2026-10-20.md). Bằng chứng kiểm thử local được giữ tại [biên bản duyệt folder ngày 20/10](google-drive-folder-browser-2026-10-20.md).
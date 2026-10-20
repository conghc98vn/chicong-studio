# Duyệt folder Google Drive — 20/10/2026

Cập nhật hiệu năng tiếp theo: polling 3 → 1 truy vấn, đọc thumbnail không dọn cache bằng DELETE, giảm heartbeat/cleanup khi idle và bỏ khoảng nghỉ sau job; **420/420 test đạt**. Xem [biên bản tối ưu thêm](google-drive-perf-pass-2026-10-20.md). Các số đo ở dưới giữ nguyên theo từng mốc.

## Thay đổi đã được studio chọn

Studio muốn dán bất kỳ link folder nào đã chia sẻ cho tài khoản dịch vụ, duyệt các folder con rồi chọn folder làm nguồn ảnh của album. Không cần gom các bộ ảnh vào một folder cha chung. Folder được chọn là phạm vi nguồn của album đó; chỉ nhập ảnh trực tiếp, không nhập đệ quy và không ghi/xóa trên Drive.

Quyết định này thay yêu cầu chọn một root chung cho tất cả album trong bản kế hoạch trước. Bộ 346 ảnh đã liên kết phải tiếp tục sử dụng được khi thêm bộ khác. Không đổi root sang folder 33 ảnh để làm mất phạm vi đồng bộ của bộ cũ.

## Luồng sử dụng

1. Khi tạo bộ ảnh hoặc gắn nguồn Drive cho album có sẵn, dán link rồi bấm **Duyệt và chọn folder**.
2. Mở folder con, quay lại qua đường dẫn hoặc tải trang folder tiếp theo khi cần.
3. Chọn folder hiện tại. Folder không có folder con vẫn có thể được chọn; ví dụ `film-taybac-trucanh` có 33 JPEG trực tiếp.
4. Kiểm tra folder, tạo/gắn album, xem trước danh sách ảnh và duyệt nhập như trước. Duyệt folder không tự tạo album hoặc nhập ảnh.

Các folder cần được chia sẻ quyền Người xem cho `chicong-drive-sync@chicong-website-backup.iam.gserviceaccount.com`. Đây là duyệt bằng tài khoản dịch vụ của studio; không phải đăng nhập Google của khách hàng, và không tự có quyền đọc mọi file trong tài khoản Google của người dùng.

### Xem nhanh ảnh trong folder

Theo yêu cầu bổ sung ngày 20/10, cửa sổ chọn folder hiển thị tối đa **6 ảnh thu nhỏ** của folder đang mở. Ảnh có kích thước hiển thị 72px, chuyển thành 3 cột trên màn hình hẹp. Chỉ xem ảnh trực tiếp trong folder; tải thêm trang folder không lấy lại bộ ảnh mẫu. Đổi link/folder hoặc đóng cửa sổ sẽ bỏ kết quả cũ. Ảnh lỗi tự ẩn, vẫn chọn folder bình thường.

Worker lấy thumbnail do Google cung cấp, không tải JPEG gốc để xem nhanh. Một truy vấn metadata giới hạn 6 JPEG/PNG/WebP; tối đa 2 thumbnail đồng thời, 3 giây mỗi yêu cầu và 8 giây cho bước tạo preview. Đầu vào tối đa 512 KiB/4 MP; ảnh WebP trả về tối đa 240px/48 KiB. Chỉ nhận URL thumbnail HTTPS từ host Google được cho phép, không đi theo redirect. Theo [tài liệu File của Google Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), thumbnail có thể không tồn tại, link ngắn hạn và ảnh riêng cần xác thực; vì vậy trình duyệt chỉ dùng API nội bộ có phiên admin, không nhận URL Google hay token.

Cache tạm `drive_folder_preview_cache` giữ tối đa 60 ảnh trong 5 phút, gắn với job/folder/generation. Route ảnh kiểm lại trạng thái kết nối và generation, trả `private,no-store`; không đưa pixels vào job progress, kho ảnh album hoặc snapshot backup. Khi phát hành phải cập nhật cả backup runner để nhận diện cache tạm mới.

Đã thử trên folder thật `film-taybac-trucanh`: **6 ảnh hiển thị được, tổng 43.408 bytes**, khoảng 8,1 giây từ mở cửa sổ đến hiển thị đủ trong lần đo này (gồm queue, Google API và polling; không phải cam kết độ trễ). Chrome 1440×1000 và 320×844 không tràn ngang; chọn folder vẫn hoạt động, không có lỗi JavaScript. Truy cập ảnh không đăng nhập trả 401. Trước/sau giữ 2 album, 346 ảnh, 1 mapping; chưa tạo album hoặc import bộ 33 ảnh.

Bằng chứng bổ sung ngoài Git: `output/drive-folder-thumbnails-2026-10-20/live-browser-report.json`, `preview-desktop.png`, `preview-mobile.png`, snapshot `before-thumbnails.sqlite` riêng quyền `0600`. Smoke UI còn kiểm URL độc hại, lỗi thumbnail, phân trang và kết quả trả về muộn. Regression sau bổ sung preview đạt **396/396 test**, không fail hoặc skip, có PostgreSQL riêng; kết quả ghi tại `regression-final.log` trong cùng thư mục. Lượt chạy đầu có hai assertion fixture cũ chưa nhận trường `preview`; đã cập nhật hợp đồng fixture và chạy lại toàn bộ đạt.

### Tổng quan số lượng và tốc độ thao tác

Cửa sổ hiển thị **số ảnh JPEG/PNG/WebP trực tiếp · số folder con**, thêm số tệp khác nếu có. Không cộng ảnh trong folder con. Tổng số folder tách riêng với dòng **Đã hiển thị … folder con** của danh sách phân trang. Khi chưa có kết quả, hiển thị đang đếm; nếu chỉ đọc được một phần, hiển thị `≥ … · Chưa đếm hết`; lỗi đếm không bị hiển thị thành 0 và không chặn chọn folder.

Danh sách và nút chọn được mở ngay khi worker xác minh xong folder. Đếm metadata và lấy thumbnail chạy song song phía sau, cập nhật từng phần. UI giữ nguyên các nút và ảnh đã tải khi polling hoặc tải thêm trang, tránh mất focus và tải lại ảnh. Kết quả hoàn tất được giữ tối đa 12 folder trong 30 giây trong cửa sổ hiện tại; đóng cửa sổ sẽ xóa cache. **Làm mới** bỏ cache và đọc lại Drive; nút này tạm khóa trong lúc tải. Đổi folder hoặc đóng cửa sổ gửi hủy browse job cũ, kể cả ACK đến muộn. Nút chọn sáng lên không đồng nghĩa toàn bộ job đã xong. Các sửa lỗi UI/UX, deadline 15 giây cho enrichment và phép đo điều hướng mới được ghi ở [review bổ sung](google-drive-folder-browser-review-2026-10-20.md).

Bước đếm chỉ lấy metadata cần thiết, tối đa 1.000 mục/trang, 20.000 mục, 30 trang và 12 giây; không tải ảnh gốc. Fixture 5.000 ảnh hoàn tất qua 5 trang metadata. `incompleteSearch`, trang trùng/lặp, lỗi quyền/quota hoặc hết thời gian không được báo là tổng đầy đủ. Đây là số quan sát trong lúc quét, không phải snapshot bất biến: thêm/xóa file trên Drive trong lúc phân trang có thể làm kết quả thay đổi; bấm **Làm mới** sau khi sửa nguồn. Hợp đồng phân trang theo [Google Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).

Lượt đo API local, polling 250ms, một lần mỗi folder:

| Folder | Trước: đến lúc chọn được | Sau: đến lúc chọn được | Sau: có số lượng | Sau: job hoàn tất |
|---|---:|---:|---:|---:|
| `film-taybac-trucanh` — 33 ảnh, 0 folder con | 6,61 giây | 2,58 giây | 4,13 giây | 6,98 giây |
| `02_Nha_Gai_Chup_Truoc` — 346 ảnh, 0 folder con | 22,93 giây | 3,12 giây | 4,40 giây | 6,48 giây |

Độ trễ có queue và Google API, biến động theo mạng; đây là phép kiểm chứng khả năng thao tác sớm, không phải benchmark nhiều mẫu hay cam kết tăng tốc tổng thời gian. Trên Chrome thật với polling UI 1,5 giây, folder 33 ảnh chọn được sau 3,34 giây, hiện số lượng sau 4,60 giây, đủ 6 thumbnail sau 7,61 giây. Mở lại từ cache mất 34ms, không tạo job mới; bấm Làm mới tạo đúng một job và lấy lại số đếm đúng. Hai lượt browse/refresh tải tổng 12 thumbnail, không tải lại thumbnail khi dùng cache.

Regression sau bổ sung tổng quan đạt **404/404**, không fail hoặc skip, gồm PostgreSQL 17 riêng và SQLite. Smoke UI kiểm số đầy đủ/một phần/chưa rõ, chọn trước khi enrichment xong, cache/làm mới, giữ DOM/focus và màn hình 320px. Luồng Chrome thật đạt ở 1440×1000 và 320×844; ảnh mẫu, số lượng và nút chọn đọc được, không tràn ngang hoặc lỗi JavaScript. Giữ nguyên 2 album, 346 ảnh, 1 admin, 1 mapping; không import ảnh khi nghiệm thu. Database PostgreSQL tạm của lượt này đã dừng và xóa.

Bằng chứng riêng ngoài Git tại `output/drive-folder-overview-2026-10-20/`: `before-overview.sqlite`, `baseline-performance.json`, `live-api-report.json`, `live-ui-report.json`, `regression-tests.log`, `overview-desktop.png`, `overview-mobile.png`, `overview-mobile-footer.png`. Thay đổi vẫn chỉ chạy local; chưa phát hành production. Fixture 5.000 metadata không thay cho benchmark nhập 5.000 JPEG full-resolution.

## Hợp đồng triển khai

- Connection có chế độ `root` hoặc `shared`. Dữ liệu cũ mặc định `root`; không tự nới phạm vi chỉ vì cập nhật mã.
- `shared` nhận các folder tài khoản dịch vụ đọc được. Folder mở đầu được giữ làm điểm bắt đầu mặc định; không còn là giới hạn chung của mọi album.
- Đổi chế độ tăng generation và vô hiệu các job/preview cũ theo cơ chế hiện tại; giữ album, ảnh và mapping đã có.
- Server web chỉ queue tác vụ đã xác thực. Worker giữ credential, đọc metadata và danh sách folder theo trang; trình duyệt không nhận credential/token Google.
- Xem trước, so sánh, nhập và kiểm lại trước khi xuất bản ảnh đều dùng cùng chế độ phạm vi. Các kiểm tra quyền, file membership, phiên bản, submission và approval vẫn áp dụng.
- Root mode được sửa trường hợp Google thiếu `parents`: chỉ chấp nhận khi tìm được đường dẫn folder và kiểm lại membership mới. Nếu không đủ bằng chứng thì báo chưa xác minh được, không khẳng định chắc chắn nằm ngoài root.

## Kiểm chứng và phát hành

Đã hoàn tất triển khai và kiểm thử local ngày 20/10/2026. Mở [admin local](http://127.0.0.1:4175/admin), tải lại trang để nhận giao diện mới, rồi thực hiện luồng trên. Tài khoản đăng nhập đã cấp vẫn dùng được.

Trước migration đã lưu SQLite riêng tại `output/drive-folder-browser-2026-10-20/before-folder-browser.sqlite`, quyền `0600`, ngoài Git. Đã khởi động lại runner local, đổi phạm vi sang `shared` bằng API admin và kiểm tra kết nối thành công; generation tăng từ 1 lên 2. Giữ nguyên folder bắt đầu cũ, 2 album, 346 ảnh, 1 admin và mapping hiện có. Không tạo album hoặc nhập thêm ảnh khi nghiệm thu trình duyệt folder. Worker thủ công bật, scheduler tắt. Runtime hiện tại được ghi tại `output/drive-local-preview/runtime-20261020.json`; runner không tự khởi động cùng máy.

| Kiểm chứng | Kết quả |
|---|---|
| Regression toàn bộ `studio/tests/*.test.mjs` | Mốc review UI/UX: 408/408 đạt; lượt tối ưu tiếp theo: [420/420 đạt](google-drive-perf-pass-2026-10-20.md), không bỏ qua, PostgreSQL 17 riêng và SQLite |
| Syntax và khoảng trắng diff | Đạt |
| 4 smoke trình duyệt: folder browser, album entry, panel UX, panel polling | Đạt; gồm phân trang, breadcrumb, tên có HTML, callback cũ, lỗi quyền, đóng modal, giữ draft và màn hình 320px |
| Review độc lập về phạm vi, generation, tạo album và UI | Không phát hiện blocker trong phạm vi review |
| Drive thật: folder `film-taybac-trucanh` | Duyệt và kiểm tra thành công ở shared mode; 33 JPEG trực tiếp, không có folder con |
| Drive thật: folder cũ `02_Nha_Gai_Chup_Truoc` | Duyệt thành công; mapping bộ 346 ảnh giữ nguyên |
| Luồng UI thật trên localhost | Dán link → mở trình duyệt → chọn folder → kiểm tra thành công; Chrome 1440×1000 và 320×844, không lỗi JavaScript hoặc tràn ngang |
| Dữ liệu sau nghiệm thu | 2 album, 346 ảnh, 1 mapping; không có job đang chạy/chờ; không tự tạo/nhập ảnh |

Bằng chứng riêng ngoài Git trong `output/drive-folder-browser-2026-10-20/`: `regression-tests.log`, `local-live-report.json`, `local-browser-report.json` và ảnh chụp `local-picker-desktop.png`, `local-picker-mobile.png`, `local-folder-checked-mobile.png`. Database PostgreSQL tạm dành riêng cho lượt kiểm thử đã được dừng và xóa theo cấu hình container `--rm`.

Hai folder thật đang thử đều là folder lá. Duyệt folder lồng nhau và phân trang được xác minh bằng fixture; lượt này chưa duyệt cây folder lớn trên Drive thật, chưa import bộ 33 ảnh và chưa chạy benchmark 5.000 JPEG full-resolution. Người dùng có thể chọn ngay folder lá để tạo bộ ảnh, hoặc dán link folder cha có các folder con để duyệt lựa chọn.

Production vẫn dùng bản phát hành ngày 19/10, nhập Drive và lịch tự động tắt; thay đổi ngày 20/10 chưa lên VPS. Khi phát hành cần migration có kiểm soát và cập nhật web/worker/backup runner cùng revision, sau đó nghiệm thu pilot qua storage thật. Kết quả ngày 19/10 được giữ tại [biên bản trước](google-drive-sync-followup-2026-10-19.md).

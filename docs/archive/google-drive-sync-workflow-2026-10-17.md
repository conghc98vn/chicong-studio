# Hoàn thiện quy trình Google Drive — 17/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Phạm vi: studio dùng service account chỉ đọc; mỗi album gắn một folder trực tiếp. Ảnh gốc ở Drive, khách tải JPG tối đa 2400px. Người dùng đã chọn tiếp tục nghiệm thu với 346 ảnh thật hiện có và kiểm tra quy mô 5.000 ảnh bằng dữ liệu giả trước.

## Những thay đổi đã triển khai

| Phần | Hành vi mới |
|---|---|
| Tạo bộ ảnh | Chọn Google Drive, điền tên và link folder trong cùng form. Kiểm tra quyền đọc trước khi tạo; kết quả có hiệu lực 15 phút. |
| Tạo và gắn folder | Album, slug, mapping và biên nhận yêu cầu lưu cùng transaction. Folder trùng, kết quả cũ hoặc lỗi ghi không để lại album rỗng. Gửi lại cùng yêu cầu trả đúng album đã tạo. |
| Danh sách album | Hiện tiến độ, chờ duyệt, lỗi, tạm dừng và lần đồng bộ thành công. API dùng một truy vấn, không tải danh sách ảnh. So sánh ảnh không che trạng thái đồng bộ. |
| Xem trước | Thống kê theo loại thay đổi và trạng thái; kết hợp hai bộ lọc, phân trang 50 file. Giữ xác nhận gắn với đúng preview khi đổi trang/lọc. |
| So sánh | Với file thay nội dung, mở ảnh hiện tại và bản mới cạnh nhau. Worker chỉ tải theo yêu cầu; không xuất bản ảnh vào album. Hai ảnh đều cần phiên admin, kiểm revision và trả `private,no-store`. |
| Thử lại | Chỉ các file lỗi có thể xử lý an toàn được đưa lại vào hàng đợi. Giữ ảnh đã lưu, biên nhận và ngân sách retry; không làm sống lại lượt đã hủy. Khi nguồn, mapping, lựa chọn hoặc approval đổi, yêu cầu preview mới. |
| Mạng chập chờn | Polling thử lại theo khoảng 4/8/16/30 giây, tự hồi phục sau lỗi thao tác; dừng khi tab ẩn, panel rời DOM hoặc hết phiên. Không poll liên tục khi không có việc. |

Tạo album không tự nhập ảnh, không tự duyệt và không bật lịch. Sau khi tạo, công cụ Drive mở sẵn để studio **Xem trước → kiểm tra → Duyệt nhập**. Ảnh upload tay và gallery đã gửi lựa chọn vẫn áp dụng các quy tắc bảo toàn đã chốt.

## Riêng tư và sao lưu

- Biên nhận tạo album dùng salted scrypt cho nội dung yêu cầu; không lưu SHA-256 nhanh chứa mật khẩu gallery.
- `drive_comparison_cache` là cache tạm trong database chung web/worker: tối đa 20 thumbnail, mỗi ảnh tối đa 512 KiB, TTL 15 phút. Bảng tự khởi tạo và bật RLS trên PostgreSQL; cleanup khi worker/request chạy. TTL không phải một dịch vụ xóa chạy đúng từng giây khi hệ thống đã dừng.
- Cache được nhận diện là bảng tạm hợp lệ và không thuộc snapshot media schema v2; bảng không nhận diện khác vẫn chặn backup. `scripts/backup-db.sh` loại dữ liệu bảng này bằng `--exclude-table-data='*.drive_comparison_cache'`; schema vẫn có thể ở trong dump. Đã kiểm chứng với `pg_dump` PostgreSQL 16: nội dung cache bị loại, dữ liệu lâu dài vẫn còn. Khi triển khai cần cập nhật cả script backup trên máy chủ. Vòng lặp backup tính danh sách reference và lập bảng tra object một lần, thay cho việc quét/sắp xếp lại theo từng file.
- Cache chỉ chứa thumbnail; snapshot media không chứa khóa service account hoặc JPEG nguồn. Snapshot vẫn là dữ liệu riêng tư của ứng dụng, gồm thông tin quản trị và gallery, nên phải được bảo vệ. Khóa service account thay thế đã được cài khi rollout; khóa cũ từng gửi trong chat đã thu hồi ngày 19/10/2026; xem [cập nhật tiếp tục](google-drive-sync-followup-2026-10-19.md).

## Kiểm chứng và giới hạn

- Hồi quy toàn bộ source cuối, gồm tối ưu backup, với Node 24.19.0, SQLite và PostgreSQL 16: **373/373 đạt, 0 fail/skip**, 54,57 giây; xem `output/drive-workflow-release-regression.log`. Fingerprint source và bằng chứng được lưu ở `output/drive-workflow-release-verification.json`; HEAD Git không đại diện toàn bộ working tree chưa commit.
- Browser: tạo album + folder check, lỗi link, chống tạo trước khi check, không tự import; danh sách trạng thái; bộ lọc/đếm/phân trang; so sánh riêng tư, bàn phím/mobile, đóng modal ngừng poll; retry giữ biên nhận; polling qua nhiều lỗi mạng.
- Hồi quy gallery/admin: 5.001 ảnh, DOM giới hạn 90/120 ảnh mỗi trang, tìm kiếm, lựa chọn/submission thay đổi đồng thời, không mất focus/draft/upload đang chờ.
- Đo gallery 5.000 ảnh: desktop local 250,6 ms; mạng mobile giả lập 1,6 Mbps, RTT 100 ms và CPU chậm 4 lần: 3.679,9 ms. Chỉ là thời gian metadata/DOM trong fixture, không phải SLA mạng khách hoặc thời gian nhập ảnh gốc.
- Metadata Drive thật ngày 17/10 giờ Việt Nam: 346 file, 346 nguồn local, không thiếu và không phát hiện đổi nội dung. Chỉ đọc metadata, không tải lại gần 2 GB và không thay đổi Drive.
- Quy trình 5.000 ảnh giả chạy trọn vẹn trên SQLite/storage local: 5.000 ảnh, 5.000 nguồn và biên nhận, 15.000 rendition. Dừng hợp tác sau ảnh 1.007 rồi tạo worker mới tiếp tục 3.993 ảnh; không tải lại phần đã hoàn thành. Sync không đổi có 0 tải và 0 ghi mới. Sau khi xóa kho nguồn và bản backup đầu, khôi phục từ bản export độc lập và đối chiếu bytes đủ 15.000 object; connection/lịch tắt, mapping pause, approval cũ vô hiệu.
- Bản thử local được khởi động lại bằng source mới, giữ nguyên 2 album, 346 ảnh, 1 admin. Lịch tự động vẫn tắt.

Bằng chứng: `output/drive-workflow-real-metadata.json`, `output/drive-entry-workflow-browser.log`, `output/drive-workflow-panel-browser.log`, `output/drive-workflow-polling-browser.log`, `output/drive-workflow-integration-browser.log`, `output/drive-workflow-gallery-performance.log`, `output/drive-comparisons-postgres.log`, `output/drive-workflow-audit-regression.log`, `output/drive-comparison-backup-exclusion.sql`. Ảnh chụp giao diện ở `output/drive-ux-review/`. Container PostgreSQL riêng của lượt kiểm thử đã được dừng và xóa; server UAT local được giữ chạy.

### Quy mô 5.000 ảnh giả

Harness: `node studio/tests/drive-scale-workflow.smoke.mjs --count 5000`; dùng database/storage tạm riêng, không nạp credential hay ảnh thật. Báo cáo local cuối: `output/drive-scale-workflow-2026-10-16T18-06-19-381Z-sqlite-5000/report.json`, trạng thái `passed`, không findings hoặc fallback schema.

| Pha local | Thời gian |
|---|---:|
| Nhập 5.000 ảnh, gồm tiếp tục sau gián đoạn | 68,736 giây |
| Backup 15.000 object reference | 36,209 giây |
| Khôi phục offline | 13,950 giây |
| Toàn lượt, gồm kiểm dữ liệu và bytes | 139,570 giây |
| RSS đỉnh tiến trình | Khoảng 673 MiB |

Fixture lặp một JPEG 96×64 dưới 5.000 file ID khác nhau; encode một lần rồi tái dùng rendition khi đi qua ingest thật. Media có 15.000 reference nhưng chỉ 3 blob độc nhất sau khử trùng. Do đó phép thử xác nhận quy mô catalog, receipts, resume và tính toàn vẹn backup/restore; không đo encode full-resolution, dung lượng backup nhiều GB, mạng/quota Google hoặc object storage cloud. Worker được tạo lại trong cùng tiến trình, không phải thử SIGKILL/mất máy.

### Diễn tập cách ly trên VPS iNET

Bản source đã tối ưu backup được chạy lại ngày 17/10/2026 trên Linux x64, Node 24.22.0, database SQLite và storage tạm: **5.000/5.000 ảnh đạt**, restore đối chiếu bytes đủ **15.000 object**, không findings hoặc fallback schema. Source `media-backup.mjs` có SHA-256 `3283619fe07fac3de9171dbc658fbb07477a96c53b5c2d68b7f113ee768a0c4a`, đã đối chiếu giữa máy local và gói chạy VPS.

| Pha VPS | Thời gian |
|---|---:|
| Nhập 5.000 ảnh, gồm tiếp tục sau ảnh 1.007 | 150,791 giây |
| Backup 15.000 object reference | 66,604 giây |
| Export và kiểm bản độc lập | 32,801 giây |
| Khôi phục offline | 39,423 giây |
| Toàn lượt | 317,997 giây |

Lượt thử dùng systemd service tạm: `CPUQuota=25%`, `MemoryMax=512M`, Node heap 256 MiB, `Nice=10`, mạng riêng không truy cập API ngoài và filesystem chỉ ghi trong thư mục thử. RSS lấy mẫu cao nhất khoảng 350 MiB; `process.resourceUsage().maxRSS` khoảng 360 MiB. Không suy các giá trị này thành cấu hình đủ cho JPEG full-resolution.

Lượt trước ở `output/vps-drive-workflow-qa/` dùng source backup chưa tối ưu và dừng trong pha backup 5.000 ảnh; đó là bằng chứng lịch sử chưa hoàn tất. Lượt mới ở `output/vps-drive-workflow-final-qa/` đã khép lại kiểm chứng quy trình synthetic trên Linux. Báo cáo đầy đủ: `output/vps-drive-workflow-final-qa/output/drive-scale-workflow-2026-10-16T21-51-35-268Z-sqlite-5000/report.json`. Thư mục/service thử đã dọn; health production trước và sau đều trả `{"ok":true}`. Không thay code, cấu hình, database hoặc ảnh production. Các giới hạn fixture nêu trên vẫn áp dụng; chưa nghiệm thu PostgreSQL/storage cloud và workload full-resolution trong cùng lượt này.

## Thử ngay

Mở `http://127.0.0.1:4175/admin`, dùng tài khoản local đã tạo. Tạo bộ ảnh → Google Drive → tên bộ ảnh + link folder → Kiểm tra folder → Tạo bộ ảnh → Xem trước → Duyệt nhập.

Folder đã gắn với bộ ảnh 346 ảnh sẽ bị từ chối khi dùng cho album khác; hãy mở album đó để thử cập nhật, hoặc dùng folder con/khác đã chia sẻ. Có thể thử các thay đổi trên folder bản sao riêng. Không đổi/xóa nguồn thật chỉ để tạo tình huống test.

## Hạ tầng đang phục vụ khách

Source web/worker/backup mới đã lên VPS iNET; health, homepage, admin và asset Drive trả 200. PostgreSQL/Supabase giữ 8 album, 1.190 ảnh, 1 admin; chưa có mapping Drive. Backup baseline 3.287 object đã verify và media maintenance đã mở lại. **Nhập Drive production và lịch vẫn tắt**; worker systemd đang kiểm kết nối, chưa enable khởi động cùng máy.

Đã bổ sung đo encoder JPEG synthetic 42,25 MP/51,2 MiB trên VPS: hai lượt khoảng 69 giây, cgroup đỉnh 283 MiB với CPU 25%/MemoryMax 512 MiB. Pilot cài giới hạn 60 MP, CPU 50%, MemoryMax 768 MiB. Đây không phải thử 5.000 ảnh full-resolution hoặc nghiệm thu import qua storage production.

Cập nhật 19/10/2026: khóa thay thế đã cài cho worker/local UAT; khóa cũ đã thu hồi. Tiến trình mới dưới user worker trên VPS xác minh lại đọc/list cả hai folder thành công. Folder mới 160 JPEG đọc được nhưng ở ngoài root; chưa tự đổi phạm vi. Chi tiết backup, rollback, giới hạn và các cổng còn lại ở [biên bản rollout production](google-drive-sync-production-release-2026-10-17.md).

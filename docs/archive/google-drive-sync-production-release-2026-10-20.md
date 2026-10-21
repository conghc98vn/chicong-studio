# Phát hành Google Drive Sync lên production — 20/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

**Trạng thái: đã phát hành và nghiệm thu nhập Drive thủ công trên production ngày 20/10/2026.** Pilot 33 ảnh hoàn tất, đồng bộ lại không tạo ảnh trùng; worker đã bật khởi động cùng máy và kiểm restart dịch vụ. Lịch đồng bộ tự động vẫn tắt. Đây là nghiệm thu pilot nhỏ, chưa chứng nhận workload 500–5.000 JPEG full-resolution.

## Phiên bản và môi trường

| Mục | Giá trị đã xác minh |
|---|---|
| Website | https://chicongphoto.vn |
| Hạ tầng | iNET VPS; cơ sở dữ liệu và media Supabase |
| GitHub | `main`, PR [#2](https://github.com/conghc98vn/chicong-studio/pull/2) đã merged |
| Commit runtime đã deploy | `5a9e83c0efd2bce1e18789cf1d227a7ea3414e2d` |
| Commit đã qua CI và vào main | `87a756c2ae31225094e692b20cd8970ee776add5` |
| Release ID | `20261020T085406982Z-3225e599` |
| Source hoạt động | `/var/www/chicongphoto` |
| Source trước phát hành | `/var/www/chicongphoto-before-drive-20261020` |
| Đối chiếu runtime | 102 file đã xác minh |

Nhánh phát hành đã hợp nhất commit R2 có sẵn trên GitHub, giữ lịch sử trước đó. Các commit từ runtime tới `87a756c` chỉ cập nhật tài liệu và sửa bước chuẩn bị test trong checkout sạch; không đổi 102 file runtime. Tài liệu nghiệm thu cuối được bổ sung sau commit này. Phát hành chạy trên VPS iNET, tiếp tục dùng PostgreSQL và private Storage của Supabase.

## Backup và chuyển phiên bản

Đã khóa thao tác ghi media, dừng worker và chờ writer kết thúc trước khi chụp backup. Trong giai đoạn này, web cũ vẫn phục vụ đọc ảnh. Thư mục backup source, cấu hình, SQL và bằng chứng của lượt phát hành là `/var/backups/chicongphoto/releases/drive-20261020`; không đưa credential hoặc nội dung cấu hình bí mật vào tài liệu/Git.

Snapshot media dùng lại kho blob `/var/backups/chicongphoto/releases/drive-20261017/media`, run **`2026-10-20T08-53-02-159Z-13197ff8-b5c5-4de0-b8c4-5e1d2db272ff`**. Đã verify đúng snapshot này với **3.287 object**. SQL baseline và toàn bộ kho backup media đã được chép về máy Mac trong `output/drive-production-release-2026-10-20/private-backup/`, ngoài Git, thư mục quyền 0700.

Đã verify bản sao ngoài VPS, phục hồi offline sang SQLite/media local và kiểm hash đủ 3.287 object. Bản phục hồi giữ 8 album, 1.190 ảnh, 1 admin, không có session/mapping/writer/cleanup tồn dư; foreign key hợp lệ và fingerprint ảnh gốc khớp production. Chỉ xóa working copy phục hồi sau khi kiểm xong; SQL và kho backup vẫn giữ. Đây **không phải diễn tập restore Supabase cloud**. Snapshot là baseline trước pilot, chưa chứa 33 ảnh nhập sau đó. Manifest backup ghi `appRevision=unknown` vì VPS không có Git; fingerprint 102 file runtime được lưu riêng trong bằng chứng phát hành.

Khoảng chuyển dịch vụ đo được: **15:59:41 → 15:59:48 ngày 20/10/2026, UTC+07:00 (7 giây)**. Sau migration, dữ liệu hiện có giữ nguyên **8 album, 1.190 ảnh, 1 admin**. Health, trang admin và thumbnail hiện có trả HTTP 200.

## Trạng thái vận hành

- Web đã bật `DRIVE_SYNC_ENABLED=true` để dùng đồng bộ thủ công.
- Worker systemd có heartbeat mới, trạng thái idle sau nghiệm thu; đã enable cùng máy và restart thành công. PM2 đã lưu process list, dịch vụ `pm2-root` cũng enabled. Chưa reboot VPS trong lượt này.
- `DRIVE_SYNC_SCHEDULER_ENABLED=false`: chưa bật lịch đồng bộ tự động.
- Giữ giới hạn nguồn **60 megapixel / 128 MiB mỗi ảnh** trên worker. Khách nhận JPG tối đa 2400px; bản gốc giữ trên Drive.
- Kết nối production active, `folder_scope=shared`, generation 2: nhận folder bất kỳ đã chia sẻ cho tài khoản dịch vụ.
- Đã kiểm flag từ API web đang chạy và environment của process worker thực tế: nhập thủ công bật, scheduler tắt. Không chỉ dựa vào nội dung file cấu hình.

## Kết quả nghiệm thu

| Hạng mục | Kết quả |
|---|---|
| Heartbeat worker | Mới, idle sau restart; không còn job queued/running |
| Media maintenance | Đã mở khóa; 0 writer, 0 cleanup pending |
| Shared scope và kết nối | Active; kiểm kết nối thành công |
| Duyệt folder thật | Đúng 33/346 ảnh, 0 folder con; kiểm 6 thumbnail mỗi folder |
| Pilot | 33 ảnh Google Drive trong album draft; apply cuối hoàn tất, không có item lỗi |
| Đồng bộ lại | 33 unchanged, không add/replace/rename/missing/conflict; fingerprint ảnh không đổi |
| Rendition | Decode đủ 33 thumbnail, 3 WebP lớn và 1 JPG mẫu; ảnh lớn/JPG kiểm được không vượt 2400px |
| Riêng tư album draft | Anonymous album API, thumbnail, ảnh lớn và download đều HTTP 404, no-store |
| Khởi động dịch vụ | Worker enabled; restart khi idle thành công, PID cũ kết thúc, PID mới hoạt động; chưa thử reboot hoặc kill giữa import |
| Dữ liệu cuối | 9 album, 1.223 ảnh, 1 admin, 1 mapping Drive; 1.190 ảnh upload tay giữ nguyên fingerprint |

Album giữ ở trạng thái nháp để studio kiểm: [Drive production verification 2026-10-20](https://chicongphoto.vn/admin#album/3c9ab377835fabf363c1f6b93605885e). Folder thử đã gắn với album này; mở album hiện có để kiểm, không tạo album thứ hai từ cùng folder.

Lượt apply đầu dừng an toàn với `drive_preview_stale` sau 7 ảnh. Kiểm lại 33 file thấy 3 file đổi `version`, còn checksum/tên/kích thước/MIME/quyền tải không đổi; chưa xác định tác nhân đổi version. Giữ nguyên guard kiểm nguồn, không sửa DB để bỏ qua: tạo preview mới qua API, thấy 7 unchanged + 26 add và duyệt lại một lần. Apply này hoàn tất lúc **16:24:58 +07**, mất **13 phút 38 giây** tính từ tạo job cho phần 26 ảnh còn lại; đây không phải thời gian nhập trọn bộ 33 ảnh. Lịch sử job đầu bị dừng vẫn được giữ.

Bộ nguồn 33 JPEG có tổng **350.069.257 byte**. Worker cgroup đạt đỉnh **213.295.104 byte (~203 MiB)** trong khoảng chạy trước restart, `NRestarts=0`. Máy đang giới hạn CPU worker 50%, MemoryHigh 512 MiB/MemoryMax 768 MiB, heap Node 256 MiB. Số đo pilot này không đủ để ngoại suy SLA cho bộ 5.000 ảnh.

## Kiểm chứng source và giới hạn

CI commit `87a756c` đã đạt kiểm tra cú pháp và **420/420 test, 0 skipped** trên Node 24/PostgreSQL 16: [PR run](https://github.com/conghc98vn/chicong-studio/actions/runs/39400134974) và [main run](https://github.com/conghc98vn/chicong-studio/actions/runs/39400498893). CI ban đầu phát hiện test local preview giả định thư mục `output` đã tồn tại; đã tái hiện trên checkout sạch, thêm bước tạo thư mục và chạy lại thành công. Lượt [tối ưu trước phát hành](google-drive-perf-pass-2026-10-20.md) có thêm smoke UI/Drive thật. Script backup đã loại dữ liệu của cả hai bảng cache Drive khỏi SQL dump.

Chưa có nghiệm thu nhập **500/5.000 JPEG full-resolution thật**, kill giữa import hoặc restore cloud; fixture 5.000 metadata không đại diện cho thời gian tải/encode hoặc tài nguyên vận hành. Browse vẫn có thể chờ batch import đang chạy. Studio tiếp tục UAT với album nháp trước khi tăng tải; cần đo workload và chốt tài nguyên trước mở rộng. Lịch tự động chưa được người dùng chốt và vẫn tắt.

Nếu cần rollback, dừng writer và worker trước, giữ Drive tắt khi quay về source cũ. Sau khi đã có dữ liệu mới, không khôi phục SQL baseline đè lên dữ liệu khách hàng; phải đánh giá schema và ownership media hiện tại trước khi phục hồi.

Bằng chứng local của phát hành: `output/drive-production-release-2026-10-20/` (ngoài Git), gồm `deployed-source-manifest.json`, `pilot-resume-1792487506110.json`, `final-runtime-check.json`, `final-status.json`, `final-process-verification.json`, `worker-before-restart.txt`, `worker-after-restart.txt`, `offsite-media-verify.json` và `offline-restore-verification.json`. Session kiểm thử đã xóa. Báo cáo chỉ ghi đường dẫn và kết quả, không ghi token, khóa hoặc mật khẩu.

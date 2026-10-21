# Chuyển kho ảnh production sang R2 — 21/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Trạng thái: hoàn tất. Website và worker đang dùng R2; đã mở khóa media và nghiệm thu. Database tiếp tục ở Supabase; không xóa kho Supabase.

## Chuẩn bị đã kiểm trực tiếp

- Production: VPS iNET; web PM2 `chicong-photo`, worker systemd `chicong-drive`.
- Kiểm kê Supabase: 3.390 object / 1.433.303.692 byte; 3.386 object được tham chiếu; 0 thiếu, 4 không được tham chiếu. Không xóa object dư.
- Dữ liệu trước chuyển: 9 album, 1.223 ảnh, 1 admin, 7 lượt chọn.
- R2: bucket `chicong-production`, APAC, Standard; public development URL tắt, không custom domain, không CORS. Chỉ có quy tắc hủy multipart chưa hoàn thành sau 7 ngày; không TTL xóa ảnh.
- Chủ tài khoản đã duyệt token `chicong-production-runtime-2026-10-21`: Object Read & Write chỉ trên bucket production. Secret lưu file 0600 ngoài Git, không ghi vào báo cáo.
- Token staging chỉ có quyền `chicong-staging` và hết hạn 23/10; không dùng làm credential production.
- Kiểm tra R2 thật bằng ảnh synthetic: PUT/GET checksum khớp, metadata đúng, DELETE/GET404 đạt; truy cập S3 không ký bị từ chối.
- 11/11 kiểm thử R2/backup đạt. 49 bài quyền truy cập/download đạt, 2 PostgreSQL-only skip vì không cấu hình DB test.

## Backup và khôi phục

Snapshot hiện tại: `2026-10-21T02-19-52-867Z-83c5216a-aee7-4e92-b7e4-ed0ce9e716e8`, 3.386 object / 1.431.587.015 byte.

Kho backup VPS: `/var/backups/chicongphoto/releases/drive-20261017/media` (giữ nhiều snapshot, gồm bản 20/10 và 21/10).

Bản độc lập trên máy: `output/r2-production-2026-10-21/backup`. Đã verify SHA-256 và restore local vào `restored-current`: 9 album / 1.223 ảnh, integrity_check=ok, 0 foreign-key violation. Đây là khôi phục ứng dụng vào SQLite offline, không phải full Supabase platform restore. Sessions bị thu hồi, Drive import bị tắt trong bản thử.

## Quy trình thực hiện

Sao chép nền từ backup; khóa media và drain; dừng worker; đối chiếu mapping hiện tại với snapshot; copy/verify cuối; đổi binding trong DB; đổi env web và worker; restart; smoke; mở khóa.

Công cụ vận hành riêng trong `output/r2-production-2026-10-21/` và `/var/backups/chicongphoto/`: sao chép 8 file song song, mỗi file ghi journal trước PUT, không tự retry PUT không rõ kết quả; GET kiểm hash/bytes và HEAD kiểm MIME/hash metadata. Dừng cấp việc mới khi có lỗi và chờ các lượt đang chạy kết thúc. Chỉ đổi binding khi báo cáo cuối khớp snapshot/target/mapping dưới lease còn hiệu lực, queue và writer đã rỗng.

Công cụ sao chép tuần tự ban đầu đã dừng ở ranh giới an toàn sau 96 file: tạm dừng process, xác minh journal không có PUT pending, sau đó kết thúc process. Không bỏ qua trạng thái ghi chưa rõ kết quả.

Rollback config trước chuyển: `/var/backups/chicongphoto/r2-cutover-20261021/web-before.env` và `worker-before.env`. Không đưa secret vào Git.

## Vận hành sau chuyển

- Backup DB cron 03:00 hiện có không chứa bytes ảnh; chưa tự bật lịch backup media mới.
- Không xóa Supabase Storage hoặc project. Khi đã có ảnh ghi mới trên R2, rollback phải đồng bộ delta ngược dưới khóa và đổi binding; không chỉ đổi `.env`, không restore DB cũ lên dữ liệu hiện tại.
- Bằng chứng riêng tư và script: `output/r2-production-2026-10-21/` (Git ignore). Manifest chứa thông tin khách và hash xác thực; giữ riêng tư.

## Kiểm chứng sau đổi nguồn

- Copy cuối: 3.386/3.386 object được GET kiểm SHA-256/bytes, HEAD kiểm MIME/hash metadata; 0 dư. Hoàn tất 09:34:03 UTC+7, mất 137 giây ở lượt cuối.
- Mapping DB trước switch khớp snapshot đã verify. Chụp thêm toàn bộ dữ liệu ứng dụng dưới lease vào `database-final.json`; không restore hoặc chuyển database.
- Web `.env` và `/etc/chicongphoto/drive-worker.env` đã dùng R2; DATABASE_URL, cờ Drive thủ công/scheduler không đổi. Khởi động lại PM2, systemd worker và lưu PM2 process list.
- Worker heartbeat mới: idle, storage_identity là bucket R2 production.
- HTTP origin: health, trang chủ, admin, ảnh public/thumbnail, portrait, tải JPEG có lựa chọn đạt; bytes ảnh khớp storage. Ảnh draft bị từ chối 404.
- Probe synthetic qua pipeline ứng dụng: upload, chặn ảnh riêng khi chưa đăng nhập, sai mật khẩu, mở khóa đúng mật khẩu, ảnh lớn/thumbnail/JPEG, logout và từ chối cookie đã thu hồi đều đạt. Album/file thử đã dọn, không thay ảnh khách.
- Health qua HTTPS domain thật trả `{"ok":true}`.
- `.env.example`, `render.yaml`, `HOSTING.md` cập nhật kho R2. Không deploy Render.

Trạng thái cuối: owner=null, deadline=0, 0 writer, 0 unknown write, cleanup=0; số liệu sau dọn probe vẫn 9 album / 1.223 ảnh / 1 admin / 7 lượt chọn. Website đã nhận lại thao tác ghi ảnh. Public portfolio và ảnh qua domain thật được kiểm sau mở khóa.

## Kiểm tra lại và dọn dẹp — 21/10/2026, 10:07 UTC+7

- Đọc lại toàn bộ 3.386 file từ R2 bằng chế độ verify-only: SHA-256, bytes, MIME và metadata đều khớp backup; 0 dư. Lượt kiểm hoàn tất 10:06:59, mất 121 giây. Không khóa ghi hoặc restart website trong lượt này.
- Inventory live: 3.386 object, 1.431.587.015 byte, 0 thiếu/0 dư; 0 writer/unknown/cleanup, maintenance đã mở.
- Web và worker khớp provider, endpoint, bucket, credentials và DATABASE_URL; DB URL không đổi so với trước migration. Worker idle với heartbeat mới trên R2, Drive thủ công bật/scheduler tắt.
- HTTP smoke lặp lại đạt: health, trang chủ/admin, public image/thumbnail, portrait, JPEG download; draft bị từ chối. Đếm vẫn 9 album/1.223 ảnh/1 admin/7 lượt chọn. Không album synthetic, không ảnh mồ côi, không ingest chưa rõ kết quả. Log lỗi web hiện tại rỗng.
- Backup độc lập verify lại đạt; hai bản restore thử integrity_check=ok, 0 lỗi FK. Bộ regression: 60 pass, 0 fail, 2 PostgreSQL-only skip.
- Đã xóa hai thư mục local `restored-baseline` và `restored-current` sau kiểm tra, thu hồi 2.756.883.895 byte (~2,76 GB). Kết quả restore lưu ở `restore-recheck.json`; có thể tái tạo từ backup vẫn giữ nguyên.
- Giữ nguyên ảnh R2, kho Supabase nguồn, backup độc lập, bản rollback env và runtime credentials. Chưa bật lịch backup media; cron DB hiện có không bao gồm ảnh.

Nhật ký chi tiết copy nền/cuối trên VPS đã nén thành `r2-cutover-20261021/r2-parallel-background-20261021.tar.gz` và `r2-parallel-final-20261021.tar.gz`, đối chiếu toàn bộ nội dung archive trước khi xóa thư mục journal rời. Đã xóa inventory tạm trong `/tmp` và log copy rỗng. Không xóa bằng chứng checksum hoặc bản backup.

## Kiểm tra lần ba — 21/10/2026, 10:17 UTC+7

- Verify-only toàn bộ 3.386 object R2: GET kiểm SHA-256/bytes, HEAD kiểm MIME/hash metadata đều đạt; 0 dư. Hoàn tất 10:17:08, mất 127 giây. Bằng chứng: `verify-third.json`.
- Kiểm tra DB cuối lượt: mapping vẫn khớp backup, provider R2, maintenance đã mở, 0 writer/unknown write/cleanup. Inventory vẫn 3.386 object / 1.431.587.015 byte, 0 thiếu/0 dư.
- Bộ regression chạy với PostgreSQL test riêng trong Docker: 62/62 pass, 0 fail, 0 skip. Hai kiểm thử PostgreSQL về publication/writer admission trước đó bị skip nay đã đạt. Không dùng database production cho các test này.
- Smoke qua origin và tên miền HTTPS thật `https://chicongphoto.vn` đều đạt 8 kiểm tra, gồm tải ảnh/thumbnail/portrait/JPEG và chặn ảnh draft. Nội dung tải JPEG khớp storage. Lượt này không tạo lại gallery mật khẩu synthetic; probe đầy đủ của lần cutover được ghi ở trên.
- Qua HTTPS: `/.env` và `/.env.r2-production` trả 404; API admin export/media-status trả 401 khi chưa xác thực.
- Hash 7 module runtime quan trọng trên VPS khớp mã local. PM2 online; worker active, process thực tế dùng R2 production; không có lỗi worker trong khoảng log kiểm tra sau cutover.
- Lượt kiểm này không restart, không khóa ghi, không thay cấu hình hoặc dữ liệu production. Không phát hiện tài nguyên thử mới cần xóa; giữ bằng chứng riêng tư, backup và cấu hình rollback. Lịch backup media tự động vẫn chưa được cấu hình.

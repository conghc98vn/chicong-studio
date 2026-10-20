# Triển khai Google Drive Sync trên VPS — 17/10/2026

**Cập nhật 19/10/2026:** đã thu hồi khóa cũ `…dc8ff2` trong Google Cloud và xác minh lại quyền đọc bằng khóa thay thế từ user worker trên VPS. Website vẫn giữ 8 album/1.190 ảnh; nhập Drive production vẫn tắt. Còn chốt folder cha chung và nghiệm thu pilot. Phần backup/kích hoạt dưới đây ghi lại mốc 17/10; [biên bản tiếp tục ngày 19/10](google-drive-sync-followup-2026-10-19.md) ghi kết quả mới.

## Trạng thái bàn giao

Mã web, worker và công cụ backup đã được cập nhật trên VPS iNET. Website [chicongphoto.vn](https://chicongphoto.vn) và [admin](https://chicongphoto.vn/admin) hoạt động; **chưa bật nhập Drive trên production** (`DRIVE_SYNC_ENABLED=false`). Scheduler vẫn tắt. Worker riêng đang chạy để kiểm tra kết nối, **chưa được enable khởi động cùng máy**. Đây là mốc triển khai mã và kiểm tra hạ tầng, chưa phải nghiệm thu pilot nhập ảnh production.

| Hạng mục | Kết quả tại lần bàn giao |
|---|---|
| Mã đang phục vụ | `/var/www/chicongphoto`; Node 24.22.0, PM2 `chicong-photo`, fork mode |
| Database / ảnh | Giữ PostgreSQL và private Storage Supabase; chưa chuyển sang R2 |
| Dữ liệu trước/sau kích hoạt | 8 album, 1.190 ảnh, 1 admin; 0 liên kết album Drive |
| Khóa media | Đã drain và mở lại; 0 writer tại lần kiểm tra |
| HTTP | Health, homepage, admin và ba asset Drive đều trả 200; health `ok: true` |
| Storage | Mẫu media production đọc được; snapshot toàn bộ reference đã verify |
| Kết nối Drive | Khóa thay thế đọc được root 346 file; connection active và heartbeat worker cập nhật |
| Khóa cũ | Đã thu hồi ngày 19/10; danh sách Google Cloud chỉ còn khóa thay thế, quyền đọc từ VPS kiểm lại thành công |
| Local UAT | Giữ tài khoản/dữ liệu thử; runner đã khởi động lại với khóa thay thế |

Không dùng số đếm HTTP hoặc connection check để kết luận luồng import qua PostgreSQL/Supabase production đã hoàn tất. Website vẫn nhận upload/thao tác quản trị bình thường sau khi mở khóa maintenance.

## Phạm vi folder đang gây lỗi khi dùng thử

Root hiện tại là folder `1yD1iAmV9GJNVvZJM3BddhwMEohy3KnsH` (346 file). Folder mới người dùng gửi, `1MGJTCKC8trgUcBN8BEs0Q_4WNNe-XpAB`, **đọc được 160 JPEG bằng tài khoản dịch vụ nhưng nằm ngoài root đã cấu hình**. Quyền đọc Google và phạm vi được ứng dụng cho phép là hai kiểm tra riêng; chia sẻ folder hoặc lấy link công khai không tự mở rộng root.

Để quản lý nhiều bộ ảnh, chọn một folder cha dành riêng cho studio, chứa các folder album cần nhập, và chia sẻ quyền Người xem cho tài khoản dịch vụ. Sau khi studio xác nhận folder cha, cập nhật root trong Cài đặt → Google Drive, kiểm tra kết nối rồi kiểm tra/gắn từng folder album. Có thể gắn một folder con thành album; chỉ JPEG trực tiếp trong folder đó được nhập, không đệ quy qua các cấp con. Mỗi folder chỉ được gắn với một album đang hoạt động. Không tự di chuyển ảnh hoặc đổi root để vượt qua cảnh báo.

Thay root có thể làm liên kết hiện tại ngoài phạm vi mới; phải rà lại mapping/preview trước nhập. Local có album 346 ảnh đã gắn folder cũ; production chưa có mapping nên chưa nhập trùng các album hiện hữu.

## Backup và trình tự kích hoạt đã thực hiện

Bản baseline ở `/var/backups/chicongphoto/releases/drive-20261017` (thư mục riêng trên VPS):

- `previous-source-config.tar.gz`: source/cấu hình trước đổi; file `0600`.
- `previous.env`: cấu hình riêng trước đổi; file `0600`, không đưa vào repository hoặc bằng chứng chia sẻ.
- `baseline.sql.gz`: 522.972 bytes, đã kiểm `gzip -t`. Đây là kiểm toàn vẹn gzip, **không thay thế phục hồi PostgreSQL thử**.
- `media/`: snapshot schema v2, **3.287 object được tham chiếu**, verify thành công. Tên snapshot: `2026-10-16T22-37-13-859Z-098e1b5f-bbf3-4d10-9d82-81f372f8cc3c.json`.
- `media-verify.json`: `verified: true`, `objects: 3287`. Kiểm kê bucket trước backup thấy 3.291 object (~1,32 GB); snapshot chỉ thu object được dữ liệu tham chiếu, không phải lệnh xóa object thừa.

Source cũ được giữ riêng tại `/var/www/chicongphoto-before-drive-20261017`. Dependencies của source mới cài trong thư mục staging, kiểm cú pháp trước khi chạm runtime đang phục vụ. Khi kích hoạt đã lấy lease mới, drain writer, dừng web cũ, chuyển source, khởi động web mới với Drive tắt, kiểm health rồi unlock. Có khoảng **6 giây gián đoạn**; PM2 fork mode không bảo đảm zero downtime.

Lease backup ban đầu hết hạn trong lúc chờ thao tác khác; đã xác minh 0 writer, recover với `writersStopped: false` và mở khóa theo quy trình. Không coi timeout là bằng chứng mọi process đã dừng, không dùng tùy chọn `writers-stopped yes` khi chưa chứng minh. Lease activation riêng đã hoàn thành và được unlock.

Tại mốc 17/10, backup ở cùng VPS. Ngày 19/10 đã sao chép riêng SQL baseline về máy và thử phục hồi phần schema ứng dụng; media vẫn ở VPS, chưa diễn tập thành công toàn bộ Supabase. Xem kết quả và giới hạn trong [biên bản ngày 19/10](google-drive-sync-followup-2026-10-19.md#diễn-tập-baseline-database). Giữ bản baseline và source cũ cho đến khi hoàn tất các cổng nghiệm thu.

## Worker và giới hạn pilot

Unit mẫu: [`scripts/systemd/chicong-drive.service`](../scripts/systemd/chicong-drive.service). Bản cài đặt tại `/etc/systemd/system/chicong-drive.service`, user riêng `chicong-drive`, biến riêng `/etc/chicongphoto/drive-worker.env`. Khóa JSON nằm ngoài webroot, quyền `0600`; web không cần private key. Không sao chép credential vào báo cáo hoặc manifest.

| Cấu hình đang cài | Giá trị |
|---|---|
| Worker | Một process, từng ảnh xử lý tuần tự |
| Giới hạn JPEG pilot | 128 MiB / **60 MP**, watchdog encode 120 giây |
| Node heap | 256 MiB |
| Toàn cgroup | CPU 50%; MemoryHigh 512 MiB; MemoryMax 768 MiB; swap tối đa 256 MiB |
| Dừng | SIGTERM, TimeoutStopSec 90; PM2 web kill_timeout 120 giây sau drain |
| Scheduler | `false`; chưa chốt giờ vận hành |
| Khởi động cùng máy | Unit đang `disabled`; chỉ enable sau nghiệm thu pilot |

Đã chạy JPEG synthetic **6500×6500 (42,25 MP), 51,2 MiB**, hai lần encode thật trong cgroup cách ly CPU 25%/MemoryMax 512 MiB: **69,091 và 68,916 giây**, đỉnh toàn cgroup **283 MiB**, không OOM/swap; WebP/JPG 2400px, thumbnail 900px decode hợp lệ. Bằng chứng: `output/vps-drive-encoder-qa/`. Đây là đo một workload lặp hai lần, không phải tải 5.000 JPEG full-resolution hoặc chứng nhận ảnh 60/120 MP. Cấu hình pilot 60 MP thận trọng hơn mặc định code local 120 MP; nếu cần tăng phải đo trước.

Kết quả hồi quy trước phát hành giữ nguyên: **373/373 test**, SQLite/PostgreSQL; 5.000 ảnh synthetic trên VPS hoàn tất trong **317,997 giây**, kiểm bytes 15.000 rendition qua backup/restore. Báo cáo [workflow](google-drive-sync-workflow-2026-10-17.md) phân biệt các phép thử này với Drive thật và cloud Storage.

## Cổng còn lại trước khi bật nhập production

1. **Đã hoàn tất 19/10:** thu hồi khóa cũ trong Google Cloud; kiểm lại khóa mới bằng tiến trình mới dưới user `chicong-drive` trên VPS, đọc/list được root 346 file và folder mới 160 file.
2. Nhận folder cha studio muốn dùng cho nhiều album, hoặc xác nhận tiếp tục phạm vi root hiện tại. Folder mới đọc được nhưng chưa nằm trong phạm vi ứng dụng.
3. Bật tính năng thủ công có kiểm soát, nhập một album draft từ preview đã duyệt qua worker/PostgreSQL/Supabase thật; kiểm rendition, JPG, no-op, restart/resume và phục hồi trên môi trường cách ly dùng cùng loại storage. Không tự publish album thử hay sửa ảnh khách đang có.
4. Sau pilot đạt, enable worker khởi động cùng máy và xác minh sau restart. Lịch tự động vẫn giữ tắt đến khi chốt giờ/quota/nghiệm thu.

## Những lần deploy tiếp theo và rollback

`npm run deploy:vps -- --stage` chỉ đóng gói allowlist source, kiểm cú pháp, tải lên thư mục release mới và `npm ci`; không restart web, không sao chép `.env`, không migrate database, không tự bật Drive. Script từ chối cách gọi cũ thiếu `--stage`. Đọc checklist in bởi `--help` và [runbook](google-drive-sync-operations.md) trước activation.

Activation phải có backup đã verify, lease còn hiệu lực, drain cleanup/writer, dừng worker/backup runner và xác minh process cũ kết thúc. Chỉ web migrate trước; web/worker/backup phải cùng bản tương thích. Kiểm dữ liệu và media rồi mới mở thao tác và pilot. Không chạy `pm2 reload` với giả định không gián đoạn hoặc bỏ qua media fence.

Khi cần rollback: tắt nhận job mới, giữ lease, drain và dừng writer trước; đối chiếu schema, nguồn Drive và write journal. Source cũ lưu trong thư mục rollback **không tự động được coi là tương thích** sau khi có import Drive. Ưu tiên bản rollback hiểu schema và ownership hiện tại. Không restore `baseline.sql.gz` đè lên PostgreSQL đang nhận dữ liệu mới: việc đó có thể làm mất upload, lựa chọn khách và yêu cầu đặt lịch sau baseline. Restore thử vào DB/storage cách ly, kiểm snapshot/bytes, đối chiếu dữ liệu phát sinh rồi mới lập thao tác khôi phục có phạm vi. Không đổi storage provider bằng chỉnh biến môi trường đơn lẻ.

## Bằng chứng và giới hạn

`output/drive-production-release-2026-10-17/` lưu manifest gói staging ban đầu và manifest source đã phục vụ tại mốc 17/10, cùng status snapshot chỉ chứa số đếm/flags. Sau bản sửa hai module giao diện ngày 19/10, manifest hiện tại là `output/drive-production-followup-2026-10-19/deployed-source-manifest.json`; đã đối chiếu 96/96 file runtime. Hash của gói staging không được gắn nhầm cho các script vận hành đã sửa sau đó. Bản sao manifest deployed được giữ trong thư mục backup release tương ứng trên VPS. Working tree chưa commit; Git HEAD không đại diện đủ source đã triển khai.

Biên bản giữ kết quả kích hoạt ngày 17/10 và ghi rõ cập nhật ngày 19/10 về thu hồi khóa. Drive production vẫn tắt. Khi hoàn tất các cổng, bổ sung status và bằng chứng mới; không sửa kết quả lịch sử thành một phép thử chưa thực hiện.

# Hoàn thiện Google Drive Sync — 19/10/2026

**Cập nhật yêu cầu 20/10:** studio đã chọn duyệt bất kỳ folder nào được chia sẻ cho tài khoản dịch vụ, thay cho yêu cầu một folder cha chung. Phần phạm vi và các bước còn lại dưới đây phản ánh mốc 19/10; thiết kế mới và trạng thái triển khai được ghi trong [bản bổ sung duyệt folder](google-drive-folder-browser-2026-10-20.md).

## Trạng thái hiện tại

Website production vẫn hoạt động trên VPS iNET với PostgreSQL/private Supabase Storage. Kiểm tra lúc 11:27 ngày 19/10 (Asia/Ho_Chi_Minh): health, trang chủ, admin và ba asset Drive trả HTTP 200; API trạng thái Drive trả 401 khi chưa đăng nhập. Dữ liệu giữ **8 album, 1.190 ảnh, 1 admin**, chưa có liên kết album Drive; maintenance mở, không có media writer.

Worker riêng đang chạy, heartbeat mới, chưa restart do lỗi; unit chưa được bật khởi động cùng máy. **Nhập Drive trên production và lịch tự động vẫn tắt.** Chưa có pilot nhập ảnh vào PostgreSQL/Supabase thật, nên kiểm tra kết nối không được coi là nghiệm thu import.

## Thu hồi khóa đã hoàn tất

Đã xóa khóa Google Cloud cũ kết thúc `dc8ff2` theo xác nhận của người dùng. Sau thông báo xóa thành công, tải lại trang Keys cho thấy chỉ còn khóa thay thế kết thúc `bba615` ở trạng thái Active. Không xóa tài khoản dịch vụ hoặc ảnh trên Drive.

Tiến trình mới chạy dưới user `chicong-drive` trên VPS đã xác thực và đọc/list lại thành công bằng khóa thay thế lúc **11:37 ngày 19/10**:

- Root hiện tại `1yD1iAmV9GJNVvZJM3BddhwMEohy3KnsH`: 346 file, danh sách đầy đủ.
- Folder mới `1MGJTCKC8trgUcBN8BEs0Q_4WNNe-XpAB`: 160 file, danh sách đầy đủ.

Khóa mới cũng đã cài cho bản thử local. Không ghi private key vào tài liệu hoặc báo cáo. Bằng chứng tại `output/drive-production-followup-2026-10-19/key-rotation.json` và `key-revoked.png`.

## Folder mới cần chọn lại phạm vi thư viện

Lỗi `drive_folder_outside_root` không phải lỗi credential. Tài khoản dịch vụ đọc được folder 160 ảnh, nhưng folder này không thuộc root 346 ảnh đang cấu hình. Website kiểm cả quyền Google lẫn phạm vi thư viện studio cho phép nhập.

Studio cần cung cấp link **folder cha chung chứa các folder album muốn dùng**, bao gồm bộ 346 ảnh đang liên kết ở local; chia sẻ folder cha ở quyền Người xem cho `chicong-drive-sync@chicong-website-backup.iam.gserviceaccount.com`. Sau đó kiểm quyền/phạm vi, cập nhật trong Cài đặt → Google Drive, kiểm tra kết nối và tạo preview mới. Không tự mở rộng root, di chuyển nguồn, hoặc bỏ liên kết album cũ khi chưa xác định folder cha.

Bản đầu cho phép gắn chính root hoặc một folder nằm dưới root làm album. Chỉ ảnh trực tiếp trong folder album được nhập; không quét ảnh đệ quy. Link được chia sẻ công khai không thay thế yêu cầu nằm trong root.

## Giao diện đã cập nhật trên production

Đã đưa hai module `drive-album-entry.mjs` và `drive-panel.mjs` lên VPS ngày 19/10. Form tạo album và panel Drive có link mở folder gốc hiện tại, giải thích quyền đọc và phạm vi nhập là hai điều kiện riêng, hướng dẫn chọn folder cha chung mà vẫn giữ các bộ đang liên kết. Khi folder nằm ngoài root, thông báo chỉ rõ cách xử lý; link sang Cài đặt đóng dialog để người dùng tiếp tục. Luồng upload tay không tải thêm API Drive trước khi chọn nguồn Drive.

Ba smoke test đã qua trên Node 24/Chromium: `album-drive-entry-browser`, `drive-panel-ux`, `drive-panel-polling`. Bao phủ tạo album sau kiểm folder, không tự nhập ảnh, lỗi ngoài root, root không đổi, điều hướng Cài đặt, bảo toàn draft/focus, polling/backoff và giao diện rộng 320px. Đã xem ảnh chụp mobile; không tràn ngang. Review độc lập và kiểm cú pháp cả hai module không phát hiện lỗi chặn.

Chỉ thay hai file tĩnh, không restart web, không đổi backend/schema/cấu hình. Đã đối chiếu **96/96 file runtime** giữa local và VPS; HTTPS health/homepage/admin trả 200, API Drive chưa đăng nhập trả 401. Hai asset trả 200, hash nội dung qua HTTPS khớp file đã kiểm thử; cache `max-age=0`. Bản cũ của hai file được giữ tại `/var/backups/chicongphoto/releases/drive-20261019-ui-root/previous`.

Bằng chứng mới: `output/drive-production-followup-2026-10-19/ui-root-deployment.json` và `deployed-source-manifest.json`; có bản sao trong thư mục release trên VPS. Manifest ngày 17/10 giữ nguyên làm bằng chứng lịch sử. Nếu cần rollback riêng giao diện, khôi phục panel cũ trước rồi entry cũ từ bản lưu này và kiểm hash/HTTP; không restore database cho thay đổi file tĩnh.

## Bản thử local

Đã khởi động lại [admin local](http://127.0.0.1:4175/admin) bằng Node 24 và khóa thay thế, không đặt lại dữ liệu/tài khoản. Trước khởi động: **2 album, 346 ảnh, 1 admin, không có job đang chạy/chờ**. Health sau khởi động trả `ok: true`. Worker thủ công bật; scheduler tắt.

Cách chạy lại và phạm vi cách ly được ghi trong [runbook](google-drive-sync-operations.md#9-checklist-dùng-thử-local). Bản thử chỉ sống khi tiến trình trên Mac còn chạy; đây không phải dịch vụ production.

Lượt chạy gắn với phiên terminal đã dừng khi phiên bị ngắt; đã chạy lại bằng tiến trình local riêng lúc 12:16 ngày 19/10, vẫn giữ dữ liệu. PID/thời điểm nằm trong `output/drive-local-preview/runtime-20261019.json`, log riêng `preview-runtime.log` quyền `0600`. Không cài tự khởi động cùng máy; trước khi chạy thêm phải kiểm cổng 4175 để tránh mở hai runner.

## Diễn tập baseline database

Đã sao chép riêng `baseline.sql.gz` từ bản backup production ngày 17/10 về máy để thử; hash SHA256 trùng bản VPS. Thư mục local riêng quyền `0700`, dump `0600`, ngoài Git. Không sao chép `.env`.

Phép thử đầu dùng PostgreSQL 16.15 sẵn có trong container không mạng, không mở TCP, dữ liệu trên tmpfs. Restore nguyên dump tạo bằng PostgreSQL 17.11 không qua do thiết lập `transaction_timeout` chưa hỗ trợ ở PostgreSQL 16. Không coi lần này là full restore thành công.

Restore riêng schema ứng dụng `public`, bỏ ACL/default ACL và dùng prologue tương thích PostgreSQL 16, đã qua trong một transaction: **28 bảng, 28 foreign key, 60 index**, không constraint chưa validate; số dòng của cả 28 bảng khớp dump, gồm 8 album/1.190 ảnh/1 admin/0 liên kết Drive. Không chạy app/worker với dữ liệu phục hồi; container đã dọn.

Đã thử tiếp **nguyên dump không chỉnh sửa trên PostgreSQL 17.11**, khớp phiên bản nguồn, trong container cách ly tương tự. Restore dừng tại `role "supabase_admin" does not exist`; có `ON_ERROR_STOP` và transaction, không tạo role giả hoặc bỏ yêu cầu để biến kết quả thành thành công. Container đã dọn. Báo cáo riêng: `output/drive-production-followup-2026-10-19/baseline-pg17-restore-report.json`.

Kết quả này xác minh phần dữ liệu/schema ứng dụng; chưa xác minh đầy đủ Supabase managed schemas, extensions, roles/grants, media hoặc tính nhất quán giữa dữ liệu hiện tại và baseline lịch sử. Full restore cần diễn tập trên môi trường tương thích Supabase, không chỉ PostgreSQL cùng phiên bản. Báo cáo phần public: `output/drive-production-followup-2026-10-19/baseline-restore-report.json`. Bản sao media vẫn ở VPS; chưa có bằng chứng sao lưu toàn bộ baseline media sang nơi độc lập.

## Việc còn lại trước khi dùng production

1. Chốt và kiểm folder cha studio muốn dùng; tạo preview mới sau đổi root.
2. Nhập album draft có kiểm soát qua worker/PostgreSQL/Supabase thật; kiểm rendition, JPG, no-op, gián đoạn/tiếp tục và restore cách ly với storage tương ứng. Không publish album thử hoặc sửa album khách đang có.
3. Khi pilot đạt, bật worker khởi động cùng máy và kiểm lại. Lịch tự động giữ tắt đến khi studio chốt giờ và hoàn tất kiểm chứng vận hành.

[Biên bản ngày 17/10](google-drive-sync-production-release-2026-10-17.md) giữ chi tiết baseline, giới hạn worker và rollback. Các kết quả 373 test, 5.000 ảnh synthetic và JPEG 42,25 MP trước đây không được đổi tên thành nghiệm thu 5.000 JPEG full-resolution trên production.

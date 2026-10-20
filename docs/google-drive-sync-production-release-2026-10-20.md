# Phát hành Google Drive Sync lên production — 20/10/2026

**Trạng thái: đã chuyển source và khởi động dịch vụ; nghiệm thu Drive cuối cùng còn đang thực hiện.** Báo cáo này chưa xác nhận hoàn tất phát hành cho đến khi các mục chờ bên dưới được cập nhật bằng kết quả thực tế.

## Phiên bản và môi trường

| Mục | Giá trị đã xác minh |
|---|---|
| Website | https://chicongphoto.vn |
| Hạ tầng | iNET VPS; cơ sở dữ liệu và media Supabase |
| Nhánh đã push | `codex/google-drive-sync` |
| Commit source | `5a9e83c0efd2bce1e18789cf1d227a7ea3414e2d` |
| Release ID | `20261020T085406982Z-3225e599` |
| Source hoạt động | `/var/www/chicongphoto` |
| Source trước phát hành | `/var/www/chicongphoto-before-drive-20261020` |
| Đối chiếu runtime | 102 file đã xác minh |

Nhánh phát hành đã hợp nhất commit R2 có sẵn trên GitHub, giữ lịch sử trước đó. Phát hành này chạy trên VPS, không phải Render.

## Backup và chuyển phiên bản

Đã khóa thao tác ghi media, dừng worker và chờ writer kết thúc trước khi chụp backup. Trong giai đoạn này, web cũ vẫn phục vụ đọc ảnh. Thư mục backup source, cấu hình, SQL và bằng chứng của lượt phát hành là `/var/backups/chicongphoto/releases/drive-20261020`; không đưa credential hoặc nội dung cấu hình bí mật vào tài liệu/Git.

Snapshot media dùng lại kho blob `/var/backups/chicongphoto/releases/drive-20261017/media`, run **`2026-10-20T08-53-02-159Z-13197ff8-b5c5-4de0-b8c4-5e1d2db272ff`**. Đã verify đúng snapshot này với **3.287 object**. Các bản backup này nằm trên cùng VPS; chúng không thay thế một bản sao độc lập ngoài máy chủ.

Khoảng chuyển dịch vụ đo được: **15:59:41 → 15:59:48 ngày 20/10/2026, UTC+07:00 (7 giây)**. Sau migration, dữ liệu hiện có giữ nguyên **8 album, 1.190 ảnh, 1 admin**. Health, trang admin và thumbnail hiện có trả HTTP 200.

## Trạng thái vận hành

- Web đã bật `DRIVE_SYNC_ENABLED=true` để dùng đồng bộ thủ công.
- Worker đã được khởi động; xác minh heartbeat và hoạt động đầu cuối đang được tiếp tục.
- `DRIVE_SYNC_SCHEDULER_ENABLED=false`: chưa bật lịch đồng bộ tự động.
- Giữ giới hạn nguồn **60 megapixel / 128 MiB mỗi ảnh** trên worker. Khách nhận JPG tối đa 2400px; bản gốc giữ trên Drive.
- Phạm vi sản phẩm đã được người dùng chốt: nhận folder bất kỳ đã chia sẻ cho tài khoản dịch vụ. Trạng thái áp dụng `shared` trên production cần được xác nhận ở bảng nghiệm thu dưới đây.

## Nghiệm thu còn chờ cập nhật

| Hạng mục | Trạng thái tại thời điểm viết |
|---|---|
| Heartbeat worker sau chuyển source | **PENDING — chưa ghi nhận kết quả cuối** |
| Mở khóa media maintenance | **PENDING — chưa xác nhận đã unlock** |
| Áp dụng `folder_scope=shared` và kiểm tra kết nối | **PENDING — chưa xác minh** |
| Duyệt folder thật 33/346 ảnh, counts và thumbnail | **PENDING — chưa nghiệm thu trên production mới** |
| Pilot nhập ảnh vào album nháp và đồng bộ lại | **PENDING — chưa nghiệm thu** |
| Worker tự khởi động sau reboot | **PENDING — chưa xác nhận enable systemd** |
| Health, dữ liệu và trạng thái cuối sau pilot | **PENDING — cập nhật bằng chứng trước khi đóng phát hành** |

Các mục PENDING là công việc chưa có kết quả xác minh trong báo cáo này, không phải lỗi đã phát hiện. Không công bố pilot đạt hoặc phát hành hoàn tất trước khi cập nhật.

## Kiểm chứng source và giới hạn

Lượt [tối ưu hiệu năng ngày 20/10](google-drive-perf-pass-2026-10-20.md) trước phát hành đã đạt **420/420 regression tests**, gồm SQLite và PostgreSQL cách ly, cùng smoke UI và Drive thật. Đây là kết quả của lượt trước, không phải tuyên bố đã chạy lại toàn bộ test trong lúc deploy. Đã sửa script backup để loại dữ liệu của cả hai bảng cache Drive khỏi SQL dump và kiểm tra cú pháp shell.

Chưa có nghiệm thu nhập **5.000 JPEG full-resolution thật**; fixture 5.000 metadata không đại diện cho thời gian tải/encode hoặc tài nguyên vận hành. Browse vẫn có thể chờ batch import đang chạy. Lịch tự động chưa được người dùng chốt và vẫn tắt.

Nếu cần rollback, dừng writer và worker trước, giữ Drive tắt khi quay về source cũ. Sau khi đã có dữ liệu mới, không khôi phục SQL baseline đè lên dữ liệu khách hàng; phải đánh giá schema và ownership media hiện tại trước khi phục hồi.

Bằng chứng local của phát hành: `output/drive-production-release-2026-10-20/` (ngoài Git). Báo cáo chỉ ghi đường dẫn và kết quả, không ghi token, khóa hoặc mật khẩu.

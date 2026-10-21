# Handbook ChiCong Studio

**Phiên bản 1.6 · 21/10/2026 · giờ Việt Nam (UTC+7).** Tài liệu chính cho kiến trúc, vận hành kỹ thuật và QA. Các bản cập nhật nối tiếp trước đây đã chuyển thành snapshot lịch sử; trang này là đầu mối trạng thái hiện hành.

## 1. Đọc theo công việc

| Công việc | Hướng dẫn chính |
|---|---|
| Hiểu công nghệ, dữ liệu và đường đi request | [01 — Kiến trúc](01-kien-truc-va-cong-nghe.md) |
| Kiểm kê key, backup, phục hồi và xử lý sự cố | [02 — Vận hành và khôi phục](02-van-hanh-bi-mat-va-khoi-phuc.md) |
| Chạy test, thiết kế case và thực hành QA | [03 — Phòng lab QA](03-phong-lab-qa.md) |
| Đăng portfolio, giao gallery và nhận tư vấn | [Vận hành studio](../../OPERATIONS.md) |
| Cấu hình host, stage/activate và rollback | [Hosting](../../HOSTING.md) |
| Drive import và job recovery | [Runbook Drive](../google-drive-sync-operations.md) |
| Đọc kết quả audit mới | [Review 21/10](../review-2026-10-21.md) |

## 2. Cách hiểu bằng chứng

**CODE** là hành vi đọc từ source; **CONFIG** là cấu hình tham chiếu; **TEST** là kết quả thực chạy trong fixture cách ly; **REPORT** là kết quả từ biên bản có ngày; **LIVE** chỉ dùng cho thao tác trực tiếp trên hệ thống thật trong chính lượt đó. Không lấy một loại thay cho loại khác.

Lượt review này sửa runtime và tài liệu tại working tree, chạy kiểm thử cách ly; không deploy hoặc kiểm cloud live mới. Production dưới đây dựa trên biên bản 20–21/10. Commit HEAD, file env mẫu hoặc CI xanh không chứng minh bản đang chạy đã nhận thay đổi.

## 3. Trạng thái production theo report gần nhất

| Thành phần | Đã ghi nhận | Giới hạn |
|---|---|---|
| Web | VPS iNET, Caddy, PM2; Cloudflare trước origin | Cần đối chiếu process/env khi release; không dùng Render blueprint thay cấu hình VPS |
| Database/media | PostgreSQL Supabase; R2 private `chicong-production` từ 21/10 | Không chuyển database; Supabase Storage cũ giữ cho đối chiếu/rollback |
| Dữ liệu | 9 album, 1.223 ảnh, 1 admin, 7 lựa chọn; 3.386 object R2 | Số tại thời điểm report, không phải số đếm live hiện tại |
| Drive | `shared`, nhập thủ công bật, scheduler tắt; worker enabled và restart idle đạt | Chưa reboot VPS hoặc kill worker giữa import |
| Pilot Drive | 33 ảnh và no-op 33 unchanged; fingerprint 1.190 ảnh cũ giữ nguyên | Pilot trước cutover R2; chưa chứng minh import mới sau cutover hoặc tải 500/5.000 JPEG thật |
| Backup | 3.386 object ngoài VPS, restore SQLite + media offline đạt, 0 lỗi FK | Không phải full Supabase/cloud restore; chưa có lịch backup media/cảnh báo tuổi snapshot |
| Cron SQL | Theo report chạy 03:00, ghi SQL gzip trên VPS | Không chứa bytes ảnh, không thay backup offsite; chưa kiểm cron mới trong lượt này |
| Email/Calendar | Tích hợp qua Resend/SMTP và private ICS | Chưa kiểm lại deliverability/config thật; email chưa có outbox bền vững |
| Feedback khách | Đã có [spec](../customer-feedback-spec.md) | Chưa triển khai |

Nguồn: [nghiệm thu Drive 20/10](../archive/google-drive-sync-production-release-2026-10-20.md), [cutover R2 21/10](../archive/r2-production-cutover-2026-10-21.md), [review R2](../archive/r2-performance-review-2026-10-21.md). Snapshot [bàn giao 21/10](../archive/handbook/06-cap-nhat-du-an-2026-10-21.md) giữ chi tiết runtime manifest, backup ID và phạm vi cũ.

## 4. Những phân biệt cần giữ

- Gallery private **không mật khẩu** được truy cập bằng link. Muốn giới hạn người xem, đặt mật khẩu và kiểm bằng phiên khách.
- JSON admin là bản xuất metadata, không chứa media/admin và không phải snapshot nhất quán toàn DB. Backup hoàn chỉnh cần công cụ DB + media và restore kiểm chứng.
- `media_control` gắn database với storage identity. Đổi env không thay binding; rollback có ảnh mới cần delta và khóa ghi.
- R2 không tự tạo CDN cache cho media qua backend. Public media dùng revalidation, private dùng no-store; không override cache theo `/media/*`.
- Phân trang gallery/admin giới hạn DOM, metadata vẫn chứa toàn album. Benchmark 5.000 metadata không chứng minh encode hoặc nhập 5.000 JPEG gốc trên VPS.
- Restore vô hiệu session/kết nối/job/approval Drive cũ. Cần cấu hình credential, check và preview mới; không tiếp tục job bằng sửa tay rows.
- Lịch dump SQL, backup DB + media, và scheduler nhập Drive là ba hệ thống khác nhau.

## 5. Kiểm thử và việc còn mở

Kết quả mới, số pass/fail/skip, môi trường, số đo trước/sau và log đã lọc nằm ở [review 21/10](../review-2026-10-21.md). Lượt hai bổ sung xử lý mất kết nối giữa transaction, cách ly database của fixture khỏi biến môi trường terminal, và phục hồi CSS Drive lỗi/treo mà không chặn admin. CI chạy Node 24/PostgreSQL 16; browser runner có thể chạy riêng nhưng chưa được cấu hình làm CI gate. Số test và hash trong evidence cũ chỉ đại diện lượt đã ghi nhận.

Ưu tiên vận hành tiếp theo: chốt lịch/retention/cảnh báo backup và thử full cloud restore; kiểm reboot/kill worker trên môi trường thử; đo JPEG thật theo capacity; xử lý 284 ảnh legacy thiếu JPEG nếu số này còn đúng sau kiểm kê. Email outbox và browser/axe CI là backlog có điều kiện nghiệm thu trong tài liệu QA, không phải chức năng đã có.

## 6. Lưu trữ và duy trì

[Snapshot 17/10](../archive/handbook/04-cap-nhat-du-an-2026-10-17.md), [snapshot 20/10](../archive/handbook/05-cap-nhat-du-an-2026-10-20.md), [snapshot 21/10 trước audit](../archive/handbook/06-cap-nhat-du-an-2026-10-21.md) và các file [evidence ban đầu](evidence.json), [17/10](evidence-2026-10-17.json), [20/10](evidence-2026-10-20.json), [21/10](evidence-2026-10-21.json) giữ phạm vi riêng. Hash cũ không đại diện working tree sau audit.

Mỗi thay đổi cập nhật hướng dẫn chính, rồi thêm record có ngày và nguồn khi có nghiệm thu mới. [Mục lục và quy tắc tài liệu](../README.md) chỉ rõ nơi sửa; tránh thêm nhiều trang “hiện tại” cạnh nhau.

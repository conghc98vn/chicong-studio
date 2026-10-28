# Handbook ChiCong Studio

**Phiên bản 1.9 · 28/10/2026 · giờ Việt Nam (UTC+7).** Tài liệu chính cho kiến trúc, vận hành kỹ thuật và QA. Các bản cập nhật nối tiếp trước đây đã chuyển thành snapshot lịch sử; trang này là đầu mối trạng thái hiện hành.

## 1. Đọc theo công việc

| Công việc | Hướng dẫn chính |
|---|---|
| Hiểu công nghệ, dữ liệu và đường đi request | [01 — Kiến trúc](01-kien-truc-va-cong-nghe.md) |
| Kiểm kê key, backup, phục hồi và xử lý sự cố | [02 — Vận hành và khôi phục](02-van-hanh-bi-mat-va-khoi-phuc.md) |
| Chạy test, thiết kế case và thực hành QA | [03 — Phòng lab QA](03-phong-lab-qa.md) |
| Đăng portfolio, giao gallery và nhận tư vấn | [Vận hành studio](../../OPERATIONS.md) |
| Cấu hình host, stage/activate và rollback | [Hosting](../../HOSTING.md) |
| Drive import và job recovery | [Runbook Drive](../google-drive-sync-operations.md) |
| Đọc kết quả audit mới | [Review 23/10](../review-2026-10-23.md), [snapshot trước release](07-cap-nhat-du-an-2026-10-28.md) và [biên bản production 28/10](08-production-release-2026-10-28.md) |

## 2. Cách hiểu bằng chứng

**CODE** là hành vi đọc từ source; **CONFIG** là cấu hình tham chiếu; **TEST** là kết quả thực chạy trong fixture cách ly; **REPORT** là kết quả từ biên bản có ngày; **LIVE** chỉ dùng cho thao tác trực tiếp trên hệ thống thật trong chính lượt đó. Không lấy một loại thay cho loại khác.

Theo xác nhận của chủ dự án ngày 28/10, bản tính năng mới đã được đưa lên production. Repo hiện vẫn có working tree chưa commit và chưa có revision/health-check live được ghi trong lượt này, nên handbook phân biệt rõ **đã lên PROD theo xác nhận** với **LIVE đã kiểm trực tiếp**. Snapshot local trước release được giữ ở [07](07-cap-nhat-du-an-2026-10-28.md); checklist và các trường còn thiếu nằm ở [biên bản production 28/10](08-production-release-2026-10-28.md).

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
| Email/Calendar | Tích hợp qua Resend/SMTP và private ICS | Chưa kiểm lại deliverability/config thật; inquiry chưa có outbox |
| Feedback khách | Đã lên PROD theo xác nhận 28/10; [cách dùng và contract](../customer-feedback-spec.md#implementation) | Chưa có live smoke/log trong lượt này; phải ghi revision, secret, queue và kết quả recipient |

Nguồn: [nghiệm thu Drive 20/10](../archive/google-drive-sync-production-release-2026-10-20.md), [cutover R2 21/10](../archive/r2-production-cutover-2026-10-21.md), [review R2](../archive/r2-performance-review-2026-10-21.md). Snapshot [bàn giao 21/10](../archive/handbook/06-cap-nhat-du-an-2026-10-21.md) giữ chi tiết runtime manifest, backup ID và phạm vi cũ.

## 4. Những phân biệt cần giữ

- Gallery private **không mật khẩu** được truy cập bằng link. Muốn giới hạn người xem, đặt mật khẩu và kiểm bằng phiên khách.
- JSON admin v3 là bản xuất metadata gồm feedback trong transaction nhất quán; không chứa media/admin hoặc đầy đủ bảng Drive nên không phải snapshot toàn DB. Backup hoàn chỉnh cần công cụ DB + media và restore kiểm chứng.
- `media_control` gắn database với storage identity. Đổi env không thay binding; rollback có ảnh mới cần delta và khóa ghi.
- R2 không tự tạo CDN cache cho media qua backend. Public media dùng revalidation, private dùng no-store; không override cache theo `/media/*`.
- Phân trang gallery/admin giới hạn DOM, metadata vẫn chứa toàn album. Benchmark 5.000 metadata không chứng minh encode hoặc nhập 5.000 JPEG gốc trên VPS.
- Restore vô hiệu session/kết nối/job/approval Drive cũ. Cần cấu hình credential, check và preview mới; không tiếp tục job bằng sửa tay rows.
- Restore offline v3 thu hồi link/pause feedback và suppress mail; raw SQL/PITR chưa có bước chuẩn bị tương đương tự động. [Phân biệt và cổng mở lại](02-van-hanh-bi-mat-va-khoi-phuc.md#36-feedback-snapshot-v3-và-phục-hồi-từ-sql-dump).
- Lịch dump SQL, backup DB + media, và scheduler nhập Drive là ba hệ thống khác nhau.

## 5. Kiểm thử và việc còn mở

Kết quả audit mới và giới hạn xác minh nằm ở [review 23/10](../review-2026-10-23.md): **446/446 PostgreSQL**, **17/17 browser suite** và **10 scan axe không violation được báo cáo** trong lượt tiếp nối; các incomplete về color-contrast vẫn phải kiểm thủ công. CI chạy Node 24/PostgreSQL 16 và đã có job browser/axe riêng với công cụ pin, nhưng job Linux/branch protection chưa được nghiệm thu theo report. [Snapshot 28/10](07-cap-nhat-du-an-2026-10-28.md) là TEST local trước release; [biên bản production 28/10](08-production-release-2026-10-28.md) ghi phần đã lên PROD theo xác nhận và phần chưa có bằng chứng LIVE.

Ưu tiên vận hành tiếp theo: ghi revision và manifest của release production; chạy checklist LIVE cho feedback/freelancer, queue email và proxy; chốt lịch/retention/cảnh báo backup và thử full cloud restore; kiểm reboot/kill worker trên môi trường thử; đo JPEG thật theo capacity; xử lý 284 ảnh legacy thiếu JPEG nếu số này còn đúng sau kiểm kê. Outbox inquiry vẫn là backlog; browser/axe CI cần lần chạy Linux thật và cấu hình branch protection theo điều kiện nghiệm thu trong tài liệu QA.

## 6. Lưu trữ và duy trì

[Snapshot 17/10](../archive/handbook/04-cap-nhat-du-an-2026-10-17.md), [snapshot 20/10](../archive/handbook/05-cap-nhat-du-an-2026-10-20.md), [snapshot 21/10 trước audit](../archive/handbook/06-cap-nhat-du-an-2026-10-21.md) và các file [evidence ban đầu](evidence.json), [17/10](evidence-2026-10-17.json), [20/10](evidence-2026-10-20.json), [21/10](evidence-2026-10-21.json) giữ phạm vi riêng. Hash cũ không đại diện working tree sau audit.

Mỗi thay đổi cập nhật hướng dẫn chính, rồi thêm record có ngày và nguồn khi có nghiệm thu mới. [Mục lục và quy tắc tài liệu](../README.md) chỉ rõ nơi sửa; tránh thêm nhiều trang “hiện tại” cạnh nhau.

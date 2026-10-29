# Handbook ChiCong Studio

**Phiên bản 2.0 · 29/10/2026 · giờ Việt Nam (UTC+7).** Tài liệu chính cho kiến trúc, vận hành kỹ thuật và QA. Các bản cập nhật nối tiếp trước đây đã chuyển thành snapshot lịch sử; trang này là đầu mối trạng thái hiện hành.

## 1. Luồng đọc chuẩn

Đọc theo thứ tự này khi cần nắm toàn bộ dự án: **trang này → biên bản production 29/10 → kiến trúc → vận hành/khôi phục → QA**. Các runbook chuyên đề chỉ đọc sau khi đã hiểu phần vận hành và giới hạn của môi trường thật.

| Bước / công việc | Hướng dẫn chính |
|---|---|
| 0. Trạng thái, phạm vi và nguồn bằng chứng | Trang handbook này |
| 1. Release đang chạy và LIVE smoke | [09 — Production 29/10](09-production-release-2026-10-29.md) |
| 2. Hiểu công nghệ, dữ liệu và đường đi request | [01 — Kiến trúc](01-kien-truc-va-cong-nghe.md) |
| 3. Kiểm kê key, backup, phục hồi và xử lý sự cố | [02 — Vận hành và khôi phục](02-van-hanh-bi-mat-va-khoi-phuc.md) |
| 4. Chạy test, thiết kế case và thực hành QA | [03 — Phòng lab QA](03-phong-lab-qa.md) |
| Hằng ngày: đăng portfolio, giao gallery và nhận tư vấn | [Vận hành studio](../../OPERATIONS.md) |
| Hạ tầng: cấu hình host, stage/activate và rollback | [Hosting](../../HOSTING.md) |
| Chuyên đề: Drive import và job recovery | [Runbook Drive](../google-drive-sync-operations.md) |
| Chuyên đề: feedback sau bàn giao | [Đặc tả feedback](../customer-feedback-spec.md) |
| Audit và snapshot trước release | [Review 23/10](../review-2026-10-23.md), [snapshot 28/10](../archive/handbook/07-cap-nhat-du-an-2026-10-28.md) |

## 2. Cách hiểu bằng chứng

**CODE** là hành vi đọc từ source; **CONFIG** là cấu hình tham chiếu; **TEST** là kết quả thực chạy trong fixture cách ly; **REPORT** là kết quả từ biên bản có ngày; **LIVE** chỉ dùng cho thao tác trực tiếp trên hệ thống thật trong chính lượt đó. Không lấy một loại thay cho loại khác.

Release `30ce096` đã được đưa lên production và kiểm trực tiếp ngày 29/10: health, public media, freelancer host, admin session, feedback guard, PM2 và worker đều đạt smoke. Snapshot local trước release được giữ ở [07](../archive/handbook/07-cap-nhat-du-an-2026-10-28.md); revision, baseline và giới hạn nghiệm thu nằm ở [biên bản production 29/10](09-production-release-2026-10-29.md).

## 3. Trạng thái production theo report gần nhất

| Thành phần | Đã ghi nhận | Giới hạn |
|---|---|---|
| Web | VPS iNET, Caddy, PM2; Cloudflare trước origin | Cần đối chiếu process/env khi release; không dùng Render blueprint thay cấu hình VPS |
| Database/media | PostgreSQL Supabase; R2 private `chicong-production` từ 21/10 | Không chuyển database; Supabase Storage cũ giữ cho đối chiếu/rollback |
| Dữ liệu | Kiểm LIVE 29/10: 9 album (7 public), 1.223 ảnh, 1 admin, 7 lựa chọn, 1 inquiry, 0 handover/feedback; 3.386 object R2 theo baseline report | DB có thể thay đổi; object R2 chưa inventory lại trong lượt cập nhật này |
| Drive | `shared`, nhập thủ công bật, scheduler tắt; worker enabled và restart idle đạt | Chưa reboot VPS hoặc kill worker giữa import |
| Pilot Drive | 33 ảnh và no-op 33 unchanged; fingerprint 1.190 ảnh cũ giữ nguyên | Pilot trước cutover R2; chưa chứng minh import mới sau cutover hoặc tải 500/5.000 JPEG thật |
| Backup | 3.386 object ngoài VPS, restore SQLite + media offline đạt, 0 lỗi FK | Không phải full Supabase/cloud restore; chưa có lịch backup media/cảnh báo tuổi snapshot |
| Cron SQL | Theo report chạy 03:00, ghi SQL gzip trên VPS | Không chứa bytes ảnh, không thay backup offsite; chưa kiểm cron mới trong lượt này |
| Email/Calendar | Tích hợp qua Resend/SMTP và private ICS; inquiry có outbox bền vững, retry và trạng thái trong admin | Chưa kiểm lại deliverability/config thật; chưa gửi hồ sơ thử tới recipient thật |
| Feedback khách | Đã chạy trong release `30ce096`; [cách dùng và contract](../customer-feedback-spec.md#implementation) | Route guard/link sai đã smoke; email recipient thật và queue nghiệp vụ chưa thử bằng dữ liệu khách |

Nguồn: [nghiệm thu Drive 20/10](../archive/google-drive-sync-production-release-2026-10-20.md), [cutover R2 21/10](../archive/r2-production-cutover-2026-10-21.md), [review R2](../archive/r2-performance-review-2026-10-21.md). Snapshot [bàn giao 21/10](../archive/handbook/06-cap-nhat-du-an-2026-10-21.md) giữ chi tiết runtime manifest, backup ID và phạm vi cũ.

## 4. Những phân biệt cần giữ

- Gallery private **không mật khẩu** được truy cập bằng link. Muốn giới hạn người xem, đặt mật khẩu và kiểm bằng phiên khách.
- JSON admin v4 là bản xuất metadata gồm feedback và inquiry outbox trong transaction nhất quán; không chứa media/admin hoặc đầy đủ bảng Drive nên không phải snapshot toàn DB. Backup hoàn chỉnh cần công cụ DB + media và restore kiểm chứng.
- `media_control` gắn database với storage identity. Đổi env không thay binding; rollback có ảnh mới cần delta và khóa ghi.
- R2 không tự tạo CDN cache cho media qua backend. Public media dùng revalidation, private dùng no-store; không override cache theo `/media/*`.
- Phân trang gallery/admin giới hạn DOM, metadata vẫn chứa toàn album. Benchmark 5.000 metadata không chứng minh encode hoặc nhập 5.000 JPEG gốc trên VPS.
- Restore vô hiệu session/kết nối/job/approval Drive cũ. Cần cấu hình credential, check và preview mới; không tiếp tục job bằng sửa tay rows.
- Restore offline v4 thu hồi link/pause feedback, suppress feedback và inquiry mail; raw SQL/PITR chưa có bước chuẩn bị tương đương tự động. [Phân biệt và cổng mở lại](02-van-hanh-bi-mat-va-khoi-phuc.md#36-feedback-snapshot-v3-và-phục-hồi-từ-sql-dump).
- Lịch dump SQL, backup DB + media, và scheduler nhập Drive là ba hệ thống khác nhau.

## 5. Kiểm thử và việc còn mở

Kết quả audit và giới hạn lịch sử nằm ở [review 23/10](../review-2026-10-23.md). Checkout hiện tại đạt `npm test` Node 24 với **480 pass + 52 skip, 0 fail**; toàn bộ 21 browser smoke pass và live smoke theo [biên bản production 29/10](09-production-release-2026-10-29.md). Các cổng chưa đóng gồm email recipient thật, full Supabase/PITR restore, reboot/kill worker giữa import và benchmark 500/5.000 JPEG.

Ưu tiên vận hành tiếp theo: kiểm email recipient bằng hồ sơ thử được phép; chốt lịch/retention/cảnh báo backup và thử full cloud restore; kiểm reboot/kill worker trên môi trường thử; đo JPEG thật theo capacity; xử lý 284 ảnh legacy thiếu JPEG nếu số này còn đúng sau kiểm kê. Báo giá/đặt cọc và nhắc follow-up vẫn là backlog nghiệp vụ.

## 6. Lưu trữ và duy trì

Tài liệu hiện hành chỉ gồm trang này, [01](01-kien-truc-va-cong-nghe.md), [02](02-van-hanh-bi-mat-va-khoi-phuc.md), [03](03-phong-lab-qa.md) và [09](09-production-release-2026-10-29.md). [07](../archive/handbook/07-cap-nhat-du-an-2026-10-28.md) là snapshot trước release; [08](../archive/handbook/08-production-release-2026-10-28.md) là biên bản release cũ. Hai file này giữ nguyên để truy vết, không dùng thay trạng thái hiện hành.

Các JSON lịch sử đã gom vào [thư mục evidence](evidence/README.md): [evidence nền](evidence/evidence.json), [17/10](evidence/evidence-2026-10-17.json), [20/10](evidence/evidence-2026-10-20.json) và [21/10](evidence/evidence-2026-10-21.json). Hash cũ không đại diện working tree sau audit.

Mỗi thay đổi cập nhật hướng dẫn chính, rồi thêm record có ngày và nguồn khi có nghiệm thu mới. [Mục lục và quy tắc tài liệu](../README.md) chỉ rõ nơi sửa; tránh thêm nhiều trang “hiện tại” cạnh nhau.

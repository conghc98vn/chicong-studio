# 09 — Cập nhật production ngày 29/10/2026

## 1. Release đang chạy

Release mới được kích hoạt và kiểm trực tiếp ngày 29/10/2026:

| Mục | Giá trị |
|---|---|
| Git revision | `7a6c039` — `docs: clarify inquiry notification operations` (chứa refactor outbox ở `fc90df6` và test retry ở `e971fc9`) |
| Release folder | `20261029T041131113Z-852ddf18` |
| Runtime | VPS iNET → Caddy/Cloudflare → PM2/Node 24.22.0 |
| Database/media | PostgreSQL Supabase + R2 private `chicong-production` |
| Worker | `chicong-drive.service` active; Drive thủ công bật, scheduler tắt |
| Flags | `FEEDBACK_API_PAUSED=false`, `FEEDBACK_NOTIFICATIONS_PAUSED=false`, `INQUIRY_NOTIFICATIONS_PAUSED=false` |
| Rollback source | `/var/www/chicongphoto-releases/rollback-20261029-active-7a6c039` |
| CI | Chưa có kết quả workflow mới đọc được tại thời điểm ghi record |

Release được stage bằng `npm run deploy:vps -- --stage`. Trong thời gian kích hoạt, maintenance lease được giữ, worker Drive dừng và drain, baseline DB/media được chụp rồi verify, source được swap, migration chạy với cờ pause, sau đó PM2/worker được khởi động lại và lease được unlock. Baseline nằm ở `/var/backups/chicongphoto/production-baseline-20261029-7a6c039`; run backup `2026-10-29T04-16-41-287Z-00000000-0000-0000-0000-000000000000` verify 3.386 object và retention `ok`. Secret, backup và dữ liệu khách không đưa vào Git.

## 2. LIVE smoke đã chạy

- `/api/health`, trang chính và `/admin` trả 200; admin giữ `private,no-store`.
- `/api/admin/session` khi chưa đăng nhập trả `200` với `authenticated:false`.
- Bảng `inquiry_notifications` đã được migration trên PostgreSQL production; DB check đọc 1 inquiry hiện có và 0 notification đang chờ.
- PM2 `chicong-photo` online, `chicong-drive.service` active; không có crash mới trong log PM2.
- Media control sau unlock có `owner=null`, không có writer/unknown/cleanup; storage identity vẫn là R2 production.
- Các cờ feedback/inquiry đã mở lại sau khi kiểm migration và health; scheduler Drive vẫn tắt.

Smoke xác nhận runtime, binding, migration và route bảo mật. Lượt này không gửi email thật, không tạo inquiry thử, không sửa dữ liệu khách và không chạy Drive import mới. Khả năng giao email cần kiểm riêng bằng recipient được studio cho phép.

## 3. Kiểm thử source và cleanup

- `npm run check`: 220 file JavaScript/config/shell pass.
- `npm run check:docs`: 69 Markdown, 513 link nội bộ pass.
- `npm test` trên Node 24: 533 test, 481 pass, 52 skip có chủ đích, 0 fail.
- Test mục tiêu inquiry/mail: outbox restart, thiếu recipient, retry recipient sau cấu hình, provider 5xx, recipient 4xx và retry endpoint đều pass.
- Browser smoke local chưa chạy vì checkout không cài module Playwright; workflow CI có job browser riêng nhưng run mới chưa có kết quả đọc được tại thời điểm cập nhật.

Refactor giữ dữ liệu inquiry trong cùng transaction với hai notification outbox, có lease/claim/retry/backoff, phân loại lỗi cấu hình/provider, retry thủ công trong admin và export/backup schema v4. Các tính năng portfolio, gallery, Drive, feedback và upload không đổi contract ngoài việc được chạy lại trong full suite.

## 4. Việc còn mở

Chưa nghiệm thu email recipient thật, full Supabase/PITR restore, reboot hoặc kill worker giữa import và benchmark 500/5.000 JPEG nguồn. Các mục này vẫn là cổng vận hành riêng; không suy ra từ test local, backup verify hoặc smoke HTTP.

Mọi thay đổi sau release này phải tạo revision mới, stage và bổ sung record LIVE tương ứng. Không đưa secret, cookie, dump database, media backup hoặc link khách vào Git.

# 08 — Cập nhật production ngày 28/10/2026

## 1. Release đang chạy

Lượt kiểm tra trực tiếp ngày 28/10/2026 đã kích hoạt release sau:

| Mục | Giá trị |
|---|---|
| Git revision | `a375ec9` — `fix: keep zip download names browser-safe` |
| Release folder | `20261028T102431831Z-c32e376d` |
| Runtime | VPS iNET → Caddy/Cloudflare → PM2/Node 24.22.0 |
| Database/media | PostgreSQL Supabase + R2 private `chicong-production` |
| Worker | `chicong-drive.service` active; Drive thủ công bật, scheduler tắt |
| Feedback flags | API và notifications đang mở sau khi smoke maintenance pass |
| CI | GitHub Actions `40671835785` thành công |

Release được stage bằng `npm run deploy:vps -- --stage`, sau đó giữ maintenance lease trong lúc dừng worker, drain writer, backup/verify, swap source và khởi động lại các consumer. Bản rollback source được giữ riêng tại VPS. Baseline media/database đã verify ở `/var/backups/chicongphoto/production-baseline-20261028-a375ec9`; SQL dump sau release có quyền `0600`.

## 2. LIVE smoke đã chạy

- `/api/health` trả 200 và `{"ok":true}`.
- Trang chính trả 200; `freelancer.chicongphoto.vn` trả 200, `X-Robots-Tag: noindex, nofollow` và `Cache-Control: private,no-store`.
- Endpoint admin chưa đăng nhập trả 401.
- Link feedback giả trả 403 `LINK_UNAVAILABLE`; trong lúc swap, cờ pause đã trả 503 đúng rồi được mở lại sau nghiệm thu.
- Ba media public đọc qua R2 trả 200 với `image/webp` và `private,no-cache`.
- `gallery-download.mjs` trên production chứa bản sửa tên ZIP ASCII an toàn.
- Media control sau unlock có `owner=null`, không có writer/unknown/cleanup; PM2 web và worker đều active.

Smoke này xác nhận runtime, binding, route bảo mật và media path. Chưa gửi email thật, chưa sửa dữ liệu khách, chưa chạy Drive import mới và chưa gọi đây là full cloud restore.

## 3. Kiểm thử source

- `npm run check`: 218 file JavaScript/config/shell pass.
- `npm run check:docs`: 67 Markdown, 503 link nội bộ pass.
- `npm test` trên Node 24: 527 test, 475 pass, 52 skip có chủ đích, 0 fail.
- Browser smoke cuối cho gallery download pass: JPEG/ZIP, 51 ảnh chia gói, retry, cancel, focus và viewport 320/390/768/1440.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerability.

Các test này không thay cho việc thử email recipient thật, full Supabase/PITR restore, reboot/kill worker giữa import hoặc benchmark 500/5.000 JPEG nguồn. Những cổng đó vẫn nằm trong runbook vận hành.

## 4. Quy tắc cập nhật tiếp theo

Mọi thay đổi sau release này phải tạo revision mới, stage và cập nhật bản ghi này bằng kết quả LIVE tương ứng. Không đưa secret, cookie, dump database, media backup hoặc link khách vào Git. Snapshot trước release ở [07](07-cap-nhat-du-an-2026-10-28.md) và các evidence cũ giữ nguyên phạm vi lịch sử của chúng.

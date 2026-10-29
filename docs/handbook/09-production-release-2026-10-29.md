# 09 — Cập nhật production ngày 29/10/2026

## 1. Release đang chạy

Release được kích hoạt và kiểm trực tiếp ngày 29/10/2026:

| Mục | Giá trị |
|---|---|
| Git revision | `30ce096` — `chore: remove inactive services draft and refresh release docs` |
| Release folder | `20261029T022402692Z-9fd9d0c6` |
| Runtime | VPS iNET → Caddy/Cloudflare → PM2/Node 24.22.0 |
| Database/media | PostgreSQL Supabase + R2 private `chicong-production` |
| Worker | `chicong-drive.service` active; Drive thủ công bật, scheduler tắt |
| Feedback flags | API và notifications mở sau khi smoke maintenance pass |
| CI | GitHub Actions run `40806115510` thành công |

Release được stage bằng `npm run deploy:vps -- --stage`. Trong thời gian kích hoạt, maintenance lease được giữ, worker dừng và drain, baseline DB/media được chụp và kiểm tra, source được swap, rồi PM2/worker được khởi động lại. Bản rollback source vẫn được giữ riêng tại VPS. Baseline nằm ở `/var/backups/chicongphoto/production-baseline-20261029-30ce096`; không đưa backup, secret hoặc dữ liệu khách vào Git.

## 2. LIVE smoke đã chạy

- `/api/health` và trang chính trả 200.
- `freelancer.chicongphoto.vn` trả 200, `X-Robots-Tag: noindex, nofollow` và `Cache-Control: private,no-store`.
- `/api/admin/session` trả `200` với `authenticated:false` khi chưa đăng nhập.
- Link feedback không hợp lệ trả 403; payload không được xử lý như một link hợp lệ.
- Ba media public đọc qua R2 trả 200, `image/webp`, `private,no-cache`.
- `gallery-download.mjs` trên production có bản xử lý tên ZIP an toàn với Unicode.
- `/services` giữ compatibility redirect 302 về `/` sau khi draft không hoạt động đã được gỡ khỏi source.
- Media control sau unlock có `owner=null`, không có writer/unknown/cleanup; PM2 web và worker đều active.
- Read-only DB check ghi nhận 9 album (7 public), 1.223 ảnh, 1 admin, 7 lựa chọn, 1 inquiry và 0 handover/feedback.

Smoke xác nhận runtime, binding, route bảo mật và media path. Lượt này không gửi email thật, không sửa dữ liệu khách và không chạy Drive import mới.

## 3. Kiểm thử source và cleanup

- `npm run check`: 217 file JavaScript/config/shell pass.
- `npm run check:docs`: 68 Markdown, 503 link nội bộ pass.
- `npm test` trên Node 24: 475 pass, 52 skip có chủ đích, 0 fail.
- Browser smoke: 21/21 suite pass.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerability.
- Working tree sạch; thư mục `output/` trong project chỉ còn hai baseline backup được bảo vệ.

Lượt cleanup này gỡ draft `studio/web/services.mjs` và CSS dịch vụ không được dùng; route redirect vẫn được giữ để không làm hỏng link cũ. Evidence cũ được chuyển ra thư mục cleanup cục bộ ngoài project. Các snapshot/evidence lịch sử giữ nguyên ngày và phạm vi, không dùng làm bằng chứng cho release này.

## 4. Việc còn mở

Chưa nghiệm thu email recipient thật, full Supabase/PITR restore, reboot hoặc kill worker giữa import và benchmark 500/5.000 JPEG nguồn. Các mục này vẫn là cổng vận hành riêng; không suy ra từ test local hoặc smoke HTTP.

Mọi thay đổi sau release này phải tạo revision mới, stage và bổ sung record LIVE tương ứng. Không đưa secret, cookie, dump database, media backup hoặc link khách vào Git.

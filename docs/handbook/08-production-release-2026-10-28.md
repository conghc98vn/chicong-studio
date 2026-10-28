# 08 — Cập nhật production ngày 28/10/2026

## 1. Nguồn và trạng thái

Theo xác nhận của chủ dự án trong ngày 28/10/2026, bản tính năng mới đã được đưa lên production. Bản ghi này cập nhật handbook theo xác nhận đó; trong lượt tài liệu này không SSH vào VPS, không đọc process/env live, không gọi provider thật và không gửi email thật.

Vì chưa có commit triển khai, thời điểm restart, log health-check hoặc ảnh chụp cấu hình production đi kèm, trạng thái được ghi như sau:

| Mục | Trạng thái |
|---|---|
| Mã nguồn/tính năng | **Đã lên PROD theo xác nhận của chủ dự án** |
| Revision đang chạy | **Chưa ghi nhận**; cần lấy từ release folder/PM2 trước lần rollback sau |
| Runtime dự kiến | VPS iNET → Caddy/Cloudflare → PM2/Node 24 → PostgreSQL Supabase + R2 private |
| Feedback/handover | Đã mở khả năng vận hành production; chỉ cấp link sau khi kiểm secret, origin, quyền và trạng thái bàn giao |
| Email feedback | Chưa coi là giao thành công chỉ từ trạng thái queue; cần kiểm recipient, provider và một lần smoke được phép |
| Browser/edge | Chưa có bằng chứng LIVE trong lượt này; browser fixture/CI vẫn là TEST |
| Rollback/restore | Runbook đã cập nhật; chưa có bản ghi diễn tập production sau release |

Phạm vi được đối chiếu từ working tree hiện tại gồm feedback/handover, form và admin feedback, queue/retry email, freelancer site, bảo vệ inquiry cạnh tranh, hardening PostgreSQL, Drive/backup guards, browser runner/CI và các chỉnh sửa gallery/UI. Nếu release thực tế chỉ gồm một phần, sửa lại bảng này và ghi revision cụ thể; không dùng working tree làm thay thế manifest triển khai.

## 2. Việc phải chốt trong hồ sơ release

Người vận hành cần bổ sung các trường sau vào biên bản release hoặc hệ thống quản lý secret:

- revision/commit hoặc tên release folder thực sự đang chạy;
- thời điểm bắt đầu/kết thúc, người thực hiện và phương án rollback;
- kết quả migration/schema và số phiên bản backup runner tương thích;
- trạng thái `FEEDBACK_LINK_SECRET`, `FEEDBACK_API_PAUSED` và `FEEDBACK_NOTIFICATIONS_PAUSED` trên mọi instance;
- `SITE_URL`, `FREELANCER_HOST`, DNS/TLS và header `no-store/no-referrer/noindex` của `/feedback/*`;
- database/storage binding (`PostgreSQL Supabase` + bucket R2 private) và kết quả health/media smoke;
- recipient/provider email, một hồ sơ thử được phép và kết quả queue sau restart;
- manifest DB + media baseline ngoài VPS trước release và đường dẫn rollback.

Không đưa secret, token, link khách, dump DB hoặc ảnh khách vào commit hay tài liệu này. Chỉ ghi tên biến, nơi lưu secret và mã bằng chứng không nhạy cảm.

## 3. Checklist xác minh sau release

Đánh dấu **LIVE** chỉ sau khi chạy trên hostname production và lưu bằng chứng có thời gian:

- [ ] `/api/health` trả 200 và truy vấn đúng PostgreSQL production.
- [ ] Trang chính, `/admin`, album công khai và gallery riêng vẫn hoạt động; kiểm một gallery có mật khẩu bằng phiên khách.
- [ ] `/feedback/*` không cache riêng tư, không referrer, không index; không có analytics/beacon ngoài chủ ý qua Caddy/Cloudflare.
- [ ] Link feedback hợp lệ mở được; link sai, link đã thu hồi và hồ sơ chưa mở nhận đều bị từ chối đúng.
- [ ] Gửi mới, sửa bản đã gửi, hai tab, retry sau mất ACK và conflict version không tạo revision/notification trùng.
- [ ] Admin thấy bản mới nhất, lịch sử, unread và trạng thái email; lỗi email không làm mất feedback.
- [ ] Restart một instance không làm mất queue/lease; không tự gửi lại event cũ ngoài lựa chọn của người vận hành.
- [ ] Freelancer host trả `X-Robots-Tag: noindex, nofollow`, không làm lộ bảng giá trước khi nhập mã và không ảnh hưởng host chính.
- [ ] Drive vẫn giữ scheduler tắt nếu chưa có kế hoạch bật; worker đúng revision/binding.
- [ ] Backup DB + media sau release có manifest, checksum và đường dẫn restore; chưa gọi “đã khôi phục production” nếu chưa restore độc lập.

## 4. Giới hạn của bản ghi này

Kết quả `npm run check`, `npm run check:docs` và test Node 24 trong [snapshot 28/10](07-cap-nhat-du-an-2026-10-28.md) là **TEST local**. Báo cáo audit 23/10 là **REPORT** của source tại thời điểm đó. Chúng không thay cho các mục LIVE ở trên và không chứng minh deployment hiện tại không có lỗi.

Bản snapshot local ngày 28/10 vẫn được giữ để biết những gì đã có trong working tree trước khi release. Từ sau xác nhận production này, mọi sửa code tiếp theo phải ghi revision mới và cập nhật lại bản ghi release; không sửa hash hoặc kết quả lịch sử để biến chúng thành bằng chứng live.

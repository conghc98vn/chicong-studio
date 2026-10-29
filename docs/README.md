# Mục lục tài liệu

Cập nhật 29/10/2026. Mỗi chủ đề có một hướng dẫn chính; biên bản cũ được giữ trong `archive/` hoặc file có ngày, không dùng như hướng dẫn cấu hình hiện hành.

| Cần làm gì? | Đọc ở đâu? |
|---|---|
| Chạy và kiểm tra code | [README dự án](../README.md) |
| Sử dụng studio hằng ngày | [OPERATIONS](../OPERATIONS.md) |
| Hosting, release và rollback | [HOSTING](../HOSTING.md) |
| Trạng thái production được báo cáo, bằng chứng và giới hạn | [Handbook — bắt đầu tại đây](handbook/README.md) |
| Trạng thái release production mới nhất | [Biên bản production 29/10](handbook/09-production-release-2026-10-29.md) |
| Snapshot local trước release | [Handbook 28/10](archive/handbook/07-cap-nhat-du-an-2026-10-28.md) |
| Kiến trúc/API/dữ liệu | [01 — Kiến trúc](handbook/01-kien-truc-va-cong-nghe.md) |
| Credential, backup, restore và sự cố | [02 — Vận hành kỹ thuật](handbook/02-van-hanh-bi-mat-va-khoi-phuc.md) |
| Cách chạy test, ma trận rủi ro và bài lab | [03 — QA](handbook/03-phong-lab-qa.md) |
| Drive import, preview, duyệt và recovery | [Runbook Drive](google-drive-sync-operations.md) |
| Chuẩn bị ảnh `.ccphoto` | [Chuẩn bị ảnh local](local-photo-preparation.md) |
| Nối lịch Google | [Google Calendar](google-calendar.md) |
| Kết quả audit mới | [Review 23/10](review-2026-10-23.md) |
| Bằng chứng code/performance ngày 21/10 | [Review 21/10](review-2026-10-21.md) |
| Prompt audit áp dụng riêng cho project | [Prompt ChiCong Studio](project-audit-prompt.md) |
| Feedback: yêu cầu, cách dùng, cấu hình và trạng thái production | [Đặc tả feedback](customer-feedback-spec.md) |
| Tìm quyết định hoặc release cũ | [Lưu trữ lịch sử](archive/README.md) |

## Quy tắc cập nhật

- Hành vi ứng dụng thay đổi: cập nhật hướng dẫn chính tương ứng, không nối thêm một khối “cập nhật mới” mâu thuẫn với phần cũ.
- Một lượt release/audit: lưu biên bản có ngày, source/revision, môi trường, cách chạy, pass/fail/skip và giới hạn; cập nhật link từ handbook.
- Giữ nguyên snapshot/evidence lịch sử; không sửa hash cũ thành bằng chứng của code mới. Link file `output/` chỉ có trên máy thực hiện, không phải artifact bảo đảm có trong checkout sạch.
- Mẫu config không chứng minh cấu hình live. Kết quả đọc report phải ghi REPORT, chạy thử cách ly ghi TEST, xác nhận của chủ dự án ghi DEPLOYED-REPORTED, kiểm production trực tiếp mới ghi LIVE.
- Không đưa credential, ảnh khách, cookie, private ICS URL hay dump DB vào Git. Release production đang chạy `30ce096`; revision, baseline, log và live smoke được ghi ở [biên bản release](handbook/09-production-release-2026-10-29.md), còn secret không ghi vào tài liệu.
- `npm run check:docs` kiểm file đích của liên kết nội bộ; còn cần đọc lại nội dung và đối chiếu code. Lệnh này không xác minh cloud hoặc liên kết web ngoài.

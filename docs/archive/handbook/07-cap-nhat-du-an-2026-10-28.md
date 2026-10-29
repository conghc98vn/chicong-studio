# 07 — Snapshot trước release đến 28/10/2026

Đây là snapshot local trước release của handbook. Nó cập nhật các thay đổi xuất hiện sau audit 23/10; không phải biên bản deploy. Theo xác nhận sau đó, bản tính năng đã được đưa lên production; xem [biên bản production 28/10](08-production-release-2026-10-28.md) để đọc trạng thái mới. Snapshot này vẫn giữ nguyên để phân biệt TEST local với DEPLOYED-REPORTED/LIVE.

## 1. Có gì mới trong working tree?

| Khu vực | Thay đổi đã đọc | Trạng thái xác minh |
|---|---|---|
| Feedback/handover | Thêm schema, link token, form khách, admin, revision, receipt idempotency, notification queue, retry và recovery gate | Đã kiểm qua audit local; chưa phát hành production |
| Tư vấn | Snapshot `expected` và conditional update chống form cũ ghi đè status/date/notes | Regression SQLite/PostgreSQL trong audit 23/10 đạt |
| Drive backup | Chặn listing không đầy đủ, metadata sai và cursor lặp trước retention/xóa blob | Mock regression đạt; chưa chạy retention provider thật |
| Browser QA | Runner tách env, timeout từng suite, `CHROME_BIN`, evidence theo suite; workflow cài Playwright/axe pin ngoài project | Workflow đã khai báo; report 23/10 chưa xác nhận GitHub/Linux và branch protection |
| Gallery/UI | CSS gallery tách khỏi CSS admin; phân trang Drive rollback offset khi request detail lỗi; thêm kiểm form mật khẩu và inquiry | Browser suite local đạt theo report |
| Backup/restore feedback | Snapshot v3 gồm 34 bảng dài hạn; SQL/PITR có bước `prepare-restored` và gate bền vững trước reconcile | Đã kiểm fixture SQLite/PostgreSQL; chưa phải full Supabase/PITR production |

Các thay đổi nằm trong working tree và nhiều file còn untracked. Không suy từ số test hoặc source local rằng VPS đã nhận chúng. Bằng chứng chi tiết: [audit 23/10](../../review-2026-10-23.md), [evidence tổng hợp](../../evidence/customer-feedback-2026-10-23.json) và [kiểm tra release cô lập](../../evidence/customer-feedback-release-check-2026-10-23.json).

## 2. Kết quả kiểm thử mới nhất theo phạm vi

- Audit tiếp nối ghi **446/446 test PostgreSQL**, **390 pass + 49 skip PostgreSQL trên SQLite**, **17/17 browser suite**, **10 scan axe không violation được báo cáo**, **192 file syntax đạt**.
- Một report release cô lập khác ghi **524/527 PostgreSQL**, **469/520 SQLite**, cùng 7/7 raw-restore và 6/6 HTTPS-proxy; các số này là phạm vi release-packaging có skip có chủ đích, không cộng vào 446/446.
- Không có email thật, database production, storage production, Zalo thật hoặc ingress production trong các fixture. Audit không phải production acceptance.
- Với Node v24.22.1, `node --test studio/tests/*.test.mjs` hiện đạt **527 test: 475 pass, 0 fail, 52 skip**; các skip là nhánh cần PostgreSQL/điều kiện riêng. Chạy bằng Node v23.6.0 của shell thất bại khi import `node:sqlite` vì thiếu export `backup`, nên không dùng kết quả Node 23 để đánh giá code.
- `npm run check:docs` hiện kiểm 66 Markdown và 491 link file nội bộ; `npm run check` đã đạt trong lượt cập nhật handbook. Hai lệnh chỉ kiểm local, không thay browser CI hoặc cloud verification.

Axe có 9 rule `color-contrast` ở trạng thái **incomplete** qua các scan; không chuyển thành đạt WCAG. Browser CI đã có trong workflow nhưng cần một lần chạy Linux thật và branch protection bắt buộc trước khi gọi là release gate.

## 3. Feedback chưa được coi là production

Feedback có queue bền vững, version conflict, request key, link token, trạng thái provider và retry. Restore v3 thu hồi link/pause queue/suppress mail và đặt gate `feedback_restore_pending`; SQL dump/PITR không tự làm các bước này nếu không chạy `feedback-ops.mjs prepare-restored` với DB đích rõ ràng.

Trước release cần chốt signing key/secret riêng, recipient email, origin/HTTPS, retention và owner vận hành; kiểm staging Linux, deploy archive, migration/backup v3, recovery gate và notification provider. Không bật link cho khách thật hoặc dispatcher production chỉ vì local fixture đã pass.

## 4. Việc còn mở

1. Review và commit working tree theo nhóm thay đổi, sau đó chạy CI thật; giữ diff/untracked có chủ đích.
2. Nghiệm thu job browser/axe trên GitHub Linux và cấu hình branch protection.
3. Chốt lịch/retention/cảnh báo backup media; thử full cloud restore và reboot/kill worker trên môi trường phù hợp.
4. Đo workload JPEG 500/5.000 thật, đánh giá 284 ảnh legacy thiếu JPEG và throughput R2 trước tối ưu.
5. Chỉ sau các cổng trên mới cân nhắc phát hành feedback, bật dispatcher production hoặc bật scheduler Drive.

Các mốc 20–21/10 trong [handbook archive](../README.md) giữ bằng chứng production trước đợt thay đổi local này.

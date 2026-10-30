# 10 — Cleanup và release production ngày 30/10/2026

## 1. Phạm vi thay đổi

- Bỏ ba khai báo không có nơi sử dụng sau khi đối chiếu source, tests và scripts: `createDriveJobStore`, `INQUIRY_NOTIFICATION_STATES`, `selectionStatusLabels`.
- Bỏ lượt kiểm cú pháp `ecosystem.config.cjs` bị lặp trong script deploy; file vẫn được kiểm bởi `check-syntax.mjs` và ở bước stage trên VPS.
- Sửa bài lab email theo outbox hiện hành; bổ sung đủ ba cờ pause và yêu cầu backup v4 trong hướng dẫn kích hoạt/khôi phục. Thu gọn mô tả trùng ở mục lục lưu trữ.
- Gom trạng thái release hiện hành về [trang đầu handbook](README.md). Các runbook dẫn về đây; biên bản/hash lịch sử giữ nguyên.

Không đổi schema, dependency hoặc contract của portfolio, gallery, upload, Drive, inquiry và feedback. Các bản backup, dữ liệu local và ảnh khách được giữ lại.

## 2. Release và bản phục hồi

| Mục | Giá trị |
|---|---|
| Source runtime | `ae74fd2c00cdd540a8af2ed01a4c94ad3d274535` — `refactor: remove unused declarations and align operations docs` |
| Release folder | `20261030T030925409Z-79812111` |
| Kích hoạt | 30/10/2026 lúc 10:24:54, giờ Việt Nam (03:24:54 UTC) |
| Runtime | VPS iNET, PM2/Node 24.22.0, PostgreSQL Supabase, R2 private |
| Source rollback | `/var/www/chicongphoto-releases/rollback-20261030-active-7a6c039` |
| Baseline trên VPS | `/var/backups/chicongphoto/production-baseline-20261030-ae74fd2` |
| Bản sao ngoài VPS | `../_chicong-local-archive/production-baseline-20261030-ae74fd2/` trên máy thực hiện; ngoài checkout và ngoài Git |

Trước kích hoạt: giữ source/config cũ, lấy maintenance lease, dừng worker Drive, drain writer/cleanup, pause feedback API và cả hai dispatcher email. Baseline mới chứa DB + 3.386 object; verify checksum/mapping đạt trên VPS và bản sao ngoài VPS. Blob bất biến đã có được tái sử dụng, không xóa bản backup lịch sử.

Source được cập nhật khi web dừng; dependency lock không đổi. Runtime mới khởi động với các cờ pause, kiểm health và mapping media khớp baseline, rồi khôi phục cấu hình gốc, bật lại worker, unlock đúng lease và ghi `ACTIVATED`/manifest. Cả ba cờ pause trở về `false`; Drive thủ công bật, scheduler tắt. PM2 chạy fork nên bước restart có gián đoạn, không phải zero downtime.

## 3. Kiểm thử source và CI

- `npm test` local Node 24: **533 test, 481 pass, 52 skip, 0 fail**.
- `npm run check`: **220 file** JavaScript/config/shell đạt.
- `npm run check:docs` và `git diff --check` đạt sau khi cập nhật tài liệu.
- [GitHub Actions run 40995712831](https://github.com/conghc98vn/chicong-studio/actions/runs/40995712831) đúng SHA `ae74fd2c00cdd540a8af2ed01a4c94ad3d274535`: cả `test` và `browser-smoke` **success**. Job test có PostgreSQL 16; browser runner dùng fixture cách ly, Chromium/Playwright và axe theo workflow.

Browser smoke local không chạy vì checkout không cài Playwright; bằng chứng browser của release này là job CI phía trên.

## 4. LIVE smoke sau kích hoạt

- Qua domain thật: health, trang chủ, admin và freelancer trả 200. Ảnh public đọc và giải mã WebP thành công; module `ui-copy.mjs` phục vụ đúng nội dung source mới.
- Admin giữ `private,no-store`; session chưa đăng nhập trả `authenticated:false`; API danh sách album admin trả 401.
- Feedback API trả 503 khi pause; sau mở lại, link thử không hợp lệ trả **403 `LINK_UNAVAILABLE`**, giữ no-store/no-referrer. Probe đầu tiên kỳ vọng nhầm 404; đã đối chiếu contract và sửa probe, không đổi ứng dụng để khớp phép thử sai.
- DB còn 9 album, 1.223 ảnh, 1 inquiry, 0 handover/feedback/notification inquiry. Mapping media trước/sau khớp baseline.
- PM2 online, worker active/enabled; media control đã unlock, không còn writer/unknown/cleanup.

Lượt này không tạo inquiry/hồ sơ/ảnh thử trên production, không gửi email thật, không chạy Drive import hoặc sửa dữ liệu khách. CI và smoke đọc không thay nghiệm thu email recipient thật, full cloud restore, reboot/kill worker giữa import hoặc benchmark JPEG nguồn.

# Kiểm tra gallery: hiệu năng, UI/UX và chuyển động — 15/10/2026

> **Lưu trữ lịch sử:** kết luận và số đo thuộc mốc ghi trong báo cáo. Hướng dẫn hiện hành: [mục lục tài liệu](../README.md).

Kiểm tra trên working tree sau lượt sửa đồng bộ gallery, với album 900 ảnh giả lập có đủ ảnh ngang, dọc, vuông và các phần ảnh. HTTP server, SQLite và tệp ảnh đều tạm thời; không đọc hoặc sửa gallery khách hàng. Lượt này tập trung vào frontend, tương tác và animation; chạy lại các luồng API qua test và trình duyệt.

## Lỗi tái hiện và sửa

1. **Zoom che chú thích:** ảnh biến đổi kích thước trong cùng vùng cắt với chú thích, khiến chữ bị ảnh che trên desktop và màn hình ngang. Tách vùng hiển thị ảnh để zoom/pan chỉ nằm trong khung ảnh.
2. **Zoom nhảy thẳng tới kích thước cuối:** CSS public ghi đè transition của transform. Khôi phục chuyển động 200ms; khi kéo ảnh thì cập nhật trực tiếp, không thêm độ trễ transition. Chế độ giảm chuyển động vẫn tắt animation.
3. **Ảnh tiếp theo chưa tải xong nhưng vẫn phóng to được:** hiển thị rõ “Đang tải ảnh…”, ẩn ảnh cũ để tránh đi cùng chú thích mới, khóa zoom khi đang tải hoặc lỗi. Tải lại thành công mở lại zoom; phản hồi ảnh đến trễ không đưa người xem về ảnh cũ.
4. **Chú thích dài đẩy nút ra khỏi màn hình nhỏ:** khung ảnh co theo phần không gian còn lại; chú thích dài có vùng cuộn tối đa ba dòng, giữ các nút thao tác trong màn hình. Hỗ trợ focus và phím lên/xuống, Page Up/Down, Home/End, bao gồm WebKit không cuộn figcaption ổn định bằng phím mặc định. Tách thao tác trên chú thích khỏi thao tác kéo/zoom ảnh; kiểm tra cuộn bằng touch thật qua Chromium.

Đồng thời sửa độ ổn định của test: chờ focus thực sự được trả sau sự kiện đóng dialog; chặn ảnh lỗi trước khi lazy loading/preload đưa ảnh vào cache WebKit. Đây là sửa cách đồng bộ test, không phải bỏ qua assertion hoặc nới điều kiện đạt.

## Kết quả hiệu năng

Đo trên local bằng ảnh tổng hợp, không qua CDN và không nén tài nguyên trong server fixture. Các số dưới đây là số đo lab, không phải INP/LCP từ người dùng thật hoặc chứng nhận FPS trên điện thoại.

| Viewport | Gallery sẵn sàng | Request ảnh ban đầu | CLS |
| --- | ---: | ---: | ---: |
| 1440 × 1000 | 158 ms | 14 | 0 |
| 390 × 844, DPR 2 | 127 ms | 16 | 0 |
| 320 × 740, DPR 2 | 134 ms | 15 | 0 |

- Với CPU chậm 4 lần, mạng 1,5 Mbps và độ trễ 100 ms trên viewport 390px: gallery sẵn sàng **4,40 giây**, ảnh đầu giải mã xong **4,86 giây**, 16 request ảnh ban đầu, CLS 0. Có một long task 248 ms lúc khởi tạo. Tải đầu trên điều kiện này vẫn có khoảng chờ đáng kể; chưa coi đây là hiệu năng production.
- Các mẫu cuộn, kéo ảnh và chuyển ảnh liên tục dài khoảng 1,8 giây trên Chromium với CPU chậm 4 lần: khoảng cách khung hình p95 khoảng **16,7–16,8 ms**, không ghi nhận khoảng ngắt trên 50 ms hay long task trong những mẫu tương tác này.
- Trên WebKit, cuộn/kéo có p95 **17–19 ms**. Chuyển ảnh nhanh ở viewport 390px có p95 **42 ms**, một khoảng ngắt **52 ms**; các viewport còn lại khoảng 18 ms. Chưa khẳng định mọi tình huống trên Safari đều đạt 60 FPS. WebKit không cung cấp cùng phép đo Long Tasks như Chromium.
- Lượt này không thay thuật toán tải ảnh hoặc giảm chất lượng ảnh để đạt số đo. Tải ảnh lười và tải trước ảnh lân cận tiếp tục hoạt động; module tải JPG/ZIP vẫn tải theo nhu cầu.

## Regression cuối

Tất cả **10 lượt browser suite** trong `output/gallery-motion-review/verified/results.json` kết thúc với mã 0:

| Nhóm | Trình duyệt | Kết quả |
| --- | --- | --- |
| Motion/UI/UX | Chromium | 111 kiểm tra đạt |
| Motion/UI/UX | WebKit | 109 kiểm tra đạt |
| Gallery 900 ảnh, gồm mạng/CPU chậm | Chromium | 84 kiểm tra đạt |
| Đồng bộ danh sách chung, xác nhận cũ, mất ACK, hết phiên, upload hủy/retry | Chromium và WebKit | Đạt cả hai |
| JPG/ZIP, chia gói, hủy/retry, lỗi, keyboard focus | Chromium và WebKit | Đạt cả hai |
| Upload UX, kéo thả, hủy và thử lại | Chromium | Đạt |
| Upload thực: thành công một phần, mất ACK, phản hồi chậm, tệp lớn | Chromium và WebKit | Đạt cả hai |

Các bài motion chạy ở 1440×1000, 390×844, 844×390 và 320×568; gồm zoom, pan, chuyển liên tục, ảnh chậm/lỗi/retry, reduced motion, xoay màn hình, cuộn chú thích dài, giữ vị trí cuộn sâu và trả focus khi đóng. Kiểm tra touch swipe/double-tap nằm trong gallery và sync suite. Axe không ghi nhận vi phạm tự động trong các trạng thái gallery/lightbox/chú thích dài/upload/download đã quét.

Bộ test Node FE/BE: **218 đạt, 0 lỗi, 2 bỏ qua** do không cấu hình PostgreSQL cho lượt chạy này. Backend không thay đổi trong lượt sửa animation này; kết quả PostgreSQL của lượt đồng bộ trước được ghi riêng trong `gallery-sync-review-2026-10-15.md`.

Syntax JavaScript và `git diff --check` đều đạt.

## Chạy lại và bằng chứng

```sh
node studio/tests/gallery-motion-browser.smoke.mjs
STUDIO_BROWSER=webkit node studio/tests/gallery-motion-browser.smoke.mjs
STUDIO_GALLERY_SLOW=1 node studio/tests/gallery-view-browser.smoke.mjs
node --test studio/tests/*.test.mjs
```

Dùng `STUDIO_PLAYWRIGHT_MODULE` và `STUDIO_AXE_MODULE` trỏ tới module nếu Playwright/Axe được cài ngoài dự án. `STUDIO_BROWSER_EVIDENCE_DIR` đặt thư mục xuất ảnh và JSON. `STUDIO_MOTION_QUICK=1` chỉ chạy viewport 320×568 khi cần tái hiện nhanh.

Ảnh chụp, log và JSON của lượt cuối ở `output/gallery-motion-review/verified/` (gitignore). Snapshot trước sửa và các lần tái hiện lỗi ở `output/gallery-motion-review/before/`, `baseline-confirmed/`, `caption-probe/`, `keyboard-probe/`.

Chưa đo trên thiết bị iPhone/Android thật, mạng production hoặc lượng khách truy cập đồng thời. Các bài tự động và ảnh chụp không thay thế hoàn toàn thử nghiệm bằng thiết bị thật và công nghệ hỗ trợ.

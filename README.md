# ChiCong Studio · v2.2.1

Ứng dụng nhiếp ảnh cho **chicongphoto.vn**: portfolio công khai, quản trị album, gallery riêng để khách chọn/tải ảnh, nhận yêu cầu tư vấn và nhập ảnh từ Google Drive.

Theo biên bản ngày **21/10/2026**, production chạy **VPS iNET → PostgreSQL Supabase + R2 private**. Nhập Drive thủ công bật, scheduler tắt. Thay đổi trong working tree không đồng nghĩa đã triển khai. [Trạng thái và giới hạn xác minh](docs/handbook/README.md).

## Chạy local

Dùng **Node 24** để khớp CI và `.nvmrc`:

```sh
nvm use
npm ci
npm run dev
```

Nếu chưa cài bản Node trong `.nvmrc`, chạy `nvm install`; có thể dùng Node 24 được cài theo cách khác nếu không dùng nvm. Website ở `http://localhost:4173`, quản trị ở `http://localhost:4173/admin`. Backend cần restart sau khi sửa code; frontend chỉ cần tải lại trang.

Lần đầu tạo admin bằng email và mật khẩu từ 12 ký tự. Không có mật khẩu mặc định. `SETUP_TOKEN` bắt buộc khi chạy production, truy cập từ máy khác hoặc đã cấu hình token. Local dùng SQLite và ảnh trong `data/live/`; `npm run dev`/`npm start` nạp `.env` nếu có. Không chạy chúng để thử gửi email nếu `.env` chứa credential thật.

`npm run dev:lan` mở listen trên LAN; đặt `SITE_URL` đúng origin đang mở và `SETUP_TOKEN` khi chưa có admin. Origin ghi dữ liệu phải khớp `SITE_URL`. Node 22 cần ít nhất 22.16 vì công cụ preview dùng `node:sqlite.backup`; Node 23 không thuộc dải hỗ trợ. Lượt QA hiện tại chạy Node 24.

## Kiểm tra

```sh
npm run check
npm run check:docs
npm test
npm audit --omit=dev
```

`npm test` không tự nạp `.env`. Mặc định chạy SQLite; muốn kiểm PostgreSQL, cấp `STUDIO_TEST_POSTGRES_URL` trỏ tới **database dùng riêng cho test**. Các fixture tạo/xóa schema, không dùng URL production. Test lỗi kết nối chỉ ngắt PID do chính test tạo.

Trong code, `openDatabase(directory)` chọn SQLite; muốn PostgreSQL phải truyền `{url}` rõ ràng. `createApp({env: {}})` dùng cấu hình local cách ly, không kế thừa `DATABASE_URL`/`NODE_ENV` của terminal. Web, worker và CLI reset admin vẫn đọc cấu hình runtime của chúng và truyền URL vào DB.

```sh
STUDIO_TEST_POSTGRES_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/TEST_DB npm test
STUDIO_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
```

Browser runner chạy các suite với fixture riêng, cần Playwright và Google Chrome đã cài; `npm ci` chưa cài hai công cụ này. [Hướng dẫn QA và phạm vi từng suite](docs/handbook/03-phong-lab-qa.md). [Báo cáo rà soát hiện tại](docs/review-2026-10-21.md) lưu kết quả thực chạy, số đo và phần chưa xác minh.

## Tài liệu theo nhu cầu

| Nhu cầu | Tài liệu chính |
|---|---|
| Đăng ảnh, giao gallery, xử lý lựa chọn và tư vấn | [Vận hành studio](OPERATIONS.md) |
| Cấu hình máy chủ, chuẩn bị release và rollback | [Hosting](HOSTING.md) |
| Hiểu kiến trúc, credential, backup/restore và học QA | [Handbook](docs/handbook/README.md) |
| Nhập ảnh Drive, xem trước/duyệt, xử lý job lỗi | [Runbook Drive](docs/google-drive-sync-operations.md) |
| Chuẩn bị gói `.ccphoto` trên Mac | [Chuẩn bị ảnh](docs/local-photo-preparation.md) |
| Danh mục đầy đủ và báo cáo lịch sử | [Mục lục tài liệu](docs/README.md) |

## Bản đồ mã nguồn

- `studio/server/`: Express/API, auth, SQLite/PostgreSQL, storage, nhập ảnh và Drive worker.
- `studio/web/`: HTML/CSS/ES modules; không có bước build frontend. UI Drive tải khi vào quản trị đã đăng nhập.
- `studio/tools/`: chuẩn bị ảnh, preview cách ly, backup/verify/restore và lệnh worker.
- `studio/tests/`: unit/integration, browser smoke, benchmark và fixture riêng.
- `scripts/`, `ecosystem.config.cjs`: chuẩn bị release VPS, systemd worker và dump DB.
- `.env.example`: tên biến và ví dụ; không phải cấu hình đang chạy. `render.yaml` là cấu hình tham chiếu nếu sử dụng Render lại.

Git không lưu `.env`, ảnh khách, database, backup hoặc `output/`. JSON xuất từ admin chỉ là metadata, không thay bản backup DB + media. Hệ thống không giao RAW, không tự xác nhận booking/thanh toán; [feedback sau bàn giao](docs/customer-feedback-spec.md) vẫn là thiết kế chưa triển khai.

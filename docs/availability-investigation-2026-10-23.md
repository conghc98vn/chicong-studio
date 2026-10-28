# Kiểm tra gián đoạn website — 23/10/2026

Kiểm tra trực tiếp khoảng 23:18–23:24, giờ Việt Nam (UTC+7). Người dùng báo lỗi cách đó khoảng 5–10 phút và xác nhận thấy trang lỗi Cloudflare; chưa có mã lỗi chính xác, URL hoặc Ray ID. Đối chiếu rộng khung 23:00–23:22 để tránh suy đoán thời điểm.

## Kết luận trong phạm vi bằng chứng

Chưa xác định được nguyên nhân gốc của lần lỗi này. Không thấy bằng chứng tiến trình web/VPS bị sập hoặc tài nguyên cạn trong khung giờ kiểm tra. Cần đối chiếu lỗi ở Cloudflare với request cụ thể; ứng dụng vẫn có thể chậm hoặc trả lỗi dù process không restart. Không coi kiểm tra HTTP thành công sau sự cố là bằng chứng website luôn hoạt động.

## Kết quả trực tiếp

| Hạng mục | Quan sát |
|---|---|
| VPS | Uptime hơn 7 ngày; đĩa `/` dùng 41%, còn khoảng 12 GB. |
| Web PM2 | `chicong-photo` online; lần khởi động gần nhất 21/10 lúc 09:34:34; không có restart sau đó trong PM2 daemon log. RAM process khoảng 135 MiB. |
| Caddy | Active từ 16/10 lúc 21:21:51; không có journal entry trong 23:00–23:22 ngày 23/10. |
| Drive worker | Active từ 21/10 lúc 09:35:31; `NRestarts=0` trong chu kỳ service hiện tại. |
| CPU lịch sử | `sar` ở 23:10 và 23:20: idle 99,19% và 98,66%; load rất thấp. Đây là mẫu tổng hợp 10 phút, không loại trừ mọi spike ngắn. |
| RAM lịch sử | Available khoảng 1,3 GiB ở hai mốc trên. Không thấy OOM trong kernel journal từ 20/10. |
| Network/firewall | `sar` không có RX/TX error hoặc drop trong các mẫu; UFW cho phép TCP 80/443; không có log block cổng web, link-down hoặc conntrack-full trong 23:00–23:22. Không chứng minh đường truyền bên ngoài VPS luôn ổn định. |
| HTTP hiện tại | Trang chủ, admin, health ở domain gốc và health ở `www` trả 200. Health trả `{"ok":true}`. |
| Độ trễ origin | Ba lượt health qua Node loopback: 0,689 / 0,085 / 0,083 giây; qua Caddy loopback: 0,088 / 0,085 / 0,084 giây. Trang chủ loopback khoảng 0,251–0,253 giây. |
| Độ trễ qua Cloudflare | Health từ VPS: 1,702 / 0,402 / 0,326 giây. Các lượt từ máy local dao động khoảng 0,81–5,51 giây; đều 200 qua IPv4/default. Mẫu ít, không phải benchmark p95. |

Truy cập trực tiếp origin qua HTTP từ máy local trả health 200 trong 0,704 giây. Một probe ép IPv6 từ local timeout sau 12 giây; chưa xác định đường IPv6 của máy/mạng và không dùng kết quả này để giải thích trang lỗi Cloudflare mà người dùng thấy. Phản hồi Cloudflare IPv4 quan sát được đi qua SIN.

## Phân biệt lỗi có sẵn với sự cố vừa báo

- Caddy journal từ 20/10 có 257 lỗi 502/EOF. **Toàn bộ là method CONNECT với Host ngoài `chicongphoto.vn`/`www.chicongphoto.vn`**, phù hợp các lượt dò proxy; không phải bằng chứng 257 lần website của khách bị down. Lỗi cuối trong tập này lúc 17:51:12 ngày 23/10.
- Error log PM2 hiện tại rỗng; các log xoay vòng không ghi lỗi PostgreSQL disconnect gần đây. Lỗi certificate chain ở log 16/10 không trùng khung sự cố này.
- VPS **chưa có bản vá PostgreSQL reconnect** trong commit local `e4dcefc`: `db.mjs` đang chạy thiếu cả listener lỗi của pool và client transaction. Đây là rủi ro crash đã tái hiện ở audit local, cần release, nhưng không có restart/log để quy lần lỗi tối nay cho nó. Xem [audit 21/10](review-2026-10-21.md).
- `logrotate.service` lỗi vì thiếu `/var/log/cmd.log`; đĩa chưa đầy, PM2 có module logrotate riêng. Không có bằng chứng đây là nguyên nhân gián đoạn web.
- API trạng thái Cloudflare tại lúc kiểm tra có incident kết nối **North America**, tạo lúc 22:47:08 UTC+7, trạng thái `identified`. Không xác minh website chịu ảnh hưởng; không suy từ trùng thời gian thành nguyên nhân. [Thông báo](https://www.cloudflarestatus.com/incidents/sufgcbe8rrwt).

## Thiếu dữ liệu và bước xử lý

1. Lấy mã lỗi chính xác, URL, thời điểm và Ray ID của trang Cloudflare; đối chiếu Cloudflare Analytics/Origin Analytics hoặc hỗ trợ iNET. 522 là timeout khi Cloudflare liên lạc origin; mã 502/524 cần phân tích khác. [Tài liệu Cloudflare](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-522/).
2. Caddyfile hiện không bật access log. Nên bổ sung log có thời gian, status, duration và CF-Ray, đồng thời loại cookie/token, query string và hạn chế lưu đường dẫn gallery riêng. Thêm phép kiểm health bên ngoài và tại origin để phân biệt lỗi mạng, proxy và DB; chưa cấu hình trong lượt này.
3. Phát hành bản vá chống crash DB đã kiểm thử, theo quy trình release hiện hành; không đưa toàn bộ working tree chưa phát hành lên production chỉ để xử lý sự cố. Pool/client cần xử lý lỗi kết nối và không tự replay thao tác ghi chưa rõ kết quả. [Tài liệu node-postgres](https://node-postgres.com/features/pooling).

Lượt kiểm tra chỉ đọc cấu hình/log/thống kê và gửi các HTTP GET chẩn đoán; không restart, deploy, migrate, đổi firewall/DNS hay sửa dữ liệu production. File này là báo cáo mới local; các thay đổi working tree có sẵn được giữ nguyên.

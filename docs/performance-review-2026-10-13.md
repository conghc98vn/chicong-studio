# Hiệu năng — 13/10/2026

Tại thời điểm lập báo cáo: đã sửa tại workspace local, chưa commit/push/deploy. Các bản vá bảo mật trước đó được giữ nguyên. Không thay đổi database hoặc file ảnh gốc trong `data/live`.

## Kết quả trước/sau

Trung vị của 3 lần tải mới cho mỗi trang, chạy nhóm trước rồi nhóm sau. Baseline là bản sao mã nguồn sau bản vá security, trước các thay đổi perf.

| Trang | LCP trước | LCP sau | Giảm thời gian | Dữ liệu nhận trước → sau |
| --- | ---: | ---: | ---: | ---: |
| Trang chủ mobile | 6,352 s | 2,752 s | 56,7% | 1,016 → 0,504 MB |
| Trang chủ desktop | 7,212 s | 4,448 s | 38,3% | 1,384 → 0,892 MB |
| Album desktop | 20,252 s | 8,624 s | 57,4% | 3,107 → 1,605 MB |

LCP là thời điểm phần nội dung lớn nhất xuất hiện trong cửa sổ đo. Khoảng dao động trước/sau: mobile 6,340–6,376 / 2,748–2,772 giây; desktop 7,196–7,220 / 4,436–4,484 giây; album 20,228–20,616 / 8,600–8,644 giây.

Dữ liệu nhận là tổng `transferSize` của HTML và các resource đã hoàn thành đến 1 giây sau khi ảnh đầu tiên tải xong; dùng MB thập phân. Đây không phải dung lượng toàn bộ album khi cuộn hết trang. CLS quan sát dưới 0,004 cả trước và sau; không có lỗi JavaScript hoặc tràn ngang trong các lượt đo.

### Điều kiện và giới hạn

- Chrome headless, cache tắt, CPU chậm 4 lần; mạng mô phỏng 200.000 byte/s (1,6 Mbps), latency cấu hình 100 ms; mỗi lần đọc database thêm 20 ms độ trễ mô phỏng.
- Mobile 390 × 900, DPR 2; desktop 1440 × 900, DPR 1. Bật reduced motion để đo ảnh đầu tiên ổn định, không trộn tải autoplay vào kết quả.
- Bản sao tạm chứa 7 album công khai / 284 ảnh. Nguồn SQLite mở read-only, ảnh chỉ được đọc; dữ liệu chạy thử được xóa sau khi kết thúc.
- Server local không nén tài nguyên và không đi qua CDN/cloud storage. Production đã có gzip qua Cloudflare. Không suy diễn các số này thành tốc độ thực tế trên Render/Supabase hoặc điểm Lighthouse.
- Đã kiểm tra riêng autoplay/manual navigation trong Chrome với fixture tạm. Sau lần xem đầu, slide khác vẫn cần thời gian tải trước khi chuyển; ảnh đang xem được giữ cho đến khi ảnh kế tiếp decode thành công.
- Chưa có số đo sau deploy, dữ liệu người dùng thật, INP hoặc kiểm thử tải đồng thời. Album vẫn còn nặng trên mạng chậm; kết quả này không khẳng định đã hoàn tất mọi tối ưu có thể làm.

## Các thay đổi

1. **Tải sớm ảnh hero đang hiển thị:** HTML phát preload theo breakpoint, dùng cùng lựa chọn ảnh và `srcset` với frontend, kể cả fallback khi chưa cấu hình slideshow. Giúp bắt đầu tải trước khi JavaScript và API hoàn tất.
2. **Trì hoãn slide chưa xem:** dùng `data-src`/`data-srcset`, chỉ gán URL thật khi chuyển slide. `loading=lazy` trước đây vẫn tải cả các slide chồng trong viewport. Giữ decode, xử lý ảnh lỗi và reduced motion.
3. **Ảnh album theo kích thước từng ô:** `sizes` phản ánh tỷ lệ ảnh, số ảnh trong hàng, khoảng cách và breakpoint CSS. Ví dụ các ô rộng khoảng 202–556 px ở desktop dùng thumbnail phù hợp thay vì ảnh full 2400 px. Trình duyệt vẫn chọn full khi mật độ điểm ảnh yêu cầu; lightbox vẫn dùng ảnh full, không nén lại ảnh gốc.
4. **Tái sử dụng dữ liệu public đã đọc để dựng HTML:** nhúng JSON không thực thi, escape dấu `<`, tiêu thụ một lần theo đúng đường dẫn. Trang chủ/portfolio không gọi lại `/api/site` và `/api/portfolio?view=cards`. Tổng truy vấn dựng trang chủ và dữ liệu frontend giảm từ 9 xuống 3, không tính truy vấn phân quyền media. Những lần tải sau vẫn lấy dữ liệu mới; không giữ cache album trong bộ nhớ server.
5. **Gộp truy vấn danh sách album:** API portfolio đầy đủ từ `1 + 2N` truy vấn xuống 3 với danh sách không rỗng; admin từ `2 + 2N` xuống 4, gồm kiểm tra session. Thứ tự ảnh, selections và trường riêng của admin được giữ nguyên. Kiểm thử dùng 8 album public + 1 private xác nhận số truy vấn không tăng theo từng album.

Dữ liệu nhúng chỉ có cấu hình public và cards của album published. Trang admin, gallery, album riêng và 404 không có bootstrap data/preload. HTML public dùng `private,no-cache`; ảnh vẫn kiểm tra quyền trước 304. Không mở lại cache CDN công khai cho media để đổi lấy tốc độ.

## Xác minh

- `npm test`: 94 pass, 1 skip do chưa bật PostgreSQL.
- `STUDIO_TEST_POSTGRES_URL=... npm test` với PostgreSQL 16 trong container tạm: **95/95 pass**, không skip. Các fixture hỗ trợ PostgreSQL dùng schema riêng và xóa sau chạy; những bài chỉ dùng SQLite vẫn chạy trên SQLite.
- `npm run check` và `git diff --check`: pass.
- Chrome smoke: tạo/sửa album, upload 3 ảnh, bootstrap không gọi API trùng, slide trì hoãn/manual/autoplay, điều hướng/canonical, ảnh theo hàng tại 390/800/1440 px, lightbox full resolution, giao diện admin mobile và không có page error.
- Kiểm tra ảnh chụp trước/sau trang chủ mobile/desktop và album desktop: giữ bố cục, ảnh và nội dung.
- Kiểm thử mới bảo vệ escape JSON chống đóng thẻ script, loại dữ liệu private khỏi HTML, consume-once/fallback, số truy vấn batch, selections/order và nguồn ảnh preload.

## Chạy lại

Chạy từ gốc repository. Playwright và Chrome cần có sẵn; có thể chỉ định đường dẫn module Playwright qua `STUDIO_PLAYWRIGHT_MODULE`. Benchmark không tự cài trình duyệt hoặc dependency.

```sh
# Mã hiện tại; nguồn dữ liệu mặc định data/live, chỉ đọc.
PERF_RUNS=3 node studio/tests/performance-benchmark.mjs after

# So sánh với bản mã đã giữ lại trước khi sửa perf.
STUDIO_PERF_SOURCE="$PWD/output/perf-baseline-2026-10-13" PERF_RUNS=3 node studio/tests/performance-benchmark.mjs before

# Kiểm thử tương tác với dữ liệu tạm độc lập.
node studio/tests/album-slug-browser.smoke.mjs
```

Có thể đổi nguồn dữ liệu bằng `STUDIO_PERF_DATA_DIR` (thư mục chứa `studio.sqlite` và `uploads`). `STUDIO_PERF_SOURCE` cần trỏ đến bản mã có thể resolve dependency, không phải dữ liệu. Chạy before và after lần lượt để giảm nhiễu do hai trình duyệt đo cùng lúc.

Benchmark tái sử dụng lưu JSON/screenshot vào `output/perf-{label}*`. Bằng chứng của lượt đo ngày này nằm trong `output/perf-before-2026-10-13.json`, `output/perf-after-2026-10-13.json`, ảnh `output/perf-before-*.png` / `output/perf-after-*.png` và log `output/perf-tests-postgres.txt`, `output/perf-browser.log`. Thư mục output và baseline là hiện vật local bị gitignore; script benchmark và báo cáo được để trong mã nguồn để tái chạy.

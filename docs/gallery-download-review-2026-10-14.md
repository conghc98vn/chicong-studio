# Tải ảnh đã chọn — kiểm tra ngày 14/10/2026

## Hành vi

- Gallery riêng có nút **Tải ảnh đã chọn**, dùng toàn bộ lựa chọn trong album, kể cả khi đang lọc một section.
- Một ảnh tải JPG; nhiều ảnh tải ZIP. Danh sách lớn chia gói tối đa 50 ảnh, tải từng gói bằng thao tác chủ động.
- Khi gói vượt 100 MiB, có nút chia nhỏ tiếp mà không bỏ chọn ảnh. Có trạng thái chuẩn bị/nhận tệp, hủy, thử lại, cập nhật danh sách khi lựa chọn thay đổi và mở lại gallery khi hết phiên. Tải không tự gửi lựa chọn cho studio và không thay đổi trạng thái đã gửi.
- Khách không cần truy cập Drive. Ảnh mới có JPG tạo từ đầu vào; ảnh cũ dùng bản WebP lớn nhất, không dùng thumbnail. Không phục hồi độ chi tiết gốc từ WebP cũ.

## Chất lượng và dung lượng đo thực tế

JPG: cạnh dài tối đa 2400 px, quality 92, 4:4:4, ICC sRGB, tự xoay đúng chiều, không phóng lớn, không giữ EXIF/GPS. Không giới hạn cứng một mức KB. Ảnh có alpha chuyển sang nền trắng. JPG lưu từ nguồn dùng mozjpeg để giảm dung lượng; ảnh cũ chuyển theo yêu cầu dùng encoder nhanh, giữ cùng quality/kích thước/chroma để giảm thời gian đợi.

| Ảnh Lightroom | Đầu vào | WebP lớn | Thumbnail | JPG tải | Tổng lưu |
|---|---:|---:|---:|---:|---:|
| CC - 0546.jpg | 7.221.518 B | 639.330 B | 111.082 B | 1.248.703 B | 1.999.115 B |
| CC - 0201.jpg | 6.018.278 B | 351.320 B | 54.478 B | 749.108 B | 1.154.906 B |

JPG lớn hơn thử nghiệm 2048px/q90 trước đó để ưu tiên chi tiết. Đã đối chiếu vùng mặt/tóc với nguồn cùng kích thước 2400px; vẫn có nén mất dữ liệu, không phải bản Lightroom nguyên gốc. Chưa thử đăng lên Facebook thật. Không thay đổi file nguồn của người dùng.

## Kiểm soát tải và lưu trữ

- Kiểm tra phiên đúng album, ID thuộc album và đang được chọn, cả trước lẫn ngay trước khi gửi tệp. Gallery đóng/đổi mật khẩu/bỏ chọn trong lúc chuẩn bị khiến lượt tải bị từ chối.
- File tạm và ZIP được chuẩn bị hoàn chỉnh trước khi gửi: lỗi một ảnh không trả về một ZIP thiếu ảnh. Xử lý lần lượt, không giữ toàn bộ album trong RAM server.
- Tối đa 100 MiB/tệp, một lượt/album, hai lượt/server, giới hạn thời gian 3 phút; dọn tệp tạm khi xong, hủy hoặc lỗi. Trình duyệt chỉ lưu sau khi đã nhận đủ dữ liệu.
- Tên file làm sạch đường dẫn/ký tự điều khiển, giữ Unicode hợp lệ, giới hạn byte và đánh số để tránh trùng trong ZIP. Download dùng private,no-store.
- Input vẫn tối đa 8 MiB/40MP. Supabase bucket private cho phép WebP/JPEG, đối tượng lưu tối thiểu 24 MiB; giữ giới hạn lớn hơn hoặc không giới hạn. Điều này xử lý ảnh nhiều chi tiết: input hợp lệ có thể sinh JPG hơn 8 MiB.
- Đã sửa lỗi tên dài cắt đôi emoji gây HTTP503, và lỗi hủy trong lúc kiểm tra database vẫn tiếp tục đọc ảnh.

## Bản xem local

Gallery thử: http://localhost:4173/gallery/db5c8eb7129639350f0126328989b823

Mật khẩu thử: `xemthu2026`. Dữ liệu nằm trong bản preview tách biệt, gồm đúng hai file Lightroom mẫu. Website production, Google Drive và bản gốc không được sửa.

## Phạm vi kiểm thử

- Toàn bộ **148/148 test đạt**, không bỏ qua; gồm tích hợp PostgreSQL 16 trong container riêng, migration, phân phần, upload, lưu trữ, API tải và client.
- `npm run check`, `git diff --check` đạt; `npm audit` không ghi nhận lỗ hổng.
- Chromium và WebKit với đúng hai ảnh Lightroom mẫu: giải mã JPG/ZIP thật; ảnh chưa chọn không lọt vào tệp; lấy lựa chọn xuyên phần; hủy/retry, lỗi lưu trữ, phiên hết hạn, cập nhật danh sách, focus/Escape, chia 51 ảnh thành 50+1 và phục hồi khi gói quá lớn. Kiểm tra 320/390/768/1440 px; không có lỗi JavaScript, axe 0 vi phạm tự động tại các màn hình đã kiểm tra.
- Upload browser: ảnh thật, thành công một phần, phản hồi bị mất, retry không nhân đôi, ảnh quá giới hạn, số đo dung lượng, responsive và lightbox. Phân phần: 18 tình huống UX đạt. Public UI: cả hai engine, 5 trang, 4 độ rộng, form gửi dùng mock.
- Bằng chứng trong `output/gallery-download-final/`, `output/final-ui-audit/` (gitignore); test và dữ liệu preview tách biệt production.

## Hiệu năng tải ảnh

Đo local, SQLite và ổ đĩa local, 50 ảnh luân phiên từ hai file thật; client nhận theo stream. Không phải phép đo tải đồng thời hoặc qua Supabase.

| Gói 50 ảnh | Dung lượng ZIP | Chuẩn bị trước khi gửi | Toàn bộ lượt local |
|---|---:|---:|---:|
| Ảnh mới, JPG có sẵn | 49.952.027 B | 315 ms | 445 ms |
| Ảnh cũ, chuyển WebP → JPG | 48.621.952 B | 4.300 ms | 4.413 ms |

Chuyển ảnh cũ trước tối ưu mất 26.589 ms; sau tối ưu còn 4.300 ms, giảm khoảng **84%**. Đổi lại ZIP tăng từ 43.294.552 lên 48.621.952 byte, khoảng **12%** trên bộ mẫu; không lưu thêm rendition cho ảnh cũ. Đã xem vùng mặt/tóc của JPEG nhanh; giữ quality 92 và 4:4:4, không ép giảm chất lượng để đạt mức KB. Hai encoder không cho đầu ra giống từng byte.

RSS cả tiến trình ở lượt cuối: khoảng 300 MiB sau upload, đỉnh 343 MiB khi chuyển gói cũ. Đây gồm Sharp/cache và runtime, không phải chỉ bộ nhớ ZIP. Chỉ xử lý lần lượt từng ảnh; server giới hạn hai tác vụ đồng thời.

Chưa thử tải cao trên hosting, thiết bị iOS/Android vật lý hoặc đăng Facebook thật; Facebook có thể nén lại. Ảnh cũ chỉ có chất lượng của WebP đang lưu. Không có lỗi còn tái hiện trong phạm vi kiểm tra trên.

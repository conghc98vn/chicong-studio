# Chuẩn bị ảnh trên Mac trước khi đăng website

Công cụ xử lý cả thư mục ảnh đã xuất Lightroom. Ảnh gốc được giữ nguyên; không cần xuất lại Lightroom hoặc chuyển từng ảnh thủ công. Không cần đăng nhập website/Drive để chạy và công cụ không tự tải ảnh lên mạng.

## Cách dùng hằng ngày

1. Mở `scripts/prepare-photos.command` bằng cách nhấp đúp trong Finder. Kéo **thư mục ảnh (hoặc kéo cùng lúc nhiều thư mục phần ảnh)** từ Finder vào cửa sổ Terminal, rồi nhấn Enter. Có thể chọn thư mục timeline gồm các thư mục section bên trong, hoặc kéo trực tiếp các thư mục section.
2. Đợi công cụ báo hoàn tất. Đường dẫn thư mục kết quả được in cuối màn hình. Mỗi ảnh có một tệp, ví dụ `CC - 0546.jpg.ccphoto`; cấu trúc các section được giữ nguyên.
3. Mở bộ ảnh trong admin website, chọn đúng **Tải ảnh vào phần**, rồi chọn các tệp `.ccphoto` trong thư mục tương ứng và bấm **Tải ảnh lên**. Lặp lại cho các phần khác. Công cụ không tự tạo hoặc gán section theo tên thư mục.

Source hiện tại hỗ trợ `.ccphoto`; kiểm deployment đang chạy cùng phiên bản hỗ trợ trước khi dùng trên host mới. JPEG/PNG/WebP vẫn là lựa chọn upload trực tiếp.

Tệp `.ccphoto` là gói dành cho website, không phải tệp gửi khách hoặc đăng Facebook. Khách tiếp tục dùng chức năng **tải ảnh đã chọn** để nhận JPG.

## Chất lượng và dung lượng

Mỗi gói chứa ba bản được tạo **trực tiếp từ ảnh Lightroom**, không lấy bản đã nén để tạo bản tiếp theo:

- WebP xem ảnh: cạnh dài tối đa 2400 px, quality 88.
- WebP thu nhỏ: cạnh dài tối đa 900 px, quality 80.
- JPG khách tải về: cạnh dài tối đa 2400 px, quality 92, 4:4:4, ICC sRGB.

Đây là cùng cấu hình tối ưu đang dùng trên website. Tự xoay đúng chiều, chuyển sRGB, không phóng lớn, không chỉnh sáng/màu hay thêm nét. EXIF/GPS được bỏ. Không ép ảnh xuống một số KB cố định vì ảnh nhiều chi tiết cần nhiều dữ liệu hơn. Bản gốc để in/chỉnh sửa vẫn nằm ở nơi bạn đã backup.

Máy chủ kiểm tra gói và lưu nguyên byte của ba bản, không nén lại. Vì vậy giảm cả dung lượng phải truyền và công việc nén ảnh trên hosting. Tốc độ upload cuối cùng còn phụ thuộc mạng và storage; công cụ không tự sửa lỗi kết nối hoặc dịch vụ lưu trữ.

## Chạy lại, lỗi và an toàn dữ liệu

- Hỗ trợ JPEG, PNG, WebP tĩnh, tối đa 20 MiB và 40 megapixel/ảnh, cùng giới hạn hiện tại của website.
- Dùng thư mục kết quả riêng bên ngoài thư mục nguồn. Công cụ không sửa/xóa ảnh nguồn, không đi theo symlink.
- Có thể chạy lại cùng nguồn và thư mục kết quả: ảnh không đổi được bỏ qua sau khi kiểm tra; ảnh nguồn thay đổi được chuẩn bị lại nếu đầu ra là gói hợp lệ của chính ảnh đó. Tệp đầu ra lạ/hỏng không bị ghi đè âm thầm.
- Ảnh lỗi được ghi rõ tên và lý do, các ảnh còn lại tiếp tục xử lý. Xem báo cáo cuối lượt và thư mục `_reports` trong kết quả. Sửa ảnh lỗi rồi chạy lại.
- Nếu cần dừng, nhấn Ctrl+C; những gói đã hoàn tất được giữ để chạy tiếp lần sau. Không upload tệp tạm hoặc báo cáo.
- Việc chạy lại công cụ không đăng ảnh lên web. Khi upload, mặc định **Bỏ qua ảnh trùng** theo tên trong album; **Ghi đè ảnh trùng** thay nội dung ảnh upload tay và giữ lựa chọn của khách. Trong một lượt lỗi mạng, giữ nguyên trang và dùng **Tải lại các ảnh còn lại** để tái dùng mã retry.

## Dùng bằng lệnh

Cần Node.js 24 (khuyến nghị theo `.nvmrc`) hoặc Node 22 từ 22.16 và thư viện của project đã cài bằng `npm ci`. Launcher báo rõ khi thiếu, không tự cài phần mềm.

```sh
npm run photos:prepare -- "/đường/dẫn/01_Phan_Loai_Timeline"
npm run photos:prepare -- "/album/01_Trang_tri" "/album/02_Nha_gai"
npm run photos:prepare -- "/đường/dẫn/01_Phan_Loai_Timeline" --output "/đường/dẫn/anh-web"
npm run photos:prepare -- "/đường/dẫn/01_Phan_Loai_Timeline" --dry-run
```

Có thể đưa một tệp ảnh thay cho thư mục. Tham khảo `npm run photos:prepare -- --help` để xem cú pháp. Không trỏ thư mục kết quả vào trong thư mục nguồn.

## Ghi chú bảo trì

Định dạng `.ccphoto` có phiên bản, độ dài từng thành phần và SHA-256; không dùng ZIP hoặc giải nén đường dẫn. Máy chủ kiểm tra đầy đủ cấu trúc, giới hạn, ảnh thực tế, metadata và kích thước trước khi lưu. Khi thay đổi thông số tạo ảnh hoặc hợp đồng gói, cần cập nhật phiên bản chính sách và kiểm thử tương thích/resume.

## Kết quả kiểm tra ngày 14/10/2026

Biên bản lịch sử của công cụ; số test và trạng thái triển khai dưới đây chỉ thuộc ngày 14/10. Kết quả kiểm chứng mới nằm ở [review 23/10](review-2026-10-23.md).

- Toàn project: **181/181 test pass**, có PostgreSQL 16, không bỏ qua test. Kiểm tra cú pháp JavaScript và Bash đều đạt.
- Upload mới trên Chrome và WebKit: ảnh nguồn/gói chuẩn bị dùng chung một lượt, đúng section và tên ảnh, mất phản hồi rồi thử lại không nhân đôi, gói hỏng báo riêng, JPG khách tải đúng từng byte. Kiểm tra responsive 320/390/768/1440 px và axe không có vi phạm. Đã chạy thêm bằng hai ảnh Lightroom thực tế.
- Regression upload nguồn và ảnh chân dung trên WebKit: ảnh trên 10 MiB, phản hồi chậm, lỗi mạng, thử lại, giới hạn dung lượng, lightbox và số liệu sau reload đều đạt.
- Launcher trên Mac chạy được từ thư mục khác, nhận đường dẫn có khoảng trắng/tiếng Việt. Kiểm tra nguồn không bị sửa, resume, hủy, output trùng tên và symlink.
- Nhóm 66 ảnh thực tế: **432.246.011 → 93.939.266 byte**, giảm khoảng **78,3%** dữ liệu cần tải (gồm cả ba bản), xử lý khoảng 126 giây trên Mac. Chạy lại bỏ qua 66 ảnh không đổi, 0 lỗi.
- Gói tạo trên Mac được đọc thành công trên Linux arm64, Node 24, Sharp 0.35.5; profile sRGB tương thích. Mô phỏng Docker giới hạn 0,15 CPU/512 MiB: kiểm tra gói mất 1,6–2,5 giây/ảnh; lần đo nén ảnh nguồn trước đó mất 19,8–31,3 giây. Đây là số đo local, không gồm mạng/storage và không khẳng định lỗi timeout production đã hết.

Lượt ngày 14/10 chỉ cập nhật code và công cụ local. Khi triển khai trên host mới, thử một gói trước khi tải cả section; đối chiếu [handbook](handbook/README.md) cho trạng thái production được báo cáo gần nhất.

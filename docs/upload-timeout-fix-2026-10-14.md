# Upload timeout trên hosting — 14/10/2026

## Lỗi và bằng chứng

Ảnh người dùng gửi cho thấy 66 file, 423,4 MB, chưa được máy chủ xác nhận. JavaScript production vẫn dùng timeout 12 giây cho mọi request, gồm multipart upload. Ngân sách này tính cả truyền dữ liệu, tối ưu ảnh và lưu ba rendition. Trình duyệt có thể tự hủy trước khi nhận được kết quả và hiển thị thông báo mạng chung.

Tái hiện trước sửa: browser upload tới server tạm thật, server lưu ảnh rồi giữ phản hồi thêm 13 giây. Bản cũ không nhận được xác nhận và test thất bại. Sau sửa: cùng kịch bản nhận đủ kết quả và không hiện lỗi mạng. Điều này xác nhận lỗi timeout; không khẳng định mọi trường hợp ngắt kết nối đều do nguyên nhân này.

Log Render từ 21:30–21:40 giờ Việt Nam không ghi nhận crash/OOM; mẫu RAM khoảng 83–95 MiB trên giới hạn 512 MiB sau khi service live. Không có request log đủ để đo chính xác request trong ảnh chụp. Trang quản trị album được mở ở tab kiểm tra riêng, cho thấy 0 ảnh; không thao tác upload hay thay dữ liệu production.

## Thay đổi

- Upload có timeout riêng 180 giây; API thông thường giữ 12 giây.
- Gửi lần lượt một ảnh/request để xác nhận và cập nhật tiến độ từng ảnh, tránh dồn nhiều lần encode vào cùng một response.
- Giữ khóa từng file trong hàng đợi; khi retry, ảnh đã lưu được nhận diện và không tạo bản trùng trong cùng lượt.
- Phân biệt hết thời gian chờ với lỗi mạng; giữ HTTP status khi proxy trả HTML thay JSON (ví dụ 502).
- Không đổi kích thước, quality, màu, encoder hoặc chính sách giữ ảnh nguồn.

## Kiểm thử

- Node 24: **153/153 test đạt**, gồm PostgreSQL 16 độc lập. Test mới bao phủ timeout thường/upload, multipart/khóa retry, timer cleanup, proxy HTML/JSON errors và hàng đợi 66 ảnh 6 MiB gửi tuần tự.
- Browser upload dùng hai ảnh Lightroom thật; test server đã lưu nhưng chậm xác nhận hơn 12 giây, phản hồi bị mất/retry, ảnh hỏng, quá dung lượng, responsive/accessibility và lightbox: đạt.
- Tám lượt smoke public/hero/slugs/sections/sections UX/upload/download Chromium/download WebKit: đạt. Syntax và diff checks đạt.
- Không test bằng cách upload thêm ảnh vào album production.

## Triển khai

Render thực tế bật Auto-Deploy On Commit, nên push main trước đó đã tự triển khai dù không gọi deploy thủ công. Theo yêu cầu người dùng muốn tự deploy, đã chuyển riêng dịch vụ chicong-photo-studio sang Off trên Dashboard và xác nhận qua API (`autoDeploy: no`, `autoDeployTrigger: off`) trước khi push hotfix. Không gọi deploy bản sửa.

Sau khi deploy thủ công thành công, cần tải lại trang quản trị để nhận module JavaScript mới. Tab cũ vẫn chạy timeout 12 giây. Kiểm tra số ảnh đã lưu trước khi chọn lại file: mở lại trang sẽ tạo một lượt upload mới, không dùng các khóa retry của tab cũ. Tại thời điểm kiểm tra album của sự cố có 0 ảnh.

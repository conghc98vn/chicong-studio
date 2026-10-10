import { inquiryNotice } from './ui-copy.mjs';

// Shared public copy keeps server-rendered and browser content in sync.
export const servicesDescription='Chụp ảnh ngày cưới bằng máy số, film hoặc kết hợp cả hai. Tìm hiểu cách chụp, quy trình làm việc và trao đổi để nhận báo giá phù hợp với ngày cưới của hai bạn.';
export function servicesMarkup(){return `
<section class="page-width page-title services-title">
 <p class="label">CHỤP ẢNH NGÀY CƯỚI</p>
 <h1>Một ngày của hai bạn.<br><em>Một cách kể riêng.</em></h1>
 <p>Từ lúc chuẩn bị, lễ gia tiên đến những khoảnh khắc bên gia đình và bạn bè, mình cùng hai bạn chọn cách ghi lại những điều muốn lưu giữ trong ngày cưới.</p>
 <a class="underlink" href="/contact">Trao đổi và nhận báo giá <span aria-hidden="true">↗</span></a>
</section>
<section class="page-width services-section" aria-labelledby="services-options">
 <div class="section-top"><div><p class="label">CHỌN CÁCH GHI LẠI</p><h2 id="services-options">Máy số, film<br><em>hay cả hai?</em></h2></div><p>Hai bạn chưa cần quyết định ngay. Hãy xem những bộ ảnh đã chụp và kể mình nghe điều hai bạn yêu thích.</p></div>
 <div class="service-options">
  <article><p class="label">01 · MÁY SỐ</p><h3>Những khoảnh khắc nối tiếp.</h3><p>Dành cho hai bạn muốn ghi lại diễn biến ngày cưới, từ những cử chỉ nhỏ đến không khí bên người thân. Mình cùng trao đổi lịch trình để xác định những phần cần chụp.</p><a class="underlink" href="/portfolio">Xem các bộ ảnh <span aria-hidden="true">↗</span></a></article>
  <article><p class="label">02 · FILM</p><h3>Một nhịp nhìn chậm hơn.</h3><p>Dành cho hai bạn yêu màu sắc và chất hạt của ảnh film. Trước buổi chụp, mình cùng xem ảnh tham khảo, trao đổi số cuộn film và những khoảnh khắc muốn ghi lại.</p><a class="underlink" href="/portfolio">Xem các bộ ảnh <span aria-hidden="true">↗</span></a></article>
  <article><p class="label">03 · FILM & MÁY SỐ</p><h3>Hai chất ảnh, cùng một ngày.</h3><p>Kết hợp film và máy số để kể câu chuyện ngày cưới. Mình cùng hai bạn chọn những phần chụp bằng mỗi loại máy, dựa trên lịch trình, sở thích và ngân sách.</p><a class="underlink" href="/contact">Trao đổi cách kết hợp <span aria-hidden="true">↗</span></a></article>
 </div>
</section>
<section class="page-width services-section services-process" aria-labelledby="services-process">
 <div><p class="label">CÁCH MÌNH LÀM VIỆC</p><h2 id="services-process">Bắt đầu từ<br><em>một cuộc trò chuyện.</em></h2><p>Hai bạn có thể nhắn cho mình ngay khi mới có dự định, dù kế hoạch vẫn còn đang chuẩn bị.</p></div>
 <ol class="service-steps">
  <li><h3>Kể mình nghe dự định</h3><p>Chia sẻ ngày dự kiến, địa điểm, các phần lễ hoặc tiệc cần chụp và vài bộ ảnh hai bạn thích. Hai bạn vẫn có thể hỏi tư vấn khi chưa chốt ngày.</p></li>
  <li><h3>Trao đổi cách chụp và báo giá</h3><p>Mình cùng hai bạn làm rõ thời lượng, cách chụp và các hạng mục cần thực hiện. Báo giá được gửi riêng dựa trên những thông tin đã trao đổi.</p></li>
  <li><h3>Xác nhận lịch chụp</h3><p>Hai bên thống nhất ngày chụp, các hạng mục, điều kiện đặt lịch và cách nhận ảnh trước khi xác nhận. ${inquiryNotice}</p></li>
  <li><h3>Chụp và bàn giao bộ ảnh</h3><p>Buổi chụp diễn ra theo lịch trình đã thống nhất. Bộ ảnh được bàn giao theo số lượng, thời gian và cách nhận ảnh hai bên đã thỏa thuận khi đặt lịch.</p></li>
 </ol>
</section>
<section class="page-width services-section services-quote" aria-labelledby="services-quote">
 <p class="label">BÁO GIÁ CHO NGÀY CƯỚI</p><h2 id="services-quote">Bắt đầu với những điều<br><em>hai bạn đã biết.</em></h2>
 <p>Ngày và địa điểm dự kiến · Lễ hoặc tiệc cần chụp · Film, máy số hoặc cả hai · Ngân sách dự kiến.</p>
 <p>Hai bạn có thể chia sẻ những gì đã biết và để lại thông tin liên hệ. Những phần chưa quyết định, mình sẽ cùng trao đổi thêm khi tư vấn.</p><a class="underlink" href="/contact">Kể mình nghe dự định <span aria-hidden="true">↗</span></a>
</section>
<section class="page-width services-section services-faq" aria-labelledby="services-faq">
 <div><p class="label">TRƯỚC KHI NHẮN MÌNH</p><h2 id="services-faq">Có thể hai bạn<br><em>đang muốn hỏi.</em></h2></div>
 <div>
 <details><summary>Chưa chốt ngày cưới có hỏi tư vấn được không?</summary><p>Được chứ. Hai bạn có thể để trống ngày trong biểu mẫu và chia sẻ dự định hiện tại. Khi có ngày dự kiến, mình cùng kiểm tra lịch và trao đổi cụ thể hơn.</p></details>
 <details><summary>Nên chọn film hay máy số?</summary><p>Hãy bắt đầu từ những bộ ảnh hai bạn thích. Mình sẽ cùng xem ảnh tham khảo và trao đổi cách chụp phù hợp với lịch trình, sở thích và ngân sách; có thể chọn kết hợp cả hai.</p></details>
 <details><summary>Chi phí chụp ảnh được báo như thế nào?</summary><p>Báo giá được gửi riêng sau khi trao đổi ngày, địa điểm, thời lượng và cách chụp. Trước khi xác nhận lịch, hai bên sẽ làm rõ những hạng mục đã bao gồm trong báo giá và các khoản có thể phát sinh.</p></details>
 <details><summary>Khi nào nhận ảnh và nhận bao nhiêu ảnh?</summary><p>Thời gian bàn giao, số lượng ảnh, định dạng tệp và mức độ chỉnh sửa được thống nhất riêng cho từng buổi chụp. Hai bạn có thể trao đổi những mong muốn này khi tư vấn, trước khi xác nhận lịch.</p></details>
 <details><summary>Gửi yêu cầu tư vấn đã được giữ lịch chụp chưa?</summary><p>${inquiryNotice} Đây là bước đầu để mình tìm hiểu dự định của hai bạn.</p></details>
 <details><summary>Cần chuẩn bị gì trước khi trao đổi?</summary><p>Nếu đã có, hai bạn có thể gửi lịch trình sơ bộ, địa điểm và ảnh tham khảo, rồi kể mình nghe về những người hoặc khoảnh khắc đặc biệt muốn ghi lại. Một lời chào cùng dự định ban đầu cũng đủ để bắt đầu cuộc trò chuyện.</p></details>
 </div>
</section>`;}

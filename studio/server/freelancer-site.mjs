import express from 'express';
import {createHash,timingSafeEqual} from 'node:crypto';

const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={wedding:'Ảnh cưới',prewedding:'Pre-wedding',portrait:'Chân dung',lifestyle:'Lifestyle',event:'Event',birthday:'Sinh nhật',teambuilding:'Teambuilding'};
const defaults={
 headline:'Chụp truyền thống.\nChụp phóng sự.',
 lead:'Công nhận book máy chính hoặc máy phụ theo từng job, phối hợp trực tiếp với studio và bàn giao đúng phạm vi đã thống nhất.',
 about:'Công tập trung vào chụp truyền thống và phóng sự, phối hợp cùng ekip của studio để ghi lại những phần việc đã thống nhất trước buổi chụp.',
 workIntro:'Chỉ những bộ ảnh đã chọn cho đối tác mới xuất hiện ở đây. Mỗi bộ sẽ ghi rõ vai trò, hình thức chụp và phạm vi bàn giao.',
 gearIntro:'Thiết bị được sắp theo từng kiểu job để đối tác biết cấu hình thường dùng, phương án dự phòng và phần cần trao đổi thêm.',
 processIntro:'Cách phối hợp được ghi rõ từ lúc nhận brief, trong buổi chụp đến khi bàn giao file.',
 calendarIntro:'Ngày được đánh dấu bận sau khi Công xác nhận nhận job. Ngày chưa đánh dấu chỉ có nghĩa là chưa có lịch đã xác nhận; xem lịch chưa giữ chỗ.',
 bookingIntro:'Chọn một ngày chưa có lịch xác nhận để tạo mẫu tin nhắn, sau đó gửi qua Messenger hoặc Zalo.',
 gear:[
  {title:'Truyền thống',description:'Bộ thiết bị Công thường mang cho vị trí máy truyền thống.',items:['Body và lens sẽ được cập nhật theo cấu hình thực tế.','Có phương án dự phòng khi job yêu cầu.']},
  {title:'Phóng sự',description:'Cấu hình ưu tiên sự linh hoạt trong không gian và ánh sáng thay đổi.',items:['Body, lens và phụ kiện sẽ được ghi rõ theo từng job.','Thiết bị bổ sung được thống nhất trước khi nhận.']},
  {title:'Thiết bị bổ sung',description:'Thiết bị chỉ mang thêm khi brief hoặc timeline cần đến.',items:['Công sẽ xác nhận khả năng đáp ứng cùng studio.']}
 ],
 pricing:[
  {title:'Truyền thống',scope:'Giao RAW / JPEG',price:'Đang bổ sung giá',delivery:'Thời lượng, phạm vi file và phụ phí sẽ được ghi rõ khi cập nhật.'},
  {title:'Truyền thống',scope:'Có edit',price:'Đang bổ sung giá',delivery:'Phạm vi edit và thời hạn bàn giao sẽ được ghi rõ khi cập nhật.'},
  {title:'Phóng sự',scope:'Giao RAW / JPEG',price:'Đang bổ sung giá',delivery:'Thời lượng, phạm vi file và phụ phí sẽ được ghi rõ khi cập nhật.'},
  {title:'Phóng sự',scope:'Có edit',price:'Đang bổ sung giá',delivery:'Phạm vi edit và thời hạn bàn giao sẽ được ghi rõ khi cập nhật.'}
 ],
 surcharges:[{title:'Chi phí phát sinh',description:'Các khoản đi tỉnh, di chuyển, thời gian phát sinh hoặc yêu cầu thiết bị thêm sẽ được thống nhất trước khi xác nhận.'}],
 commitments:[
  {title:'Trước khi nhận',description:'Thống nhất ngày, địa điểm, vị trí, thời lượng, thiết bị và đầu ra cần bàn giao.'},
  {title:'Trong buổi chụp',description:'Phối hợp theo timeline của studio, ưu tiên phần việc đã thống nhất và báo sớm khi lịch trình thay đổi.'},
  {title:'Bàn giao',description:'Giao RAW, JPEG hoặc thực hiện edit theo đúng phạm vi báo giá đã chốt qua tin nhắn.'}
 ],
 roles:[
  {title:'Chụp truyền thống',description:'Nhận vị trí máy chính hoặc máy phụ theo cách phối hợp của studio, ưu tiên các phần lễ, gia đình và những khoảnh khắc cần chỉ dẫn rõ.',tags:['Máy chính','Máy phụ']},
  {title:'Chụp phóng sự',description:'Ghi lại diễn biến tự nhiên, làm việc linh hoạt theo timeline và không gian thực tế của ngày cưới.',tags:['Máy chính','Máy phụ']}
 ]
};
const cookieValue=(req,name)=>Object.fromEntries((req.headers.cookie||'').split(';').map(part=>{const index=part.indexOf('=');return [part.slice(0,index).trim(),part.slice(index+1).trim()];}).filter(([key])=>key))[name]||'';
const sameSecret=(a,b)=>{try{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}catch{return false;}};
const parseJSON=(value,fallback)=>{if(!value)return fallback;try{const parsed=JSON.parse(value);return parsed??fallback;}catch{return fallback;}};
const selectedAlbumIds=site=>{const value=parseJSON(site.freelancerSelection,[]);return Array.isArray(value)?value.filter(id=>typeof id==='string'):[];};
const safeExternalUrl=value=>{try{const url=new URL(String(value||''));return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}};
const safeArray=(value,fallback)=>{const parsed=parseJSON(value,null);return Array.isArray(parsed)&&parsed.length?parsed:fallback;};

function hostMatches(req,env){
 const expected=(env.FREELANCER_HOST||'freelancer.chicongphoto.vn').toLowerCase();
 return String(req.hostname||'').toLowerCase()===expected;
}
function localPath(req){return req.path==='/freelancer'||req.path.startsWith('/freelancer/')||req.path.startsWith('/api/freelancer/');}
function isFreelancer(req,env,production){return hostMatches(req,env)||(!production&&localPath(req));}
function basePath(req,env){return hostMatches(req,env)?'':'/freelancer';}
function priceToken(env){const code=env.FREELANCER_PRICE_CODE||env.FREELANCER_ACCESS_CODE||'';return code?digest(code+'|'+(env.FREELANCER_PRICE_SECRET||code)):'';}
function priceUnlocked(req,env){const expected=priceToken(env);return !!expected&&sameSecret(cookieValue(req,'freelancer_price'),expected);}
function privateHeaders(res){return res.set({'Cache-Control':'private,no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'});}

function cardMarkup(cards,base){
 if(!cards.length)return '<div class="freelancer-empty"><strong>Bộ ảnh dành cho đối tác đang được tuyển chọn.</strong><span>Các bộ ảnh thực tế sẽ được bổ sung dần theo từng nhóm chụp.</span></div>';
 return cards.map((album,index)=>{
  const photo=album.photos?.find(item=>item.id===album.cover_id)||album.photos?.[0];
  const image=photo?`<img src="${escape(photo.thumb)}" alt="${escape(album.title)}" loading="${index<2?'eager':'lazy'}" decoding="async" width="${photo.width||1200}" height="${photo.height||800}">`:'<div class="freelancer-placeholder">Ảnh đang cập nhật</div>';
  const category=labels[album.category]||album.category||'Bộ ảnh';
  const href=`${base||''}/album/${encodeURIComponent(album.slug||album.id)}`;
  const facts=[category,album.photo_count?`${album.photo_count} ảnh`:'' ,album.event_date||''].filter(Boolean);
  return `<article class="freelancer-work-card"><figure>${image}</figure><div><p class="freelancer-kicker">${escape(category)}</p><h3>${escape(album.title)}</h3><p>${escape(album.description||'Bộ ảnh thực tế do Công thực hiện.')}</p><div class="freelancer-card-meta">${facts.map(fact=>`<span>${escape(fact)}</span>`).join('')}</div><a href="${escape(href)}" class="freelancer-text-link">Xem bộ ảnh <span aria-hidden="true">↗</span></a></div></article>`;
 }).join('');
}

function contactMarkup(site){
 const links=[];
 const facebook=safeExternalUrl(site.facebook),zalo=safeExternalUrl(site.zalo);
 if(facebook)links.push(`<a class="freelancer-button freelancer-button-dark" href="${escape(facebook)}" target="_blank" rel="noopener noreferrer">Messenger / Facebook ↗</a>`);
 if(zalo)links.push(`<a class="freelancer-button freelancer-button-light" href="${escape(zalo)}" target="_blank" rel="noopener noreferrer">Nhắn Zalo ↗</a>`);
 if(site.phone){const phone=String(site.phone).replace(/[^+\d]/g,'');if(phone)links.push(`<a class="freelancer-contact-link" href="tel:${escape(phone)}">${escape(site.phone)}</a>`);}
 if(!links.length)links.push('<span class="freelancer-contact-placeholder"><strong>Messenger / Zalo</strong><small>Chọn ngày, sao chép mẫu tin nhắn rồi gửi trực tiếp cho Công.</small></span>');
 return links.join('');
}

function priceMarkup(unlocked,env,site){
 if(!unlocked){
  const configured=!!(env.FREELANCER_PRICE_CODE||env.FREELANCER_ACCESS_CODE);
  return `<div class="freelancer-price-locked"><p class="freelancer-kicker">BẢNG GIÁ ĐỐI TÁC</p><h3>Báo giá được chia sẻ riêng</h3><p>${configured?'Nhập mã Công gửi cho đối tác để xem phạm vi giao file, edit và các khoản phát sinh.':'Mã truy cập sẽ được cấu hình trước khi gửi website cho đối tác.'}</p><form method="post" action="/freelancer/access" class="freelancer-access-form"><label for="freelancer-price-code">Mã truy cập</label><div><input id="freelancer-price-code" name="code" type="password" autocomplete="off" required placeholder="Nhập mã được gửi riêng"><button type="submit" class="freelancer-button freelancer-button-dark" ${configured?'':'disabled'}>Mở báo giá</button></div><small>Hồ sơ, portfolio, thiết bị, quy trình và lịch vẫn xem được bằng đường link.</small></form></div>`;
 }
 const configuredPricing=parseJSON(site.freelancerPricing,null),pricing=Array.isArray(configuredPricing)&&configuredPricing.length?configuredPricing:null,surcharges=safeArray(site.freelancerSurcharges,defaults.surcharges);
 const priceBody=pricing?`<div class="freelancer-price-grid">${pricing.map(item=>`<article><h4>${escape(item.title||'Hạng mục')}</h4><p>${escape(item.scope||'Phạm vi công việc')}</p><strong>${escape(item.price||'Liên hệ')}</strong>${item.unit?`<span class="freelancer-price-unit">${escape(item.unit)}</span>`:''}<span>${escape(item.delivery||item.note||'Trao đổi chi tiết trước khi chốt job.')}</span></article>`).join('')}</div>`:'<div class="freelancer-price-pending"><span class="freelancer-card-index">ĐANG HOÀN THIỆN</span><h4>Bảng giá sẽ được cập nhật theo từng vị trí chụp.</h4><p>Phạm vi giao RAW, JPEG, edit và thời gian bàn giao sẽ được ghi rõ trước khi Công nhận job.</p></div>';
 return `<div class="freelancer-price-unlocked"><div class="freelancer-price-head"><div><p class="freelancer-kicker">BẢNG GIÁ ĐỐI TÁC</p><h3>Giá theo cách chụp và đầu ra</h3></div><span class="freelancer-pill">Đã mở</span></div>${priceBody}<div class="freelancer-surcharges"><h4>Phụ phí và điều kiện</h4>${surcharges.map(item=>`<p><strong>${escape(item.title||'Phụ phí')}</strong> · ${escape(item.description||'Trao đổi trước khi xác nhận.')}</p>`).join('')}</div><p class="freelancer-price-note">Giá được xác nhận theo ngày, vị trí Công nhận trong job và đầu ra đã thống nhất qua tin nhắn.</p></div>`;
}

function gearMarkup(site){
 const gear=safeArray(site.freelancerGear,defaults.gear);
 return gear.map((item,index)=>`<article><span>${String(index+1).padStart(2,'0')}</span><h3>${escape(item.title||'Thiết bị')}</h3><p>${escape(item.description||'Cấu hình sẽ được xác nhận theo từng job.')}</p>${Array.isArray(item.items)&&item.items.length?`<ul>${item.items.map(row=>`<li>${escape(row)}</li>`).join('')}</ul>`:''}</article>`).join('');
}

function commitmentsMarkup(site){
 const items=safeArray(site.freelancerCommitments,defaults.commitments);
 return items.map((item,index)=>`<article><span>${String(index+1).padStart(2,'0')}</span><div><h3>${escape(item.title||'Cam kết')}</h3><p>${escape(item.description||'Trao đổi rõ trước khi xác nhận.')}</p></div></article>`).join('');
}

function roleMarkup(site){
 const roles=safeArray(site.freelancerRoles,defaults.roles);
 return `<div class="freelancer-role-grid">${roles.map((item,index)=>{const tags=Array.isArray(item.tags)?item.tags.filter(Boolean):[];return `<article><span class="freelancer-card-index">${String(index+1).padStart(2,'0')}</span><h3>${escape(item.title||'Vị trí nhận chụp')}</h3><p>${escape(item.description||'Phạm vi công việc sẽ được xác nhận theo từng job.')}</p>${tags.length?`<div class="freelancer-role-tags">${tags.map(tag=>`<span>${escape(tag)}</span>`).join('')}</div>`:''}</article>`;}).join('')}</div>`;
}

function renderPage({req,site,cards,unlocked,env,notice=''}){
 const base=basePath(req,env),name=site.name||'Chí Công',location=site.location||'Hồ sơ dành cho đối tác',serviceArea=site.freelancerServiceArea||site.location||'',serviceLine=serviceArea?`Nhận chụp tại ${escape(serviceArea)}`:'Khu vực nhận chụp thống nhất theo từng job',responseTime=site.freelancerResponseTime||'trong ngày',updatedAt=site.freelancerUpdatedAt||'Theo lịch đã xác nhận',bookingPolicy=site.freelancerBookingPolicy||'Xác nhận qua Messenger / Zalo · Không cần cọc · Chưa giữ ngày khi chưa xác nhận',headlineLines=String(site.freelancerHeadline||defaults.headline).split(/\r?\n/).map(line=>line.trim()).filter(Boolean),headlineHtml=(headlineLines.length?headlineLines:[defaults.headline.split('\n')[0],defaults.headline.split('\n')[1]]).map((line,index)=>index?`<em>${escape(line)}</em>`:escape(line)).join('<br>'),roles=safeArray(site.freelancerRoles,defaults.roles),copy=value=>escape(value).replace(/\r?\n/g,'<br>');
 const navHref=section=>`${base||''}#${section}`;
 const cardsHtml=cardMarkup(cards,base);
 const noticeHtml=notice==='invalid'?'<p class="freelancer-form-error" role="alert">Mã chưa đúng. Công kiểm tra lại mã rồi thử lại nhé.</p>':'';
 return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(name)} · Freelancer</title><meta name="description" content="Hồ sơ chụp truyền thống và phóng sự dành cho đối tác của ${escape(name)}."><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f3eee6"><link rel="stylesheet" href="/app/fonts/fonts.css"><link rel="stylesheet" href="/app/freelancer.css"></head><body class="freelancer-site"><a class="freelancer-skip" href="#main">Bỏ qua đến nội dung chính</a><header class="freelancer-nav"><a class="freelancer-brand" href="${base||'/'}"><span>${escape(name)}</span><small>Hồ sơ đối tác</small></a><nav aria-label="Điều hướng hồ sơ"><a href="${navHref('profile')}" data-freelancer-nav="profile">Hồ sơ</a><a href="${navHref('work')}" data-freelancer-nav="work">Bộ ảnh</a><a href="${navHref('gear')}" data-freelancer-nav="gear">Thiết bị</a><a href="${navHref('price')}" data-freelancer-nav="price">Báo giá</a><a href="${navHref('process')}" data-freelancer-nav="process">Quy trình</a><a href="${navHref('contact')}" data-freelancer-nav="contact">Liên hệ</a></nav><a class="freelancer-nav-cta" href="${navHref('contact')}">Nhắn book ↗</a></header><main id="main">
 <section class="freelancer-hero" id="profile"><div class="freelancer-hero-copy"><p class="freelancer-kicker">HỒ SƠ DÀNH CHO ĐỐI TÁC</p><h1>${headlineHtml}</h1><p class="freelancer-lead">${copy(site.freelancerLead||defaults.lead)}</p><div class="freelancer-quick-facts" aria-label="Thông tin nhanh"><span><strong>${String(roles.length).padStart(2,'0')}</strong> vị trí nhận chụp</span><span><strong>01</strong> job mỗi ngày</span><span><strong>RAW / JPEG</strong> hoặc edit</span></div><div class="freelancer-actions"><a class="freelancer-button freelancer-button-dark" href="${navHref('contact')}">Kiểm tra lịch & nhắn book ↓</a><a class="freelancer-text-link" href="${navHref('work')}">Xem năng lực <span aria-hidden="true">↘</span></a></div><p class="freelancer-hero-note">Phản hồi ${escape(responseTime)} · ${escape(bookingPolicy)}</p></div><aside class="freelancer-hero-card"><span class="freelancer-card-index">01 / 06</span><strong>${escape(name)}</strong><span>${escape(location)}</span><span>${serviceLine}</span><span>Messenger / Zalo</span><div class="freelancer-status"><i></i>Lịch theo ngày · chưa giữ chỗ</div></aside></section>
 <section class="freelancer-section freelancer-intro"><div class="freelancer-section-label">01 · HỒ SƠ</div><div class="freelancer-two-col"><div><h2>Book Công<br><em>cho từng ngày chụp.</em></h2></div><div><p>${copy(site.freelancerAbout||defaults.about)}</p><p class="freelancer-muted">Hầu hết booking trên hồ sơ này là lịch Công trực tiếp nhận và thực hiện. Hai bên xác nhận qua tin nhắn; không cần cọc để chốt lịch.</p></div></div>${roleMarkup(site)}</section>
 <section class="freelancer-section freelancer-work" id="work"><div class="freelancer-section-top"><div><div class="freelancer-section-label">02 · BỘ ẢNH</div><h2>Những bộ ảnh<br><em>đã thực hiện.</em></h2></div><p>${copy(site.freelancerWorkIntro||defaults.workIntro)}</p></div><div class="freelancer-work-grid">${cardsHtml}</div></section>
 <section class="freelancer-section freelancer-gear" id="gear"><div class="freelancer-section-label">03 · THIẾT BỊ</div><div class="freelancer-two-col"><div><h2>Thiết bị theo<br><em>từng kiểu job.</em></h2></div><div><div class="freelancer-gear-list">${gearMarkup(site)}</div><p class="freelancer-muted">${copy(site.freelancerGearIntro||defaults.gearIntro)}</p></div></div></section>
 <section class="freelancer-section freelancer-price" id="price"><div class="freelancer-section-label">04 · BÁO GIÁ</div>${priceMarkup(unlocked,env,site)}${noticeHtml}</section>
 <section class="freelancer-section freelancer-process" id="process"><div class="freelancer-section-label">05 · QUY TRÌNH</div><div class="freelancer-two-col"><div><h2>Cách phối hợp<br><em>trước, trong và sau job.</em></h2></div><div class="freelancer-process-list"><p class="freelancer-process-intro">${copy(site.freelancerProcessIntro||defaults.processIntro)}</p>${commitmentsMarkup(site)}<div class="freelancer-process-policy"><span class="freelancer-card-index">QUY TẮC BOOKING</span><strong>${escape(bookingPolicy)}</strong></div></div></div></section>
 <section class="freelancer-section freelancer-calendar" id="contact"><div class="freelancer-section-top"><div><div class="freelancer-section-label">06 · LỊCH</div><h2>Lịch nhận chụp<br><em>theo từng ngày.</em></h2></div><p>${copy(site.freelancerCalendarIntro||defaults.calendarIntro)}</p></div><div class="freelancer-calendar-shell"><div class="freelancer-calendar-toolbar"><button type="button" data-calendar-prev aria-label="Tháng trước">←</button><strong data-calendar-title aria-live="polite">Đang tải lịch…</strong><button type="button" data-calendar-next aria-label="Tháng sau">→</button></div><div class="freelancer-calendar-legend" aria-label="Chú thích lịch"><span><i class="legend-free"></i>Chưa có lịch xác nhận</span><span><i class="legend-busy"></i>Đã bận</span><span><i class="legend-today"></i>Hôm nay</span><span data-calendar-unknown-legend hidden><i class="legend-unknown"></i>Chưa kiểm tra</span></div><div class="freelancer-calendar-grid" data-calendar-grid role="group" aria-label="Lịch nhận chụp theo tháng" aria-busy="true"></div><p class="freelancer-calendar-status" data-calendar-status aria-live="polite">Đang tải lịch…</p><p class="freelancer-calendar-selection" data-calendar-selection aria-live="polite" hidden></p><p class="freelancer-calendar-meta">Lịch cập nhật: ${escape(updatedAt)} · Ngày trống chưa được giữ tự động.</p></div><div class="freelancer-contact"><div><p class="freelancer-kicker">BOOKING</p><h2>Gửi Công ngày và<br><em>vị trí cần book.</em></h2><p>${copy(site.freelancerBookingIntro||defaults.bookingIntro)}</p></div><div class="freelancer-contact-actions">${contactMarkup(site)}<button type="button" class="freelancer-text-link freelancer-copy" data-copy-booking>Sao chép mẫu tin nhắn ↗</button></div></div></section>
 </main><footer class="freelancer-footer"><span>© ${new Date().getFullYear()} · ${escape(name)}</span><span>Hồ sơ chia sẻ riêng cho đối tác</span></footer><div class="freelancer-sticky-cta" hidden><span>Đã chọn ngày?</span><a href="${navHref('contact')}">Nhắn book ↗</a></div><script type="module" src="/app/freelancer.js"></script></body></html>`;
}

function renderAlbumPage({req,site,album,env}){
 const base=basePath(req,env),name=site.name||'Chí Công',category=labels[album.category]||album.category||'Bộ ảnh';
 const photos=(album.photos||[]).map((photo,index)=>`<figure class="freelancer-detail-photo"><img src="${escape(photo.src)}" alt="${escape(photo.caption||album.title)}" loading="${index<2?'eager':'lazy'}" decoding="async" width="${photo.width||1200}" height="${photo.height||800}">${photo.caption?`<figcaption>${escape(photo.caption)}</figcaption>`:''}</figure>`).join('');
 return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(album.title)} · ${escape(name)}</title><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/app/fonts/fonts.css"><link rel="stylesheet" href="/app/freelancer.css"></head><body class="freelancer-site"><a class="freelancer-skip" href="#main">Bỏ qua đến nội dung chính</a><header class="freelancer-nav"><a class="freelancer-brand" href="${base||'/'}"><span>${escape(name)}</span><small>Hồ sơ đối tác</small></a><nav aria-label="Điều hướng hồ sơ"><a href="${base||''}#work">Bộ ảnh</a><a href="${base||''}#contact">Liên hệ</a></nav></header><main id="main" class="freelancer-detail"><section class="freelancer-detail-heading"><a class="freelancer-text-link" href="${base||'/'}#work">← Quay lại hồ sơ</a><p class="freelancer-kicker">${escape(category)}</p><h1>${escape(album.title)}</h1><p>${escape(album.description||'Bộ ảnh thực tế do Công thực hiện.')}</p></section><section class="freelancer-detail-grid" aria-label="Ảnh trong bộ ${escape(album.title)}">${photos||'<p class="freelancer-empty">Bộ ảnh đang được cập nhật.</p>'}</section></main><footer class="freelancer-footer"><span>© ${new Date().getFullYear()} · ${escape(name)}</span><span>Hồ sơ chia sẻ riêng cho đối tác</span></footer></body></html>`;
}

export function registerFreelancerSite({app,db,settings,portfolioCards,freelancerAlbum,googleCalendar,env,rate,production}){
 const freelancer=(req)=>isFreelancer(req,env,production);
 const page=async(req,res,next)=>{if(!freelancer(req))return next();try{const site=await settings();const selection=new Set(selectedAlbumIds(site));const all=await portfolioCards(site);const cards=all.filter(album=>selection.has(album.id));const unlocked=priceUnlocked(req,env);privateHeaders(res);res.type('html').send(renderPage({req,site,cards,unlocked,env,notice:req.query.price==='invalid'?'invalid':''}));}catch(error){next(error);}};
 const detail=async(req,res,next)=>{if(!freelancer(req))return next();try{const site=await settings(),selection=new Set(selectedAlbumIds(site)),album=await freelancerAlbum(req.params.key);if(!album||!selection.has(album.id))return next();privateHeaders(res);res.type('html').send(renderAlbumPage({req,site,album,env}));}catch(error){next(error);}};
 const access=async(req,res,next)=>{if(!freelancer(req))return next();try{await rate(req,'freelancer-price',8);const code=typeof req.body?.code==='string'?req.body.code.trim():'';const configured=env.FREELANCER_PRICE_CODE||env.FREELANCER_ACCESS_CODE||'';if(!configured||!sameSecret(code,configured)){const target=basePath(req,env)||'/';return res.redirect(303,target+(target.includes('?')?'&':'?')+'price=invalid#price');}const token=priceToken(env);res.cookie('freelancer_price',token,{httpOnly:true,sameSite:'strict',secure:production,maxAge:30*86400000,path:'/'});const target=basePath(req,env)||'/';return res.redirect(303,target+'?price=1#price');}catch(error){next(error);}};
 app.get('/',page);app.get('/freelancer',page);app.get('/freelancer/',page);
 app.get('/album/:key',detail);app.get('/freelancer/album/:key',detail);
 app.post('/access',express.urlencoded({extended:false}),access);app.post('/freelancer/access',express.urlencoded({extended:false}),access);
 app.get('/robots.txt',(req,res,next)=>{if(!freelancer(req))return next();res.type('text/plain').set('Cache-Control','no-store').send('User-agent: *\nDisallow: /');});
 app.get('/sitemap.xml',(req,res,next)=>{if(!freelancer(req))return next();res.type('text/plain').set('Cache-Control','no-store').send('');});
 app.get('/api/freelancer/availability',async(req,res,next)=>{if(!freelancer(req))return next();try{const [rows,google]=await Promise.all([db.all("SELECT date FROM blocked_dates UNION SELECT date FROM inquiries WHERE status='confirmed' AND date<>''"),googleCalendar?.read?.()||{blocked:[]}]);const blocked=[...new Set([...rows.map(row=>row.date),...(google.blocked||[])])];const payload={blocked,today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())};if(google.configured)Object.assign(payload,{unavailable:!!google.unavailable,through:google.through});res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).json(payload);}catch(error){next(error);}});
}

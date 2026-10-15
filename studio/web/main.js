import {uploadRequest,uploadProgressText} from './upload-request.mjs';
import {api} from './api-request.mjs';
import {uploadReport,uploadSelection,photoSizeNote} from './upload-report.mjs';
import {sectionPhotos,sectionOptions,sectionTabs,sectionManager,sectionBulkToolbar,weddingSections} from './album-sections.mjs';
import {initBackToTop} from './back-to-top.mjs';
import {albumRows,albumPhotoSizes,initAlbumLayout,initClientLayout} from './album-layout.mjs';
import {imageSources,heroDesktopSizes,heroMobileSizes,albumCardSizes} from './responsive-image.mjs';
import {takePageData} from './page-data.mjs';
import {albumSlug} from './album-slug.mjs';
import {albumEditorial,photoDescription} from './album-editorial.mjs';
import {initInquiryForm} from './inquiry-form.mjs';
import {currentCopy} from './site-copy.mjs';
import {categoryLabels as categories,albumStatusLabels,inquiryStatusLabels,selectionStatusLabels,inquiryNotice,budgetLabels,budgetLabel} from './ui-copy.mjs';
import {defaultHeroSelection,parseSelection} from './hero-slides.mjs';
import {initHeroSlideshow} from './hero-slideshow.mjs';
import {curateHome,curatePortfolio,nextStories,defaultStorySelection,homeHeroSlides} from './home-curation.mjs';
import {initPortfolioMotion} from './portfolio-motion.mjs';
import {icon} from './icons.mjs';
import {maxUploadBytes,uploadSizeLabel} from './upload-policy.mjs';
import {UploadQueue} from './upload-queue.mjs';
const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses={...albumStatusLabels,...inquiryStatusLabels};
let googleCalendarState={configured:false};
let site={},albums=[],album=null,adminAlbums=[],inquiries=[],dates=[],availability={blocked:[],today:''},adminView='dashboard',adminAlbumId=null,filter='all',selectedOnly=false,lightIndex=0,calendarMonth=new Date(),bookingDate='';
const latestUploadReports=new Map();const uploadQueues=new WeakMap();let uploadBusy=false;let sectionReturnFocus=null;
let sectionFilter='all',adminSectionFilter='all',sectionAlbumId=null,sectionBusy=false;
const sectionSelected=new Set(),sectionRequestIds=new Map();
window.addEventListener('beforeunload',e=>{if(uploadBusy||sectionBusy){e.preventDefault();e.returnValue='';}});
const label=s=>`<p class="label">${s}</p>`;
const button=(text,href,cls='')=>`<a class="btn ${cls}" href="${href}">${text}</a>`;
const dateLabel=s=>s?new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(s+'T12:00:00')):'Chưa chọn ngày';

const send=(url,data,method='POST')=>api(url,{method,body:JSON.stringify(data)});
let clientGallery=false,pickBusy=false,activeUploadQueue=null;
let selectionUncertain=false,selectionEpoch=0,selectionRefreshing=false,confirmedPhotoIds=[];
// Download code loads on demand so opening a gallery does not wait for it.
let galleryDownloads,photoDownloads,galleryDownloadsLoading,photoDownloadsLoading;
const loadGalleryDownloads=()=>galleryDownloadsLoading??=import('./gallery-download.mjs').then(({createGalleryDownloads})=>galleryDownloads=createGalleryDownloads({onExpired:async()=>{try{await expireGallery();}catch(error){toast(error.message);}},onSelectionChanged:async()=>{try{await route();$('[data-action=download-selected]')?.focus({preventScroll:true});toast('Đã cập nhật danh sách ảnh đã chọn.');}catch(error){toast(error.message);}}})).catch(error=>{galleryDownloadsLoading=null;throw error;});
const loadPhotoDownloads=()=>photoDownloadsLoading??=import('./photo-download.mjs').then(({createPhotoDownloads})=>photoDownloads=createPhotoDownloads({
 onExpired:async()=>{await expireGallery();},
 onState:state=>{
  const link=$('#lightbox-download'),status=$('#lightbox-download-status');
  const busy=!['idle','saved','error','cancelled'].includes(state.phase);
  link.textContent=busy?'Hủy tải':'Tải ảnh này';link.setAttribute('aria-label',busy?'Hủy tải ảnh':'Tải ảnh này');
  if(state.message)status.textContent=state.message;
  if(state.phase==='progress')status.textContent=state.total?`Đang tải ảnh… ${Math.round(state.received/state.total*100)}%`:'Đang tải ảnh…';
 }
})).catch(error=>{photoDownloadsLoading=null;throw error;});
function syncDownloadButton(){const button=$('[data-action=download-selected]');if(button)button.disabled=pickBusy||selectionUncertain||!album?.photos?.some(photo=>photo.selected);}
let toastTimer;function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
const badge=(status,labels=statuses)=>`<span class="badge ${esc(status)}">${esc(labels[status]||status)}</span>`;
const cover=a=>a.photos.find(p=>p.id===a.cover_id)||a.photos[0];
const photoSources=p=>esc(imageSources(p));
const img=(p,cls='',eager=false,responsive=false,sizes='(max-width:750px) calc(100vw - 44px), (max-width:1200px) 44vw, 520px',deferred=false)=>p?`<img ${deferred?'data-src':'src'}="${esc(p.thumb)}" ${responsive&&Math.max(p.width,p.height)>900?` ${deferred?'data-srcset':'srcset'}="${photoSources(p)}" sizes="${esc(sizes)}"`:""} ${eager?'fetchpriority="high"':'loading="lazy"'} decoding="async" alt="${esc(photoDescription(p))}" width="${p.width}" height="${p.height}" class="${cls}">`:`<div class="empty-cover">${icon('image')}<span>Chưa có ảnh</span></div>`;
function nav(){const pathname=location.pathname.replace(/\/$/,'')||'/';return `<header class="public-nav"><a class="wordmark" href="/">${esc(site.brand)}<span>${esc(site.tagline)}</span></a><button class="mobile-menu" data-action="menu" aria-expanded="false" aria-controls="nav-links">Menu ${icon('menu')}</button><nav id="nav-links" aria-label="Điều hướng"><a href="/portfolio" ${(pathname.startsWith('/portfolio')||pathname.startsWith('/album/'))?'aria-current="page"':''}>Portfolio</a><a href="/about" ${pathname==='/about'?'aria-current="page"':''}>About</a><a href="/contact" ${pathname==='/contact'?'aria-current="page"':''}>Contact</a></nav></header>`;}
const phoneLabel=value=>String(value||'').replace(/^(0\d{3})(\d{3})(\d{3})$/,'$1 $2 $3');
function contactLinks(){return `<div class="direct-contact">${site.phone?`<a class="underlink" href="tel:${esc(site.phone.replace(/[^+\d]/g,''))}">${icon('phone')} ${esc(phoneLabel(site.phone))}</a>`:''}${site.facebook?`<a class="underlink" href="${esc(site.facebook)}" target="_blank" rel="noopener noreferrer">${icon('facebook')} Nhắn qua Facebook ${icon('external')}</a>`:''}${site.zalo?`<a class="underlink" href="${esc(site.zalo)}" target="_blank" rel="noopener noreferrer">Nhắn qua Zalo ${icon('external')}</a>`:''}</div>`;}
function footer(){
 const pathname=location.pathname.replace(/\/$/,'')||'/';
 const invite=!pathname.startsWith('/gallery/')&&pathname!=='/contact';
 return `<footer class="public-footer journal-footer"><div class="page-width">${invite?cta():''}<div class="footer-main"><p class="footer-copyright">© ${new Date().getFullYear()} · ${esc(site.name||'Chí Công')}.</p><nav class="footer-links" aria-label="Liên hệ">${site.facebook?`<a href="${esc(site.facebook)}" target="_blank" rel="noopener noreferrer">${icon('facebook')} Facebook</a>`:''}${site.zalo?`<a href="${esc(site.zalo)}" target="_blank" rel="noopener noreferrer">Zalo ${icon('external')}</a>`:''}${site.instagram?`<a href="${esc(site.instagram)}" target="_blank" rel="noopener noreferrer">Instagram ${icon('external')}</a>`:''}${site.email?`<a href="mailto:${esc(site.email)}">Email ${icon('arrow')}</a>`:''}${site.phone?`<a href="tel:${esc(site.phone.replace(/[^+\d]/g,''))}">${icon('phone')} ${esc(phoneLabel(site.phone))}</a>`:''}</nav></div></div></footer><button type="button" class="back-to-top" data-action="back-to-top" aria-label="Lên đầu trang" hidden>${icon('arrow')}</button>`;
}
function publicPage(body){document.body.classList.add('public-view');$('#root').innerHTML=nav()+`<main id="main">${body}</main>`+footer();initBackToTop($('.back-to-top'));const wasHidden=$('#root').hidden;if(wasHidden)$('#root').hidden=false;initAlbumLayout($('#main'));initClientLayout($('#main'));if(wasHidden)$('#root').hidden=true;initPortfolioMotion($('#main'));initHeroSlideshow($('.highlight-hero'));}
function albumContext(a){return albumEditorial(a)?.summary||'';}
function albumCard(a,i=0,preview=null,layout='grid'){const photo=preview||cover(a);return `<a href="/album/${esc(a.slug||a.id)}" class="album-card ${preview&&photo.width>photo.height?'landscape-card':''}"><figure class="story-image">${img(photo,'',i===0,true,albumCardSizes(layout))}</figure><div class="album-meta"><div><p class="label">${esc(categories[a.category])}</p><h3>${esc(a.title)}</h3>${albumContext(a)?`<p class="album-context">${esc(albumContext(a))}</p>`:''}</div><span class="story-arrow" aria-hidden="true">${icon('arrow')}</span></div></a>`;}
function cta(){
 const introduction='Mình cùng hai bạn chọn cách chụp phù hợp, để lưu lại những khoảnh khắc tự nhiên bên gia đình và bạn bè.';
 return `<section class="footer-invitation"><h2>Kể mình nghe<br><em>về ngày cưới.</em></h2><p>${introduction}</p><a class="underlink" href="/contact">Gửi lời nhắn ${icon('arrow')}</a></section>`;
}
function home(){
 const {stories:featured}=curateHome(albums,site.storySelection,site.heroSelection);
 const highlights=homeHeroSlides(albums,site.storySelection,site.heroSelection);
 publicPage(`<section class="highlight-hero page-width ${highlights.length?'':'is-empty'}" aria-label="Những khoảnh khắc nổi bật" aria-roledescription="trình chiếu">
 ${highlights.length?`<div class="highlight-stage"><div class="highlight-images" ${highlights.length>1?'tabindex="0" role="group" aria-label="Ảnh nổi bật. Vuốt trái hoặc phải, hoặc dùng phím mũi tên để chuyển ảnh."':''}>${highlights.map(({album:a,wide,tall},i)=>`<figure class="highlight-slide ${i===0?'is-active':''}" aria-hidden="${i!==0}" data-title="${esc(a.title)}" data-href="/album/${esc(a.slug||a.id)}"><picture><source media="(max-width:750px)" ${i?'data-srcset':'srcset'}="${photoSources(tall)}" sizes="${heroMobileSizes(tall)}">${img({...wide,caption:"Khoảnh khắc ngày cưới trong bộ ảnh "+a.title},'',i===0,true,heroDesktopSizes,i>0)}</picture></figure>`).join('')}</div></div>
 <div class="highlight-bar"><a class="highlight-album" href="/album/${esc(highlights[0].album.slug||highlights[0].album.id)}"><span class="highlight-album-title">${esc(highlights[0].album.title)}</span>${icon('arrow')}</a>${highlights.length>1?`<div class="highlight-controls"><button type="button" data-slide="prev" aria-label="Ảnh trước">${icon('arrow')}</button><span class="highlight-count" aria-live="polite" aria-atomic="true">01 / ${String(highlights.length).padStart(2,'0')}</span><button type="button" data-slide="next" aria-label="Ảnh tiếp theo">${icon('arrow')}</button></div>`:''}</div>`:''}
 <div class="highlight-copy"><h1>${site.headline.split('\n').map((line,i)=>i?'<em>'+esc(line)+'</em>':esc(line)).join('<br>')}</h1><a class="highlight-scroll" href="#stories">Xem các bộ ảnh ${icon('arrow')}</a></div>
 </section>
 <section class="page-width featured" id="stories"><div class="section-top"><div>${label('BỘ ẢNH NỔI BẬT')}<h2>Một vài ngày cưới<br><em>mình đã ghi lại.</em></h2></div><a class="underlink" href="/portfolio">Xem tất cả ${icon('arrow')}</a></div><div class="album-grid selected-grid">${featured.length?featured.map(({album,photo},i)=>albumCard(album,i,photo)).join(''):'<div class="empty-state"><p>Các bộ ảnh đang được cập nhật. Hai bạn có thể gửi lời nhắn để trao đổi về ngày cưới.</p><a class="underlink" href="/contact">Gửi lời nhắn cho mình</a></div>'}</div></section>

 <section class="note-section page-width">${label('CHÀO HAI BẠN')}<p>Mình là ${esc(site.name)}.<br><em>Mình chụp ảnh cưới<br>bằng film và máy số.</em></p><a class="underlink" href="/about">Một chút về mình ${icon('arrow')}</a></section>`);
}
function portfolio(){const availableCategories=Object.entries(categories).filter(([key])=>albums.some(a=>a.category===key));const visible=curatePortfolio(albums,site.storySelection,site.heroSelection).filter(({album})=>filter==='all'||album.category===filter);publicPage(`<section class="page-width page-title portfolio-title">${label('ẢNH & NHỮNG CÂU CHUYỆN')}<h1>Câu chuyện <em>bằng ảnh.</em></h1><p>Những ngày cưới mình ghi lại bằng film và máy số.</p></section><section class="page-width portfolio-section">${availableCategories.length>1?`<div class="filter-row" role="group" aria-label="Lọc bộ ảnh theo thể loại">${[['all','Tất cả'],...availableCategories].map(([k,v])=>`<button data-action="filter" data-filter="${k}" aria-pressed="${filter===k}" class="${filter===k?'active':''}">${v}</button>`).join('')}</div>`:''}<div class="album-grid stories-grid">${visible.length?visible.map(({album,photo},i)=>albumCard(album,i,photo)).join(''):'<p class="empty-state">Chưa có bộ ảnh trong thể loại này.</p>'}</div></section>`);}
function photosMarkup(photos,client=false){
 const photoMarkup=(p,i,sizes)=>{const name=p.caption||p.original||'Ảnh '+(i+1);return `<article class="photo-item"><button class="photo-open" data-action="open-photo" data-photo="${p.id}" aria-label="Xem ảnh ${esc(name)}">${img(p,'',i===0,true,sizes)}</button><div class="photo-info"><span title="${esc(name)}">${esc(name)}</span>${client?`<button class="pick ${p.selected?'picked':''}" data-action="pick" data-photo="${p.id}" aria-pressed="${!!p.selected}" aria-label="${p.selected?'Bỏ chọn':'Chọn'} ảnh ${esc(name)}">${p.selected?'♥':'♡'}</button>`:''}</div></article>`;};
 if(client){
  const sizes='(max-width:750px) calc((100vw - 56px)/2), min(calc((89vw - 32px)/3), 363px)';
  return `<div class="photo-grid client-masonry" data-count="${photos.length}">${photos.map((p,i)=>photoMarkup(p,i,sizes)).join('')}</div>`;
 }
 let index=0;
 return `<div class="photo-grid album-sequence">${albumRows(photos).map(row=>`<div class="album-photo-row ${row.length===1?'single-frame':''} ${row.length===1&&row[0].width<row[0].height?'portrait-frame':''}">${row.map(p=>photoMarkup(p,index++,albumPhotoSizes(row,p))).join('')}</div>`).join('')}</div>`;
}
function relatedStories(){
 const stories=nextStories(albums,album.id,site.storySelection,site.heroSelection);
 if(!stories.length)return '';
 return `<section class="page-width related-stories"><div class="section-top"><div>${label('CÒN NHỮNG ĐIỀU ĐỂ NHỚ')}<h2>Một câu chuyện khác,<br><em>một cảm xúc mới.</em></h2></div><a class="underlink" href="/portfolio">Tất cả bộ ảnh ${icon('arrow')}</a></div><div class="album-grid related-grid">${stories.map(({album,photo},i)=>albumCard(album,i,photo,'related')).join('')}</div></section>`;
}
function albumDescription(a){
 const description=a.description||'';
 const imported={
 'A New Chapter of Love':'Cheers to a new chapter of love! ',
 'Love in the Details':'Love in the details, beauty in every frame. ',
 'Celebrating Love':'Celebrating love and unforgettable moments. ',
 'Traditional Wedding':'Follow my passion for traditional photography. ',
 'Ceremony | T & T':'Ceremony | T & T. '
 };
 let text=description;
 if(imported[a.title]&&text.startsWith(imported[a.title]))text=text.slice(imported[a.title].length);
 const at=text.search(/Photographed for|Photography by|Wedding photography by|Ảnh: Chí Công/);
 const intro=albumEditorial(a)?.intro||(at>=0?text.slice(0,at).trim():text);
 const credit=at>=0?text.slice(at).trim():'';
 return {intro,credit};
}
function updateClientSelection(){
 const count=album.photos.filter(photo=>photo.selected).length,submitted=album.selection_status==='submitted';
 $('.client-toolbar strong').textContent=`${count} ảnh đã chọn`;
 $('.client-save-status').textContent=selectionUncertain?'Chưa xác nhận được dữ liệu. Bấm “Đồng bộ lại”.':submitted?'Đã gửi đến studio':'Lựa chọn được lưu tự động';
 const retry=$('[data-action=retry-selection]');if(retry)retry.hidden=!selectionUncertain;
 const submit=$('[data-action=submit-picks]');
 submit.disabled=!count||pickBusy||selectionUncertain;submit.setAttribute('aria-label',submitted?'Gửi lại lựa chọn':'Gửi lựa chọn');
 submit.querySelector('.btn-text-full').textContent=submitted?'Gửi lại lựa chọn':'Gửi lựa chọn';
 submit.querySelector('.btn-text-short').textContent=submitted?'Gửi lại':'Gửi lựa chọn';
 $('.success-note')?.remove();
 if(submitted){const note=document.createElement('p');note.className='success-note';note.textContent='Studio đã nhận danh sách ảnh bạn chọn. Bạn vẫn có thể thay đổi và gửi lại lựa chọn.';$('.client-intro').after(note);}
 syncDownloadButton();
}
function applySharedSelection(state){
 if(!Array.isArray(state?.selected)||!['draft','submitted'].includes(state.selection_status))throw Error('Chưa xác nhận được danh sách ảnh. Vui lòng đồng bộ lại.');
 const selected=new Set(state.selected),removed=[],added=[];
 const currentPhoto=lightPhotos()[lightIndex]?.id;
 for(const p of album.photos){if(p.selected&&!selected.has(p.id))removed.push(p.id);if(!p.selected&&selected.has(p.id))added.push(p.id);p.selected=selected.has(p.id);}
 album.selection_status=state.selection_status;selectionUncertain=false;
 if(selectedOnly&&added.length){const top=scrollY;albumPage(true);scrollTo({top,behavior:'instant'});}
 else if(selectedOnly)for(const id of removed)removeSelectedCard(id);
 const photosById=new Map(album.photos.map(p=>[p.id,p]));
 for(const button of document.querySelectorAll('.pick')){
  const p=photosById.get(button.dataset.photo);if(!p)continue;
  button.classList.toggle('picked',p.selected);button.setAttribute('aria-pressed',String(p.selected));button.setAttribute('aria-label',`${p.selected?'Bỏ chọn':'Chọn'} ảnh ${p.caption||p.original||''}`);button.textContent=p.selected?'♥':'♡';
 }
 updateClientSelection();
 if($('#lightbox').open){
  const photos=lightPhotos();
  if(!photos.length)$('#lightbox').close();
  else if(selectedOnly&&(removed.length||added.length))showLight(Math.max(0,photos.findIndex(p=>p.id===currentPhoto)));
  else{const p=photos[lightIndex],pick=$('#lightbox-pick');if(p){pick.setAttribute('aria-pressed',String(p.selected));pick.textContent=p.selected?'Bỏ chọn ảnh này':'Chọn ảnh này';$('#lightbox-selection').textContent=`${selected.size} ảnh đã chọn · ${state.selection_status==='submitted'?'Đã gửi đến studio':'Lựa chọn được lưu tự động'}`;}}
 }
}
async function refreshSharedSelection(full=false){
 if(!clientGallery||!album?.id)return false;
 const current=album,epoch=++selectionEpoch;
 let data=await api(`/api/gallery/${current.id}${full?'':'/selection'}`);
 if(!full&&data.photo_version&&data.photo_version!==current.photo_version){data=await api(`/api/gallery/${current.id}`);full=true;}
 if(epoch!==selectionEpoch||album!==current)return false;
 if(data.locked)throw Object.assign(Error('Phiên xem bộ ảnh đã hết hạn.'),{status:401});
 if(full){
  const catalog=a=>JSON.stringify([a.title,a.description,a.sections,a.has_password,a.photos.map(({selected,...p})=>p)]);
  if(catalog(data)!==catalog(album)){
   const top=scrollY,photoId=lightPhotos()[lightIndex]?.id,wasOpen=$('#lightbox').open;
   album=data;selectionUncertain=false;albumPage(true);scrollTo({top,behavior:'instant'});
   if(wasOpen){const index=lightPhotos().findIndex(p=>p.id===photoId);if(index<0)$('#lightbox').close();else showLight(index);}
  }
  applySharedSelection({selected:data.photos.filter(p=>p.selected).map(p=>p.id),selection_status:data.selection_status});
 }else applySharedSelection(data);
 return true;
}
async function expireGallery(){
 ++selectionEpoch;selectionUncertain=false;$('#editor').close();$('#lightbox').close();galleryDownloads?.close();photoDownloads?.close();
 await route();toast('Phiên xem bộ ảnh đã hết hạn. Vui lòng nhập lại mật khẩu.');
}
async function backgroundSelectionRefresh(full=false){
 if(!clientGallery||document.hidden||pickBusy||selectionRefreshing||$('#editor').open)return;
 selectionRefreshing=true;
 try{await refreshSharedSelection(full);}catch(error){if(error.status===401)await expireGallery();else{selectionUncertain=true;if(clientGallery)updateClientSelection();}}finally{selectionRefreshing=false;}
}
setInterval(()=>void backgroundSelectionRefresh(),20000);
window.addEventListener('focus',()=>void backgroundSelectionRefresh(true));
window.addEventListener('online',()=>void backgroundSelectionRefresh(true));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void backgroundSelectionRefresh(true);});
function removeSelectedCard(photoId){
 const card=$(`.pick[data-photo="${photoId}"]`)?.closest('.photo-item');
 const cards=[...document.querySelectorAll('.client-masonry .photo-item')],index=cards.indexOf(card),neighbor=cards[index+1]||cards[index-1];
 const top=neighbor?.getBoundingClientRect().top;
 card?.remove();
 const visible=sectionPhotos(album,sectionFilter,true),tabs=$('.section-tabs');
 if(tabs)tabs.outerHTML=sectionTabs(album,sectionFilter,false,true,true);
 $('[data-gallery-status]').textContent=`${visible.length} ảnh đang hiển thị`;
 if(!visible.length){$('.client-masonry').outerHTML='<div class="empty-state">Chưa có ảnh được chọn trong mục này.</div>';}
 else {const grid=$('.client-masonry');grid.dataset.count=visible.length;initClientLayout($('#main'));}
 if(!$('#lightbox').open){
  if(neighbor){window.scrollBy({top:neighbor.getBoundingClientRect().top-top,behavior:'instant'});neighbor.querySelector('.pick')?.focus({preventScroll:true});}
  else $('[data-action=selected-only]')?.focus({preventScroll:true});
 }else if(lightReturnPhoto===photoId)lightReturnPhoto=neighbor?.querySelector('.photo-open')?.dataset.photo||null;
}
function scrollToGallery(){
 const target=$('.section-tabs')||$('.client-masonry')||$('.client-photos .empty-state');
 if(target&&target.getBoundingClientRect().top<0)target.scrollIntoView({block:'start',behavior:'instant'});
}
function albumPage(client=false){
 clientGallery=client;
 if(sectionFilter!=='all'&&sectionFilter!=='unassigned'&&!album.sections?.some(s=>s.id===sectionFilter))sectionFilter='all';
 const visible=sectionPhotos(album,sectionFilter,selectedOnly);
 const count=album.photos.filter(p=>p.selected).length;
 const copy=client?null:albumDescription(album);
 const introduction=client?
  `${label('BỘ ẢNH RIÊNG CỦA BẠN')}<h1 id="album-heading">${esc(album.title)}</h1>${album.description?`<p>${esc(album.description)}</p>`:''}<div class="album-line"><span>${album.photos.length} ảnh${album.event_date?' · '+dateLabel(album.event_date):''}</span>${album.has_password?`<button class="link-btn" data-action="lock-gallery">Khóa bộ ảnh</button>`:''}</div>`:
  `<h1 id="album-heading">${esc(album.title)}</h1>${copy.intro?`<p class="album-description">${esc(copy.intro)}</p>`:''}`;
 publicPage(`<section class="page-width album-title ${client?'page-title client-album-title':'portfolio-album-title'}" aria-labelledby="album-heading">${introduction}</section>
 <section class="page-width photo-section ${client?'client-photos':'editorial-photos'}">
 ${client?`<div class="client-intro"><p>Bấm ♡ trên mỗi ảnh để chọn. Lựa chọn được lưu tự động. Khi hoàn tất, bấm “Gửi lựa chọn” để báo cho studio.</p></div>`:''}
 ${album.selection_status==='submitted'?'<p class="success-note">Studio đã nhận danh sách ảnh bạn chọn. Bạn vẫn có thể thay đổi và gửi lại lựa chọn.</p>':''}
 ${sectionTabs(album,sectionFilter,false,selectedOnly,client)}<p class="sr-only" data-gallery-status role="status">${visible.length} ảnh đang hiển thị</p>
 ${visible.length?photosMarkup(visible,client):`<div class="empty-state">${selectedOnly?'Chưa có ảnh được chọn trong mục này.':sectionFilter!=='all'?'Phần này chưa có ảnh.':'Bộ ảnh đang được chuẩn bị.'}</div>`}
 ${client?`<div class="client-toolbar" role="region" aria-label="Thao tác chọn ảnh"><div class="client-toolbar-main"><strong role="status" aria-live="polite">${count} ảnh đã chọn</strong><button class="link-btn" data-action="retry-selection" hidden>Đồng bộ lại</button><span class="client-save-status">${album.selection_status==='submitted'?'Đã gửi đến studio':'Lựa chọn được lưu tự động'}</span></div><div class="client-toolbar-actions"><button class="small-btn" data-action="selected-only" aria-label="${selectedOnly?'Xem tất cả':'Xem ảnh đã chọn'}" aria-pressed="${selectedOnly}"><span class="btn-text-full">${selectedOnly?'Xem tất cả':'Xem ảnh đã chọn'}</span><span class="btn-text-short">${selectedOnly?'Tất cả':'Đã chọn'}</span></button><button class="small-btn" data-action="download-selected" aria-label="Tải ảnh đã chọn" ${!count||pickBusy?'disabled':''}><span class="btn-text-full">Tải ảnh đã chọn</span><span class="btn-text-short">Tải ảnh</span></button><button class="btn" data-action="submit-picks" aria-label="${album.selection_status==='submitted'?'Gửi lại lựa chọn':'Gửi lựa chọn'}" ${!count?'disabled':''}><span class="btn-text-full">${album.selection_status==='submitted'?'Gửi lại lựa chọn':'Gửi lựa chọn'}</span><span class="btn-text-short">${album.selection_status==='submitted'?'Gửi lại':'Gửi lựa chọn'}</span></button></div></div>`:''}
 ${copy?.credit?`<p class="album-credit">${esc(copy.credit)}</p>`:''}</section>${client?'':relatedStories()}`);
 alignSectionTabs();
}
function lockedGallery(){clientGallery=false;selectionUncertain=false;$('#editor').close();$('#lightbox').close();publicPage(`<section class="gallery-lock page-width">${label('DÀNH RIÊNG CHO BẠN')}<div class="lock-icon">${icon('lock')}</div><h1>Bộ ảnh của bạn.</h1><p>Nhập mật khẩu studio đã gửi để xem và chọn ảnh.</p><form data-form="unlock"><label>Mật khẩu bộ ảnh<input name="password" type="password" autocomplete="current-password" required autofocus></label><p class="form-error" role="alert"></p><button class="btn">Mở bộ ảnh</button></form></section>`);}
function about(){
 const portrait=/^[a-f0-9]{32}$/.test(site.portrait||'');
 publicPage(`<div class="about-page page-width">
 <section class="about-opening" aria-labelledby="about-heading">
 <header class="about-heading">${label('VỀ MÌNH')}<h1 id="about-heading">Mình là<br><em><span class="about-name">${esc(site.name)}</span>.</em></h1>${portrait?`<figure class="about-portrait"><img src="/portrait/${site.portrait}" alt="${esc(site.name)} — nhiếp ảnh gia" width="800" height="1000" fetchpriority="high"></figure>`:''}</header>
 <div class="about-story-copy">${site.about.split(/\n\s*\n/).filter(Boolean).map(paragraph=>`<p class="long-copy">${esc(paragraph)}</p>`).join('')}<a class="underlink about-portfolio-link" href="/portfolio">Xem bộ ảnh ${icon('arrow')}</a></div>
 </section>
 <section class="about-process" aria-labelledby="about-process-heading"><header><h2 id="about-process-heading">Trước buổi chụp.</h2></header>
 <ol class="about-steps"><li><h3>Chia sẻ dự định</h3><p>Kể mình nghe về ngày cưới, địa điểm và những điều hai bạn muốn lưu giữ.</p></li><li><h3>Chọn cách chụp</h3><p>Mình cùng hai bạn chọn film, máy số hoặc kết hợp cả hai.</p></li><li><h3>Cùng thống nhất</h3><p>Mình cùng hai bạn thống nhất lịch trình, phạm vi buổi chụp, báo giá và cách giao ảnh trước khi xác nhận lịch.</p></li></ol>
 </section>
 </div>`);
}
function calendarHTML(){
 if(availability.loading)return '<p class="form-note" role="status">Đang tải lịch…</p>';
 if(availability.unavailable)return '<p class="form-note" role="status">Chưa tải được lịch. Bạn vẫn có thể gửi lời nhắn.</p><button type="button" class="link-btn" data-action="retry-calendar">Thử lại</button>';
 const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth();
 const start=(new Date(year,month,1).getDay()+6)%7,days=new Date(year,month+1,0).getDate();
 const earliest=availability.today.slice(0,7),current=`${year}-${String(month+1).padStart(2,'0')}`;
 return `<div class="calendar-heading"><button type="button" data-action="month-prev" aria-label="Tháng trước" ${current<=earliest?'disabled':''}>←</button><strong aria-live="polite">Tháng ${month+1}, ${year}</strong><button type="button" data-action="month-next" aria-label="Tháng tiếp theo">→</button></div><div class="calendar-grid">${['T2','T3','T4','T5','T6','T7','CN'].map(d=>`<span class="weekday">${d}</span>`).join('')}${Array.from({length:start},()=>'<span></span>').join('')}${Array.from({length:days},(_,i)=>{
 const d=`${current}-${String(i+1).padStart(2,'0')}`,busy=availability.blocked.includes(d),past=d<availability.today;
 return `<button type="button" data-action="choose-date" data-date="${d}" class="${busy?'busy ':''}${d===bookingDate?'chosen':''}" ${busy||past||(availability.through&&d>availability.through)?'disabled':''} aria-pressed="${d===bookingDate}" ${d===availability.today?'aria-current="date"':''} aria-label="${dateLabel(d)}${busy?' — không còn trống':past?' — đã qua':''}">${i+1}</button>`;
 }).join('')}</div><div class="calendar-legend"><span><i></i>Còn trống</span><span><i class="busy"></i>Không còn trống</span></div>`;
}
function syncBookingDate(followMonth=false){
 const input=$('#booking-form [name=date]');if(!input)return;
 bookingDate=input.value;
 if(followMonth&&bookingDate){const [year,month]=bookingDate.split('-').map(Number);calendarMonth=new Date(year,month-1,1);}
 const busy=availability.blocked.includes(bookingDate);
 input.setCustomValidity(busy?'Ngày này không còn trống. Bạn có thể chọn ngày khác hoặc bỏ chọn ngày.':'');
 input.setAttribute('aria-invalid',String(!input.validity.valid));
 const feedback=$('#booking-date-feedback');
 feedback.textContent=busy?'Ngày này không còn trống. Bạn có thể chọn ngày khác hoặc bỏ chọn ngày.':bookingDate&&bookingDate<availability.today?'Vui lòng chọn ngày từ hôm nay trở đi.':bookingDate?`Ngày dự kiến: ${dateLabel(bookingDate)}.`:'';
 feedback.classList.toggle('date-unavailable',!input.validity.valid);
 $('[data-action=clear-date]').hidden=!bookingDate;
 $('#booking-calendar').innerHTML=calendarHTML();
}
function contact(){publicPage(`<div class="page-width contact-page"><section class="page-title contact-title">${label('LIÊN HỆ'+(site.location?' · '+esc(site.location):''))}<h1>Kể mình nghe<br><em>về ngày cưới.</em></h1><p>${esc(site.bookingNote)}</p>${contactLinks()}${site.responseNote?`<p class="response-note">${esc(site.responseNote)}</p>`:''}</section>
<section class="booking-layout contact-layout"><form data-form="inquiry" id="booking-form"><p class="form-note">Bạn điền giúp mình các mục có dấu * nhé.</p><label>Tên của bạn *<input name="name" autocomplete="name" required maxlength="100" placeholder="Tên của bạn"></label><p class="form-note" id="contact-hint">Để lại email hoặc số điện thoại để mình nhắn lại nhé.</p><div class="form-pair"><label>Email<input name="email" autocomplete="email" type="email" maxlength="150" aria-describedby="contact-hint" placeholder="Email của bạn"></label><label>Số điện thoại<input name="phone" type="tel" autocomplete="tel" maxlength="30" aria-describedby="contact-hint" placeholder="Số điện thoại của bạn"></label></div>
<div class="booking-date-field"><label>Ngày cưới dự kiến (tùy chọn)<input name="date" type="date" min="${availability.today}" value="${bookingDate}" aria-describedby="booking-date-feedback"></label><button type="button" class="link-btn" data-action="clear-date" hidden>Bỏ chọn ngày</button></div><p class="form-note booking-date-feedback" id="booking-date-feedback" role="status"></p><section class="contact-calendar" aria-labelledby="shoot-calendar-title"><h2 id="shoot-calendar-title">Lịch chụp</h2><div id="booking-calendar">${calendarHTML()}</div></section>
<label>Cách chụp<select name="service"><option value="Mình muốn được tư vấn thêm">Mình cần tư vấn thêm</option><option value="Chụp ảnh cưới bằng máy số">Máy số</option><option value="Chụp ảnh cưới bằng film">Film</option><option value="Kết hợp film và máy số">Film và máy số</option></select></label><label>Ngân sách dự kiến (tùy chọn)<select name="budget"><option value="">Chưa xác định</option>${Object.entries(budgetLabels).map(([value,text])=>`<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label><label>Lời nhắn *<textarea name="message" required minlength="10" maxlength="5000" rows="4" placeholder="Hai bạn dự định tổ chức ở đâu? Có điều gì muốn mình lưu ý không?"></textarea></label><div class="trap" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div><p class="form-note">Thông tin được dùng để phản hồi lời nhắn của bạn. ${inquiryNotice}</p><p class="form-error" role="alert"></p><button class="btn" type="submit">Gửi lời nhắn ${icon('arrow')}</button></form></section></div>`);
 initInquiryForm($('#booking-form'),{availability:()=>availability,onDateConflict:()=>loadBookingAvailability(),onSuccess:(result,data)=>{
  const form=$('#booking-form');
  form.innerHTML=`<div class="booking-success" tabindex="-1" role="status"><span>✓</span><h2>Cảm ơn bạn đã chia sẻ.<br>Mình đã nhận lời nhắn.</h2><p>Mã yêu cầu: <strong>${esc(result.reference)}</strong></p><p>Mình sẽ phản hồi qua ${[data.email?'email '+esc(data.email):'',data.phone?'số điện thoại '+esc(data.phone):''].filter(Boolean).join(' hoặc ')}.</p>${site.responseNote?`<p>${esc(site.responseNote)}</p>`:''}<p>${inquiryNotice}</p>${site.phone||site.facebook||site.zalo?`${contactLinks()}`:''}${button('Xem bộ ảnh','/portfolio','btn-outline')}</div>`;
  form.querySelector('.booking-success').focus();
 }});
}
async function loadBookingAvailability(){
 availability={...availability,loading:true,unavailable:false};
 const calendar=$('#booking-calendar');if(calendar)calendar.innerHTML=calendarHTML();
 try{availability=await api('/api/availability');}catch{availability={...availability,loading:false,unavailable:true};}
 if($('#booking-form [name=date]'))syncBookingDate();
}

function loginPage(session){if($('#editor').open)$('#editor').close();if($('#lightbox').open)$('#lightbox').close();$('#root').innerHTML=`<main id="main" class="login-page"><a href="/" class="wordmark">${esc(site.brand)}<span>QUẢN TRỊ STUDIO</span></a><div class="login-card">${label(session.needsSetup?'THIẾT LẬP BAN ĐẦU':'QUẢN TRỊ WEBSITE')}<h1>${session.needsSetup?'Thiết lập studio.':'Chào mừng trở lại.'}</h1><p>${session.needsSetup?'Tạo tài khoản quản trị của bạn để bắt đầu quản lý website.':'Đăng nhập để quản lý bộ ảnh, yêu cầu tư vấn và lịch chụp.'}</p><form data-form="${session.needsSetup?'setup':'login'}"><label>Email quản trị<input type="email" name="email" required autocomplete="username"></label><label>Mật khẩu<input type="password" name="password" required ${session.needsSetup?'minlength="12"':''} autocomplete="${session.needsSetup?'new-password':'current-password'}"></label>${session.needsSetup?'<p class="form-note">Đặt mật khẩu có ít nhất 12 ký tự và lưu lại để đăng nhập.</p><label>Mã thiết lập <span class="muted">(cần khi truy cập từ máy khác hoặc trên máy chủ)</span><input name="token" type="password" autocomplete="off"></label>':''}<p class="form-error" role="alert"></p><button class="btn">${session.needsSetup?'Tạo tài khoản quản trị':'Đăng nhập'} </button></form></div><a class="underlink" href="/">Về website</a></main>`;}
const views=[['dashboard','grid','Tổng quan'],['portfolio','image','Bộ ảnh'],['clients','gallery','Ảnh của khách'],['inquiries','inbox','Yêu cầu tư vấn'],['calendar','calendar','Lịch chụp'],['settings','settings','Cài đặt']];
function alignAdminNav(){
 const nav=$('.sidebar nav'),active=nav?.querySelector('[aria-current=page]');
 if(!nav||!active||!window.matchMedia('(max-width:750px)').matches)return;
 const navRect=nav.getBoundingClientRect(),activeRect=active.getBoundingClientRect();
 nav.scrollLeft+=activeRect.left-navRect.left-(nav.clientWidth-activeRect.width)/2;
}
window.addEventListener('resize',alignAdminNav);
function adminShell(content){history.replaceState(null,'','#'+(adminAlbumId?'album/'+adminAlbumId:adminView));$('#root').innerHTML=`<div class="admin-layout"><aside class="sidebar"><a class="wordmark" href="/">${esc(site.brand)}<span>QUẢN TRỊ STUDIO</span></a><p class="sidebar-label">QUẢN LÝ STUDIO</p><nav aria-label="Điều hướng studio">${views.map(([v,glyph,text])=>`<button data-action="admin-view" data-view="${v}" class="${adminView===v?'active':''}" ${adminView===v?'aria-current="page"':''}>${icon(glyph)}<span>${text}</span></button>`).join('')}</nav><div class="sidebar-bottom"><span class="studio-signature">Quản lý ảnh và lịch chụp.</span><button data-action="logout">${icon('logout')} Đăng xuất</button></div></aside><main id="main" class="admin-main"><header class="admin-topbar"><div class="breadcrumb"><span>Studio</span><span aria-hidden="true">/</span><strong>${esc(views.find(v=>v[0]===adminView)?.[2])}</strong></div><a href="/" target="_blank" rel="noopener">Xem website ${icon('external')}</a></header><div class="admin-content">${content}</div></main></div>`;alignAdminNav();}
function readinessPanel(r){return `<section class="panel readiness-panel"><div class="panel-heading"><h2>Thiết lập website</h2><span class="badge">${r.production?'Môi trường chính thức':'Môi trường thử nghiệm'}</span></div><div class="readiness-grid">${[[r.contact,'Thông tin liên hệ',r.contact?'Khách đã có kênh liên hệ với bạn.':'Thêm email hoặc số điện thoại trong Cài đặt.','settings'],[r.portfolio,'Bộ ảnh công khai',r.portfolio?'Đã có bộ ảnh công khai kèm ảnh.':'Đăng ảnh rồi chuyển bộ ảnh sang Công khai.','portfolio'],[r.cloud,'Lưu trữ dữ liệu',r.cloud?'Đã cấu hình cơ sở dữ liệu và kho ảnh trên đám mây.':'Dữ liệu đang lưu trên máy. Cần cấu hình lưu trữ bền vững khi triển khai website.','settings']].map(([done,title,note,view])=>`<button class="readiness-item" data-action="admin-view" data-view="${view}"><span class="readiness-icon ${done?'done':''}">${done?icon('check'):icon('plus')}</span><div><strong>${title}</strong><p>${note}</p></div></button>`).join('')}</div></section>`;}
function adminHeading(title,subtitle,action=''){return `<div class="admin-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;}
function inquiryRows(rows,emptyTitle='Chưa có yêu cầu tư vấn',emptyNote='Yêu cầu khách gửi qua website sẽ xuất hiện tại đây.'){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Khách hàng</th><th>Dịch vụ quan tâm</th><th>Ngày dự kiến</th><th>Trạng thái</th><th><span class="sr-only">Thao tác</span></th></tr></thead><tbody>${rows.map(r=>`<tr data-search="${esc([r.name,r.email,r.phone,r.service,r.date].join(' '))}" data-status="${r.status}"><td class="customer-cell" data-label="Khách hàng"><strong>${esc(r.name)}</strong><small>${esc(r.email||r.phone)}</small></td><td data-label="Dịch vụ quan tâm">${esc(r.service)}</td><td data-label="Ngày dự kiến">${dateLabel(r.date)}</td><td class="status-cell" data-label="Trạng thái">${badge(r.status)}</td><td class="row-action"><button class="link-btn" data-action="inquiry-detail" data-id="${r.id}" aria-label="Xem yêu cầu của ${esc(r.name)}">Xem chi tiết ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state"><span class="empty-icon">${icon('inbox')}</span><h3>${esc(emptyTitle)}</h3><p>${esc(emptyNote)}</p></div>`;}
async function dashboard(){const d=await api('/api/admin/dashboard');const count=(rows,status)=>Number(rows.find(r=>r.status===status)?.count||0);adminShell(adminHeading('Tổng quan','Theo dõi bộ ảnh, yêu cầu tư vấn và lựa chọn của khách.',`<button class="btn" data-action="new-album">${icon('plus')} Tạo bộ ảnh</button>`)+`<div class="stats-grid">${[['Bộ ảnh công khai',count(d.albums,'published'),'Bộ ảnh đang hiển thị'],['Ảnh của khách',count(d.albums,'private'),'Bộ ảnh có mật khẩu'],['Yêu cầu mới',count(d.inquiries,'new'),'Đang chờ bạn xử lý'],['Ảnh trong studio',d.photos,'Tổng số ảnh đã tải lên']].map(([title,n,note])=>`<div class="stat-card"><span>${title}</span><strong>${n}</strong><small>${note}</small></div>`).join('')}</div>${readinessPanel(d.readiness)}<section class="panel"><div class="panel-heading"><h2>Yêu cầu gần đây</h2><button class="link-btn" data-action="admin-view" data-view="inquiries">Xem tất cả</button></div>${inquiryRows(d.recent)}</section><div class="admin-two"><section class="panel quick-start"><h2>Tạo bộ ảnh mới</h2><p>Tạo bộ ảnh, thêm ảnh, chọn bìa và chuyển sang công khai khi đã sẵn sàng.</p><button class="underlink" data-action="new-album">${d.albums.some(a=>Number(a.count)>0)?'Tạo bộ ảnh mới':'Tạo bộ ảnh đầu tiên'}</button></section><section class="panel"><h2>Khách đã gửi lựa chọn</h2>${d.selections.length?d.selections.map(a=>`<button class="selection-alert" data-action="edit-album" data-id="${a.id}"><span>${esc(a.title)}</span></button>`).join(''):'<p class="muted panel-note">Khi khách gửi danh sách ảnh đã chọn, bộ ảnh sẽ xuất hiện tại đây.</p>'}</section></div>`);}
function adminAlbumsPage(){const client=adminView==='clients';const rows=adminAlbums.filter(a=>client?a.status==='private':a.status!=='private');adminShell(adminHeading(client?'Ảnh của khách':'Bộ ảnh',client?'Gửi đường dẫn (và mật khẩu nếu có) để khách xem ảnh, chọn ảnh rồi gửi lựa chọn cho studio.':'Tạo bộ ảnh, sắp xếp nội dung và chọn những gì sẽ hiển thị trên website.',`<button class="btn" data-action="new-album">${icon('plus')} ${client?'Tạo bộ ảnh riêng':'Tạo bộ ảnh'}</button>`)+searchToolbar(client?['private']:['draft','published','archived'])+`<div class="admin-album-grid">${rows.length?rows.map(a=>`<button class="admin-album" data-search="${esc([a.title,a.client_name,categories[a.category]].join(' '))}" data-status="${a.status}" data-action="edit-album" data-id="${a.id}">${img(cover(a))}<div class="admin-album-info">${badge(a.status)}<h3>${esc(a.title)}</h3><p>${a.photos.length} ảnh · ${esc(categories[a.category])}${client?' · '+a.photos.filter(p=>p.selected).length+' đã chọn · '+(a.has_password?'Có mật khẩu':'Không mật khẩu'):''}</p>${a.selection_status==='submitted'&&client?'<span class="pick-status">● Khách đã gửi lựa chọn</span>':''}</div></button>`).join(''):`<div class="empty-state"><span class="empty-icon">${icon('image')}</span><h3>${client?'Bộ ảnh riêng đầu tiên':'Bộ ảnh đầu tiên của bạn'}</h3><p>${client?'Tạo bộ ảnh để chia sẻ riêng với khách.':'Tạo bộ ảnh, thêm ảnh và công khai khi đã sẵn sàng.'}</p></div>`}</div>`);applyAdminFilters();}
function albumForm(a={}){const isPrivate=(a.status||(adminView==='clients'?'private':'draft'))==='private';const hasPassword=a.id?Boolean(a.has_password):true;return `<form data-form="album" data-id="${a.id||''}"><label>Tên bộ ảnh *<input name="title" required maxlength="150" value="${esc(a.title)}" placeholder="Tên bộ ảnh"></label><label>Tên trong đường dẫn (slug)<input name="slug" maxlength="150" value="${esc(a.slug)}" placeholder="Để trống để tạo từ tên bộ ảnh"><small data-slug-preview>chicongphoto.vn/album/${esc(a.slug||albumSlug(a.title))}</small></label><p class="form-note">Tên trong đường dẫn được thêm số nếu bị trùng. Đổi tên bộ ảnh không tự đổi đường dẫn; nếu sửa đường dẫn, đường dẫn cũ vẫn chuyển tiếp. Bộ ảnh riêng dùng đường dẫn riêng có mã định danh.</p><div class="form-pair"><label>Thể loại<select name="category">${Object.entries(categories).map(([k,v])=>`<option value="${k}" ${a.category===k?'selected':''}>${v}</option>`).join('')}</select></label><label>Trạng thái<select name="status">${['draft','published','private','archived'].map(k=>`<option value="${k}" ${(a.status||(adminView==='clients'?'private':'draft'))===k?'selected':''}>${statuses[k]}</option>`).join('')}</select></label></div><label>Mô tả<textarea name="description" rows="3" maxlength="2000">${esc(a.description)}</textarea></label><div class="form-pair"><label>Tên khách hàng<input name="client_name" maxlength="150" value="${esc(a.client_name)}"></label><label>Ngày chụp<input name="event_date" type="date" value="${esc(a.event_date)}"></label></div><div class="private-password-section" ${isPrivate?'':'hidden'}><label class="checkbox-label"><input type="checkbox" name="require_password" ${hasPassword?'checked':''}> Cài mật khẩu khi xem trên web</label><div class="password-field" ${hasPassword?'':'hidden'}><label>Mật khẩu bộ ảnh riêng<input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="${hasPassword?'Để trống nếu giữ mật khẩu hiện tại':'Ít nhất 8 ký tự nếu cài mật khẩu'}"></label></div><p class="form-note">Nếu không bật mật khẩu, khách chỉ cần mở đường dẫn là xem và chọn ảnh được ngay trên web. Nếu bật mật khẩu, khách cần nhập đúng mật khẩu để mở bộ ảnh.</p></div><p class="form-note">Chỉ bộ ảnh có trạng thái Công khai mới hiển thị trên website.</p><p class="form-error" role="alert"></p><button class="btn">${a.id?'Lưu thay đổi':'Tạo bộ ảnh'} </button></form>`;}
function managedPhotos(a){const visible=sectionPhotos(a,adminSectionFilter);return visible.map((p,i)=>`<article class="manage-photo ${p.selected?'client-picked':''}">${img(p)}<div>${a.sections?.length?`<label class="bulk-check"><input type="checkbox" data-section-photo="${p.id}" aria-label="Chọn ảnh ${esc(p.original||p.caption)} để chuyển phần" ${sectionSelected.has(p.id)?'checked':''}> Chọn ảnh</label>`:''}<span class="photo-number">${String(i+1).padStart(2,'0')}${p.selected?' · ♥ Khách chọn':''}</span><p>${esc(p.original||p.caption)}</p>${photoSizeNote(p.optimization)}${a.sections?.length?`<label class="photo-section-label">Phần<select data-photo-section="${p.id}" aria-label="Phần của ảnh ${esc(p.original||p.caption)}">${sectionOptions(a,p.section_id)}</select></label>`:''}<div class="photo-actions"><button data-action="cover-photo" data-id="${p.id}">${a.cover_id===p.id?'● Ảnh bìa':'Đặt làm ảnh bìa'}</button><button data-action="caption-photo" data-id="${p.id}">Sửa chú thích</button><button data-action="move-photo" data-id="${p.id}" data-direction="up" aria-label="Đưa ảnh lên trước" ${i===0||visible[i-1].section_id!==p.section_id?'disabled':''}>↑</button><button data-action="move-photo" data-id="${p.id}" data-direction="down" aria-label="Đưa ảnh xuống sau" ${i===visible.length-1||visible[i+1].section_id!==p.section_id?'disabled':''}>↓</button><button data-action="remove-photo" data-id="${p.id}">Xóa</button></div></div></article>`).join('');}
function adminAlbumDetail(){const a=adminAlbums.find(a=>a.id===adminAlbumId);if(!a){adminAlbumId=null;return adminAlbumsPage();}const pendingUpload=$(`[data-form=upload][data-id="${a.id}"]`);adminView=a.status==='private'?'clients':'portfolio';if(sectionAlbumId!==a.id){sectionAlbumId=a.id;adminSectionFilter='all';sectionSelected.clear();}if(adminSectionFilter!=='all'&&adminSectionFilter!=='unassigned'&&!a.sections?.some(s=>s.id===adminSectionFilter))adminSectionFilter='all';for(const key of sectionSelected)if(!a.photos.some(p=>p.id===key))sectionSelected.delete(key);const count=a.photos.filter(p=>p.selected).length;adminShell(`<button class="underlink back-btn" data-action="album-back">Danh sách bộ ảnh</button>`+adminHeading(esc(a.title),`${a.photos.length} ảnh · ${esc(categories[a.category])}`,`<button class="small-btn" data-action="album-settings" data-id="${a.id}">${icon('settings')} Thông tin bộ ảnh</button>`)+`<div class="album-detail-top">${badge(a.status)}${a.status==='published'?`<a class="underlink" href="/album/${esc(a.slug||a.id)}" target="_blank" rel="noopener">Xem trên website</a>`:''}${a.status==='private'?`<a class="underlink" href="/gallery/${a.id}" target="_blank" rel="noopener">Xem trên web</a><button class="underlink" data-action="copy-link" data-id="${a.id}">Sao chép đường dẫn</button><span class="badge ${a.has_password?'has-password':'no-password'}">${a.has_password?'Có mật khẩu':'Không cần mật khẩu'}</span><span>${count} ảnh đã chọn</span><a class="small-btn" href="/api/admin/albums/${a.id}/selections.csv">Xuất danh sách CSV</a>${badge(a.selection_status,selectionStatusLabels)}`:''}</div>${sectionManager(a)}<section class="upload-panel"><div><h3>Thêm ảnh vào bộ ảnh</h3><p>Chọn một hoặc nhiều ảnh JPEG, PNG, WebP hoặc gói .ccphoto. Tối đa ${uploadSizeLabel} và 40 megapixel mỗi ảnh.</p></div><form data-form="upload" data-id="${a.id}">${a.sections?.length?`<label class="upload-destination">Tải ảnh vào phần<select name="section_id">${sectionOptions(a,adminSectionFilter)}</select></label>`:''}<label class="upload-label">Chọn ảnh<input type="file" name="photos" accept=".ccphoto,image/jpeg,image/png,image/webp" multiple required></label><button class="btn" type="submit">Tải ảnh lên</button><a role="button" href="#" class="upload-cancel" data-action="cancel-upload" hidden>Hủy tải lên</a><p class="upload-selection" role="status"></p><progress class="upload-meter" aria-label="Tiến độ tải ảnh" max="1" value="0" hidden></progress><p class="upload-progress" role="status" aria-live="polite"></p><p class="form-error" role="alert"></p></form><details class="upload-explanation"><summary>Cách tải nhanh bộ ảnh lớn</summary><p class="form-note">Nếu đã chuẩn bị ảnh trên Mac, chọn các tệp .ccphoto trong thư mục của phần ảnh tương ứng. Mỗi tệp chứa bản xem và JPG cho khách, giúp giảm thời gian xử lý khi upload. Với JPEG, PNG hoặc WebP, hệ thống tự tạo các bản ảnh sau khi nhận tệp.</p></details></section><div data-upload-report>${latestUploadReports.get(a.id)||''}</div>${sectionTabs(a,adminSectionFilter,true)}${sectionBulkToolbar(a,sectionSelected)}<div class="admin-photo-grid">${managedPhotos(a)||'<p class="empty-state">Chưa có ảnh trong mục này.</p>'}</div>`);restorePendingUpload(pendingUpload,a);syncBulkSelection();alignSectionTabs();}
const adminFilters={};
const normalizeSearch=value=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
function searchToolbar(options){const f=adminFilters[adminView]||{query:'',status:''};return `<div class="admin-filters"><label>Tìm kiếm<span class="search-input">${icon('search')}<input type="search" data-admin-search value="${esc(f.query)}" placeholder="${adminView==='inquiries'?'Tên, email hoặc số điện thoại…':'Tên bộ ảnh hoặc khách hàng…'}"></span></label><label>Trạng thái<select data-admin-status aria-label="Trạng thái"><option value="">Tất cả trạng thái</option>${options.map(k=>`<option value="${k}" ${f.status===k?'selected':''}>${statuses[k]}</option>`).join('')}</select></label><p data-filter-count role="status"></p></div><p class="filter-empty" hidden>Không có kết quả phù hợp. Thử từ khóa hoặc trạng thái khác.</p>`;}
function applyAdminFilters(){if(!$('[data-admin-search]'))return;const f=adminFilters[adminView]||{query:'',status:''};const rows=[...document.querySelectorAll('[data-search]')];let count=0;rows.forEach(row=>{row.hidden=!!((f.status&&row.dataset.status!==f.status)||!normalizeSearch(row.dataset.search).includes(normalizeSearch(f.query.trim())));if(!row.hidden)count++;});$('[data-filter-count]').textContent=`${count} / ${rows.length} kết quả`;$('.filter-empty').hidden=!rows.length||count>0;}
function changeAdminFilter(){adminFilters[adminView]={query:$('[data-admin-search]').value,status:$('[data-admin-status]').value};applyAdminFilters();}
document.addEventListener('input',e=>{const form=e.target.closest('[data-form=album]');if(form&&['slug','title'].includes(e.target.name))form.querySelector('[data-slug-preview]').textContent='chicongphoto.vn/album/'+albumSlug(form.elements.slug.value||form.elements.title.value);if(form&&e.target.name==='password'&&e.target.value){const pwCheck=form.querySelector('[name=require_password]');if(pwCheck)pwCheck.checked=true;}if(e.target.matches('[data-admin-search]'))changeAdminFilter();});
document.addEventListener('change',e=>{if(e.target.matches('#booking-form [name=date]'))syncBookingDate(true);if(e.target.matches('[data-admin-status]'))changeAdminFilter();const form=e.target.closest('[data-form=album]');if(form){if(e.target.name==='status'){const isPrivate=e.target.value==='private';const sec=form.querySelector('.private-password-section');if(sec)sec.hidden=!isPrivate;const pwCheck=form.querySelector('[name=require_password]');const pwField=form.querySelector('.password-field');if(isPrivate&&!form.dataset.id&&pwCheck&&!pwCheck.checked){pwCheck.checked=true;if(pwField)pwField.hidden=false;}}if(e.target.name==='require_password'){const pwField=form.querySelector('.password-field');const pwInput=form.querySelector('[name=password]');if(pwField)pwField.hidden=!e.target.checked;if(!e.target.checked&&pwInput)pwInput.value='';}}});
function inquiriesPage(){adminShell(adminHeading('Yêu cầu tư vấn','Xem thông tin khách gửi, lưu ghi chú và cập nhật trạng thái tư vấn.')+searchToolbar(['new','contacted','confirmed','completed','cancelled'])+`<section class="panel">${inquiryRows(inquiries)}</section>`);applyAdminFilters();}
function calendarAdmin(){adminShell(adminHeading('Lịch chụp','Quản lý ngày bận và những buổi chụp đã xác nhận.')+`<div class="admin-two"><section class="panel"><h2>Chặn một ngày</h2><form data-form="block-date"><label>Ngày bận<input name="date" type="date" required></label><label>Ghi chú riêng<input name="note" maxlength="200" placeholder="Chụp ngoài tỉnh, nghỉ…"></label><p class="form-error" role="alert"></p><button class="btn">${icon('plus')} Chặn ngày</button></form></section><section class="panel"><h2>Ngày đã chặn</h2>${dates.length?dates.map(d=>`<div class="date-row"><div><strong>${dateLabel(d.date)}</strong><small>${esc(d.note)}</small></div><button class="link-btn" data-action="unblock-date" data-date="${d.date}">Mở lại</button></div>`).join(''):'<p class="panel-note muted">Chưa chặn ngày nào.</p>'}</section></div><section class="panel"><h2>Lịch đã xác nhận</h2>${inquiryRows(inquiries.filter(i=>i.status==='confirmed'),'Chưa có lịch chụp đã xác nhận','Các yêu cầu được chuyển sang trạng thái Đã xác nhận lịch sẽ xuất hiện tại đây.')}</section>`);}
function curationRow(kind,index,choice={}){
 const available=adminAlbums.filter(a=>a.status==='published'&&a.photos.length);
 const selected=available.find(a=>a.id===choice.albumId);
 const photoSelect=(field,title)=>{const selectedPhoto=selected?.photos.find(p=>p.id===choice[field])|| (selected?cover(selected):null);return `<label>${title}<select data-photo-field="${field}" ${selected?'':'disabled'}>${selected?selected.photos.map((p,i)=>`<option value="${p.id}" ${p.id===selectedPhoto?.id?'selected':''}>${i+1}. ${esc(p.caption||'Ảnh')} · ${p.width>p.height?'Ngang':'Dọc'}</option>`).join(''):'<option>Chọn bộ ảnh trước</option>'}</select>${selectedPhoto?`<img class="curation-preview" src="${esc(selectedPhoto.thumb)}" alt="Xem trước ${esc(title)}">`:''}</label>`;};
 return `<fieldset class="curation-row" data-curation="${kind}" data-slot="${index}"><legend>${kind==='hero'?'Ảnh mở đầu':'Bộ ảnh'} ${index+1}</legend><label>Bộ ảnh<select data-curation-album><option value="">Không chọn</option>${available.map(a=>`<option value="${a.id}" ${a.id===selected?.id?'selected':''}>${esc(a.title)}</option>`).join('')}</select></label><div class="curation-photos">${kind==='hero'?photoSelect('wideId','Ảnh trên máy tính')+photoSelect('tallId','Ảnh trên điện thoại'):photoSelect('photoId','Ảnh đại diện')}</div></fieldset>`;
}
function googleCalendarSettings(){return `<section class="panel settings-panel"><h2>Google Calendar · Đồng bộ lịch chụp</h2><p>${googleCalendarState.configured?(googleCalendarState.unavailable?'Chưa kết nối được Google Calendar. Khách vẫn có thể gửi yêu cầu tư vấn khi để trống ngày chụp.':`Đã đồng bộ · ${googleCalendarState.blocked.length} ngày bận · Lần gần nhất: ${esc(new Date(googleCalendarState.lastSynced).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))}`):'Chưa cấu hình kết nối Google Calendar trên máy chủ.'}</p><p class="panel-note">Đồng bộ một chiều từ Google Calendar vào studio. Khi xem lịch, dữ liệu được cập nhật nếu lần đồng bộ trước đã quá 5 phút. ${googleCalendarState.includeTransparent?'Mọi sự kiện chưa hủy trên lịch này đều chặn cả ngày, kể cả sự kiện được Google đánh dấu Rảnh.':'Sự kiện Bận sẽ chặn cả ngày; sự kiện Rảnh không chặn.'} Hiển thị lịch trong 2 năm tới.</p><a class="link-btn" href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer">Mở Google Calendar</a>${googleCalendarState.blocked.length?`<details><summary>Ngày bận từ Google</summary>${googleCalendarState.blocked.map(d=>`<div class="date-row">${dateLabel(d)}</div>`).join('')}</details>`:''}</section>`;}
function settingsPage(){
 const fields=[['brand','Tên thương hiệu'],['name','Tên để khách gọi bạn'],['tagline','Dòng mô tả thương hiệu'],['headline','Tiêu đề trang chủ'],['intro','Mô tả khi chia sẻ đường dẫn'],['about','Giới thiệu bản thân'],['email','Email liên hệ'],['phone','Số điện thoại công khai'],['location','Khu vực hoạt động'],['facebook','Đường dẫn Facebook'],['instagram','Đường dẫn Instagram'],['zalo','Đường dẫn Zalo (nếu sử dụng)'],['bookingNote','Lời mở đầu trang liên hệ'],['responseNote','Thông tin phản hồi (để trống nếu chưa có cam kết)']];
 const heroes=parseSelection(site.heroSelection,defaultHeroSelection),stories=parseSelection(site.storySelection,defaultStorySelection);
 adminShell(adminHeading('Cài đặt','Quản lý kết nối lịch, nội dung website và thông tin liên hệ.')+`${googleCalendarSettings()}<section class="panel settings-panel"><form data-form="settings">${fields.map(([k,v])=>`<label>${v}${['headline','intro','about','bookingNote'].includes(k)?`<textarea name="${k}" rows="${k==='about'?5:2}" ${k==='headline'?'required':''}>${esc(site[k])}</textarea>`:`<input name="${k}" value="${esc(site[k])}" ${['brand','name'].includes(k)?'required':''} ${k==='email'?'type="email"':''}>`}</label>`).join('')}<p class="form-note">Các kênh liên hệ có thể để trống. Website chỉ hiện những kênh bạn đã điền.</p><p class="form-error" role="alert"></p><button class="btn" type="submit">Lưu nội dung</button></form></section>
 <section class="panel settings-panel"><h2>Ảnh chân dung của bạn</h2><p class="panel-note">Dùng ảnh chân dung hoặc ảnh bạn đang tác nghiệp. Ảnh này sẽ xuất hiện công khai ở trang Về mình.</p>${site.portrait?`<img class="portrait-preview" src="/portrait/${esc(site.portrait)}" alt="Ảnh chân dung hiện tại">`:''}<form data-form="portrait"><label>Chọn ảnh JPEG, PNG hoặc WebP · Tối đa ${uploadSizeLabel}<input type="file" name="portrait" accept="image/jpeg,image/png,image/webp" required></label><p class="form-error" role="alert"></p><button class="btn" type="submit">Tải ảnh chân dung lên</button></form>${site.portrait?'<button class="underlink" data-action="hide-portrait">Ẩn ảnh chân dung</button>':''}</section>
 <section class="panel settings-panel"><form data-form="curation"><h2>Ảnh mở đầu và bộ ảnh nổi bật</h2><p class="panel-note">Chọn tối đa 4 ảnh mở đầu và 6 bộ ảnh theo thứ tự hiển thị. Mỗi bộ ảnh chỉ chọn một lần trong mỗi nhóm. Chỉ bộ ảnh công khai xuất hiện ở đây; hãy dùng ảnh khác nhau giữa phần trình chiếu và danh sách bộ ảnh bên dưới.</p><h3>Trình chiếu ảnh mở đầu</h3><div class="curation-grid">${Array.from({length:4},(_,i)=>curationRow('hero',i,heroes[i])).join('')}</div><h3>Bộ ảnh trên trang chủ</h3><div class="curation-grid">${Array.from({length:6},(_,i)=>curationRow('story',i,stories[i])).join('')}</div><p class="form-note">Các vị trí chưa chọn được bỏ qua. Nếu chưa chọn ảnh mở đầu, website dùng một ảnh từ bộ ảnh công khai. Danh sách bộ ảnh tự bổ sung các bộ ảnh công khai còn lại để đủ tối đa 6 bộ.</p><p class="form-error" role="alert"></p><button class="btn" type="submit">Lưu lựa chọn ảnh</button></form></section>
 <section class="panel backup-panel"><h2>Sao lưu dữ liệu</h2><p>Tải thông tin bộ ảnh, lựa chọn và yêu cầu tư vấn dưới dạng JSON. Bản sao chứa thông tin khách hàng và ghi chú riêng; hãy lưu ở nơi an toàn. Ảnh và tài khoản quản trị cần được sao lưu riêng.</p><a class="small-btn" href="/api/admin/export">Tải bản sao JSON</a></section>`);
}
function editDialog(title,html){$('#editor').innerHTML=`<div class="dialog-heading"><h2 id="editor-title">${title}</h2><button class="close" data-action="close-editor" aria-label="Đóng">×</button></div>${html}`;$('#editor').setAttribute('aria-labelledby','editor-title');$('#editor').showModal();}
async function refreshAdmin(){if(adminView==='dashboard')return dashboard();if(['portfolio','clients'].includes(adminView)||adminAlbumId){adminAlbums=await api('/api/admin/albums');if(adminAlbumId)return adminAlbumDetail();return adminAlbumsPage();}if(adminView==='inquiries'){inquiries=await api('/api/admin/inquiries');return inquiriesPage();}if(adminView==='calendar'){[dates,inquiries]=await Promise.all([api('/api/admin/dates'),api('/api/admin/inquiries')]);return calendarAdmin();}if(adminView==='settings'){const values=await Promise.all([api('/api/site'),api('/api/admin/albums'),api('/api/admin/google-calendar')]);site=currentCopy(values[0]);adminAlbums=values[1];googleCalendarState=values[2];return settingsPage();}}
async function openAdmin(){const session=await api('/api/admin/session');if(!session.authenticated)return loginPage(session);return refreshAdmin();}
async function route(){document.body.classList.toggle('public-view',location.pathname.replace(/\/$/,'')!=='/admin');const pathname=location.pathname.replace(/\/$/,'')||'/';const needsCards=['/','/portfolio'].includes(pathname),initial=takePageData(pathname);const isGallery=pathname.startsWith('/gallery/'),isAlbum=pathname.startsWith('/album/');const [settings,cards,detail]=await Promise.all([initial?.site||api('/api/site'),needsCards?(Array.isArray(initial?.albums)?initial.albums:api('/api/portfolio?view=cards')):isAlbum?api('/api/portfolio?view=cards').catch(()=>[]):null,isGallery?api('/api/gallery/'+pathname.split('/')[2]):isAlbum?api('/api/albums/'+pathname.split('/')[2]):null]);site=currentCopy(settings);if(cards)albums=cards;if(pathname==='/admin'){const hash=location.hash.slice(1);if(hash.startsWith('album/')&&/^[a-f0-9]{32}$/.test(hash.slice(6))){adminAlbumId=hash.slice(6);adminView='portfolio';}else if(views.some(v=>v[0]===hash))adminView=hash;return openAdmin();}if(isGallery){album=detail;return album.locked?lockedGallery():albumPage(true);}if(isAlbum){album=detail;return albumPage();}if(pathname==='/contact'){availability={blocked:[],loading:true,today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())};const [year,month]=availability.today.split('-').map(Number);calendarMonth=new Date(year,month-1,1);contact();void loadBookingAvailability();return;}if(pathname==='/about')return about();if(needsCards)return pathname==='/'?home():portfolio();publicPage(`<section class="page-width page-title">${label('404')}<h1>Không tìm thấy trang.</h1>${button('Về trang chủ','/')}</section>`);}
function closeMobileMenu(restoreFocus=false){const trigger=$('[data-action=menu]');if(trigger?.getAttribute('aria-expanded')!=='true')return;trigger.setAttribute('aria-expanded','false');$('#nav-links')?.classList.remove('open');if(restoreFocus)trigger.focus();}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobileMenu(true);});
document.addEventListener('click',e=>{if(!e.target.closest('.public-nav'))closeMobileMenu();});
function lightPhotos(){return album?.photos?sectionPhotos(album,sectionFilter,selectedOnly):[];}
let lightReturnPhoto=null,lightPreloadTimer,lightPreloads=[];
function lightImageSizes(photo){
 const image=$('#lightbox img');
 const aspect=photo.width>0&&photo.height>0?photo.width/photo.height:1.5;
 return Math.ceil(Math.min(image.clientWidth||innerWidth, (image.clientHeight||innerHeight*.65)*aspect))+'px';
}
function stopLightPreloads(){clearTimeout(lightPreloadTimer);lightPreloads.forEach(image=>{image.removeAttribute('srcset');image.removeAttribute('src');});lightPreloads=[];}
function preloadLightNeighbors(){
 stopLightPreloads();
 if(navigator.connection?.saveData||/2g/.test(navigator.connection?.effectiveType||''))return;
 lightPreloadTimer=setTimeout(()=>{
  if(!$('#lightbox').open)return;
  const photos=lightPhotos();if(photos.length<=1)return;
  const neighbors=new Set([photos[(lightIndex+1)%photos.length],photos[(lightIndex-1+photos.length)%photos.length]]);
  for(const photo of neighbors){
   const image=new Image();image.decoding='async';image.fetchPriority='low';
   if(Math.max(photo.width||0,photo.height||0)>900){image.sizes=lightImageSizes(photo);image.srcset=imageSources(photo);}
   image.src=photo.src;lightPreloads.push(image);
  }
 },180);
}
let lightZoomed=false,lightPanX=0,lightPanY=0,lightZoomScale=2.5,lightPanState=null;
let lightLastTapTime=0,lightLastTapX=0,lightLastTapY=0;
let lightPointerType='mouse';
function resetLightZoom(){
 lightZoomed=false;lightPanX=0;lightPanY=0;lightPanState=null;
 lightLastTapTime=0;
 const img=$('#lightbox img');if(img)img.style.transform='';
 const photo=lightPhotos()[lightIndex];if(img&&photo&&img.hasAttribute('srcset'))img.sizes=lightImageSizes(photo);
 $('#lightbox')?.classList.remove('is-zoomed','is-panning');
 const zoomBtn=$('#lightbox-zoom');
 if(zoomBtn){zoomBtn.textContent='Phóng to';zoomBtn.setAttribute('aria-label','Phóng to ảnh');}
}
function toggleLightZoom(clientX,clientY){
 const img=$('#lightbox img');
 if(!img||!img.naturalWidth)return;
 if(lightZoomed){resetLightZoom();return;}
 lightZoomed=true;
 // CSS transforms do not affect responsive image selection. Request the detail
 // rendition explicitly while zooming, without preloading it for every slide.
 const photo=lightPhotos()[lightIndex];
 if(photo&&img.hasAttribute('srcset'))img.sizes=Math.ceil(parseFloat(lightImageSizes(photo))*lightZoomScale)+'px';
 $('#lightbox').classList.add('is-zoomed');
 const zoomBtn=$('#lightbox-zoom');
 if(zoomBtn){zoomBtn.textContent='Thu nhỏ';zoomBtn.setAttribute('aria-label','Thu nhỏ ảnh');}
 const rect=img.getBoundingClientRect();
 const originX=clientX!==undefined?clientX-rect.left:img.clientWidth/2;
 const originY=clientY!==undefined?clientY-rect.top:img.clientHeight/2;
 const maxPanX=(img.clientWidth*(lightZoomScale-1))/2;
 const maxPanY=(img.clientHeight*(lightZoomScale-1))/2;
 lightPanX=Math.max(-maxPanX,Math.min(maxPanX,(img.clientWidth/2-originX)*(lightZoomScale-1)));
 lightPanY=Math.max(-maxPanY,Math.min(maxPanY,(img.clientHeight/2-originY)*(lightZoomScale-1)));
 img.style.transform=`translate(${lightPanX}px, ${lightPanY}px) scale(${lightZoomScale})`;
}
function showLight(index,retry=false){
 const photos=lightPhotos();
 if(!photos.length)return;
 resetLightZoom();
 lightIndex=(index+photos.length)%photos.length;
 const p=photos[lightIndex];
 const lightImg=$('#lightbox img');
 if(!$('#lightbox').open)$('#lightbox').showModal();
 const srcChanged=retry||lightImg.getAttribute('src')!==p.src;
 if(srcChanged){
  photoDownloads?.close();$('#lightbox-download-status').textContent='';
  // Keep the neighbor's image resource alive until the visible image adopts it.
  // Clearing its src first can issue a second no-store request on mobile.
  clearTimeout(lightPreloadTimer);
  $('#lightbox-retry').hidden=true;
  if(retry){lightImg.removeAttribute('srcset');lightImg.removeAttribute('src');}
  $('#lightbox').classList.add('image-loading');
  $('#lightbox').classList.remove('image-error');
  if(Math.max(p.width||0,p.height||0)>900){
   lightImg.sizes=lightImageSizes(p);
   lightImg.srcset=imageSources(p);
  }else{
   lightImg.removeAttribute('srcset');
   lightImg.removeAttribute('sizes');
  }
  lightImg.src=p.src;
  if(lightImg.complete&&lightImg.naturalWidth){$('#lightbox').classList.remove('image-loading');preloadLightNeighbors();}
 }
 lightImg.alt=p.caption||p.original||'Ảnh '+(lightIndex+1);
 $('#lightbox figcaption').textContent=`${p.caption||p.original||'Ảnh'}${album.sections?.length?' · '+(album.sections.find(s=>s.id===p.section_id)?.title||'Chưa phân loại'):''} · ${lightIndex+1} / ${photos.length}`;
 const pick=$('#lightbox-pick');
 pick.hidden=!clientGallery;
 pick.dataset.photo=p.id;
 pick.disabled=pickBusy;
 pick.setAttribute('aria-pressed',String(!!p.selected));
 pick.textContent=p.selected?'Bỏ chọn ảnh này':'Chọn ảnh này';
 $('#lightbox-download').hidden=false;
 $('#lightbox-selection').textContent=clientGallery?`${album.photos.filter(p=>p.selected).length} ảnh đã chọn · Lựa chọn được lưu tự động`:'';
 if(!$('#lightbox').open)$('#lightbox').showModal();
 document.body.classList.add('modal-open');

}
const lightImage=$('#lightbox img');
lightImage.addEventListener('load',()=>{if(!$('#lightbox').open)return;$('#lightbox').classList.remove('image-loading','image-error');$('#lightbox-retry').hidden=true;preloadLightNeighbors();});
lightImage.addEventListener('error',()=>{if(!$('#lightbox').open)return;$('#lightbox').classList.remove('image-loading');$('#lightbox').classList.add('image-error');$('#lightbox-retry').hidden=false;$('#lightbox figcaption').textContent='Chưa tải được ảnh. Bạn có thể thử lại.';});
$('#lightbox').addEventListener('dblclick',e=>{if(lightPointerType==='touch')return;if(e.target.closest('button,a,input,select'))return;const img=$('#lightbox img'),rect=img?.getBoundingClientRect();if(e.target===img||e.target.closest('#lightbox figure')||(rect&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom)){e.preventDefault();toggleLightZoom(e.clientX,e.clientY);}});
$('#lightbox').addEventListener('close',()=>{
 if($('#lightbox').open)return;
 document.body.classList.remove('modal-open');photoDownloads?.close();stopLightPreloads();resetLightGesture();resetLightZoom();
 lightImage.removeAttribute('srcset');lightImage.removeAttribute('src');
 ($(`.photo-open[data-photo="${lightReturnPhoto}"]`)||$('[data-action=selected-only]'))?.focus({preventScroll:true});
});
window.addEventListener('resize',()=>{if($('#lightbox').open){const photo=lightPhotos()[lightIndex];if(photo)lightImage.sizes=lightImageSizes(photo);resetLightZoom();}});
$('#lightbox').addEventListener('click',e=>{
 if(e.target!==$('#lightbox'))return;
 const rect=e.target.getBoundingClientRect();
 if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)$('#lightbox').close();
});
document.addEventListener('keydown',e=>{if($('#lightbox').open){if(e.key==='Escape'&&lightZoomed){e.preventDefault();resetLightZoom();return;}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();showLight(lightIndex+(e.key==='ArrowLeft'?-1:1));}}});
let lightGesture=null;
const resetLightGesture=()=>{
 const id=lightGesture?.id;lightGesture=null;
 if(id!==undefined&&$('#lightbox').hasPointerCapture?.(id)){try{$('#lightbox').releasePointerCapture(id);}catch{}}
};
$('#lightbox').addEventListener('pointerdown',e=>{
 lightPointerType=e.pointerType;
 if(!e.isPrimary){resetLightGesture();return;}
 if(e.button!==0||e.target.closest('button,a,input,select'))return;
 if(lightZoomed){
  const img=$('#lightbox img'),rect=img?.getBoundingClientRect();
  const inside=e.target===img||e.target.closest('#lightbox figure')||(rect&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom);
  if(inside){
   lightPanState={id:e.pointerId,startX:e.clientX,startY:e.clientY,originX:lightPanX,originY:lightPanY};
   $('#lightbox').classList.add('is-panning');
   try{$('#lightbox').setPointerCapture(e.pointerId);}catch{}
  }
  return;
 }
 lightGesture={id:e.pointerId,x:e.clientX,y:e.clientY,axis:null};
 try{$('#lightbox').setPointerCapture(e.pointerId);}catch{}
});
$('#lightbox').addEventListener('pointermove',e=>{
 if(lightPanState&&lightPanState.id===e.pointerId){
  const dx=e.clientX-lightPanState.startX,dy=e.clientY-lightPanState.startY;
  const img=$('#lightbox img');
  const maxPanX=(img.clientWidth*(lightZoomScale-1))/2;
  const maxPanY=(img.clientHeight*(lightZoomScale-1))/2;
  lightPanX=Math.max(-maxPanX,Math.min(maxPanX,lightPanState.originX+dx));
  lightPanY=Math.max(-maxPanY,Math.min(maxPanY,lightPanState.originY+dy));
  img.style.transform=`translate(${lightPanX}px, ${lightPanY}px) scale(${lightZoomScale})`;
  return;
 }
 if(!lightGesture||lightGesture.id!==e.pointerId)return;
 const dx=e.clientX-lightGesture.x,dy=e.clientY-lightGesture.y;
 if(!lightGesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8){
  if(Math.abs(dy)>=Math.abs(dx)){resetLightGesture();return;}
  lightGesture.axis='horizontal';
 }
});
$('#lightbox').addEventListener('pointerup',e=>{
 const gesture=lightPanState?.id===e.pointerId?{x:lightPanState.startX,y:lightPanState.startY}:lightGesture?.id===e.pointerId?lightGesture:null;
 const tap=gesture&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)<8;
 if(lightPanState&&lightPanState.id===e.pointerId){
  lightPanState=null;$('#lightbox').classList.remove('is-panning');
  if($('#lightbox').hasPointerCapture?.(e.pointerId))$('#lightbox').releasePointerCapture(e.pointerId);
 }
 if(e.pointerType==='touch'&&tap&&!e.target.closest('button,a,input,select')){
  const img=$('#lightbox img'),rect=img?.getBoundingClientRect();
  const inside=e.target===img||e.target.closest('#lightbox figure')||(rect&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom);
  if(inside){
   const now=Date.now();
   if(now-lightLastTapTime<320&&Math.hypot(e.clientX-lightLastTapX,e.clientY-lightLastTapY)<24){
    e.preventDefault();toggleLightZoom(e.clientX,e.clientY);lightLastTapTime=0;resetLightGesture();return;
   }
   lightLastTapTime=now;lightLastTapX=e.clientX;lightLastTapY=e.clientY;
  }
 }else lightLastTapTime=0;
 if(!lightGesture||lightGesture.id!==e.pointerId)return;
 const dx=e.clientX-lightGesture.x,dy=e.clientY-lightGesture.y;
 resetLightGesture();
 if(Math.abs(dx)>=44&&Math.abs(dx)>Math.abs(dy)*1.25)showLight(lightIndex+(dx<0?1:-1));
});
$('#lightbox').addEventListener('pointercancel',()=>{resetLightGesture();if(lightPanState){lightPanState=null;$('#lightbox').classList.remove('is-panning');}});
$('#lightbox').addEventListener('lostpointercapture',()=>{resetLightGesture();if(lightPanState){lightPanState=null;$('#lightbox').classList.remove('is-panning');}});
function alignSectionTabs(){
 const bar=$('.section-tabs'),active=bar?.querySelector('[aria-pressed=true]');if(!bar||!active)return;
 const parent=bar.getBoundingClientRect(),child=active.getBoundingClientRect();
 if(child.right>parent.right)bar.scrollLeft+=child.right-parent.right+3;
 else if(child.left<parent.left)bar.scrollLeft+=child.left-parent.left-3;
}
window.addEventListener('resize',alignSectionTabs);
function syncBulkSelection(){
 const a=adminAlbums.find(a=>a.id===adminAlbumId);if(!a)return;
 const visible=sectionPhotos(a,adminSectionFilter),chosen=visible.filter(p=>sectionSelected.has(p.id)).length;
 const check=$('[data-select-visible]');if(check){check.checked=visible.length>0&&chosen===visible.length;check.indeterminate=chosen>0&&chosen<visible.length;check.disabled=!visible.length;}
 document.querySelectorAll('[data-section-photo]').forEach(input=>{input.checked=sectionSelected.has(input.dataset.sectionPhoto);input.closest('.manage-photo').classList.toggle('section-selected',input.checked);});
 if($('[data-bulk-count]'))$('[data-bulk-count]').textContent=`${sectionSelected.size} ảnh đang chọn`;
 for(const action of ['section-assign','section-clear']){const btn=$(`[data-action=${action}]`);if(btn)btn.disabled=!sectionSelected.size;}
}
function sectionFocusSelector(){
 const el=document.activeElement;
 if(el?.closest('#editor'))return sectionReturnFocus;
 if(el?.dataset.photoSection)return `[data-photo-section="${el.dataset.photoSection}"]`;
 if(el?.dataset.action){let selector=`[data-action="${el.dataset.action}"]`;for(const key of ['id','direction','section'])if(el.dataset[key])selector+=`[data-${key}="${CSS.escape(el.dataset[key])}"]`;return selector;}
 return null;
}
async function saveSection(work){
 if(sectionBusy)return;sectionBusy=true;
 const focus=sectionFocusSelector(),top=window.scrollY;
 const controls=[...document.querySelectorAll('.admin-content button,.admin-content input,.admin-content select,#editor button,#editor input')].map(el=>[el,el.disabled]);
 controls.forEach(([el])=>{el.disabled=true;});
 const content=$('.admin-content');content?.setAttribute('aria-busy','true');
 const status=document.createElement('p');status.className='section-save-status';status.setAttribute('role','status');status.textContent='Đang lưu phần ảnh…';document.body.append(status);
 try{await work();await refreshAdmin();window.scrollTo({top,behavior:'instant'});(focus&&$(focus)||$('.section-tabs [aria-pressed=true]')||$('[data-action=section-new]'))?.focus({preventScroll:true});}
 finally{sectionBusy=false;status.remove();content?.removeAttribute('aria-busy');controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});}
}
function restorePendingUpload(form,a){
 if(!form?.querySelector('[type=file]')?.files.length)return;
 const fresh=$('[data-form=upload]'),queue=uploadQueues.get(form),previous=form.querySelector('[name=section_id]')?.value||'';
 const target=queue?.sectionId??previous,valid=!target||a.sections?.some(s=>s.id===target);
 const label=form.querySelector('.upload-destination');
 if(a.sections?.length){
  if(!label)form.prepend(fresh.querySelector('.upload-destination'));
  const select=form.querySelector('[name=section_id]');select.innerHTML=sectionOptions(a,valid?target:'');select.disabled=uploadBusy||!!queue?.pending.length;
 }else label?.remove();
 if(!valid){if(queue)queue.sectionId='';form.querySelector('.form-error').textContent='Phần đích đã bị xóa. Các ảnh chưa tải sẽ vào “Chưa phân loại”.';}
 fresh.replaceWith(form);
}
function sectionDialog(section){
 editDialog(section?'Đổi tên phần':'Thêm phần ảnh',`<form data-form="section" data-request-id="${crypto.randomUUID().replaceAll('-','')}" ${section?`data-id="${section.id}"`:''}><label>Tên phần<input name="title" value="${esc(section?.title)}" maxlength="120" placeholder="Ví dụ: Nghi thức gia tiên" required></label><p class="form-error" role="alert"></p><button class="btn" type="submit">Lưu phần</button></form>`);
 $('#editor [name=title]').focus();
}
async function handleSectionAction(action,el){
 if(action==='section-filter'){
  sectionFilter=el.dataset.section;albumPage(clientGallery);if(clientGallery)scrollToGallery();
  $(`[data-action=section-filter][data-section="${sectionFilter}"]`)?.focus({preventScroll:true});return true;
 }
 if(!['admin-section-filter','section-new','section-rename','section-remove','section-confirm-remove','section-move','section-preset','section-assign','section-clear'].includes(action))return false;
 const a=adminAlbums.find(a=>a.id===adminAlbumId);if(!a)return true;
 const section=a.sections?.find(s=>s.id===el.dataset.id);
 if(action==='admin-section-filter'){adminSectionFilter=el.dataset.section;sectionSelected.clear();adminAlbumDetail();$(`[data-action=admin-section-filter][data-section="${adminSectionFilter}"]`)?.focus({preventScroll:true});}
 if(action==='section-new'){sectionReturnFocus='[data-action=section-new]';sectionDialog();}
 if(action==='section-rename'&&section){sectionReturnFocus=`[data-action=section-rename][data-id="${section.id}"]`;sectionDialog(section);}
 if(action==='section-remove'&&section){sectionReturnFocus='.section-tabs [aria-pressed=true]';editDialog('Xóa phần ảnh?',`<p class="panel-note">Xóa phần “${esc(section.title)}”? Ảnh trong phần này sẽ trở về “Chưa phân loại”. Ảnh và lựa chọn của khách vẫn được giữ.</p><button class="btn danger" data-action="section-confirm-remove" data-id="${section.id}">Xóa phần</button>`);}
 if(action==='section-confirm-remove')await saveSection(async()=>{await api('/api/admin/sections/'+el.dataset.id,{method:'DELETE'});$('#editor').close();sectionSelected.clear();});
 if(action==='section-move'&&section){const order=a.sections.map(s=>s.id),from=order.indexOf(section.id),to=from+(el.dataset.direction==='up'?-1:1);if(to>=0&&to<order.length){[order[from],order[to]]=[order[to],order[from]];await saveSection(()=>send('/api/admin/albums/'+a.id+'/sections/order',{sections:order},'PUT'));$(`[data-action=section-move][data-id="${section.id}"][data-direction="${el.dataset.direction}"]`)?.focus({preventScroll:true});}}
 if(action==='section-preset'){
  await saveSection(async()=>{for(const title of weddingSections){if(!a.sections.some(s=>s.title.toLocaleLowerCase('vi')===title.toLocaleLowerCase('vi'))){const requestKey=a.id+':'+title;if(!sectionRequestIds.has(requestKey))sectionRequestIds.set(requestKey,crypto.randomUUID().replaceAll('-',''));const s=await send('/api/admin/albums/'+a.id+'/sections',{title,request_id:sectionRequestIds.get(requestKey)});a.sections.push(s);sectionRequestIds.delete(requestKey);}}});toast('Đã thêm các phần theo mẫu ngày cưới. Bạn có thể đổi tên hoặc sắp xếp lại.');
 }
 if(action==='section-clear'){sectionSelected.clear();syncBulkSelection();}
 if(action==='section-assign'){
  if(sectionSelected.size>1000)throw Error('Mỗi lượt chuyển tối đa 1.000 ảnh. Vui lòng chọn ít ảnh hơn.');
  const sectionId=$('[data-bulk-section]').value||null;
  await saveSection(async()=>{await send('/api/admin/albums/'+a.id+'/photos/sections',{assignments:[...sectionSelected].map(photo_id=>({photo_id,section_id:sectionId}))},'PUT');sectionSelected.clear();});toast('Đã chuyển ảnh vào phần đã chọn.');
 }
 return true;
}
document.addEventListener('change',async event=>{
 const input=event.target;
 if(!input.matches('[data-section-photo],[data-select-visible],[data-photo-section]'))return;
 const a=adminAlbums.find(a=>a.id===adminAlbumId);if(!a)return;
 if(sectionBusy||uploadBusy){if(input.matches('[data-photo-section]'))input.value=a.photos.find(p=>p.id===input.dataset.photoSection)?.section_id||'';else syncBulkSelection();return;}
 if(input.matches('[data-section-photo]')){if(input.checked)sectionSelected.add(input.dataset.sectionPhoto);else sectionSelected.delete(input.dataset.sectionPhoto);syncBulkSelection();}
 if(input.matches('[data-select-visible]')){for(const p of sectionPhotos(a,adminSectionFilter)){if(input.checked)sectionSelected.add(p.id);else sectionSelected.delete(p.id);}syncBulkSelection();}
 if(input.matches('[data-photo-section]')){
  const p=a.photos.find(p=>p.id===input.dataset.photoSection);input.focus({preventScroll:true});
  try{await saveSection(()=>send('/api/admin/photos/'+p.id,{section_id:input.value||null},'PATCH'));}
  catch(error){input.value=p.section_id||'';if(error.status===401)await openAdmin();toast(error.message);}
  finally{input.disabled=false;}
 }
});
let draggedSection=null;
document.addEventListener('dragstart',event=>{
 const handle=event.target.closest('.section-drag');if(!handle)return;
 if(sectionBusy||uploadBusy){event.preventDefault();return;}
 draggedSection=handle.closest('[data-section-row]').dataset.sectionRow;event.dataTransfer.setData('text/plain',draggedSection);event.dataTransfer.effectAllowed='move';
});
document.addEventListener('dragover',event=>{
 if(draggedSection&&event.target.closest('[data-section-row]')){event.preventDefault();event.dataTransfer.dropEffect='move';return;}
 const panel=event.target.closest('.upload-panel');
 if(panel&&event.dataTransfer?.types?.includes('Files')){
  event.preventDefault();event.dataTransfer.dropEffect='copy';panel.classList.add('drag-over');
 }
});
document.addEventListener('dragleave',event=>{
 const panel=event.target.closest('.upload-panel');
 if(panel&&!panel.contains(event.relatedTarget)){panel.classList.remove('drag-over');}
});
document.addEventListener('dragend',()=>{
 draggedSection=null;document.querySelectorAll('.upload-panel.drag-over').forEach(p=>p.classList.remove('drag-over'));
});
document.addEventListener('drop',async event=>{
 const row=event.target.closest('[data-section-row]');
 if(row&&draggedSection){
  event.preventDefault();const key=draggedSection;draggedSection=null;if(sectionBusy||uploadBusy)return;
  const a=adminAlbums.find(a=>a.id===adminAlbumId),order=a.sections.map(s=>s.id),from=order.indexOf(key),to=order.indexOf(row.dataset.sectionRow);
  if(from<0||to<0||from===to)return;order.splice(to,0,order.splice(from,1)[0]);
  try{await saveSection(()=>send('/api/admin/albums/'+a.id+'/sections/order',{sections:order},'PUT'));}catch(error){toast(error.message);}
  return;
 }
 const panel=event.target.closest('.upload-panel');
 if(panel&&event.dataTransfer?.files?.length){
  event.preventDefault();panel.classList.remove('drag-over');
  if(uploadBusy){
   toast('Đang tải ảnh lên. Hãy đợi hoàn tất hoặc bấm “Hủy tải lên” trước khi chọn ảnh mới.');
   return;
  }
  const input=panel.querySelector('input[type=file][name=photos]');
  if(input){
   input.files=event.dataTransfer.files;
   input.dispatchEvent(new Event('change',{bubbles:true}));
  }
 }
});

document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;if(action==='cancel-upload'){e.preventDefault();if(activeUploadQueue){activeUploadQueue.abort();toast('Đang dừng lượt tải ảnh…');}return;}if(sectionBusy){toast('Đang lưu phần ảnh. Vui lòng đợi một chút.');return;}if(uploadBusy){toast('Đang tải ảnh lên. Hãy đợi hoàn tất trước khi chuyển trang.');return;}if(pickBusy&&['section-filter','submit-picks','selected-only','download-selected','lock-gallery','open-photo'].includes(action)){toast('Đang lưu lựa chọn. Vui lòng đợi một chút.');return;}try{
 if(action==='hide-portrait'){await send('/api/admin/settings',{portrait:''},'PATCH');await refreshAdmin();toast('Đã ẩn ảnh chân dung.');}
 if(action==='back-to-top'){window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});$('.public-nav .wordmark')?.focus({preventScroll:true});}
 if(action==='menu'){const open=el.getAttribute('aria-expanded')!=='true';el.setAttribute('aria-expanded',String(open));$('#nav-links').classList.toggle('open',open);}
 if(action==='filter'){filter=el.dataset.filter;portfolio();$(`[data-filter="${filter}"]`)?.focus({preventScroll:true});}
 if(await handleSectionAction(action,el))return;
 if(action==='open-photo'){lightReturnPhoto=el.dataset.photo;el.focus({preventScroll:true});showLight(lightPhotos().findIndex(p=>p.id===el.dataset.photo));}
 if(action==='retry-photo')showLight(lightIndex,true);
 if(action==='download-single'){
  e.preventDefault();
  if(photoDownloads?.busy)photoDownloads.close();
  else{
   const photo=lightPhotos()[lightIndex],albumId=album.id;
   if(photo){
    el.disabled=true;
    try{
     const downloads=await loadPhotoDownloads();
     if($('#lightbox').open&&album?.id===albumId&&lightPhotos()[lightIndex]?.id===photo.id){el.disabled=false;await downloads.download({albumId:clientGallery?album.id:album.slug||album.id,photoId:photo.id,privateGallery:clientGallery});}
    }finally{el.disabled=false;}
   }
  }
 }
 if(action==='close-lightbox')$('#lightbox').close();if(action==='prev-photo')showLight(lightIndex-1);if(action==='next-photo')showLight(lightIndex+1);
 if(action==='zoom-photo')toggleLightZoom();
 if(action==='retry-selection'){await refreshSharedSelection(true);toast('Đã đồng bộ danh sách ảnh.');}
 if(action==='pick'){
  if(pickBusy)return;
  if(selectionUncertain)await refreshSharedSelection(true);
  const p=album.photos.find(p=>p.id===el.dataset.photo);if(!p)return;
  pickBusy=true;++selectionEpoch;syncDownloadButton();$('.client-save-status').textContent='Đang lưu lựa chọn…';el.disabled=true;
  try{applySharedSelection(await send(`/api/gallery/${album.id}/selection/${p.id}`,{selected:!p.selected},'PUT'));}
  catch(error){
   if(error.status===401)throw error;
   selectionUncertain=true;
   try{await refreshSharedSelection(true);toast('Đã đối chiếu lại lựa chọn với máy chủ.');}catch(syncError){if(syncError.status===401)throw syncError;throw error;}
  }finally{pickBusy=false;el.disabled=false;if(clientGallery)updateClientSelection();}
 }
 if(action==='download-selected'){
  await refreshSharedSelection(true);
  const albumId=album.id;el.disabled=true;
  try{const downloads=await loadGalleryDownloads();if(clientGallery&&album?.id===albumId&&el.isConnected)downloads.open({albumId,photos:sectionPhotos(album,'all',true),trigger:el});}
  finally{syncDownloadButton();}
 }
 if(action==='lock-gallery'){photoDownloads?.close();galleryDownloads?.close();await send(`/api/gallery/${album.id}/logout`,{});album=null;selectedOnly=false;sectionFilter='all';await route();}
 if(action==='selected-only'){await refreshSharedSelection(true);selectedOnly=!selectedOnly;albumPage(true);scrollToGallery();$('[data-action=selected-only]')?.focus({preventScroll:true});}
 if(action==='submit-picks'){
  await refreshSharedSelection(true);confirmedPhotoIds=album.photos.filter(p=>p.selected).map(p=>p.id);
  const count=album?.photos?.filter(p=>p.selected).length||0;if(!count)return;
  editDialog('Gửi lựa chọn đến studio',`<div class="submit-confirm-content"><p>Bạn muốn gửi danh sách <strong>${count} ảnh đã chọn</strong> đến studio?</p><p class="panel-note">Studio sẽ nhận được danh sách ảnh bạn đã chọn để tiến hành hậu kỳ.</p><div class="submit-confirm-actions"><button type="button" class="btn secondary" data-action="close-editor">Xem lại thêm</button><button type="button" class="btn" data-action="confirm-submit-picks">Xác nhận gửi</button></div></div>`);
 }
 if(action==='confirm-submit-picks'){
  el.disabled=true;pickBusy=true;++selectionEpoch;syncDownloadButton();
  try{
   applySharedSelection(await send(`/api/gallery/${album.id}/submit`,{photos:confirmedPhotoIds}));
   $('#editor').close();$('[data-action=submit-picks]')?.focus({preventScroll:true});toast('Lựa chọn của bạn đã được gửi đến studio.');
  }catch(error){
   if(error.status===409){applySharedSelection(error.data);$('#editor').close();$('[data-action=selected-only]')?.focus({preventScroll:true});}
   else if(!error.status){selectionUncertain=true;try{await refreshSharedSelection();}catch{} }
   throw error;
  }finally{pickBusy=false;el.disabled=false;if(clientGallery)updateClientSelection();}
 }
 if(action==='month-prev'||action==='month-next'){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+(action==='month-next'?1:-1),1);$('#booking-calendar').innerHTML=calendarHTML();($('#booking-calendar').querySelector(`[data-action="${action}"]:not(:disabled)`)||$('#booking-calendar').querySelector('[data-action="month-next"]'))?.focus();}
 if(action==='retry-calendar'){await loadBookingAvailability();}
 if(action==='choose-date'){const input=$('#booking-form [name=date]');if(input){input.value=el.dataset.date;syncBookingDate();$(`[data-action=choose-date][data-date="${bookingDate}"]`)?.focus();}}
 if(action==='clear-date'){$('#booking-form [name=date]').value='';syncBookingDate();$('#booking-form [name=date]').focus();}
 if(action==='admin-view'){adminView=el.dataset.view;adminAlbumId=null;await refreshAdmin();}
 if(action==='logout'){galleryDownloads?.close();await send('/api/admin/logout',{});await openAdmin();}
 if(action==='new-album')editDialog(adminView==='clients'?'Tạo bộ ảnh riêng':'Tạo bộ ảnh mới',albumForm());
 if(action==='close-editor')$('#editor').close();
 if(action==='edit-album'){adminAlbums=await api('/api/admin/albums');adminAlbumId=el.dataset.id;const a=adminAlbums.find(a=>a.id===adminAlbumId);adminView=a?.status==='private'?'clients':'portfolio';adminAlbumDetail();}
 if(action==='album-back'){adminAlbumId=null;await refreshAdmin();}
 if(action==='album-settings')editDialog('Thông tin bộ ảnh',albumForm(adminAlbums.find(a=>a.id===el.dataset.id)));
 if(action==='copy-link'){const a=adminAlbums.find(x=>x.id===el.dataset.id);await navigator.clipboard.writeText(location.origin+'/gallery/'+el.dataset.id);toast(a?.has_password?'Đã sao chép đường dẫn. Hãy gửi mật khẩu riêng cho khách.':'Đã sao chép đường dẫn bộ ảnh cho khách.');}
 if(action==='cover-photo'){const a=adminAlbums.find(a=>a.id===adminAlbumId);await send('/api/admin/albums/'+a.id,{...a,cover_id:el.dataset.id},'PATCH');await refreshAdmin();toast('Đã cập nhật ảnh bìa.');}
 if(action==='caption-photo'){const p=adminAlbums.flatMap(a=>a.photos).find(p=>p.id===el.dataset.id);editDialog('Chú thích ảnh',`<form data-form="caption" data-id="${p.id}"><label>Chú thích<input name="caption" value="${esc(p.caption)}" maxlength="300" required></label><p class="form-error" role="alert"></p><button class="btn">Lưu chú thích</button></form>`);}
 if(action==='move-photo'){const a=adminAlbums.find(a=>a.id===adminAlbumId),visible=sectionPhotos(a,adminSectionFilter),index=visible.findIndex(p=>p.id===el.dataset.id),target=index+(el.dataset.direction==='up'?-1:1);if(target>=0&&target<visible.length){if(visible[index].section_id!==visible[target].section_id){toast('Chọn một phần để sắp xếp ảnh trong phần đó. Dùng mục Phần để chuyển ảnh.');return;}const ordered=[...a.photos],from=ordered.findIndex(p=>p.id===visible[index].id),to=ordered.findIndex(p=>p.id===visible[target].id);[ordered[from],ordered[to]]=[ordered[to],ordered[from]];el.disabled=true;await send('/api/admin/albums/'+a.id+'/order',{photos:ordered.map(p=>p.id)},'PUT');await refreshAdmin();}}
 if(action==='remove-photo')editDialog('Xóa ảnh này?',`<p class="panel-note">Ảnh sẽ bị xóa khỏi bộ ảnh và kho lưu trữ. Hãy giữ bản gốc trên máy của bạn.</p><button class="btn danger" data-action="confirm-remove-photo" data-id="${el.dataset.id}">Xóa ảnh</button>`);
 if(action==='confirm-remove-photo'){await api('/api/admin/photos/'+el.dataset.id,{method:'DELETE'});$('#editor').close();await refreshAdmin();toast('Đã xóa ảnh.');}
 if(action==='inquiry-detail'){
 inquiries=await api('/api/admin/inquiries');const r=inquiries.find(r=>r.id===el.dataset.id);if(!r)throw Error('Yêu cầu này không còn tồn tại.');
 editDialog('Yêu cầu của '+esc(r.name),`<div class="inquiry-summary">${badge(r.status)}<span>Mã yêu cầu: ${esc(r.id.slice(0,8))}</span></div><dl class="inquiry-detail"><dt>Email</dt><dd>${r.email?`<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`:'Chưa cung cấp'}</dd><dt>Điện thoại</dt><dd>${r.phone?`<a href="tel:${esc(r.phone.replace(/[^+\d]/g,''))}">${esc(r.phone)}</a>`:'Chưa cung cấp'}</dd><dt>Dịch vụ quan tâm</dt><dd>${esc(r.service)}</dd><dt>Ngân sách dự kiến</dt><dd>${esc(budgetLabel(r.budget))}</dd><dt>Lời nhắn của khách</dt><dd class="message">${esc(r.message)}</dd></dl><form data-form="inquiry-status" data-id="${r.id}"><div class="form-pair"><label>Ngày chụp dự kiến<input name="date" type="date" value="${esc(r.date)}"></label><label>Trạng thái<select name="status">${['new','contacted','confirmed','completed','cancelled'].map(s=>`<option value="${s}" ${s===r.status?'selected':''}>${statuses[s]}</option>`).join('')}</select></label></div><p class="form-note">Cần chọn ngày trước khi xác nhận. Mỗi ngày chỉ nhận một lịch đã xác nhận; đổi lịch thành công sẽ mở lại ngày cũ nếu không bị chặn riêng.</p><label>Ghi chú riêng của studio<textarea name="notes" rows="4" maxlength="3000" placeholder="Địa điểm, nội dung đã trao đổi, việc cần chuẩn bị…">${esc(r.notes)}</textarea></label><p class="form-note">Ghi chú chỉ hiển thị trong quản trị và bản sao lưu dữ liệu.</p><p class="form-error" role="alert"></p><button class="btn">Lưu yêu cầu</button></form>`);
 }
 if(action==='unblock-date'){await api('/api/admin/dates/'+el.dataset.date,{method:'DELETE'});await refreshAdmin();toast('Đã bỏ chặn ngày.');}
 }catch(err){if(err.status===401&&location.pathname==='/admin'){await openAdmin();toast('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.');}else if(err.status===401&&location.pathname.startsWith('/gallery/')){await expireGallery();}else toast(err.message);el.disabled=false;}});
document.addEventListener('submit',async e=>{const form=e.target.closest('[data-form]');if(!form)return;if(form.dataset.form==='inquiry')return;e.preventDefault();if(sectionBusy||uploadBusy){toast('Đang lưu thay đổi. Vui lòng đợi hoàn tất.');return;}if(!form.reportValidity())return;const kind=form.dataset.form,submit=form.querySelector('[type=submit]')||form.querySelector('button'),error=form.querySelector('.form-error');submit.disabled=true;if(error)error.textContent='';const data=Object.fromEntries(new FormData(form));try{
 if(kind==='setup'||kind==='login'){await send('/api/admin/'+kind,data);await openAdmin();}
 if(kind==='unlock'){await send('/api/gallery/'+location.pathname.split('/')[2]+'/unlock',data);await route();}
 if(kind==='album'){const reqPw=form.querySelector('[name=require_password]');if(data.status==='private'){data.require_password=reqPw?reqPw.checked:false;if(!data.require_password)data.password='';}if(form.dataset.id)await send('/api/admin/albums/'+form.dataset.id,data,'PATCH');else{const result=await send('/api/admin/albums',data);adminAlbumId=result.id;adminView=data.status==='private'?'clients':'portfolio';}$('#editor').close();await refreshAdmin();toast('Đã lưu bộ ảnh.');}
 if(kind==='upload'){
 const input=form.querySelector('[type=file]'),destination=form.querySelector('[name=section_id]'),cancelBtn=form.querySelector('.upload-cancel'),files=[...input.files];
 let queue=uploadQueues.get(form);if(!queue||!queue.matches(files)){queue=new UploadQueue(files);queue.sectionId=destination?.value||'';uploadQueues.set(form,queue);}
 const report=()=>{const container=$('[data-upload-report]'),expanded=container?.querySelector('details')?.open;const html=uploadReport(queue).replace('<details',expanded?'<details open':'<details');latestUploadReports.set(form.dataset.id,html);if(container){container.innerHTML=html;if(expanded&&container.querySelector('details'))container.querySelector('details').open=true;}};
 input.disabled=true;if(destination)destination.disabled=true;if(cancelBtn)cancelBtn.hidden=false;uploadBusy=true;activeUploadQueue=queue;const meter=form.querySelector('.upload-meter');meter.hidden=false;meter.max=files.length;meter.value=queue.done.size;report();
 try{
 await queue.run(async (batch,keys,registerAbort)=>{const fd=new FormData();batch.forEach(file=>fd.append('photos',file));const req=uploadRequest('/api/admin/albums/'+form.dataset.id+'/photos',{body:fd,headers:{'X-Upload-Keys':JSON.stringify(keys),...(queue.sectionId?{'X-Album-Section':queue.sectionId}:{})},onProgress:progress=>{form.querySelector('.upload-progress').textContent=uploadProgressText(batch[0].name,progress);}});if(registerAbort&&req.abort)registerAbort(()=>req.abort());return req;},(done,total)=>{meter.value=done;meter.max=total;submit.textContent=`Đang tải ${done}/${total} ảnh…`;report();});
 if(queue.pending.length)throw Error(queue.retryable.length?'Xem chi tiết lỗi bên dưới. Bấm “Tải lại các ảnh còn lại” để tiếp tục.':'Xem chi tiết lỗi bên dưới. Hãy xuất lại các tệp lỗi và chọn ảnh mới; ảnh đã lưu vẫn được giữ.');
 input.value='';uploadQueues.delete(form);await refreshAdmin();toast(`Đã thêm ${files.length} ảnh.`);
 }catch(err){
 report();
 try{adminAlbums=await api('/api/admin/albums');const a=adminAlbums.find(a=>a.id===form.dataset.id);if(form.isConnected&&a){adminAlbumDetail();}}catch{}
 throw Object.assign(Error(`Đã lưu ${queue.done.size}/${files.length} ảnh được máy chủ xác nhận. ${err.message}`),{status:err.status});
 }finally{input.disabled=false;if(destination)destination.disabled=false;if(cancelBtn)cancelBtn.hidden=true;activeUploadQueue=null;uploadBusy=false;meter.hidden=true;form.querySelector('.upload-progress').textContent='';}
 }
 if(kind==='section'){await saveSection(async()=>{if(form.dataset.id)await send('/api/admin/sections/'+form.dataset.id,data,'PATCH');else await send('/api/admin/albums/'+adminAlbumId+'/sections',{...data,request_id:form.dataset.requestId});$('#editor').close();});toast('Đã lưu phần ảnh.');}
 if(kind==='caption'){await send('/api/admin/photos/'+form.dataset.id,data,'PATCH');$('#editor').close();await refreshAdmin();toast('Đã lưu chú thích.');}
 if(kind==='inquiry-status'){await send('/api/admin/inquiries/'+form.dataset.id,data,'PATCH');$('#editor').close();await refreshAdmin();toast('Đã cập nhật yêu cầu.');}
 if(kind==='block-date'){await send('/api/admin/dates',data);await refreshAdmin();toast('Đã chặn ngày trong lịch.');}
 if(kind==='portrait'){
  const file=form.querySelector('[type=file]').files[0];if(file.size>maxUploadBytes)throw Error(`Ảnh không được vượt quá ${uploadSizeLabel}. Vui lòng giảm dung lượng rồi thử lại.`);
  await uploadRequest('/api/admin/portrait',{body:new FormData(form)});await refreshAdmin();toast('Đã cập nhật ảnh chân dung.');
 }
 if(kind==='curation'){
  const choices=kind=>[...form.querySelectorAll(`[data-curation="${kind}"]`)].flatMap(row=>{
   const albumId=row.querySelector('[data-curation-album]').value;if(!albumId)return [];
   return [{albumId,...Object.fromEntries([...row.querySelectorAll('[data-photo-field]')].map(select=>[select.dataset.photoField,select.value]))}];
  });
  await send('/api/admin/settings',{heroSelection:JSON.stringify(choices('hero')),storySelection:JSON.stringify(choices('story'))},'PATCH');await refreshAdmin();toast('Đã lưu lựa chọn ảnh.');
 }
 if(kind==='settings'){await send('/api/admin/settings',data,'PATCH');await refreshAdmin();toast('Đã cập nhật website.');}
 }catch(err){if(err.status===401&&location.pathname==='/admin'&&!['login','setup'].includes(kind)){await openAdmin();toast('Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.');}else if(error)error.textContent=err.message;else toast(err.message);}finally{submit.disabled=false;if(kind==='upload'){const queue=uploadQueues.get(form);submit.textContent=queue?.retryable.length?'Tải lại các ảnh còn lại':'Tải ảnh lên';submit.disabled=!!queue?.pending.length&&!queue.retryable.length;const destination=form.querySelector('[name=section_id]');if(destination)destination.disabled=!!uploadQueues.get(form)?.pending.length;}}});
document.addEventListener('change',event=>{
 const upload=event.target.closest('[data-form=upload]');if(upload&&event.target.matches('[type=file]')){uploadQueues.delete(upload);const destination=upload.querySelector('[name=section_id]');if(destination)destination.disabled=false;upload.querySelector('.form-error').textContent='';upload.querySelector('button').textContent='Tải ảnh lên';upload.querySelector('button').disabled=false;upload.querySelector('.upload-selection').textContent=uploadSelection([...event.target.files]);}
 const row=event.target.closest('[data-curation]');if(!row)return;
 if(event.target.matches('[data-curation-album]'))row.outerHTML=curationRow(row.dataset.curation,Number(row.dataset.slot),{albumId:event.target.value});
 else if(event.target.matches('[data-photo-field]')){
  const album=adminAlbums.find(a=>a.id===row.querySelector('[data-curation-album]').value),photo=album?.photos.find(p=>p.id===event.target.value);
  if(photo)event.target.closest('label').querySelector('img').src=photo.thumb;
 }
});
export const ready=route().catch(err=>publicPage(`<section class="page-width page-title">${label(err.status===404?'404':'VUI LÒNG THỬ LẠI')}<h1>${err.status===404?'Không tìm thấy bộ ảnh.':'Chưa tải được trang.'}</h1><p>${esc(err.message)}</p>${button('Về trang chủ','/')}</section>`));

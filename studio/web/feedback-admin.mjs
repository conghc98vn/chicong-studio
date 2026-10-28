import {api} from './api-request.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const criteria=[['overall','Trải nghiệm chung'],['shoot','Trải nghiệm buổi chụp'],['product','Sản phẩm nhận được'],['delivery','Quá trình bàn giao']];
const invitationLabels={unissued:'Chưa cấp lời mời',active:'Đang nhận',paused:'Tạm đóng',revoked:'Link đã thu hồi'};
const notificationLabels={pending:'Đang chờ gửi',processing:'Đang gửi',accepted_by_provider:'Dịch vụ đã nhận thư',accepted:'Dịch vụ đã nhận thư',sent:'Dịch vụ đã nhận thư',retry:'Đang chờ thử lại',retry_wait:'Đang chờ thử lại',failed:'Gửi lỗi',blocked_config:'Chờ cấu hình email',suppressed:'Đã dừng sau khôi phục'};
const time=value=>value?new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(value)):'—';
const date=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'Chưa ghi ngày';
const send=(url,data,method='POST')=>api(url,{method,body:JSON.stringify(data)});
const button=(action,label,attributes='',cls='small-btn')=>`<button type="button" class="${cls}" data-feedback-action="${action}" ${attributes}>${label}</button>`;
const unread=h=>Number(h.latestVersion)>Number(h.readVersion||0);
export function handoverSummary(h){return h.archivedAt?'Đã lưu trữ':h.deliveryState!=='delivered'?'Chưa mở nhận':['paused','revoked'].includes(h.invitationState)?`Đã đóng · ${invitationLabels[h.invitationState]}`:h.invitationState==='active'?'Đang nhận':'Chưa mở nhận';}
function badges(h){return `<div class="feedback-badges"><span class="badge">${handoverSummary(h)}</span><span class="badge">${h.latestVersion?(Number(h.latestVersion)>1?'Đã cập nhật':'Đã có phản hồi'):'Chưa có phản hồi'}</span>${h.latestVersion?`<span class="badge ${unread(h)?'feedback-unread':''}">${unread(h)?'Chưa đọc':'Đã đọc'} · v${Number(h.latestVersion)}</span>`:''}${h.notifications?.[0]?`<span class="badge">Email: ${esc(notificationLabels[h.notifications[0].state]||h.notifications[0].state)}</span>`:''}</div>`;}
function revisionMarkup(r){return `<article class="feedback-revision"><div class="feedback-revision-heading"><strong>${esc(r.name)}</strong><span>Phiên bản ${Number(r.version)} · ${esc(time(r.savedAt))}</span></div><dl class="feedback-ratings">${(r.criteria||criteria.map(([key,label])=>({key,label}))).map(({key,label})=>`<div><dt>${esc(label)}</dt><dd>${r.ratings?.[key]?`${Number(r.ratings[key])} / 5`:'Chưa đánh giá'}</dd></div>`).join('')}</dl><h3>Lời chia sẻ</h3><p class="feedback-message">${esc(r.message)}</p><h3>Điều cần cải thiện</h3><p class="feedback-message">${esc(r.improvement||'Chưa có góp ý bổ sung.')}</p></article>`;}
function styles(){if(document.querySelector('[data-feedback-admin-style]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='/app/feedback-admin.css';link.dataset.feedbackAdminStyle='';link.onerror=()=>link.remove();document.head.append(link);}

export function createFeedbackAdmin({shell,heading,toast,navigate,onUnauthorized}){
 let epoch=0,listEpoch=0,seed=null,filters={q:'',state:'',unread:'',archived:'',page:1};
 const requests=new Map();
 const requestFor=(url,payload)=>{const fingerprint=JSON.stringify([url,payload]);if(!requests.has(fingerprint))requests.set(fingerprint,{...payload,requestKey:crypto.randomUUID()});return {fingerprint,payload:requests.get(fingerprint)};};
 async function mutate(url,payload,method='POST'){
  const request=requestFor(url,payload);
  try{
   const result=await send(url,request.payload,method);
   const validHandover=value=>typeof value?.id==='string'&&value.id.length>0&&Number.isSafeInteger(value.version)&&value.version>0;
   const expectedId=/^\/api\/admin\/handovers\/([^/]+)/.exec(url)?.[1];
   if(!validHandover(result?.handover)||(expectedId&&result.handover.id!==decodeURIComponent(expectedId))||(url.endsWith('/transfer-album')&&(!validHandover(result.targetHandover)||result.targetHandover.id!==payload.toHandoverId)))throw Object.assign(new Error('Chưa xác nhận được kết quả lưu. Hãy thử lại đúng thao tác để đối soát, tránh tạo thêm hồ sơ.'),{code:'INCOMPLETE_ACK'});
   requests.delete(request.fingerprint);return result;
  }catch(error){if(error.status&&error.status<500)requests.delete(request.fingerprint);throw error;}
 }
 async function fromAlbum(album,current){
  const result=await api(`/api/admin/handovers?albumId=${encodeURIComponent(album.id)}&archived=all&pageSize=100`);if(!current())return;
  if(result.handovers?.length)return navigate(result.handovers[0].id);
  seed={clientName:album.client_name||'',title:album.title||'',shootDate:album.event_date||'',albumIds:[album.id]};return navigate('new');
 }
 async function show({id,current}){
  styles();const run=++epoch,isCurrent=()=>run===epoch&&current();
  shell(heading('Cảm nhận','Theo dõi bàn giao và những lời chia sẻ riêng của khách.')+'<div class="feedback-admin"><p role="status">Đang tải hồ sơ…</p></div>');
  try{
   if(!id)return await showList(isCurrent);
   const [response,albums,inquiries]=await Promise.all([id==='new'?Promise.resolve({handover:{...seed}}):api('/api/admin/handovers/'+encodeURIComponent(id)),api('/api/admin/albums?view=summary'),api('/api/admin/inquiries')]);
   if(!isCurrent())return;seed=null;
   return detail(response.handover,albums,inquiries,isCurrent,id==='new');
  }catch(error){if(!isCurrent())return;if(error.status===401)return onUnauthorized();shell(heading('Cảm nhận','Chưa tải được hồ sơ.')+`<div class="feedback-admin"><p role="alert">${esc(error.message)}</p>${button('reload','Thử lại')}</div>`);document.querySelector('[data-feedback-action=reload]')?.addEventListener('click',()=>show({id,current}));}
 }
 async function showList(current){
  const load=++listEpoch;const query=new URLSearchParams({...filters,pageSize:25});const data=await api('/api/admin/handovers?'+query);if(!current()||load!==listEpoch)return;
  shell(heading('Cảm nhận',`${Number(data.unreadCount||0)} hồ sơ có cảm nhận chưa đọc.`,button('new','Tạo hồ sơ bàn giao','','btn'))+`<div class="feedback-admin"><form class="feedback-filters"><label>Tìm hồ sơ<input type="search" name="q" value="${esc(filters.q)}" placeholder="Tên khách hoặc buổi chụp"></label><label>Trạng thái<select name="state">${[['','Tất cả'],['draft','Chưa bàn giao'],['active','Đang nhận'],['received','Đã có phản hồi'],['closed','Đã đóng']].map(([value,label])=>`<option value="${value}" ${filters.state===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Đọc cảm nhận<select name="unread">${[['','Tất cả'],['true','Chưa đọc'],['false','Đã đọc']].map(([value,label])=>`<option value="${value}" ${filters.unread===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Lưu trữ<select name="archived">${[['','Đang sử dụng'],['true','Đã lưu trữ'],['all','Gồm lưu trữ']].map(([value,label])=>`<option value="${value}" ${filters.archived===value?'selected':''}>${label}</option>`).join('')}</select></label><button class="small-btn">Áp dụng</button></form>${data.readiness?.ready===false||data.readiness?.linkConfigured===false?'<p class="feedback-notice">Chưa sẵn sàng cấp link. Kiểm tra cấu hình đường dẫn và khóa lời mời trên máy chủ.</p>':''}<div class="feedback-list">${data.handovers?.length?data.handovers.map(h=>`<button class="feedback-list-row" type="button" data-feedback-action="open" data-id="${esc(h.id)}"><div><h2>${esc(h.title)}</h2><p>${esc(h.clientName)} · ${esc(date(h.shootDate))}</p>${badges(h)}</div><span aria-hidden="true">→</span></button>`).join(''):'<div class="empty-state"><h2>Chưa có hồ sơ phù hợp</h2><p>Tạo hồ sơ theo từng buổi chụp để ghi nhận bàn giao và nhận cảm nhận riêng.</p></div>'}</div><div class="feedback-pagination">${button('prev','Trang trước',filters.page<=1?'disabled':'')}<span>Trang ${Number(data.page||filters.page)} · ${Number(data.total||0)} hồ sơ</span>${button('next','Trang sau',filters.page*25>=data.total?'disabled':'')}</div></div>`);
  const root=document.querySelector('.admin-content');const alive=()=>current()&&root.isConnected;
  root.addEventListener('submit',async event=>{if(!event.target.matches('.feedback-filters'))return;event.preventDefault();event.stopPropagation();filters={...Object.fromEntries(new FormData(event.target)),page:1};await guarded(()=>showList(current),alive);});
  root.addEventListener('click',async event=>{const el=event.target.closest('[data-feedback-action]');if(!el||!alive())return;const action=el.dataset.feedbackAction;if(action==='new')return navigate('new');if(action==='open')return navigate(el.dataset.id);if(['prev','next'].includes(action)){filters.page+=action==='next'?1:-1;await guarded(()=>showList(current),alive);}});
 }
 async function guarded(work,current){try{return await work();}catch(error){if(!current())return;if(error.status===401)return onUnauthorized();toast(error.message);}}
 function detail(h,albums,inquiries,current,isNew){
  let busy=false,revisionPage=0,revisionTotal=0,uncertain=null;
  const transfer={targets:[],source:h,sourceVersion:h.version,pending:null,lookupEpoch:0,needsReview:false};
  const url=isNew?'/api/admin/handovers':'/api/admin/handovers/'+encodeURIComponent(h.id);
  const command=(name,label,cls='small-btn')=>button('command',label,`data-command="${name}"`,cls);
  const active=h.deliveryState==='delivered'&&h.invitationState==='active'&&!h.archivedAt;
  const commands=isNew?'':h.archivedAt?command('unarchive','Bỏ lưu trữ'):`${h.deliveryState!=='delivered'?command('complete','Đã bàn giao đầy đủ & mở nhận','btn'):h.invitationState==='paused'?command('resume','Mở lại nhận cảm nhận','btn'):['revoked','unissued'].includes(h.invitationState)?command('issue',h.invitationState==='revoked'?'Cấp link mới & mở nhận':'Cấp lời mời & mở nhận','btn'):''}${active?button('copy-link','Sao chép link','','btn')+button('copy-invitation','Sao chép lời mời Zalo'):''}`;
  const extra=isNew||h.archivedAt?'':`<details class="feedback-actions-menu"><summary>Thao tác khác</summary><div>${active?command('pause','Tạm đóng nhận')+command('issue','Cấp link mới'):''}${h.invitationState!=='revoked'&&h.invitationState!=='unissued'?command('revoke','Thu hồi link'):''}${h.deliveryState==='delivered'?command('uncomplete','Trả về chưa bàn giao'):''}${command('archive','Lưu trữ hồ sơ')}</div></details>`;
  const field=(name,label,type='text',max=200)=>`<label>${label}<input name="${name}" type="${type}" value="${esc(h[name])}" ${['clientName','title'].includes(name)?'required':''} ${type==='text'?`maxlength="${max}"`:''}></label>`;
  shell(heading(isNew?'Tạo hồ sơ bàn giao':esc(h.title),isNew?'Một hồ sơ cho mỗi đơn hoặc buổi chụp.':'Cảm nhận chỉ dùng nội bộ. Khách có thể cập nhật khi đang mở nhận.',button('back','Danh sách cảm nhận'))+`<div class="feedback-admin">${isNew?'':`<section class="panel feedback-panel">${badges(h)}<dl class="feedback-states"><div><dt>Bàn giao</dt><dd>${h.deliveryState==='delivered'?'Đã bàn giao đầy đủ':'Chưa bàn giao'}</dd></div><div><dt>Lời mời</dt><dd>${esc(invitationLabels[h.invitationState]||h.invitationState)}</dd></div><div><dt>Ngày giao thực tế</dt><dd>${esc(date(h.deliveredOn))}</dd></div><div><dt>Xác nhận lúc</dt><dd>${esc(time(h.deliveryConfirmedAt))}</dd></div></dl><div class="feedback-actions">${commands}${extra}</div><p class="form-note">Sao chép link không xác nhận đã gửi lời mời. Tạm đóng chặn cả xem và sửa; bỏ lưu trữ không tự mở nhận.</p><div data-feedback-copy></div><div data-feedback-confirm></div><div data-feedback-operation role="status"></div></section>`}<div class="feedback-detail-grid"><section class="panel feedback-panel"><h2>Thông tin bàn giao</h2>${h.issuedAt?'<p class="form-note">Hồ sơ đã cấp lời mời: chỉ sửa thông tin của cùng buổi chụp. Hãy tạo hồ sơ mới cho khách hoặc buổi khác.</p>':''}<form class="feedback-editor">${field('clientName','Tên khách *')}${field('title','Tên buổi chụp / đơn *')}${field('service','Dịch vụ')}<div class="form-pair">${field('shootDate','Ngày chụp','date')}${field('deliveredOn','Ngày bàn giao thực tế','date')}</div><label>Yêu cầu tư vấn liên quan (tùy chọn)<select name="inquiryId"><option value="">Không liên kết</option>${h.inquiryId&&!inquiries.some(i=>i.id===h.inquiryId)?`<option value="${esc(h.inquiryId)}" selected>Yêu cầu đang liên kết</option>`:''}${inquiries.map(i=>`<option value="${esc(i.id)}" ${h.inquiryId===i.id?'selected':''}>${esc(i.name||i.client_name||i.id)}${i.date?' · '+esc(date(i.date)):''}</option>`).join('')}</select></label><fieldset class="feedback-albums"><legend>Bộ ảnh liên quan (có thể không chọn)</legend>${albums.length?albums.map(a=>`<label><input type="checkbox" name="albumIds" value="${esc(a.id)}" ${h.albumIds?.includes(a.id)?'checked':''}><span>${esc(a.title)}${a.client_name?' · '+esc(a.client_name):''}</span></label>`).join(''):'<p class="form-note">Chưa có bộ ảnh. Có thể nhận cảm nhận cho sản phẩm giao qua Drive hoặc kênh khác.</p>'}</fieldset><label>Ghi chú riêng<textarea name="notes" rows="4" maxlength="10000">${esc(h.notes)}</textarea></label><div data-feedback-duplicates></div><p class="form-error" role="alert"></p><button class="btn" type="submit">${isNew?'Tạo hồ sơ chưa bàn giao':'Lưu thông tin'}</button></form>${!isNew&&h.albumIds?.length?`<details class="feedback-transfer"><summary>Sửa liên kết bộ ảnh nhầm hồ sơ</summary><p class="form-note">Chọn hồ sơ đúng rồi xác nhận chuyển. Bộ ảnh được chuyển giữa hai hồ sơ trong cùng một thao tác; lời mời và cảm nhận của từng hồ sơ được giữ nguyên.</p><label>Bộ ảnh cần chuyển<select data-transfer-album>${h.albumIds.map(id=>`<option value="${esc(id)}">${esc(albums.find(a=>a.id===id)?.title||id)}</option>`).join('')}</select></label><label>Tìm hồ sơ nhận (gồm lưu trữ)<input type="search" data-transfer-query placeholder="Tên khách hoặc buổi chụp"></label>${button('find-transfer','Tìm hồ sơ nhận')}<label>Hồ sơ nhận<select data-transfer-target><option value="">Chọn hồ sơ nhận</option></select></label><div data-transfer-preview></div><div class="form-error" data-transfer-error role="alert"></div>${button('prepare-transfer','Xem lại trước khi chuyển')}<div data-transfer-confirm></div></details>`:''}</section><div>${isNew?'<section class="panel feedback-panel"><h2>Bàn giao rồi mới mời</h2><p>Hồ sơ mới chưa có link. Sau khi giao đủ sản phẩm đã thỏa thuận, chọn “Đã bàn giao đầy đủ & mở nhận”, rồi sao chép lời mời để gửi riêng cho khách.</p></section>':`<section class="panel feedback-panel"><div class="feedback-section-heading"><h2>Cảm nhận mới nhất</h2>${h.latestFeedback&&unread(h)?button('read',`Đánh dấu đã đọc v${Number(h.latestFeedback.version)}`):''}</div>${h.latestFeedback?revisionMarkup(h.latestFeedback):'<p class="muted">Khách chưa gửi cảm nhận.</p>'}${h.feedbackContext?`<details class="feedback-context"><summary>Thông tin buổi chụp lúc nhận cảm nhận</summary><p>${esc(h.feedbackContext.clientName)} · ${esc(h.feedbackContext.title)}</p><p>${esc(h.feedbackContext.service)} · Ngày chụp: ${esc(date(h.feedbackContext.shootDate))} · Ngày giao: ${esc(date(h.feedbackContext.deliveredOn))}</p><p class="form-note">Ngữ cảnh đã chốt khi nhận lần đầu; các lần sửa thông tin hồ sơ không thay đổi nội dung này.</p></details>`:''}</section><section class="panel feedback-panel"><h2>Lịch sử cảm nhận</h2><p class="form-note">Mỗi phiên bản giữ nguyên lời khách. Mở bản cũ không đánh dấu bản mới đã đọc.</p><div data-feedback-revisions></div>${h.latestVersion?button('history','Xem các phiên bản'):'<p class="muted">Chưa có lịch sử.</p>'}</section><section class="panel feedback-panel"><h2>Thông báo email cho studio</h2><p class="form-note">Dịch vụ nhận thư không đồng nghĩa thư đã đến hộp thư hoặc đã được đọc.</p><div class="feedback-notifications">${(h.notifications||[]).map(n=>`<div class="feedback-notification"><strong>Phiên bản ${Number(n.version||n.feedbackVersion||0)} · ${esc(notificationLabels[n.state]||n.state)}</strong><p>${esc(n.recipient||'Chưa có người nhận')} · ${Number(n.attempts||0)} lần thử</p>${n.lastError||n.errorCode?`<p class="form-note">${esc(n.lastError||n.errorCode)}</p>`:''}${!['accepted_by_provider','accepted','sent','pending'].includes(n.state)&&(n.state!=='processing'||Number(n.leaseUntil)<=Date.now())?`<form class="feedback-retry" data-notification="${esc(n.id)}"><label>Người nhận studio<input type="email" name="recipient" value="${esc(n.recipient)}" required maxlength="254"></label><button class="small-btn">${n.recipient?'Xác nhận người nhận & thử lại':'Cập nhật người nhận & thử lại'}</button><p class="form-error" role="alert"></p></form>`:''}</div>`).join('')||'<p class="muted">Chưa có thông báo email.</p>'}</div></section>`}</div></div></div>`);
  const root=document.querySelector('.admin-content'),alive=()=>current()&&root.isConnected;
  const form=root.querySelector('.feedback-editor'),errorNode=form.querySelector('.form-error');
  const refresh=()=>navigate(h.id,{push:false,scroll:false});
  function setBusy(value){
   busy=value;root.querySelectorAll('button').forEach(el=>{el.disabled=value;});
   // Successful mutations refresh this view. Freeze editable controls until
   // the response is reconciled so keystrokes cannot disappear on refresh.
   const locked=value||Boolean(form._feedbackPending||uncertain||transfer.pending);
   root.querySelectorAll('input,textarea,select').forEach(el=>{el.disabled=locked;});
  }
  async function handleError(error,target=errorNode){if(!alive())return;if(error.status===401)return onUnauthorized();if(error.status===409&&error.data?.code==='VERSION_CONFLICT'){target.innerHTML='Hồ sơ đã thay đổi ở nơi khác. Nội dung đang nhập được giữ lại. Sao chép ghi chú nếu cần rồi tải bản mới trước khi sửa tiếp. '+button('reload','Tải hồ sơ mới');}else target.textContent=error.message;}
  async function runMutation(work,success,target=errorNode){if(busy||!alive())return;setBusy(true);try{const result=await work();if(alive())await success(result);}catch(error){await handleError(error,target);}finally{if(alive()){setBusy(false);if(form._feedbackPending)root.querySelectorAll('button').forEach(el=>{if(el!==form.querySelector('[type=submit]')&&el.dataset.feedbackAction!=='back')el.disabled=true;});if(transfer.pending)root.querySelectorAll('button').forEach(el=>{if(!['retry-transfer','back'].includes(el.dataset.feedbackAction))el.disabled=true;});}}}
  const transferPanel=root.querySelector('.feedback-transfer');
  const transferTarget=()=>transfer.targets.find(item=>item.id===transferPanel?.querySelector('[data-transfer-target]').value);
  const transferLabel=item=>`${item.clientName} · ${item.title} · ${date(item.shootDate)}${item.archivedAt?' · Đã lưu trữ':''}`;
  const transferError=()=>transferPanel.querySelector('[data-transfer-error]');
  function clearTransferConfirmation(){transferPanel.querySelector('[data-transfer-confirm]').innerHTML='';transferPanel.querySelector('[data-transfer-preview]').textContent=transferTarget()?`Hồ sơ nhận: ${transferLabel(transferTarget())}`:'';}
  if(transferPanel)transferPanel.addEventListener('change',event=>{if(event.target.matches('[data-transfer-target],[data-transfer-album]')&&!transfer.pending)clearTransferConfirmation();});
  async function findTransferTargets(){
   const round=++transfer.lookupEpoch,select=transferPanel.querySelector('[data-transfer-target]'),selected=select.value;
   transferError().textContent='';
   const query=transferPanel.querySelector('[data-transfer-query]').value.trim();
   const result=await api('/api/admin/handovers?archived=all&pageSize=100&q='+encodeURIComponent(query));
   if(!alive()||round!==transfer.lookupEpoch)return;
   transfer.targets=result.handovers.filter(item=>item.id!==h.id);
   select.innerHTML='<option value="">Chọn hồ sơ nhận</option>'+transfer.targets.map(item=>`<option value="${esc(item.id)}">${esc(transferLabel(item))}</option>`).join('');
   if(transfer.targets.some(item=>item.id===selected))select.value=selected;
   clearTransferConfirmation();
   if(!transfer.targets.length)transferError().textContent='Chưa tìm thấy hồ sơ nhận phù hợp. Hãy tìm theo tên khách hoặc buổi chụp.';
   else if(result.total>100)transferError().textContent='Có nhiều kết quả. Hãy nhập tên khách hoặc buổi chụp cụ thể để tìm hồ sơ nhận.';
  }
  async function prepareTransfer(reload=false){
   const target=transferTarget(),albumId=transferPanel.querySelector('[data-transfer-album]').value;
   if(!target){transferError().textContent='Chọn hồ sơ nhận trước khi chuyển bộ ảnh.';return;}
   if(reload){
    const [sourceResult,targetResult]=await Promise.all([api(url),api('/api/admin/handovers/'+encodeURIComponent(target.id))]);
    if(!alive()||transferTarget()?.id!==target.id||transferPanel.querySelector('[data-transfer-album]').value!==albumId)return;
    if(!sourceResult.handover.albumIds.includes(albumId)){clearTransferConfirmation();transferError().textContent='Bộ ảnh này không còn thuộc hồ sơ hiện tại. Lựa chọn được giữ để đối chiếu; hãy tải hồ sơ mới.';return;}
    transfer.source=sourceResult.handover;transfer.sourceVersion=sourceResult.handover.version;
    Object.assign(target,targetResult.handover);
    transferPanel.querySelector('[data-transfer-target]').selectedOptions[0].textContent=transferLabel(target);
    transfer.needsReview=false;
   }
   transferError().textContent='';
   if(transfer.needsReview){transferError().innerHTML='Một trong hai hồ sơ đã thay đổi. Lựa chọn được giữ lại. '+button('reload-transfer','Tải lại hai hồ sơ để đối chiếu');return;}
   transferPanel.querySelector('[data-transfer-confirm]').innerHTML=`<div class="feedback-notice"><p>Chuyển <strong>${esc(albums.find(a=>a.id===albumId)?.title||albumId)}</strong> từ <strong>${esc(transfer.source.clientName)} · ${esc(transfer.source.title)}</strong> sang <strong>${esc(transferLabel(target))}</strong>?</p><p>Kiểm tra đúng khách và buổi chụp trước khi xác nhận.</p>${button('confirm-transfer','Xác nhận chuyển bộ ảnh')}${button('cancel-transfer','Hủy')}</div>`;
  }
  async function executeTransfer(){
   const target=transferTarget();if(!transfer.pending&&(!target||transfer.needsReview))return;
   const payload=transfer.pending||{albumId:transferPanel.querySelector('[data-transfer-album]').value,toHandoverId:target.id,expectedVersion:transfer.sourceVersion,expectedTargetVersion:target.version};
   await runMutation(async()=>{
    try{const result=await mutate(url+'/transfer-album',payload);transfer.pending=null;return result;}
    catch(error){
     if(!error.status||error.status>=500)transfer.pending=payload;
     else{transfer.pending=null;if(error.status===409)transfer.needsReview=true;}
     throw error;
    }
   },async()=>{toast('Đã chuyển bộ ảnh sang hồ sơ đúng.');await refresh();},transferError());
   if(!alive())return;
   transferPanel.querySelectorAll('input,select').forEach(el=>{el.disabled=Boolean(transfer.pending);});
   if(transfer.pending){transferError().innerHTML='Chưa xác nhận được kết quả chuyển. '+button('retry-transfer','Đối soát lại lần chuyển vừa thực hiện');root.querySelectorAll('button').forEach(el=>{el.disabled=!['retry-transfer','back'].includes(el.dataset.feedbackAction);});}
   else if(transfer.needsReview){transferPanel.querySelector('[data-transfer-confirm]').innerHTML='';transferError().innerHTML='Một trong hai hồ sơ đã thay đổi. Bộ ảnh và hồ sơ nhận đã chọn được giữ lại. '+button('reload-transfer','Tải lại hai hồ sơ để đối chiếu');}
  }
  let duplicateTimer,duplicateEpoch=0;
  async function checkDuplicates(){if(!isNew||!alive())return;const term=form.elements.clientName.value.trim(),round=++duplicateEpoch;if(!term){root.querySelector('[data-feedback-duplicates]').innerHTML='';return;}try{const matches=await api('/api/admin/handovers?archived=all&pageSize=100&q='+encodeURIComponent(term));if(!alive()||round!==duplicateEpoch)return;const day=form.elements.shootDate.value;const rows=matches.handovers.filter(item=>item.clientName.toLocaleLowerCase()===term.toLocaleLowerCase()||day&&item.shootDate===day);root.querySelector('[data-feedback-duplicates]').innerHTML=rows.length?`<div class="feedback-notice"><strong>Có hồ sơ tương tự, kể cả hồ sơ lưu trữ</strong>${rows.map(item=>button('open',`${esc(item.title)} · ${esc(date(item.shootDate))}${item.archivedAt?' · Đã lưu trữ':''}`,`data-id="${esc(item.id)}"`)).join('')}<p>Kiểm tra hồ sơ cũ trước khi tạo thêm; không tự gộp khách trùng tên.</p></div>`:'';}catch{if(alive())root.querySelector('[data-feedback-duplicates]').textContent='Chưa kiểm tra được hồ sơ trùng. Hãy tìm trong danh sách gồm lưu trữ trước khi tạo.';}}
  form.addEventListener('input',event=>{if(['clientName','shootDate'].includes(event.target.name)){clearTimeout(duplicateTimer);duplicateTimer=setTimeout(checkDuplicates,350);}});if(isNew&&h.clientName)void checkDuplicates();
  root.addEventListener('submit',async event=>{
   event.preventDefault();event.stopPropagation();if(!alive()||busy)return;
   if(event.target===form){
    const data=new FormData(form),payload={...Object.fromEntries(data),albumIds:data.getAll('albumIds')};if(!isNew)payload.expectedVersion=h.version;
    const frozen=form._feedbackPending||payload;errorNode.textContent='';
    await runMutation(async()=>{try{const result=await mutate(url,frozen,isNew?'POST':'PATCH');delete form._feedbackPending;return result;}catch(error){if(!error.status||error.status>=500){form._feedbackPending=frozen;form.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);form.querySelector('[type=submit]').textContent='Thử lại đúng thông tin vừa lưu';}else{delete form._feedbackPending;form.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=false);}throw error;}},async result=>{toast(isNew?'Đã tạo hồ sơ. Chưa mở nhận cảm nhận.':'Đã lưu thông tin.');await navigate(result.handover.id,{push:!h.id,scroll:false});});
   }else if(event.target.matches('.feedback-retry')){
    const retry=event.target,recipient=retry.elements.recipient.value.trim();await runMutation(()=>send(`${url}/notifications/${encodeURIComponent(retry.dataset.notification)}/retry`,{recipient}),async()=>{toast('Đã yêu cầu thử lại thông báo email.');await refresh();},retry.querySelector('.form-error'));
   }
  });
  async function executeCommand(name){const target=root.querySelector('[data-feedback-operation]');const payload=uncertain||{command:name,expectedVersion:h.version};await runMutation(async()=>{try{return await mutate(url+'/commands',payload);}catch(error){if(!error.status||error.status>=500)uncertain=payload;else uncertain=null;throw error;}},async()=>{uncertain=null;toast('Đã cập nhật trạng thái hồ sơ.');await refresh();},target);if(alive()&&uncertain){target.innerHTML=`Chưa xác nhận được kết quả. ${button('retry-command','Đối soát lại thao tác vừa thực hiện')}`;root.querySelectorAll('button').forEach(el=>{if(!['retry-command','back'].includes(el.dataset.feedbackAction))el.disabled=true;});}}
  root.addEventListener('click',async event=>{
   const el=event.target.closest('[data-feedback-action]');if(!el||!alive()||busy)return;const action=el.dataset.feedbackAction;
   if(action==='back')return navigate(null);if(action==='open')return navigate(el.dataset.id);if(action==='reload')return refresh();if(action==='retry-command')return executeCommand(uncertain.command);
   if(action==='find-transfer')return guarded(findTransferTargets,alive);
   if(action==='prepare-transfer')return guarded(()=>prepareTransfer(),alive);
   if(action==='reload-transfer')return guarded(()=>prepareTransfer(true),alive);
   if(action==='cancel-transfer'){clearTransferConfirmation();return;}
   if(action==='confirm-transfer'||action==='retry-transfer')return executeTransfer();
   if(action==='command'){
    const name=el.dataset.command;
    const explanations={complete:'Bạn xác nhận đã giao đủ sản phẩm của buổi chụp này? Thao tác này mở nhận cảm nhận.',pause:'Tạm đóng sẽ chặn khách xem và sửa cảm nhận cho đến khi mở lại.',revoke:'Thu hồi vĩnh viễn link hiện tại. Cảm nhận và toàn bộ lịch sử được giữ nội bộ.',issue:'Cấp link mới và mở nhận cảm nhận. Link trước đó sẽ không dùng được.',uncomplete:'Trả về chưa bàn giao và thu hồi link hiện tại. Cảm nhận vẫn được giữ.',archive:'Lưu trữ sẽ tạm đóng lời mời đang mở, giữ liên kết bộ ảnh và lịch sử.'};
    if(explanations[name]){root.querySelector('[data-feedback-confirm]').innerHTML=`<div class="feedback-notice"><p>${explanations[name]}</p>${button('confirm-command','Xác nhận',`data-command="${name}"`)} ${button('cancel-command','Hủy')}</div>`;return;}
    return executeCommand(name);
   }
   if(action==='cancel-command'){root.querySelector('[data-feedback-confirm]').innerHTML='';return;}
   if(action==='confirm-command')return executeCommand(el.dataset.command);
   if(action==='read')return runMutation(()=>send(url+'/read',{observedVersion:h.latestFeedback.version}),async()=>{toast(`Đã đánh dấu đọc phiên bản ${h.latestFeedback.version}.`);await refresh();});
   if(action==='history')return guarded(async()=>{el.disabled=true;try{const data=await api(`${url}/revisions?page=${revisionPage+1}&pageSize=10`);if(!alive())return;revisionPage++;revisionTotal=data.total;root.querySelector('[data-feedback-revisions]').insertAdjacentHTML('beforeend',data.revisions.map(r=>`<details class="feedback-history-item"><summary>Phiên bản ${Number(r.version)} · ${esc(time(r.savedAt))}</summary>${revisionMarkup(r)}</details>`).join(''));el.textContent='Xem phiên bản cũ hơn';el.hidden=revisionPage*10>=revisionTotal;}finally{if(alive())el.disabled=false;}},alive);
   if(action==='copy-link'||action==='copy-invitation')return guarded(async()=>{el.disabled=true;try{const {url:link}=await api(url+'/link');if(!alive())return;const text=action==='copy-link'?link:`Chào ${h.clientName}, Chí Công đã bàn giao đầy đủ bộ ảnh ${h.title}. Nếu có chút thời gian, bạn chia sẻ cảm nhận về trải nghiệm cùng Chí Công tại đây nhé:\n${link}\nBạn có thể góp ý cả những điều chưa tốt để Chí Công làm tốt hơn. Cảm nhận chỉ dùng nội bộ và bạn có thể cập nhật khi hồ sơ đang mở nhận. Cảm ơn bạn!`;try{await navigator.clipboard.writeText(text);if(alive())toast(action==='copy-link'?'Đã sao chép link cảm nhận.':'Đã sao chép lời mời Zalo.');}catch{if(!alive())return;root.querySelector('[data-feedback-copy]').innerHTML=`<label>Chưa sao chép được tự động. Chọn và sao chép nội dung bên dưới<textarea readonly rows="6">${esc(text)}</textarea></label>`;root.querySelector('[data-feedback-copy] textarea').select();}}finally{if(alive())el.disabled=false;}},alive);
  });
 }
 return {show,fromAlbum};
}

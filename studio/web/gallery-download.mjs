export const downloadPartSize=50;
export const downloadByteLimit=100*1024*1024;

export function selectedDownloadParts(photos,partSize=downloadPartSize){
 partSize=Math.max(1,Math.min(downloadPartSize,Math.floor(partSize)||downloadPartSize));
 const ids=[...new Set(photos.filter(photo=>photo.selected&&typeof photo.id==='string').map(photo=>photo.id))];
 const parts=[];
 for(let index=0;index<ids.length;index+=partSize)parts.push({ids:ids.slice(index,index+partSize),first:index+1,last:Math.min(index+partSize,ids.length)});
 return parts;
}

export function downloadFilename(disposition,type){
 let name='';
 const extended=/filename\*=UTF-8''([^;]+)/i.exec(disposition||'');
 if(extended){try{name=decodeURIComponent(extended[1].trim());}catch{}}
 if(!name)name=/(?:^|;)\s*filename="?([^";]+)"?/i.exec(disposition||'')?.[1]||'';
 const extension=type==='image/jpeg'?'.jpg':'.zip';
 name=name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g,'-').replace(/^\.+/,'').trim();
 if(!name)return `anh-da-chon${extension}`;
 if(type==='application/zip')name=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').replace(/[^\x20-\x7e]/g,'-');
 return name.replace(/\.[^.]*$/,'').slice(0,180)+extension;
}

function waitForRetry(milliseconds,signal){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const aborted=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},milliseconds);
  signal?.addEventListener('abort',aborted,{once:true});
 });
}

export async function fetchGalleryDownload(albumId,photos,{signal,onProgress=()=>{},onWaiting=()=>{},fetchImpl=fetch,maxBytes=downloadByteLimit}={}){
 let response;
 for(let attempt=0;;attempt++){
  signal?.throwIfAborted();
  response=await fetchImpl(`/api/gallery/${encodeURIComponent(albumId)}/download`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({photos}),signal});
  const seconds=Number(response.headers.get('retry-after'));
  // A cancelled legacy JPEG conversion may still be finishing. Respect the
  // server's delay, with bounded retries that remain cancellable in the dialog.
  if(response.status!==429||attempt>=2||!Number.isFinite(seconds)||seconds<=0||seconds>30)break;
  await response.body?.cancel();onWaiting();await waitForRetry(seconds*1000,signal);
 }
 if(!response.ok){
  let data;try{data=await response.json();}catch{}
  throw Object.assign(Error(data?.error||'Chưa tải được ảnh. Vui lòng thử lại.'),{status:response.status});
 }
 const type=response.headers.get('content-type')?.split(';')[0].trim();
 const expected=photos.length===1?'image/jpeg':'application/zip';
 if(type!==expected){await response.body?.cancel();throw Error('Tệp tải xuống không đúng định dạng. Vui lòng thử lại.');}
 const declared=Number(response.headers.get('content-length'))||0;
 const tooLarge=()=>Object.assign(Error('Tệp tải xuống quá lớn. Hãy chia thành gói nhỏ hơn rồi thử lại.'),{status:413});
 if(declared>maxBytes){await response.body?.cancel();throw tooLarge();}
 if(!response.body?.getReader)throw Error('Trình duyệt chưa hỗ trợ tải ảnh này. Hãy thử bằng Safari hoặc Chrome phiên bản mới.');
 const reader=response.body.getReader(),chunks=[];let received=0,finished=false;
 try{
  while(true){
   signal?.throwIfAborted();
   const {done,value}=await reader.read();
   if(done)break;
   received+=value.byteLength;
   if(received>maxBytes)throw tooLarge();
   chunks.push(value);onProgress(received,declared);
  }
  signal?.throwIfAborted();
  if(!received)throw Error('Tệp tải xuống trống. Vui lòng thử lại.');
  if(declared&&received!==declared)throw Error('Tệp tải xuống chưa đầy đủ. Vui lòng thử lại.');
  finished=true;
  return {blob:new Blob(chunks,{type}),filename:downloadFilename(response.headers.get('content-disposition'),type)};
 }finally{
  if(!finished)await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

export function createGalleryDownloads({onExpired=()=>{},onSelectionChanged=()=>{}}={}){
 let dialog=null,active=null;
 const urls=new Map();
 const revoke=url=>{clearTimeout(urls.get(url));urls.delete(url);URL.revokeObjectURL(url);};
 const close=()=>{active?.controller.abort();if(dialog?.open)dialog.close();};
 window.addEventListener('pagehide',()=>{close();for(const url of urls.keys())revoke(url);});
 window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue='';}});

 function open({albumId,photos,trigger=document.activeElement,partSize=downloadPartSize}){
  const parts=selectedDownloadParts(photos,partSize),count=parts.reduce((total,part)=>total+part.ids.length,0);
  if(!count)return;
  close();
  dialog?.remove();const returnFocus=trigger;
  const current=document.createElement('dialog');dialog=current;current.id='gallery-download';
  current.setAttribute('aria-labelledby','gallery-download-title');current.setAttribute('aria-describedby','gallery-download-description');
  current.innerHTML=`<div class="dialog-heading"><h2 id="gallery-download-title">Tải ${count} ảnh đã lưu</h2><button type="button" class="close" data-download-close aria-label="Đóng hộp tải ảnh">×</button></div>
   <p id="gallery-download-description">Bao gồm ảnh đã lưu trong tất cả các phần của bộ ảnh, kể cả ảnh đang ẩn bởi bộ lọc.</p>
   <p class="download-format">Ảnh JPG rõ nét, dung lượng được tối ưu để chia sẻ và đăng Facebook. ${count>1?'Các ảnh được gói trong tệp ZIP.':'Bạn sẽ nhận một tệp JPG.'}</p>
   ${count>1?'<p class="download-hint">Trên điện thoại, mở tệp ZIP trong ứng dụng Tệp / Files rồi giải nén để lưu ảnh.</p>':''}
   ${parts.length>1?`<p class="download-hint">Danh sách được chia thành từng gói tối đa ${partSize} ảnh. Bấm tải lần lượt các gói bên dưới.</p>`:''}
   <div class="download-parts">${parts.map((part,index)=>`<div class="download-part"><div><strong>${parts.length>1?`Gói ${index+1} · Ảnh ${part.first}–${part.last}`:`${count} ảnh đã lưu`}</strong><span data-download-part-status="${index}">${part.ids.length} ảnh · ${part.ids.length===1?'JPG':'ZIP'}</span></div><button type="button" class="${parts.length===1?'btn':'small-btn'}" data-download-part="${index}">${parts.length>1?`Tải gói ${index+1}`:part.ids.length===1?'Tải ảnh JPG':`Tải ${count} ảnh (ZIP)`}</button></div>`).join('')}</div>
   <div class="download-progress" hidden><progress aria-label="Tiến độ tải ảnh"></progress></div>
   <p class="download-status" role="status" aria-live="polite"></p><p class="form-error" role="alert"></p>
   <div class="download-footer"><button type="button" class="small-btn" data-download-smaller hidden>Chia thành gói nhỏ hơn</button><button type="button" class="small-btn" data-download-cancel hidden>Hủy tải</button><button type="button" class="small-btn" data-download-refresh hidden>Cập nhật danh sách</button></div>`;
  document.body.append(current);
  const find=selector=>current.querySelector(selector),buttons=[...current.querySelectorAll('[data-download-part]')];
  const status=find('.download-status'),error=find('.form-error'),progressBox=find('.download-progress'),progress=find('progress'),cancel=find('[data-download-cancel]'),refresh=find('[data-download-refresh]'),smaller=find('[data-download-smaller]');
  let stale=false,smallerSize=partSize;
  current.addEventListener('close',()=>{
   if(active?.dialog===current)active.controller.abort();
   if(dialog===current){document.body.classList.remove('download-modal-open');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
  });
  current.addEventListener('cancel',()=>{if(active?.dialog===current)active.controller.abort();});
  find('[data-download-close]').addEventListener('click',close);
  cancel.addEventListener('click',()=>{cancel.focus({preventScroll:true});active?.controller.abort();});
  refresh.addEventListener('click',async()=>{close();await onSelectionChanged();});
  smaller.addEventListener('click',()=>open({albumId,photos,trigger:returnFocus,partSize:smallerSize}));
  buttons.forEach((button,index)=>button.addEventListener('click',async()=>{
   if(active||stale)return;
   // A previous file has already been handed to the browser. Keep only the
   // current package's Blob reachable while receiving the next package.
   for(const url of urls.keys())revoke(url);
   const controller=new AbortController();active={controller,dialog:current};
   let timedOut=false;
   const timeout=setTimeout(()=>{timedOut=true;controller.abort();},180000);
   buttons.forEach(item=>{item.disabled=true;});cancel.hidden=false;refresh.hidden=true;smaller.hidden=true;cancel.focus({preventScroll:true});
   find('.download-parts').setAttribute('aria-busy','true');error.textContent='';status.textContent='Đang chuẩn bị ảnh. Vui lòng giữ cửa sổ này mở.';
   progressBox.hidden=false;progress.removeAttribute('value');
   try{
    let lastUpdate=0;
    const result=await fetchGalleryDownload(albumId,parts[index].ids,{signal:controller.signal,onWaiting:()=>{
     if(current.open)status.textContent='Máy chủ đang chuẩn bị ảnh. Sẽ thử lại sau ít giây.';
    },onProgress:(received,total)=>{
     if(!current.open)return;
     if(total){progress.max=total;progress.value=received;}
     if(Date.now()-lastUpdate>300||received===total){status.textContent=`Đang nhận tệp · ${(received/1000000).toLocaleString('vi-VN',{maximumFractionDigits:1})} MB${total?' / '+(total/1000000).toLocaleString('vi-VN',{maximumFractionDigits:1})+' MB':''}`;lastUpdate=Date.now();}
    }});
    if(!current.open||controller.signal.aborted)return;
    const url=URL.createObjectURL(result.blob),link=document.createElement('a');
    urls.set(url,setTimeout(()=>revoke(url),60000));
    link.href=url;link.download=result.filename;link.hidden=true;document.body.append(link);link.click();link.remove();
    find(`[data-download-part-status="${index}"]`).textContent='Đã gửi tệp đến trình duyệt';
    button.textContent=parts.length>1?`Tải lại gói ${index+1}`:'Tải lại tệp';
    status.textContent='Đã chuyển tệp cho trình duyệt. Kiểm tra mục Tải xuống trên thiết bị của bạn.';
   }catch(failure){
    if(!current.open)return;
    status.textContent='';
    if(controller.signal.aborted){if(timedOut)error.textContent='Tải ảnh mất quá lâu. Kiểm tra kết nối rồi thử lại.';else status.textContent='Đã hủy tải. Bạn có thể thử lại khi sẵn sàng.';}
    else if(failure.status===401){close();await onExpired();}
    else if(failure.status===409){stale=true;error.textContent='Danh sách ảnh đã thay đổi. Hãy cập nhật danh sách trước khi tải lại.';refresh.hidden=false;}
    else if(failure.status===413&&parts[index].ids.length>1){smallerSize=Math.max(1,Math.floor(parts[index].ids.length/2));smaller.hidden=false;error.textContent='Gói ảnh quá lớn. Chia thành gói nhỏ hơn để tải tiếp; danh sách ảnh bạn chọn vẫn được giữ nguyên.';}
    else error.textContent=failure instanceof TypeError?'Kết nối bị gián đoạn. Kiểm tra mạng rồi thử lại.':failure.message;
   }finally{
    clearTimeout(timeout);if(active?.controller===controller)active=null;
    const restoreActionFocus=document.activeElement===cancel;
    find('.download-parts').removeAttribute('aria-busy');buttons.forEach(item=>{item.disabled=stale;});cancel.hidden=true;progressBox.hidden=true;
    if(current.open&&restoreActionFocus)(stale?refresh:!smaller.hidden?smaller:button).focus({preventScroll:true});
   }
  }));
  document.body.classList.add('download-modal-open');current.showModal();
 }
 return {open,close,get busy(){return !!active;}};
}

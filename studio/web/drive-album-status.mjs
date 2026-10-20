import {api} from './api-request.mjs';
const active=new Set(['queued','running','retry_wait']);
export function driveAlbumStatus(row) {
  const job=row.job,progress=job?.progress||{};
  let text='Drive · Chưa nhập ảnh';
  if(row.mapping_state==='paused')text='Drive · Đang tạm dừng';
  else if(job?.status==='awaiting_review')text='Drive · Chờ studio duyệt';
  else if(active.has(job?.status)) {
    const done=Number(progress.applied||0)+Number(progress.skipped||0)+Number(progress.failed||0);
    text='Drive · '+(job.status==='queued'?'Đang chờ':job.status==='retry_wait'?'Chờ thử lại':job.kind==='preview'?'Đang quét':'Đang xử lý');
    if(Number(progress.total)>0)text+=' '+done.toLocaleString('vi-VN')+'/'+Number(progress.total).toLocaleString('vi-VN')+' ảnh';
  } else if(['failed','completed_with_errors'].includes(job?.status))text='Drive · Có lỗi cần kiểm tra';
  else if(job?.kind==='preview'&&job.status==='completed')text='Drive · Có bản xem trước';
  else if(['canceled','cancelled'].includes(job?.status))text='Drive · Đã hủy lượt xử lý';
  else if(row.last_success_at)text='Drive · Đã đồng bộ';
  return {text,last:row.last_success_at?'Lần đồng bộ thành công: '+new Date(Number(row.last_success_at)).toLocaleString('vi-VN'):'Chưa có lần đồng bộ thành công',active:active.has(job?.status)};
}
export function mountDriveAlbumStatuses(container) {
  if(!container?.querySelector('[data-drive-album-status]'))return;
  let timer,closed=false,pending=false;
  const stop=()=>{closed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);observer.disconnect();};
  const observer=new MutationObserver(()=>{if(!container.isConnected)stop();});
  observer.observe(document.querySelector('#root')||document.body,{childList:true,subtree:true});
  async function refresh() {
    if(closed||pending||!container.isConnected)return;
    clearTimeout(timer);
    if(document.hidden)return;
    pending=true;let delay=30000;
    try {
      const result=await api('/api/admin/drive/albums');
      if(closed||!container.isConnected)return;
      const rows=new Map((result.albums||[]).map(row=>[row.album_id,row]));
      for(const element of container.querySelectorAll('[data-drive-album-status]')) {
        const row=rows.get(element.dataset.driveAlbumStatus);
        element.hidden=!row;
        if(!row)continue;
        const status=driveAlbumStatus(row);
        const last=row.last_success_at?' · Lần cuối: '+new Date(Number(row.last_success_at)).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
        const text=status.text+(result.enabled?'':' · Đang tắt')+last;
        if(element.textContent!==text)element.textContent=text;
        element.title=status.last;element.setAttribute('aria-label',text+'. '+status.last);
        if(status.active)delay=4000;
      }
    }catch(error){
      if(error.status===401){stop();return;}
      for(const element of container.querySelectorAll('[data-drive-album-status]:not([hidden])')){element.textContent='Drive · Chưa cập nhật được trạng thái';}
    }finally{pending=false;if(!closed&&container.isConnected)timer=setTimeout(refresh,delay);}
  }
  const visible=()=>{if(document.hidden)clearTimeout(timer);else void refresh();};
  document.addEventListener('visibilitychange',visible);void refresh();return stop;
}

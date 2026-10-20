import {api} from './api-request.mjs';

const states = new WeakMap();
const messages = {
  drive_folder_already_linked:'Folder này đã thuộc một bộ ảnh khác. Hãy chọn folder khác hoặc mở bộ ảnh đó.',
  drive_feature_disabled:'Đồng bộ Google Drive chưa được bật trên máy chủ.',
  drive_not_configured:'Hãy cấu hình Google Drive trong Cài đặt trước khi tạo bộ ảnh từ Drive.',
  drive_connection_not_ready:'Hãy kiểm tra kết nối Google Drive trong Cài đặt trước.',
  drive_folder_outside_root:'Folder này nằm ngoài folder gốc đã cấu hình. Có quyền đọc trên Drive chưa đủ: folder ảnh phải là folder gốc hoặc nằm bên trong nó. Vào Cài đặt → Google Drive để chọn folder cha chung chứa các bộ ảnh, rồi kiểm tra kết nối và thử lại.',
  drive_folder_scope_unverified:'Chưa xác minh được folder này nằm trong folder gốc. Hãy kiểm tra quyền Người xem của tài khoản dịch vụ trên folder gốc và các folder cha, rồi kiểm tra lại. Ảnh chưa được nhập.',
  drive_permission_denied:'Hãy chia sẻ folder cho tài khoản dịch vụ ở quyền Người xem.',
  drive_source_unavailable:'Không đọc được folder. Hãy kiểm tra link và quyền chia sẻ.',
  drive_folder_unavailable:'Link phải trỏ đến folder Google Drive, không phải một ảnh.',
  drive_folder_check_invalid:'Hãy kiểm tra folder lại trước khi tạo bộ ảnh.',
  drive_album_unavailable:'Không thể gắn folder với bộ ảnh đã lưu trữ. Hãy chọn Nháp, Công khai hoặc Riêng tư.',
  drive_request_conflict:'Yêu cầu trước đã được xử lý với thông tin khác. Hãy tải lại danh sách bộ ảnh trước khi tạo tiếp.',
  drive_folder_check_stale:'Kết quả kiểm tra đã hết hiệu lực. Hãy kiểm tra folder lại.',
  drive_folder_check_expired:'Kết quả kiểm tra đã hết hạn. Hãy kiểm tra folder lại.',
  drive_preview_stale:'Kết nối đã thay đổi. Hãy kiểm tra folder lại.'
};
export const driveEntryError = error => messages[error?.message] || (String(error?.message).startsWith('drive_') ? 'Chưa kiểm tra được folder. Hãy kiểm tra kết nối trong Cài đặt rồi thử lại.' : error?.message);
export function driveFolderId(value) {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{3,200}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' && url.hostname === 'drive.google.com') return url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{3,200})\/?$/)?.[1] || '';
  } catch {}
  return '';
}
export function driveRootGuidance(connection, {settingsLink = true} = {}) {
  const id = driveFolderId(connection?.root_folder_id);
  if (connection?.folder_scope === 'shared') return 'Bạn có thể dán bất kỳ link folder nào đã chia sẻ quyền Người xem cho tài khoản dịch vụ, rồi duyệt folder con và chọn bộ ảnh. Không cần đổi folder bắt đầu cho từng album.';
  const root = id ? `<a href="https://drive.google.com/drive/folders/${id}" target="_blank" rel="noopener noreferrer">Mở folder gốc hiện tại trên Drive</a>. ` : '';
  const settings = settingsLink ? '<a href="#settings" data-drive-settings>Cài đặt → Google Drive</a>' : 'Cài đặt → Google Drive';
  return `${root}Quyền đọc trên Drive và phạm vi nhập ảnh là hai điều kiện riêng: chỉ nhận folder gốc hoặc folder bên trong. Muốn dùng nhiều bộ ảnh, chọn folder cha chung trong ${settings}; giữ cả các bộ đang liên kết và kiểm tra kết nối sau khi lưu.`;
}
export function driveAlbumFields() {
  return `<div class="album-drive-entry" data-drive-entry hidden><label>Link folder Google Drive *<input name="drive_folder_id" placeholder="https://drive.google.com/drive/folders/…" autocomplete="off" aria-describedby="drive-folder-result" disabled></label><button type="button" class="small-btn" data-browse-drive-folder>Duyệt và chọn folder</button><button type="button" class="small-btn" data-check-drive-folder>Kiểm tra folder</button><p class="form-note" data-drive-root-guidance></p><p class="form-note" id="drive-folder-result" role="status" aria-live="polite">Chia sẻ folder ở quyền Người xem cho tài khoản dịch vụ. Chỉ ảnh nằm trực tiếp trong folder được nhập.</p></div>`;
}
export function mountDriveAlbumEntry(form) {
  if (!form?.querySelector('[data-drive-entry]')) return;
  const source = form.elements.photo_source;
  const field = form.elements.drive_folder_id;
  const region = form.querySelector('[data-drive-entry]');
  const button = form.querySelector('[data-check-drive-folder]');
  const result = form.querySelector('#drive-folder-result');
  const state = {epoch:0, checked:null, busy:false, requestKey:crypto.randomUUID()};
  states.set(form,state);
  let connection, closeBrowser;
  const guidance = form.querySelector('[data-drive-root-guidance]');
  guidance.innerHTML = driveRootGuidance(null);
  async function loadScope() {
    try {
      const status = await api('/api/admin/drive/status');
      if (form.isConnected) { connection = status.connection; guidance.innerHTML = driveRootGuidance(connection); }
    } catch { /* The folder check reports connection errors; guidance stays available. */ }
  }
  guidance.addEventListener('click', event => {
    if (event.target.closest('[data-drive-settings]')) form.closest('dialog')?.close();
  });
  const live = epoch => state.epoch === epoch && form.isConnected && form.closest('dialog')?.open && source.value === 'drive';
  function reset() {
    state.epoch++; state.checked=null; state.busy=false; button.disabled=false;
    button.textContent='Kiểm tra folder';
    result.textContent='Kiểm tra folder trước khi tạo bộ ảnh. Sau đó bạn sẽ xem trước và duyệt danh sách ảnh.';
    result.classList.remove('form-error');
  }
  source.addEventListener('change',()=>{closeBrowser?.();reset();region.hidden=source.value!=='drive';field.disabled=region.hidden;field.required=!region.hidden;if(!region.hidden)void loadScope();});
  field.addEventListener('input',reset);
  form.closest('dialog')?.addEventListener('close',()=>{state.epoch++;closeBrowser?.();},{once:true});
  form.querySelector('[data-browse-drive-folder]').addEventListener('click', async () => {
    const {openDriveFolderBrowser} = await import('./drive-folder-browser.mjs');
    if (!form.isConnected || !form.closest('dialog')?.open || source.value !== 'drive') return;
    closeBrowser?.();
    closeBrowser = openDriveFolderBrowser({initialFolder:field.value || connection?.root_folder_id || '',isAlive:()=>form.isConnected && Boolean(form.closest('dialog')?.open) && source.value === 'drive',onSelect:folder=>{field.value='https://drive.google.com/drive/folders/'+folder.id;reset();result.textContent='Đã chọn: '+folder.name+'. Nhấn Kiểm tra folder trước khi tạo bộ ảnh.';button.focus();}});
  });
  button.addEventListener('click',async()=>{
    if (state.busy) return;
    reset(); const epoch=state.epoch, folderId=driveFolderId(field.value);
    if (!folderId) {result.textContent='Hãy nhập link folder Google Drive, không dùng link của một ảnh.';result.classList.add('form-error');field.focus();return;}
    state.busy=true;button.disabled=true;button.textContent='Đang kiểm tra…';result.textContent='Đang chờ máy chủ kiểm tra quyền đọc folder…';
    try {
      const queued=await api('/api/admin/drive/folder-check',{method:'POST',body:JSON.stringify({folder_id:folderId,request_key:crypto.randomUUID()})});
      const deadline=Date.now()+120000;
      while(live(epoch)) {
        const {job}=await api('/api/admin/drive/jobs/'+queued.job_id);
        if (!live(epoch)) return;
        if (job.status==='completed') {
          if(job.progress?.folder?.id!==folderId)throw Error('Kết quả kiểm tra không khớp folder. Hãy kiểm tra lại.');
          state.checked={id:job.id,folderId,at:Date.now()};
          const formError=form.querySelector('[data-album-error]');if(formError)formError.textContent='';
          result.textContent='Đã kiểm tra: '+job.progress.folder.name+'. Bạn có thể tạo bộ ảnh, sau đó xem trước và duyệt nhập ảnh.';
          return;
        }
        if(!['queued','running','retry_wait'].includes(job.status))throw Error(job.error_code||'Không kiểm tra được folder. Hãy thử lại.');
        if(Date.now()>deadline)throw Error('Máy chạy đồng bộ chưa phản hồi. Hãy kiểm tra trạng thái worker trong Cài đặt rồi kiểm tra folder lại.');
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
    } catch(error) {if(live(epoch)){result.textContent=driveEntryError(error);result.classList.add('form-error');}}
    finally {if(live(epoch)){state.busy=false;button.disabled=false;button.textContent='Kiểm tra lại folder';}}
  });
}
export function checkedDriveAlbumData(form) {
  const state=states.get(form),checked=state?.checked;
  if (!checked || checked.folderId!==driveFolderId(form.elements.drive_folder_id?.value) || Date.now()-checked.at>14*60000) {
    form.querySelector('[data-check-drive-folder]')?.focus();
    throw Error(state?.busy?'Folder đang được kiểm tra. Hãy chờ kết quả trước khi tạo bộ ảnh.':'Hãy kiểm tra folder thành công trước khi tạo bộ ảnh.');
  }
  return {drive_folder_id:checked.folderId,drive_check_job_id:checked.id,request_key:state.requestKey};
}

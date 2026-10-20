import {api} from './api-request.mjs';

const folderId = value => {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{3,200}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' && url.hostname === 'drive.google.com') return url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{3,200})\/?$/)?.[1] || '';
  } catch {}
  return '';
};
const errorText = error => ({
  drive_permission_denied: 'Hãy chia sẻ folder ở quyền Người xem cho tài khoản dịch vụ.',
  drive_source_unavailable: 'Không đọc được folder. Hãy kiểm tra link và quyền chia sẻ.',
  drive_folder_unavailable: 'Link phải trỏ đến folder Google Drive, không phải một ảnh.',
  drive_folder_outside_root: 'Folder nằm ngoài thư viện đã chọn. Kiểm tra phạm vi trong Cài đặt → Google Drive.',
  drive_folder_scope_unverified: 'Chưa xác minh được phạm vi folder. Hãy kiểm tra quyền đọc trên các folder cha.',
  drive_connection_not_ready: 'Hãy kiểm tra kết nối trong Cài đặt → Google Drive trước.',
  drive_feature_disabled: 'Đồng bộ Drive chưa được bật trên máy chủ.',
  drive_preview_stale: 'Kết nối đã thay đổi. Hãy đóng và mở lại trình duyệt folder.',
  drive_connection_stale: 'Kết nối đã thay đổi. Hãy duyệt lại folder.',
  drive_browse_stale: 'Danh sách đã hết hiệu lực. Hãy duyệt folder lại.',
  drive_browse_timeout: 'Chưa xác minh xong folder trong thời gian cho phép. Hãy duyệt lại.',
}[error?.message] || (String(error?.message).startsWith('drive_') ? 'Chưa đọc được danh sách folder. Hãy thử lại.' : error?.message || 'Chưa đọc được danh sách folder.'));

/** A read-only dialog; enrichment never blocks choosing or navigating folders. */
export function openDriveFolderBrowser({initialFolder = '', onSelect, isAlive = () => true} = {}) {
  const returnFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'drive-folder-browser';
  dialog.setAttribute('aria-label', 'Chọn folder Google Drive');
  dialog.innerHTML = `<header><h2>Chọn folder Google Drive</h2><button type="button" class="small-btn" data-close aria-label="Đóng trình duyệt folder">Đóng</button></header>
    <div class="drive-folder-scroll"><p>Dán link đã chia sẻ cho tài khoản dịch vụ, rồi chọn folder ảnh.</p>
    <form data-browse-form><label>Link hoặc mã folder<input name="folder" autocomplete="off" required placeholder="https://drive.google.com/drive/folders/…"></label><button class="small-btn">Duyệt folder</button></form>
    <nav aria-label="Đường dẫn folder" data-breadcrumb></nav>
    <p role="status" aria-live="polite" data-status></p>
    <div data-content hidden><div class="drive-folder-heading"><h3 data-title></h3><button type="button" class="small-btn" data-refresh>Làm mới</button></div>
    <p class="drive-folder-overview" data-summary aria-live="polite"></p>
    <p class="drive-folder-summary-note">Chỉ đếm ảnh JPEG/PNG/WebP trực tiếp trong folder, không tính ảnh trong folder con.</p>
    <section class="drive-folder-preview" aria-label="Xem nhanh ảnh trong folder" hidden><p></p><div class="drive-folder-preview-images"></div></section>
    <p data-empty hidden>Không có folder con.</p>
    <p class="drive-folder-loaded" data-loaded></p><ul class="drive-folder-list"></ul><button type="button" class="small-btn" data-more hidden>Tải thêm folder</button></div>
    </div><footer><a data-google target="_blank" rel="noopener noreferrer" hidden>Mở trên Google Drive</a><button type="button" class="btn" data-select disabled>Chọn folder này</button></footer>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const input = $('input'), status = $('[data-status]'), content = $('[data-content]');
  const select = $('[data-select]'), google = $('[data-google]'), breadcrumb = $('[data-breadcrumb]');
  const list = $('.drive-folder-list'), strip = $('.drive-folder-preview-images'), previewSection = $('.drive-folder-preview');
  const cache = new Map(), waits = new Map(), requests = new Set(), imageNodes = new Map(), failedImages = new Set(), activeJobs = new Set();
  let epoch = 0, current = null, folders = [], nextPage = null, trail = [], summary = null, preview = [], previewPending = false;
  let loading = false, enriching = false, paging = false, closed = false, pendingId = null, primaryComplete = false, primaryCompletedAt = 0, previewUnavailable = false;
  const live = token => !closed && dialog.open && isAlive() && epoch === token;
  const cancelWait = () => {for (const [timer, resolve] of waits) {clearTimeout(timer); resolve();} waits.clear();};
  const cancelJob = id => {
    activeJobs.delete(id);
    // Only IDs issued to this picker are tracked; never cancel an import or
    // another admin's job. A completed job treats cancellation as a no-op.
    void api('/api/admin/drive/jobs/' + encodeURIComponent(id) + '/cancel', {method:'POST',body:'{}'}).catch(()=>{});
  };
  const cancelJobs = () => {for (const id of activeJobs) cancelJob(id);};
  function close() {
    if (closed) return;
    closed = true; epoch++; cancelWait(); cancelJobs(); observer.disconnect(); cache.clear();
    dialog.close(); dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
  }
  const observer = new MutationObserver(() => { if (!isAlive()) close(); });
  observer.observe(document.body, {childList: true, subtree: true});
  const setText = (node, value) => {if (node.textContent !== value) node.textContent = value;};
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  function renderSummary() {
    const state = summary?.status;
    if (state === 'ready' || state === 'partial') {
      const partial = state === 'partial' || !summary.complete;
      const format = (value, label) => count(value) === null ? `Chưa rõ số ${label}` : `${partial ? '≥ ' : ''}${value.toLocaleString('vi-VN')} ${label}`;
      setText($('[data-summary]'), [format(summary.images, 'ảnh'),format(summary.folders, 'folder con'),...(count(summary.otherFiles) > 0 ? [format(summary.otherFiles, 'tệp khác')] : [])].join(' · ') + (partial ? ' · Chưa đếm hết' : ''));
    } else setText($('[data-summary]'), state === 'unavailable' ? 'Chưa lấy được số ảnh và folder. Bạn vẫn có thể chọn folder.' : 'Đang đếm ảnh và folder…');
  }
  function renderPreview() {
    const samples = preview.filter(sample => !failedImages.has(sample.url));
    const wanted = new Set(samples.map(sample => sample.url));
    for (const [url, node] of imageNodes) if (!wanted.has(url)) {node.remove(); imageNodes.delete(url);}
    for (const sample of samples) {
      if (imageNodes.has(sample.url)) continue;
      const image = document.createElement('img'); image.alt = sample.name; image.title = sample.name;
      image.width = 72; image.height = 72; image.decoding = 'async'; image.referrerPolicy = 'same-origin';
      image.addEventListener('error', () => {failedImages.add(sample.url); renderPreview();}, {once:true});
      imageNodes.set(sample.url, image); image.src = sample.url; strip.append(image);
    }
    previewSection.hidden = !samples.length && !previewPending && !previewUnavailable && !preview.length;
    setText(previewSection.querySelector('p'), samples.length ? `Xem nhanh · ${samples.length} ảnh` : previewPending ? 'Đang lấy ảnh xem nhanh…' : 'Chưa tải được ảnh xem nhanh. Bạn vẫn có thể chọn folder.');
  }
  function renderState() {
    content.hidden = !current; select.disabled = !current; google.hidden = !current;
    if (current) {google.href = 'https://drive.google.com/drive/folders/' + current.id; setText($('[data-title]'), current.name);}
    $('[data-more]').hidden = !nextPage; $('[data-more]').disabled = paging;
    $('[data-refresh]').disabled = loading || paging || enriching;
    $('[data-empty]').hidden = !current || folders.length > 0 || !!nextPage;
    setText($('[data-loaded]'), folders.length ? `Đã hiển thị ${folders.length.toLocaleString('vi-VN')} folder con${nextPage ? ' · còn trang tiếp theo' : ''}` : '');
    content.setAttribute('aria-busy', String(loading));
    renderSummary(); renderPreview();
  }
  function renderTrail() {
    breadcrumb.replaceChildren(); breadcrumb.hidden = trail.length < 2;
    trail.forEach((folder, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'small-btn';
      button.textContent = folder.name; button.disabled = index === trail.length - 1;
      if (button.disabled) button.setAttribute('aria-current', 'location');
      const path = trail.slice(0, index);
      button.addEventListener('click', () => void browse(folder.id, {path})); breadcrumb.append(button);
    });
  }
  function appendFolders(children) {
    const seen = new Set(folders.map(folder => folder.id));
    for (const folder of children) {
      if (!folder || folderId(folder.id) !== folder.id || seen.has(folder.id)) continue;
      seen.add(folder.id); const child = {id:folder.id,name:String(folder.name || folder.id)}; folders.push(child);
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'small-btn'; button.textContent = child.name; button.setAttribute('aria-label', 'Mở folder ' + child.name);
      button.addEventListener('click', () => void browse(child.id, {path:[...trail]})); item.append(button); list.append(item);
    }
  }
  function reset(path = []) {
    current = null; folders = []; nextPage = null; trail = [...path]; summary = null; preview = []; previewPending = false; previewUnavailable = false;
    paging = false; primaryComplete = false; primaryCompletedAt = 0; list.replaceChildren(); renderTrail(); renderState();
  }
  function remember() {
    if (!current || !primaryComplete || paging) return;
    cache.delete(current.id);
    cache.set(current.id, {savedAt:primaryCompletedAt,current:{...current},folders:[...folders],nextPage,summary,preview:[...preview],previewUnavailable});
    while (cache.size > 12) cache.delete(cache.keys().next().value);
  }
  async function browse(id, {path = [], more = false, refresh = false} = {}) {
    if (!folderId(id)) {status.textContent = 'Hãy nhập link folder Google Drive, không dùng link của một ảnh.'; status.className = 'form-error'; input.focus(); return;}
    if (!more && loading && pendingId === id) return;
    if (more && (!nextPage || paging || current?.id !== id)) return;
    const pageToken = more ? nextPage : null;
    if (!more) {
      cancelWait(); cancelJobs(); epoch++; loading = true; enriching = true; pendingId = id; reset(path);
      if (refresh) cache.delete(id);
      const hit = cache.get(id);
      if (hit && Date.now() - hit.savedAt < 30000) {
        current = {...hit.current}; appendFolders(hit.folders); nextPage = hit.nextPage; summary = hit.summary; preview = [...hit.preview]; previewUnavailable = hit.previewUnavailable;
        trail = [...path,current]; primaryComplete = true; primaryCompletedAt = hit.savedAt; loading = false; enriching = false; pendingId = null;
        input.value = 'https://drive.google.com/drive/folders/' + id;
        status.className = ''; status.textContent = 'Đang dùng kết quả vừa xem. Bấm Làm mới để kiểm tra thay đổi trên Drive.';
        renderTrail(); renderState(); return;
      }
    } else paging = true;
    const token = epoch, requestId = `${token}:${id}:${pageToken || ''}`;
    if (requests.has(requestId)) return;
    requests.add(requestId); status.className = ''; status.textContent = more ? 'Đang tải thêm folder…' : 'Đang đọc danh sách folder…'; renderState();
    let applied = false, queuedId;
    try {
      const queued = await api('/api/admin/drive/browse', {method:'POST',body:JSON.stringify({folder_id:id,...(pageToken ? {page_token:pageToken} : {}),request_key:crypto.randomUUID()})});
      if(typeof queued?.job_id!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(queued.job_id)) throw Error('Máy chủ trả về tác vụ không hợp lệ. Hãy duyệt lại.');
      queuedId=queued.job_id;activeJobs.add(queuedId);
      if(!live(token)) {cancelJob(queuedId);return;}
      const deadline = Date.now() + 120000;
      while (live(token)) {
        const {job} = await api('/api/admin/drive/jobs/' + encodeURIComponent(queued.job_id));
        if (!live(token)) return;
        if(!['queued','running','retry_wait'].includes(job.status)) activeJobs.delete(queuedId);
        const progress = job.progress;
        if (job.status === 'completed' || (job.status === 'running' && progress?.ready === true)) {
          if (progress?.folder?.id !== id || !Array.isArray(progress.folders)) throw Error('Danh sách folder không khớp. Hãy duyệt lại.');
          if (!applied) {
            current = {id,name:String(progress.folder.name || id)}; appendFolders(progress.folders);
            nextPage = typeof progress.nextPageToken === 'string' && progress.nextPageToken ? progress.nextPageToken : null;
            if (!more) {trail = [...path,current]; renderTrail(); input.value = 'https://drive.google.com/drive/folders/' + id; loading = false; pendingId = null;}
            applied = true;
          }
          if (!more) {
            summary = progress.summary || {status:job.status === 'completed' ? 'unavailable' : 'loading'};
            const seen = new Set();
            preview = /^[A-Za-z0-9_-]{1,200}$/.test(queued.job_id) && Array.isArray(progress.preview?.images) ? progress.preview.images.filter(image => {
              if (!image || folderId(image.id) !== image.id || seen.has(image.id) || image.url !== `/api/admin/drive/browse/${queued.job_id}/images/${image.id}`) return false;
              seen.add(image.id); return true;
            }).slice(0,6).map(image => ({url:image.url,name:String(image.name || 'Ảnh trong folder')})) : [];
            previewPending = progress.preview?.pending === true && job.status !== 'completed';
            previewUnavailable = progress.preview?.unavailable === true;
          }
          setText(status, job.status === 'completed' ? 'Folder sẵn sàng.' : 'Bạn có thể chọn hoặc mở folder trong khi tải tổng quan.');
          renderState();
          if (job.status === 'completed') {if (!more) {primaryComplete = true; primaryCompletedAt = Date.now();} return;}
        }
        if (!['queued','running','retry_wait'].includes(job.status)) throw Object.assign(Error(job.error_code || 'Danh sách đã hết hiệu lực. Hãy duyệt folder lại.'),{invalidatesFolder:true});
        if (Date.now() > deadline) throw Error('Máy đồng bộ chưa phản hồi. Hãy kiểm tra worker trong Cài đặt rồi thử lại.');
        await new Promise(resolve => {const timer = setTimeout(() => {waits.delete(timer); resolve();}, 1500); waits.set(timer, resolve);});
      }
    } catch (error) {
      if (live(token)) {
        if(!more || error.invalidatesFolder || [401,403,404].includes(error.status)) {
          epoch++;cancelWait();cancelJobs();cache.clear();loading=false;enriching=false;pendingId=null;reset(trail.slice(0,-1));
        }
        status.textContent = errorText(error); status.className = 'form-error';
      }
    } finally {
      if(queuedId && activeJobs.has(queuedId)) cancelJob(queuedId);
      requests.delete(requestId);
      if (live(token)) {if (more) paging = false; else {loading = false; enriching = false; pendingId = null;} renderState(); remember();}
    }
  }
  $('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => {event.preventDefault(); close();}); dialog.addEventListener('close', close);
  input.addEventListener('input', () => {epoch++; cancelWait(); cancelJobs(); loading = false; enriching = false; pendingId = null; reset(); status.textContent = 'Nhấn Duyệt folder để kiểm tra link mới.';});
  $('[data-browse-form]').addEventListener('submit', event => {event.preventDefault(); if (current?.id === folderId(input.value) && (loading || enriching)) return; void browse(folderId(input.value));});
  $('[data-more]').addEventListener('click', () => {if (current) void browse(current.id, {more:true});});
  $('[data-refresh]').addEventListener('click', () => {if (current) void browse(current.id, {path:trail.slice(0,-1),refresh:true});});
  select.addEventListener('click', () => {if (!current || !isAlive()) return; const chosen = {...current}; close(); onSelect?.(chosen);});
  dialog.showModal(); input.value = initialFolder; input.focus();
  if (folderId(initialFolder)) void browse(folderId(initialFolder));
  return close;
}

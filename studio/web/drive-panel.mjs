import {api} from './api-request.mjs';
import {driveRootGuidance, driveEntryError} from './drive-album-entry.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const send = (url, body, method = 'POST') => api(url, {method, body: JSON.stringify(body)});
const activeStates = new Set(['queued', 'running', 'retry_wait']);
const labels = {
  queued: 'Đang chờ', running: 'Đang xử lý', retry_wait: 'Đang chờ thử lại',
  completed: 'Hoàn tất', completed_with_errors: 'Hoàn tất, có ảnh cần kiểm tra',
  awaiting_review: 'Chờ studio duyệt', failed: 'Thất bại', canceled: 'Đã hủy', cancelled: 'Đã hủy',
  add: 'Thêm ảnh', replace: 'Thay nội dung', rename: 'Đổi tên', missing: 'Không còn trên Drive',
  unchanged: 'Không thay đổi', conflict: 'Xung đột', skip: 'Bỏ qua', pending: 'Chờ xử lý',
  applied: 'Đã áp dụng', skipped: 'Đã bỏ qua', active: 'Đã đồng bộ',
  missing_in_drive: 'Không còn trên Drive', detached: 'Đã chuyển sang quản lý tay', suppressed: 'Đã xóa khỏi web',
  check: 'Kiểm tra kết nối', preview: 'Xem trước thay đổi', apply: 'Đồng bộ'
};
const errors = {
  drive_preview_stale: 'Bộ ảnh đã thay đổi. Hãy tạo bản xem trước mới rồi duyệt lại.',
  drive_review_required: 'Bộ ảnh này cần studio duyệt bản xem trước trước khi đồng bộ.',
  drive_credentials_missing: 'Chưa cài khóa tài khoản dịch vụ trên máy chạy đồng bộ.',
  drive_credentials_file_permissions: 'Cần chỉnh quyền đọc file khóa trên máy chạy đồng bộ.',
  drive_identity_mismatch: 'Tài khoản dịch vụ trên máy chạy đồng bộ khác với tài khoản đã cấu hình.',
  drive_permission_denied: 'Chưa có quyền đọc. Hãy chia sẻ folder cho tài khoản dịch vụ ở quyền Người xem.',
  drive_source_unavailable: 'Không đọc được file hoặc folder. Hãy kiểm tra lại chia sẻ trên Drive.',
  drive_folder_outside_root: driveEntryError({message: 'drive_folder_outside_root'}),
  drive_folder_scope_unverified: driveEntryError({message: 'drive_folder_scope_unverified'}),
  drive_connection_not_ready: 'Hãy kiểm tra kết nối thành công trước khi gắn folder.',
  drive_not_configured: 'Hãy cấu hình tài khoản dịch vụ và folder gốc trong Cài đặt.',
  drive_rate_limited: 'Google đang giới hạn lượt đọc. Tác vụ sẽ thử lại sau.',
  drive_feature_disabled: 'Đồng bộ Drive chưa được bật trên máy chủ.',
  drive_file_too_large: 'Ảnh nguồn vượt giới hạn dung lượng xử lý.',
  drive_unsupported_type: 'Định dạng này không được nhập vào web.',
  drive_source_suppressed: 'Ảnh đã được studio bỏ đồng bộ. Chọn nhập lại nếu muốn tạo ảnh Drive mới.',
  drive_download_restricted: 'Chủ sở hữu đã hạn chế tải file này.',
  drive_file_other_album: 'File này đang thuộc một liên kết album khác.',
  drive_checksum_mismatch: 'Nội dung tải xuống không khớp. Hãy tạo bản xem trước và thử lại.',
  drive_mapping_stale: 'Liên kết folder đã thay đổi. Hãy tải lại trạng thái.',
  drive_source_stale: 'Ảnh nguồn đã thay đổi. Hãy tạo bản xem trước mới rồi duyệt lại.',
  drive_invalid_id: 'Hãy nhập link thư mục Google Drive hoặc mã thư mục, không dùng link của một ảnh.',
  drive_folder_already_linked: 'Folder này đã gắn với bộ ảnh khác. Hãy mở bộ ảnh đó hoặc chọn một folder khác.',
  drive_folder_unavailable: 'Link phải trỏ đến một thư mục Drive đã chia sẻ quyền Người xem cho tài khoản dịch vụ.',
  drive_root_unavailable: 'Không đọc được folder gốc. Hãy kiểm tra link và quyền chia sẻ trong Cài đặt.',
  drive_baseline_required: 'Hãy xem trước, duyệt và hoàn tất lần nhập đầu tiên trước khi bật lịch.',
  drive_preview_unavailable: 'Bản xem trước không còn dùng được. Hãy tạo bản xem trước mới.',
  drive_admin_rate_limited: 'Bạn thao tác quá nhanh. Hãy đợi một lát rồi thử lại.',
  drive_request_conflict: 'Yêu cầu trước đã thay đổi. Hãy cập nhật trạng thái rồi thử lại.',
  drive_retry_unavailable: 'Lượt này không có file lỗi có thể thử lại. Hãy cập nhật trạng thái hoặc tạo bản xem trước mới.',
  drive_retry_exhausted: 'Lượt này đã hết số lần thử lại. Hãy tạo bản xem trước mới và duyệt lại.',
  drive_job_active: 'Bộ ảnh đang có một lượt xử lý. Hãy đợi lượt đó hoàn tất.',
  drive_temporary_failure: 'Đọc ảnh tạm thời thất bại. Có thể thử lại các file lỗi.',
  drive_comparison_busy: 'Đang có nhiều yêu cầu so sánh ảnh. Hãy đợi một lát rồi thử lại.',
  drive_comparison_unavailable: 'Không tải được ảnh so sánh. Hãy cập nhật trạng thái hoặc tạo bản xem trước mới.',
  drive_comparison_expired: 'Ảnh so sánh đã hết hạn. Hãy tải lại so sánh.',
  drive_comparison_too_large: 'Không tạo được ảnh so sánh trong giới hạn dung lượng.',
  drive_maintenance_active: 'Đang sao lưu hoặc bảo trì. Đồng bộ sẽ chờ rồi tiếp tục.'
};
const message = value => errors[value] || (String(value || '').startsWith('drive_') ? 'Chưa thực hiện được thao tác. Hãy kiểm tra trạng thái kết nối và thử lại.' : value);
const title = value => labels[value] || value || '—';
const date = value => value ? new Date(Number(value)).toLocaleString('vi-VN') : 'Chưa có';
const parse = value => {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
};
function folderId(value) {
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{3,200}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' && url.hostname === 'drive.google.com') return url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/)?.[1] || '';
  } catch {}
  return '';
}
const button = (action, text, disabled = false) => `<button type="button" class="small-btn" data-drive-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;

export function mountDrivePanel(container, {album, onChanged = async () => {}} = {}) {
  if (!container) return;
  const base = album ? `/api/admin/albums/${album.id}/drive` : '/api/admin/drive';
  let state;
  let detail;
  let jobId;
  let jobOffset = 0;
  let actionFilter = '';
  let statusFilter = '';
  let sourceOffset = 0;
  let busy = false;
  let timer;
  let refreshing;
  let refreshFailures = 0;
  let needsRefresh = true;
  let authenticationRequired = false;
  let disposed = false;
  let closeFolderBrowser;
  let feedbackText = '';
  let feedbackError = false;
  let reviewedPreview;
  let comparison;
  let comparisonTimer;
  const staleJobs = new Set();
  const actionFilters = ['add', 'replace', 'rename', 'missing', 'skip', 'conflict', 'unchanged'];
  const statusFilters = ['pending', 'applied', 'skipped', 'failed'];
  const requestKeys = new Map();
  const readActions = new Set(['refresh', 'select-job', 'filter-items', 'items-prev', 'items-next', 'sources-prev', 'sources-next', 'reload-album']);
  const keyFor = action => {
    if (!requestKeys.has(action)) requestKeys.set(action, crypto.randomUUID());
    return requestKeys.get(action);
  };
  function feedback(text, isError = false) {
    feedbackText = text || '';
    feedbackError = isError;
    const target = container.querySelector('[data-drive-feedback]');
    if (target) {
      target.textContent = feedbackText;
      target.classList.toggle('form-error', isError);
      target.setAttribute('role', isError ? 'alert' : 'status');
    }
  }
  function refresh() {
    if (refreshing) return refreshing;
    if (disposed || !container.isConnected) return Promise.resolve();
    if (document.hidden) {
      scheduleRefresh();
      return Promise.resolve();
    }
    clearTimeout(timer);
    refreshing = load().then(loaded => {
      if (!loaded) {
        needsRefresh = true;
        return;
      }
      refreshFailures = 0;
      needsRefresh = false;
      authenticationRequired = false;
    }, error => {
      refreshFailed(error);
      throw error;
    }).finally(() => {
      refreshing = null;
      scheduleRefresh();
    });
    return refreshing;
  }
  function refreshFailed(error) {
    if (error.status === 401) authenticationRequired = true;
    else {
      refreshFailures = Math.min(refreshFailures + 1, 4);
      needsRefresh = true;
    }
  }
  function scheduleRefresh() {
    clearTimeout(timer);
    if (!container.isConnected) return dispose();
    if (disposed || document.hidden || authenticationRequired || busy || refreshing || !(needsRefresh || hasActiveJob())) return;
    const delay = refreshFailures ? Math.min(4000 * 2 ** (refreshFailures - 1), 30000) : 4000;
    timer = setTimeout(() => {
      if (!container.isConnected) return dispose();
      if (disposed || document.hidden || authenticationRequired || busy) return;
      void refresh().catch(error => feedback(message(error.message), true));
    }, delay);
  }
  function dispose() {
    disposed = true;
    closeFolderBrowser?.();
    clearTimeout(timer);
    clearTimeout(comparisonTimer);
    document.removeEventListener('visibilitychange', visibilityChanged);
    observer.disconnect();
  }
  function visibilityChanged() {
    scheduleRefresh();
  }
  const observer = new MutationObserver(() => {
    if (!container.isConnected) dispose();
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});
  document.addEventListener('visibilitychange', visibilityChanged);
  async function load() {
    const [status, info] = await Promise.all([
      api('/api/admin/drive/status'),
      album ? api(`${base}?offset=${sourceOffset}&limit=50`) : null
    ]);
    if (!container.isConnected || document.hidden) return false;
    state = {status, info};
    const jobs = album ? info.jobs : status.jobs;
    if (!jobId) jobId = jobs[0]?.id;
    const query = new URLSearchParams({offset: String(jobOffset), limit: '50'});
    if (actionFilter) query.set('action', actionFilter);
    if (statusFilter) query.set('status', statusFilter);
    detail = jobId ? await api(`/api/admin/drive/jobs/${jobId}?${query}`) : null;
    if (!container.isConnected || document.hidden) return false;
    if (detail?.job.error_code) markStale(detail.job.id, detail.job.error_code);
    draw();
    return true;
  }
  const jobTitle = job => album && job.kind === 'check' ? 'Kiểm tra và gắn folder' : title(job.kind);
  const previewKey = job => !staleJobs.has(job?.id) && job?.manifest?.complete && (job.status === 'awaiting_review' || job.kind === 'preview' && job.status === 'completed')
    ? JSON.stringify([job.id, job.manifest]) : null;
  const hasActiveJob = () => [...((album ? state?.info?.jobs : state?.status.jobs) || []), detail?.job].some(job => job && activeStates.has(job.status));
  function jobMarkup() {
    const jobs = [...(album ? state.info.jobs : state.status.jobs)];
    if (detail?.job && !jobs.some(job => job.id === detail.job.id)) jobs.unshift(detail.job);
    if (!jobs.length) return '<p>Chưa có lượt đồng bộ.</p>';
    const job = detail?.job;
    const items = detail?.items || [];
    const preview = previewKey(job);
    if (reviewedPreview !== preview) reviewedPreview = null;
    const progress = job?.progress || {};
    const total = Number(detail?.total ?? progress.total ?? items.length);
    const counts = detail?.counts;
    const failed = Number(counts?.statuses?.failed ?? progress.failed ?? 0);
    const retryable = job?.kind === 'apply' && ['failed', 'completed_with_errors'].includes(job.status) && failed > 0;
    const filterOptions = (values, selected, group) => values.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escape(title(value))}${counts ? ` (${Number(counts[group]?.[value] || 0)})` : ''}</option>`).join('');
    const processed = Number(progress.applied || 0) + Number(progress.skipped || 0) + Number(progress.failed || 0);
    const progressText = progress.total === undefined ? '' : preview
      ? ` · ${Number(progress.total)} file trong bản xem trước`
      : ` · Đã xử lý ${processed}/${Number(progress.total)} file${progress.failed ? ` · ${Number(progress.failed)} file lỗi` : ''}`;
    return `<div class="drive-job">
      <label>Lượt xử lý<select data-drive-job>${jobs.map(item => `<option value="${escape(item.id)}" ${item.id === jobId ? 'selected' : ''}>${escape(jobTitle(item))} · ${escape(title(item.status))} · ${date(item.created_at)}</option>`).join('')}</select></label>
      ${job ? `<p role="status">${escape(title(job.status))}${progressText}</p>
      ${job.error_code ? `<p class="form-error">${escape(message(job.error_code))}</p>` : ''}
      ${activeStates.has(job.status) ? button('cancel', 'Hủy lượt này') : ''}
      ${retryable ? `<p>Chỉ thử lại các file lỗi trong lượt đã duyệt; các file đã áp dụng được giữ nguyên.</p>${button('retry-failed', `Thử lại file lỗi (${failed})`, !state.status.enabled || hasActiveJob() || staleJobs.has(job.id) || album && state.info.mapping?.state !== 'attached')}` : ''}
      ${staleJobs.has(job.id) ? `<p class="form-error">Lượt này cần bản xem trước mới trước khi tiếp tục.</p>${freshPreviewMarkup()}` : ''}
      <div class="drive-filters"><label>Lọc thay đổi<select data-drive-filter="action"><option value="">Tất cả thay đổi${counts ? ` (${Object.values(counts.actions).reduce((sum, value) => sum + Number(value), 0)})` : ''}</option>${filterOptions(actionFilters, actionFilter, 'actions')}</select></label>
      <label>Lọc trạng thái<select data-drive-filter="status"><option value="">Tất cả trạng thái</option>${filterOptions(statusFilters, statusFilter, 'statuses')}</select></label></div>
      ${counts ? '<p class="panel-note">Số trong bộ lọc tính trên toàn bộ lượt xử lý.</p>' : ''}
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">File</th><th scope="col">Thay đổi</th><th scope="col">Trạng thái</th></tr></thead><tbody>${items.map(item => `<tr><td data-label="File">${escape(parse(item.source_json).file?.name || item.file_id)}${item.action === 'replace' && preview && item.current_photo ? `<button type="button" class="small-btn drive-compare-button" data-drive-compare="${escape(item.id)}" ${state.status.enabled ? '' : 'disabled'}>So sánh trước / sau</button>` : ''}</td><td data-label="Thay đổi">${escape(title(item.action))}</td><td data-label="Trạng thái">${escape(item.error_code ? message(item.error_code) : title(item.status))}</td></tr>`).join('')}</tbody></table></div>` : `<p data-drive-empty role="status">${total ? 'Không còn file ở trang này.' : actionFilter || statusFilter ? 'Không có file khớp bộ lọc.' : 'Chưa có file trong lượt này.'}</p>`}
      <div class="drive-actions">${button('items-prev', 'File trước', jobOffset === 0)}<span data-drive-page role="status">${items.length ? `File ${jobOffset + 1}–${jobOffset + items.length} / ${total}` : `0 / ${total} file`}</span>${button('items-next', 'File sau', items.length < 50 || jobOffset + items.length >= total)}</div>
      ${album && preview ? `<p>Chỉ áp dụng nội dung trong bản xem trước này. Nếu bộ ảnh hoặc Drive thay đổi, hệ thống yêu cầu xem lại. Ảnh không còn trên Drive vẫn được giữ trên web.</p>
      <label class="checkbox-label"><input type="checkbox" data-drive-reviewed ${reviewedPreview ? 'checked' : ''}> Tôi đã xem các thay đổi và đồng ý áp dụng vào bộ ảnh.</label>${button('approve', 'Duyệt và đồng bộ', !reviewedPreview || hasActiveJob() || !state.status.enabled || state.info.mapping?.state !== 'attached')}` : ''}` : ''}
    </div>`;
  }
  function draw() {
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const selector = focused?.matches('[data-drive-form] input, [data-drive-form] select') ? `[data-drive-form="${focused.closest('form').dataset.driveForm}"] [name="${focused.name}"]`
      : focused?.matches('[data-drive-reviewed]') ? '[data-drive-reviewed]'
      : focused?.matches('[data-drive-job]') ? '[data-drive-job]'
      : focused?.dataset.driveFilter ? `[data-drive-filter="${focused.dataset.driveFilter}"]`
      : focused?.dataset.driveCompare ? `[data-drive-compare="${CSS.escape(focused.dataset.driveCompare)}"]`
      : focused?.dataset.driveAction ? `[data-drive-action="${focused.dataset.driveAction}"]` : null;
    const selection = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;
    const drafts = [...container.querySelectorAll('[data-drive-form] input, [data-drive-form] select')].map(input => [input.closest('form').dataset.driveForm, input.name, input.value]);
    const sourceOpen = container.querySelector('[data-drive-sources]')?.open;
    const {status, info} = state;
    const connection = status.connection;
    const link = info?.mapping;
    const workerAlive = status.workers.some(worker => worker.state !== 'stopped' && Date.now() - Number(worker.heartbeat_at) < 90000);
    const markup = `<section class="panel drive-panel">
      <h2>Google Drive · ${album ? 'Nguồn ảnh của bộ ảnh' : 'Kết nối studio'}</h2>
      <p>${status.enabled ? connection?.status === 'active' ? 'Đã kết nối tài khoản studio.' : 'Kết nối chưa sẵn sàng.' : 'Đồng bộ Drive chưa được bật trên máy chủ.'}</p>
      ${status.enabled && !workerAlive ? '<p class="panel-note">Máy chạy đồng bộ chưa báo hoạt động gần đây. Các yêu cầu sẽ chờ trong hàng đợi.</p>' : ''}
      <p class="panel-note" data-drive-root-guidance>${driveRootGuidance(connection, {settingsLink: Boolean(album)})}</p>
      ${album ? albumMarkup(link, status) : connectionMarkup(connection, status)}
      <p class="drive-feedback ${feedbackError ? 'form-error' : ''}" data-drive-feedback role="${feedbackError ? 'alert' : 'status'}">${escape(feedbackText)}</p>
      <div class="drive-actions">${button('refresh', 'Cập nhật trạng thái')}${album ? button('reload-album', 'Cập nhật bộ ảnh trên web') : ''}</div>
      ${jobMarkup()}
    </section>`;
    const panel = container.querySelector('.drive-panel');
    if (panel) panel.outerHTML = markup;
    else container.innerHTML = markup;
    for (const [form, name, value] of drafts) {
      const input = container.querySelector(`[data-drive-form="${form}"] [name="${name}"]`);
      if (input) input.value = value;
    }
    const scope = container.querySelector('[name=folder_scope]');
    if (scope) container.querySelector('[data-root-label]').textContent = scope.value === 'shared' ? 'Folder bắt đầu mặc định' : 'Đường dẫn hoặc mã folder gốc';
    const sources = container.querySelector('[data-drive-sources]');
    if (sources && sourceOpen) sources.open = true;
    if (busy) container.querySelectorAll('.drive-panel button, .drive-panel select').forEach(element => { element.disabled = true; });
    container.querySelector('.drive-panel').setAttribute('aria-busy', String(busy));
    const nextFocus = selector && container.querySelector(selector);
    if (nextFocus && !nextFocus.disabled) {
      nextFocus.focus({preventScroll: true});
      if (selection?.[0] !== null && selection?.[0] !== undefined) nextFocus.setSelectionRange(...selection);
    }
  }
  function freshPreviewMarkup() {
    return album ? button('fresh-preview', 'Tạo bản xem trước mới', !state.status.enabled || hasActiveJob() || state.info.mapping?.state !== 'attached') : '<p>Mở bộ ảnh để tạo bản xem trước mới và duyệt lại.</p>';
  }
  function markStale(id, code) {
    if (['drive_preview_stale', 'drive_preview_unavailable', 'drive_mapping_stale', 'drive_source_stale', 'drive_retry_exhausted'].includes(code)) {
      staleJobs.add(id);
      if (id === jobId) reviewedPreview = null;
    }
  }
  function closeComparison() {
    const current = comparison;
    if (!current) return;
    comparison = null;
    clearTimeout(comparisonTimer);
    current.dialog.close();
    current.dialog.remove();
    const opener = container.querySelector(`[data-drive-compare="${CSS.escape(current.itemId)}"]`);
    (opener || container.querySelector('[data-drive-action="fresh-preview"], [data-drive-job]'))?.focus({preventScroll: true});
  }
  const comparisonOpen = current => comparison === current && container.isConnected && current.dialog.open;
  function comparisonImageUrl(value, id) {
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin && url.pathname === `/api/admin/drive/comparisons/${encodeURIComponent(id)}/image` ? url.href : '';
    } catch { return ''; }
  }
  function drawComparison(current) {
    if (!comparisonOpen(current)) return;
    const focusedAction = current.dialog.contains(document.activeElement) ? document.activeElement.dataset.comparisonAction : null;
    const data = current.data;
    const ready = !current.error && data?.status === 'completed' && data.incoming;
    const currentUrl = ready && comparisonImageUrl(data.current?.url, current.jobId);
    const incomingUrl = ready && comparisonImageUrl(data.incoming?.url, current.jobId);
    const stale = staleJobs.has(current.previewId);
    current.dialog.innerHTML = `<div class="drive-comparison-header"><h2 id="drive-comparison-title">So sánh trước / sau</h2><button type="button" class="small-btn" data-comparison-action="close" autofocus>Đóng</button></div>
      <p class="drive-comparison-name">${escape(data?.file_name || current.fileName)}</p>
      <p>Ảnh nhỏ để kiểm tra nội dung trước khi duyệt thay thế.</p>
      ${current.error ? `<p class="form-error" role="alert">${escape(message(current.error))}</p>${stale ? '<p>Đóng so sánh và tạo bản xem trước mới để duyệt lại thay đổi.</p>' : '<button type="button" class="small-btn" data-comparison-action="retry">Tải lại so sánh</button>'}`
        : ready && currentUrl && incomingUrl ? `<div class="drive-comparison-images"><figure><figcaption>Trước · Ảnh đang trên web</figcaption><img src="${escape(currentUrl)}" alt="Ảnh hiện tại: ${escape(current.fileName)}" data-comparison-image></figure><figure><figcaption>Sau · Ảnh mới từ Drive</figcaption><img src="${escape(incomingUrl)}" alt="Ảnh thay thế từ Drive: ${escape(current.fileName)}" data-comparison-image></figure></div><p class="panel-note">Ảnh so sánh có hiệu lực đến ${date(data.expires_at)}.</p>`
        : '<p role="status" class="drive-comparison-loading">Đang chuẩn bị ảnh so sánh… Bạn có thể đóng cửa sổ này để dừng xem.</p>'}`;
    current.dialog.querySelectorAll('[data-comparison-image]').forEach(img => img.addEventListener('error', () => {
      if (!comparisonOpen(current)) return;
      clearTimeout(comparisonTimer);
      current.error = 'drive_comparison_unavailable';
      drawComparison(current);
    }, {once: true}));
    if (focusedAction) current.dialog.querySelector(`[data-comparison-action="${focusedAction}"]`)?.focus({preventScroll: true});
  }
  function comparisonError(current, code) {
    if (!comparisonOpen(current)) return;
    current.error = code;
    markStale(current.previewId, code);
    draw();
    drawComparison(current);
  }
  async function pollComparison(current) {
    if (!comparisonOpen(current)) return;
    try {
      const data = await api(`/api/admin/drive/comparisons/${encodeURIComponent(current.jobId)}`);
      if (!comparisonOpen(current)) return;
      current.data = data;
      if (data.error_code) return comparisonError(current, data.error_code);
      if (activeStates.has(data.status)) {
        comparisonTimer = setTimeout(() => void pollComparison(current), 1500);
        return;
      }
      if (data.status !== 'completed' || !data.incoming || !comparisonImageUrl(data.current?.url, current.jobId) || !comparisonImageUrl(data.incoming.url, current.jobId)) {
        return comparisonError(current, ['canceled', 'cancelled'].includes(data.status) ? 'Đã hủy yêu cầu so sánh. Bạn có thể tải lại khi cần.' : 'drive_comparison_unavailable');
      }
      if (data.expires_at && Number(data.expires_at) <= Date.now()) return comparisonError(current, 'drive_comparison_expired');
      drawComparison(current);
      if (data.expires_at) comparisonTimer = setTimeout(() => comparisonError(current, 'drive_comparison_expired'), Math.min(Number(data.expires_at) - Date.now(), 2147483647));
    } catch (error) { comparisonError(current, error.message); }
  }
  async function requestComparison(current) {
    clearTimeout(comparisonTimer);
    current.error = null;
    current.data = null;
    drawComparison(current);
    const action = `comparison-${current.previewId}-${current.itemId}`;
    try {
      const result = await send(`/api/admin/drive/jobs/${encodeURIComponent(current.previewId)}/items/${encodeURIComponent(current.itemId)}/comparison`, {request_key: keyFor(action)});
      requestKeys.delete(action);
      if (!comparisonOpen(current)) return;
      current.jobId = result.job_id;
      await pollComparison(current);
    } catch (error) { comparisonError(current, error.message); }
  }
  function openComparison(item) {
    closeComparison();
    const dialog = document.createElement('dialog');
    dialog.className = 'drive-comparison';
    dialog.setAttribute('aria-labelledby', 'drive-comparison-title');
    const current = {dialog, previewId: jobId, itemId: item.id, fileName: parse(item.source_json).file?.name || item.file_id};
    comparison = current;
    container.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeComparison(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    });
    dialog.addEventListener('click', event => {
      const action = event.target.closest('[data-comparison-action]')?.dataset.comparisonAction;
      if (action === 'close') closeComparison();
      if (action === 'retry') void requestComparison(current);
    });
    dialog.showModal();
    drawComparison(current);
    dialog.querySelector('[data-comparison-action="close"]').focus();
    void requestComparison(current);
  }
  function connectionMarkup(connection, status) {
    return `<p>Chia sẻ các folder cần nhập cho email tài khoản dịch vụ ở quyền Người xem. Khóa kết nối được cài trên máy chạy đồng bộ.</p>
      <form data-drive-form="connection">
        <label>Email tài khoản dịch vụ<input name="email" type="email" required value="${escape(connection?.service_account_email)}"></label>
        <label>Phạm vi folder<select name="folder_scope"><option value="root" ${connection?.folder_scope !== 'shared' ? 'selected' : ''}>Trong thư viện đã chọn</option><option value="shared" ${connection?.folder_scope === 'shared' ? 'selected' : ''}>Các folder đã chia sẻ</option></select></label><p class="panel-note">Chọn “Các folder đã chia sẻ” để dán link từng bộ ảnh mà không cần chung folder cha. Chỉ folder tài khoản dịch vụ đọc được mới được chấp nhận.</p><label><span data-root-label>${connection?.folder_scope === 'shared' ? 'Folder bắt đầu mặc định' : 'Đường dẫn hoặc mã folder gốc'}</span><input name="root" required value="${escape(connection?.root_folder_id)}"></label>
        <button class="btn" ${status.enabled ? '' : 'disabled'}>Lưu kết nối</button>
      </form>
      <div class="drive-actions">${button('check', 'Kiểm tra kết nối', !status.enabled || !connection)}</div>
      <p>Lần kiểm tra gần nhất: ${date(connection?.last_checked_at)}. ${status.scheduler_enabled ? 'Lịch đồng bộ đã bật.' : 'Lịch đồng bộ đang tắt.'}</p>`;
  }
  function albumMarkup(link, status) {
    const active = hasActiveJob();
    if (!link) return `<p class="drive-next-step">Bước 1/3: gắn folder ảnh. Sau đó xem trước danh sách và duyệt để nhập ảnh.</p>
      ${status.connection?.status !== 'active' ? '<p class="panel-note">Vào <a href="#settings">Cài đặt → Google Drive</a> để cấu hình và kiểm tra kết nối trước.</p>' : `<p>${status.connection.folder_scope === 'shared' ? 'Dán link folder đã chia sẻ quyền Người xem cho' : 'Folder phải là folder gốc hoặc nằm bên trong nó, và được chia sẻ quyền Người xem cho'} <strong class="drive-service-email">${escape(status.connection.service_account_email)}</strong>.</p>`}
      <form data-drive-form="link">
      <label>Đường dẫn hoặc mã folder ảnh<input name="folder" required placeholder="https://drive.google.com/drive/folders/…"></label>
      <button type="button" class="small-btn" data-browse-drive-folder>Duyệt và chọn folder</button><p>Chỉ nhập ảnh nằm trực tiếp trong folder; không quét folder con. Ảnh gốc giữ trên Drive. Tên bộ ảnh, chú thích, thứ tự và ảnh bìa tiếp tục chỉnh trên web.</p>
      <button class="btn" ${status.enabled && status.connection?.status === 'active' && !active ? '' : 'disabled'}>${active ? 'Đang kiểm tra folder…' : 'Kiểm tra và gắn folder'}</button>
      </form>`;
    const sources = state.info.sources;
    const ready = status.enabled && status.connection?.status === 'active' && link.state === 'attached';
    const needsReview = !link.baseline_preview_id || album.drive_review_required;
    const preview = previewKey(detail?.job);
    return `<p>Folder: <a href="https://drive.google.com/drive/folders/${escape(link.folder_id)}" target="_blank" rel="noopener noreferrer">Mở trên Google Drive</a> · ${link.state === 'paused' ? 'Đang tạm dừng' : 'Đã liên kết'}</p>
      ${!link.baseline_preview_id ? `<p class="drive-next-step">${preview ? 'Bước 3/3: xem danh sách bên dưới, tích xác nhận rồi chọn “Duyệt và đồng bộ” để nhập ảnh.' : 'Bước 2/3: chọn “Xem trước thay đổi” để kiểm tra danh sách ảnh trước khi nhập.'}</p>` : ''}
      ${album.drive_review_required ? '<p class="panel-note">Khách đã gửi lựa chọn. Các thay đổi từ Drive luôn chờ studio duyệt.</p>' : ''}
      <p>Lần đồng bộ thành công: ${date(link.last_success_at)}</p>
      <div class="drive-actions">
        ${button('preview', 'Xem trước thay đổi', !ready || active)}
        ${needsReview ? '' : button('sync', 'Đồng bộ ngay', !ready || active)}
        ${button('pause', link.state === 'paused' ? 'Tiếp tục đồng bộ' : 'Tạm dừng', !status.enabled)}
        ${button('schedule', link.next_run_at ? 'Tắt lịch cho bộ ảnh' : 'Cho phép đồng bộ định kỳ', !status.enabled || !link.next_run_at && (!ready || !link.baseline_preview_id))}
        ${button('unlink', 'Ngắt liên kết folder', !status.enabled)}
      </div>
      <p>${link.next_run_at ? status.scheduler_enabled ? 'Đã cho phép đồng bộ theo lịch của studio.' : 'Đã cho phép lịch cho bộ ảnh; lịch toàn studio vẫn đang tắt.' : 'Bộ ảnh chưa bật đồng bộ định kỳ.'}</p>
      ${sources.length || sourceOffset ? `<details data-drive-sources><summary>Ảnh nguồn · ${Number(state.info.total)} file</summary>
      <ul class="drive-sources">${sources.map(source => `<li><span>${escape(source.source_name || source.drive_file_id)} · ${escape(title(source.state))}</span>${['detached', 'suppressed'].includes(source.state) ? `<button type="button" class="link-btn" data-drive-reimport="${escape(source.drive_file_id)}">Nhập lại thành ảnh Drive mới</button>` : ''}</li>`).join('')}</ul>
      <div class="drive-actions">${button('sources-prev', 'Trang trước', sourceOffset === 0)}${button('sources-next', 'Trang sau', sourceOffset + sources.length >= state.info.total)}</div></details>` : ''}`;
  }
  async function perform(action, operation) {
    if (busy) return;
    const previousPage = {jobId, jobOffset, actionFilter, statusFilter};
    busy = true;
    clearTimeout(timer);
    feedback(readActions.has(action) ? 'Đang cập nhật…' : 'Đang gửi yêu cầu…');
    container.querySelectorAll('.drive-panel button, .drive-panel select').forEach(element => { element.disabled = true; });
    try {
      await refreshing;
      const result = await operation();
      requestKeys.delete(action);
      if (result?.job_id) {
        jobId = result.job_id;
        jobOffset = 0;
        actionFilter = '';
        statusFilter = '';
      }
      if (!readActions.has(action)) await refresh();
      feedback(result?.job_id ? 'Đã ghi nhận yêu cầu. Bạn có thể rời trang; máy chủ tiếp tục xử lý.' : readActions.has(action) ? 'Đã cập nhật trạng thái.' : 'Đã lưu thay đổi.');
    } catch (error) {
      if (readActions.has(action)) ({jobId, jobOffset, actionFilter, statusFilter} = previousPage);
      if (error.status === 401) authenticationRequired = true;
      else if (!readActions.has(action) && (!error.status || error.status === 408 || error.status === 429 || error.status >= 500)) {
        needsRefresh = true;
        if (!refreshFailures) refreshFailed(error);
      }
      markStale(jobId, error.message);
      feedback(message(error.message), true);
    } finally {
      busy = false;
      if (state && container.isConnected) draw();
      else container.querySelectorAll('button').forEach(element => { element.disabled = false; });
      scheduleRefresh();
    }
  }
  container.addEventListener('submit', event => {
    const form = event.target.closest('[data-drive-form]');
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    const fields = new FormData(form);
    const kind = form.dataset.driveForm;
    const folder = kind === 'link' ? folderId(fields.get('folder')) : null;
    const action = kind === 'link' ? 'link-' + folder : kind;
    const body = kind === 'connection' ? {
      service_account_email: fields.get('email').trim(),
      root_folder_id: folderId(fields.get('root')),
      folder_scope: fields.get('folder_scope'),
      enabled: true
    } : {folder_id: folder, request_key: keyFor(action)};
    if (!(kind === 'connection' ? body.root_folder_id : folder)) {
      feedback(errors.drive_invalid_id, true);
      form.querySelector(`[name="${kind === 'connection' ? 'root' : 'folder'}"]`).focus();
      return;
    }
    void perform(action, () => send(kind === 'connection' ? '/api/admin/drive/connection' : base, body, 'PUT'));
  });
  container.addEventListener('click', async event => {
    if (!event.target.closest('[data-browse-drive-folder]') || busy) return;
    const {openDriveFolderBrowser} = await import('./drive-folder-browser.mjs');
    if (disposed || !container.isConnected || !container.querySelector('[data-drive-form=link]')) return;
    closeFolderBrowser?.();
    closeFolderBrowser = openDriveFolderBrowser({initialFolder:container.querySelector('[name=folder]')?.value || state.status.connection?.root_folder_id || '',isAlive:()=>!disposed && container.isConnected && Boolean(container.querySelector('[data-drive-form=link]')),onSelect:folder=>{const field=container.querySelector('[name=folder]');if(field){field.value='https://drive.google.com/drive/folders/'+folder.id;field.focus();feedback('Đã chọn: '+folder.name+'. Nhấn Kiểm tra và gắn folder để tiếp tục.');}}});
  });
  container.addEventListener('change', event => {
    if (event.target.name === 'folder_scope') {
      container.querySelector('[data-root-label]').textContent = event.target.value === 'shared' ? 'Folder bắt đầu mặc định' : 'Đường dẫn hoặc mã folder gốc';
    }
    if (event.target.matches('[data-drive-reviewed]')) {
      reviewedPreview = event.target.checked ? previewKey(detail?.job) : null;
      container.querySelector('[data-drive-action=approve]').disabled = !reviewedPreview || busy || hasActiveJob() || !state.status.enabled || state.info.mapping?.state !== 'attached';
    }
    if (event.target.matches('[data-drive-job]') && !busy) {
      const selected = event.target.value;
      void perform('select-job', () => {
        jobId = selected;
        jobOffset = 0;
        actionFilter = '';
        statusFilter = '';
        return refresh();
      });
    }
    if (event.target.matches('[data-drive-filter]') && !busy) {
      const {driveFilter} = event.target.dataset;
      const value = event.target.value;
      void perform('filter-items', () => {
        if (driveFilter === 'action') actionFilter = value;
        else statusFilter = value;
        jobOffset = 0;
        return refresh();
      });
    }
  });
  container.addEventListener('click', event => {
    const target = event.target.closest('[data-drive-action],[data-drive-reimport],[data-drive-compare]');
    if (!target || target.disabled || busy) return;
    event.preventDefault();
    const action = target.dataset.driveAction;
    if (target.dataset.driveCompare) {
      const item = detail?.items.find(item => item.id === target.dataset.driveCompare);
      if (item?.action === 'replace' && previewKey(detail.job)) openComparison(item);
      return;
    }
    if (target.dataset.driveReimport) {
      if (!window.confirm('Nhập lại tạo một ảnh Drive mới. Bản đã chuyển sang quản lý tay vẫn giữ nguyên. Tiếp tục?')) return;
      const fileId = target.dataset.driveReimport;
      void perform('reimport-' + fileId, () => send(base + '/reimport', {
        file_id: fileId, request_key: keyFor('reimport-' + fileId)
      }));
      return;
    }
    if (action === 'unlink' && !window.confirm('Ngắt folder khỏi bộ ảnh? Ảnh hiện có trên web được giữ nguyên.')) return;
    if (action === 'approve' && !container.querySelector('[data-drive-reviewed]')?.checked) return;
    const actions = {
      'reload-album': onChanged,
      refresh: () => refresh(),
      check: () => send('/api/admin/drive/check', {request_key: keyFor('check')}),
      preview: () => send(base + '/preview', {request_key: keyFor('preview')}),
      'fresh-preview': () => send(base + '/preview', {request_key: keyFor('fresh-preview')}),
      'retry-failed': () => send('/api/admin/drive/jobs/' + jobId + '/retry', {request_key: keyFor('retry-failed-' + jobId)}),
      sync: () => send(base + '/sync', {request_key: keyFor('sync')}),
      approve: () => send(base + '/approve', {preview_id: jobId, request_key: keyFor('approve-' + jobId)}),
      cancel: () => send('/api/admin/drive/jobs/' + jobId + '/cancel', {}),
      pause: () => send(base + '/pause', {paused: state.info.mapping.state !== 'paused'}),
      schedule: () => send(base + '/schedule', {enabled: !state.info.mapping.next_run_at}),
      unlink: () => api(base, {method: 'DELETE'}),
      'items-prev': () => { jobOffset = Math.max(0, jobOffset - 50); return refresh(); },
      'items-next': () => { jobOffset += 50; return refresh(); },
      'sources-prev': () => { sourceOffset = Math.max(0, sourceOffset - 50); return refresh(); },
      'sources-next': () => { sourceOffset += 50; return refresh(); }
    };
    if (actions[action]) void perform(['approve', 'retry-failed'].includes(action) ? action + '-' + jobId : action, actions[action]);
  });
  container.innerHTML = '<section class="panel drive-panel"><h2>Google Drive</h2><p role="status">Đang tải trạng thái…</p></section>';
  refresh().catch(error => {
    if (container.isConnected) {
      container.innerHTML = `<section class="panel drive-panel"><h2>Google Drive</h2><p data-drive-feedback role="alert">${escape(message(error.message))}</p>${button('refresh', 'Thử lại')}</section>`;
    }
  });
}

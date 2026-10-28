const CRITERIA = [
  { key: 'overall', label: 'Trải nghiệm chung', hint: 'Cảm nhận tổng thể của bạn khi làm việc cùng studio.' },
  { key: 'shoot', label: 'Trải nghiệm buổi chụp', hint: 'Sự thoải mái, cách hướng dẫn và tương tác trong buổi chụp.' },
  { key: 'product', label: 'Sản phẩm nhận được', hint: 'Cảm xúc, chất lượng và mức độ phù hợp với mong đợi của bạn.' },
  { key: 'delivery', label: 'Quá trình bàn giao', hint: 'Thời gian, cách nhận sản phẩm và hỗ trợ khi bàn giao.' },
];
const LEVELS = ['Chưa đánh giá', 'Rất không hài lòng', 'Chưa hài lòng', 'Bình thường', 'Hài lòng', 'Rất hài lòng'];
const UNAVAILABLE = 'Đường dẫn này hiện không dùng được. Bạn nhắn Chí Công để kiểm tra hoặc nhận lại đường dẫn nhé.';
const UNKNOWN_SAVE = 'Chưa xác nhận được lần gửi trước đã lưu. Bạn kiểm tra lại lần gửi đó nhé; phần sửa thêm vẫn được giữ riêng trong trang và chưa được gửi.';
const CONFLICT = 'Đã có một cập nhật mới từ đường dẫn này. Phần bạn đang viết vẫn được giữ. Bạn xem bản mới nhất trước khi tiếp tục nhé.';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const clone = value => JSON.parse(JSON.stringify(value));

export function readFeedbackContext(location) {
  const match = /^\/feedback\/([^/]+)\/?$/i.exec(location.pathname);
  try {
    const id = match ? decodeURIComponent(match[1]) : '';
    const fragment = location.hash.slice(1);
    const token = decodeURIComponent(fragment.startsWith('token=') ? fragment.slice(6) : fragment);
    return id && token && token.length <= 4096 && !/[\s\x00-\x1f]/.test(token) ? { id, token } : null;
  } catch { return null; }
}

export function feedbackDraft(snapshot) {
  const latest = snapshot?.latestFeedback;
  return {
    name: latest?.name ?? snapshot?.handover?.clientName ?? '',
    message: latest?.message ?? '', improvement: latest?.improvement ?? '',
    ratings: Object.fromEntries(CRITERIA.map(({ key }) => [key, latest?.ratings?.[key] ?? null])),
  };
}

export function draftFingerprint(draft) {
  return JSON.stringify([draft.name, draft.message, draft.improvement, ...CRITERIA.map(({ key }) => draft.ratings[key] ?? null)]);
}

export function validateFeedback(draft, limits = {}) {
  const fields = {};
  for (const [key, max] of Object.entries({ name: 150, message: 3000, improvement: 1500 })) {
    const value = draft[key] || '';
    const limit = limits[key] || max;
    if (value.length > limit) fields[key] = `Nội dung vượt quá ${limit.toLocaleString('vi-VN')} ký tự. Bạn rút gọn một chút nhé.`;
  }
  if (!draft.name.trim()) fields.name = 'Bạn điền tên muốn dùng nhé.';
  if (!draft.message.trim()) fields.message = 'Bạn viết lời cảm nhận trước khi gửi nhé.';
  return fields;
}

export function makeFeedbackRequest(draft, snapshot, requestKey) {
  const payload = {
    ...clone(draft), formVersion: snapshot.schema.formVersion, requestKey,
    expectedVersion: Number(snapshot.latestVersion || 0),
  };
  if (!payload.expectedVersion) payload.expectedContextVersion = snapshot.contextVersion;
  Object.freeze(payload.ratings);
  return Object.freeze(payload);
}

export function mountFeedbackPage(root, browser = window) {
  let context = readFeedbackContext(browser.location);
  let epoch = 0;
  let generation = 0;
  let accessRevision = 0;
  let readController;
  let disposed = false;
  let state;
  const sameContext = (a, b) => a?.id === b?.id && a?.token === b?.token;
  const reset = () => {
    state = { snapshot: null, draft: null, baseline: '', mode: 'edit', access: 'checking', notice: '', fields: {}, pending: null, saving: false, review: null, reviewed: false, success: '', transition: null, editVersion: 0, editContext: null, editFormVersion: null };
  };
  reset();
  const dirty = () => Boolean(state.draft && draftFingerprint(state.draft) !== state.baseline);
  const mustKeep = () => dirty() || Boolean(state.pending);
  const criteria = () => CRITERIA.map(item => ({ ...item, ...(state.snapshot?.schema?.criteria?.find(candidate => candidate.key === item.key) || {}) }));
  const formatDate = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
  };
  const formatTime = value => {
    const date = new Date(value);
    return !value || Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
  };
  const safeContact = (value, protocols) => {
    try { const url = new URL(value); return protocols.includes(url.protocol) ? url.href : ''; } catch { return ''; }
  };
  const contactMarkup = () => {
    const contact = state.snapshot?.contact;
    if (!contact) return '<p class="feedback-contact">Cần hỗ trợ? Bạn nhắn Chí Công qua kênh đã trao đổi với studio nhé.</p>';
    const links = [];
    const zalo = safeContact(contact.zalo, ['https:']);
    const facebook = safeContact(contact.facebook, ['https:']);
    if (zalo) links.push(`<a href="${escape(zalo)}" target="_blank" rel="noopener noreferrer">Nhắn Chí Công qua Zalo ↗</a>`);
    if (facebook) links.push(`<a href="${escape(facebook)}" target="_blank" rel="noopener noreferrer">Facebook ↗</a>`);
    if (contact.phone && /^[+\d ().-]+$/.test(contact.phone)) links.push(`<a href="tel:${escape(contact.phone.replace(/[^+\d]/g, ''))}">Gọi Chí Công</a>`);
    if (contact.email && /^[^\s@?&#]+@[^\s@?&#]+$/.test(contact.email)) links.push(`<a href="mailto:${escape(contact.email)}">Email studio</a>`);
    return `<div class="feedback-contact">${links.join('<span aria-hidden="true"> · </span>') || 'Bạn nhắn Chí Công qua kênh đã trao đổi với studio nhé.'}</div>`;
  };
  const copyText = draft => [draft.name, draft.message, draft.improvement, ...CRITERIA.map(({ key, label }) => `${label}: ${LEVELS[draft.ratings[key] || 0]}`)].filter(Boolean).join('\n\n');
  const draftRecovery = () => state.draft && mustKeep() ? '<p class="feedback-note">Phần đang viết vẫn được giữ trong trang này.</p><button type="button" class="feedback-secondary" data-action="copy">Sao chép phần đang viết</button><details class="feedback-recovery"><summary>Xem phần đang viết của bạn</summary><textarea aria-label="Nội dung đang viết để sao chép" readonly>' + escape(copyText(state.draft)) + '</textarea></details>' : '';
  const savedMarkup = () => {
    const latest = state.snapshot?.latestFeedback;
    if (!latest) return '<p>Chưa có cảm nhận được lưu.</p>';
    const savedCriteria = Array.isArray(latest.criteria) ? latest.criteria : Array.isArray(latest.schema?.criteria) ? latest.schema.criteria : criteria();
    return `<article class="feedback-saved"><p class="feedback-eyebrow">CẢM NHẬN MỚI NHẤT</p><h2>Cảm nhận bạn đã gửi</h2><p class="feedback-note">Cập nhật gần nhất: ${escape(formatTime(latest.savedAt))}</p><h3>${escape(latest.name)}</h3><p class="feedback-prose">${escape(latest.message)}</p>${latest.improvement ? `<h3>Điều Chí Công có thể làm tốt hơn</h3><p class="feedback-prose">${escape(latest.improvement)}</p>` : ''}<dl class="feedback-saved-ratings">${savedCriteria.map(({ key, label }) => `<div><dt>${escape(label)}</dt><dd>${latest.ratings?.[key] ? `${latest.ratings[key]}/5 · ${escape(LEVELS[latest.ratings[key]])}` : 'Chưa đánh giá'}</dd></div>`).join('')}</dl><p class="feedback-note">Hai người giữ cùng đường dẫn dùng chung bản cảm nhận này.</p></article>`;
  };
  const fieldMarkup = (key, label, hint, placeholder, rows) => {
    const limit = state.snapshot.schema.limits?.[key] || ({ name: 150, message: 3000, improvement: 1500 })[key];
    const error = state.fields[key];
    const attributes = `id="feedback-${key}" name="${key}" aria-describedby="feedback-${key}-hint feedback-${key}-count${error ? ` feedback-${key}-error` : ''}" ${error ? 'aria-invalid="true"' : ''} ${key !== 'improvement' ? 'required' : ''}`;
    return `<div class="feedback-field"><label for="feedback-${key}">${label}</label><p class="feedback-hint" id="feedback-${key}-hint">${hint}</p>${rows ? `<textarea ${attributes} rows="${rows}" placeholder="${escape(placeholder)}">${escape(state.draft[key])}</textarea>` : `<input ${attributes} type="text" autocomplete="name" value="${escape(state.draft[key])}">`}<div class="feedback-field-meta"><span id="feedback-${key}-error" class="feedback-field-error">${escape(error || '')}</span><span id="feedback-${key}-count">${state.draft[key].length.toLocaleString('vi-VN')} / ${limit.toLocaleString('vi-VN')}</span></div></div>`;
  };
  const ratingMarkup = () => `<section class="feedback-ratings" aria-labelledby="feedback-ratings-title"><h2 id="feedback-ratings-title">Một vài đánh giá thêm</h2><p class="feedback-hint">Phần này không bắt buộc. Bạn có thể đánh giá những mục mình muốn chia sẻ và bỏ qua mục không phù hợp.</p>${criteria().map(({ key, label, hint }) => `<fieldset class="feedback-rating"><legend>${escape(label)}</legend><p class="feedback-hint">${escape(hint)}</p><div class="feedback-stars">${[1, 2, 3, 4, 5].map(value => `<label class="feedback-star ${state.draft.ratings[key] >= value ? 'is-selected' : ''}"><input type="radio" name="rating-${key}" value="${value}" ${state.draft.ratings[key] === value ? 'checked' : ''} aria-label="${escape(label)}: ${value} sao — ${LEVELS[value]}"><span aria-hidden="true">★</span></label>`).join('')}</div><div class="feedback-rating-caption"><span id="feedback-rating-${key}" aria-live="polite">${LEVELS[state.draft.ratings[key] || 0]}</span><button type="button" data-clear="${key}" ${state.draft.ratings[key] ? '' : 'hidden'}>Bỏ đánh giá</button></div></fieldset>`).join('')}</section>`;
  const formMarkup = () => `<form class="feedback-form" novalidate>${fieldMarkup('name', 'Tên bạn muốn dùng <span aria-hidden="true">*</span>', 'Bạn có thể dùng tên riêng hoặc tên hai người.', '', 0)}${fieldMarkup('message', 'Cảm nhận của bạn <span aria-hidden="true">*</span>', 'Bạn cứ viết theo cách của mình.', 'Bạn cảm thấy thế nào về buổi chụp và sản phẩm đã nhận? Có điều gì bạn muốn kể với Chí Công?', 6)}${ratingMarkup()}${fieldMarkup('improvement', 'Điều Chí Công có thể làm tốt hơn', 'Không bắt buộc.', 'Nếu có điều chưa như mong đợi hoặc cần thay đổi, bạn chia sẻ thêm ở đây nhé.', 4)}<div class="feedback-disclosure"><p>Bạn có thể quay lại xem hoặc cập nhật khi hồ sơ đang mở nhận cảm nhận.</p><p>Studio lưu các lần bạn gửi hoặc cập nhật để theo dõi đầy đủ góp ý. Trang này hiển thị nội dung mới nhất.</p><p>Nội dung chưa gửi chỉ được giữ trong trang đang mở.</p></div><div class="feedback-actions"><button class="feedback-primary" type="submit" ${state.saving || state.pending || state.review ? 'disabled' : ''}>${state.saving ? state.snapshot.latestVersion ? 'Đang lưu…' : 'Đang gửi…' : state.snapshot.latestVersion ? 'Lưu cập nhật' : 'Gửi cảm nhận'}</button>${state.snapshot.latestVersion && !state.pending ? '<button class="feedback-secondary" type="button" data-action="cancel">Hủy chỉnh sửa</button>' : ''}</div></form>`;
  const noticeMarkup = () => state.notice ? `<div class="feedback-notice" role="status"><p>${escape(state.notice)}</p>${state.pending && !state.saving ? '<button class="feedback-secondary" type="button" data-action="retry-save">Kiểm tra lần gửi trước</button>' : ''}${state.review && !state.pending ? `<button class="feedback-secondary" type="button" data-action="review">${state.review === 'form' ? 'Tải mẫu mới' : state.review === 'context' ? 'Xem thông tin mới' : 'Xem bản mới nhất'}</button>` : ''}</div>` : '';
  const contextMarkup = handover => `<section class="feedback-context" aria-label="Thông tin buổi chụp"><dl>${[
    ['Khách hàng', handover.clientName], ['Buổi chụp / đơn', handover.title], ['Dịch vụ', handover.service],
    ['Ngày chụp', formatDate(handover.shootDate)], ['Ngày bàn giao', formatDate(handover.deliveredOn)],
  ].map(([label,value]) => `<div><dt>${label}</dt><dd>${escape(value || 'Chưa ghi thông tin')}</dd></div>`).join('')}</dl></section>`;
  function render() {
    if (disposed) return;
    let body;
    if (state.transition) {
      body = `<section class="feedback-state"><h1>Đường dẫn đã thay đổi</h1><p>Phần đang viết thuộc đường dẫn trước. Bạn có thể sao chép trước khi mở đường dẫn mới.</p>${draftRecovery()}<button class="feedback-primary" type="button" data-action="change-context">Mở đường dẫn mới</button></section>`;
    } else if (state.access !== 'active') {
      const checking = state.access === 'checking';
      body = `<section class="feedback-state" aria-busy="${checking}"><p class="feedback-eyebrow">CẢM NHẬN CỦA BẠN</p><h1>${checking ? 'Đang kiểm tra lại đường dẫn…' : state.access === 'unavailable' ? 'Đường dẫn hiện không dùng được' : 'Chưa kết nối được với studio'}</h1><p role="status">${escape(checking ? 'Bạn chờ một chút nhé.' : state.notice || UNAVAILABLE)}</p>${!checking ? '<button class="feedback-primary" type="button" data-action="reload">Thử lại</button>' : ''}${draftRecovery()}</section>`;
    } else {
      const handover = state.snapshot.handover;
      const intro = `<div class="feedback-intro"><p class="feedback-eyebrow">CẢM NHẬN CỦA BẠN</p><h1>Kể Chí Công nghe về trải nghiệm của bạn</h1><p>Cảm ơn bạn đã tin tưởng Chí Công. Sau khi nhận sản phẩm, nếu có điều ưng ý hoặc chưa như mong đợi, bạn cứ chia sẻ ở đây nhé. Chí Công sẽ đọc để hiểu trải nghiệm của bạn và làm tốt hơn.</p>${contextMarkup(handover)}<p class="feedback-private"><span aria-hidden="true">♡</span> Chia sẻ này chỉ gửi riêng cho Chí Công và studio, không hiển thị công khai trên website.</p></div>`;
      if (state.mode === 'success') body = `<section class="feedback-state"><p class="feedback-eyebrow">CHÍ CÔNG ĐÃ NHẬN ĐƯỢC</p><h1>${state.success === 'first' ? 'Cảm ơn bạn đã chia sẻ' : 'Đã lưu cập nhật của bạn'}</h1><p>${state.success === 'first' ? 'Cảm nhận của bạn đã được lưu trong hồ sơ của studio. Chí Công cảm ơn bạn đã dành thời gian kể lại trải nghiệm của mình.' : 'Bản cập nhật đã được lưu trong hồ sơ. Cảm ơn bạn đã chia sẻ thêm để Chí Công hiểu rõ hơn trải nghiệm của bạn.'}</p><p>Bạn có thể quay lại xem hoặc bổ sung khi hồ sơ đang mở nhận cảm nhận.</p><button class="feedback-primary" type="button" data-action="view">Xem cảm nhận mới nhất</button></section>`;
      else if (state.mode === 'view') body = `${intro}${noticeMarkup()}${savedMarkup()}<button class="feedback-primary" type="button" data-action="edit">Chỉnh sửa cảm nhận</button>`;
      else if (state.mode === 'review') body = `${intro}${noticeMarkup()}${savedMarkup()}${draftRecovery()}<p class="feedback-note">Phần đang viết được giữ riêng. Sau khi xem thông tin mới, bạn có thể quay lại và chủ động gửi.</p><button class="feedback-primary" type="button" data-action="accept-review">Quay lại phần đang viết</button>`;
      else body = `${intro}${noticeMarkup()}${formMarkup()}`;
    }
    root.innerHTML = `<div class="feedback-page"><button class="feedback-skip" type="button" data-action="skip">Đến nội dung chính</button><header class="feedback-header"><span class="feedback-brand">CHÍ CÔNG<span>PHOTOGRAPHY</span></span><span class="feedback-header-note">Một lời chia sẻ, nhiều ý nghĩa.</span></header><main class="feedback-main" id="feedback-content" tabindex="-1">${body}</main><footer class="feedback-footer"><span class="feedback-footer-brand">Chí Công · Photography</span>${contactMarkup()}<p>Cảm ơn bạn đã dành thời gian.</p></footer></div>`;
  }
  async function request(method, payload, signal) {
    const current = context;
    const response = await browser.fetch(`/api/feedback/${encodeURIComponent(current.id)}`, {
      method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
      headers: { Authorization: `Bearer ${current.token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    let data;
    try { data = await response.json(); } catch { throw Object.assign(new Error('Invalid response'), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error('Feedback request failed'), { status: response.status, data });
    if (!data?.handover || !data?.schema || !Number.isInteger(data.latestVersion) || (method === 'PUT' && !Number.isInteger(data.acknowledgedVersion))) throw new Error('Incomplete feedback response');
    return data;
  }
  const isUnavailable = error => [401, 403, 404, 410].includes(error.status);
  function clearServerData() { state.snapshot = null; if (!mustKeep()) state.draft = null; }
  async function revalidate({ review = false } = {}) {
    if (state.transition || disposed) return;
    readController?.abort();
    const thisEpoch = epoch;
    const thisGeneration = ++generation;
    ++accessRevision;
    if (!context) { state.access = 'unavailable'; state.notice = UNAVAILABLE; clearServerData(); render(); return; }
    const previous = state.snapshot;
    state.access = 'checking';
    render();
    const controller = new AbortController();
    readController = controller;
    const timeout = browser.setTimeout(() => controller.abort(), 20000);
    try {
      const snapshot = await request('GET', null, controller.signal);
      if (disposed || thisEpoch !== epoch || thisGeneration !== generation) return;
      if (previous && snapshot.latestVersion < previous.latestVersion) throw new Error('Outdated snapshot');
      state.access = 'active';
      state.snapshot = snapshot;
      if (!state.draft) {
        state.draft = feedbackDraft(snapshot);
        state.baseline = draftFingerprint(state.draft);
        state.mode = snapshot.latestVersion ? 'view' : 'edit';
        state.editVersion = snapshot.latestVersion; state.editContext = snapshot.contextVersion; state.editFormVersion = snapshot.schema.formVersion;
      } else if (review) {
        state.mode = 'review'; state.reviewed = true;
      } else if (!state.pending && dirty() && (snapshot.latestVersion > state.editVersion || (!snapshot.latestVersion && snapshot.contextVersion !== state.editContext) || snapshot.schema.formVersion !== state.editFormVersion)) {
        state.review = snapshot.latestVersion > state.editVersion ? 'version' : snapshot.schema.formVersion !== state.editFormVersion ? 'form' : 'context';
        state.notice = state.review === 'version' ? CONFLICT : state.review === 'form' ? 'Biểu mẫu đã được cập nhật. Phần bạn đang viết vẫn được giữ; bạn tải mẫu mới và kiểm tra lại trước khi gửi nhé.' : 'Thông tin buổi chụp vừa được studio cập nhật. Phần bạn đang viết vẫn được giữ; bạn xem lại thông tin trước khi gửi nhé.';
      } else if (!dirty() && !state.pending && state.mode !== 'success') {
        state.draft = feedbackDraft(snapshot); state.baseline = draftFingerprint(state.draft);
        state.editVersion = snapshot.latestVersion; state.editContext = snapshot.contextVersion; state.editFormVersion = snapshot.schema.formVersion;
      }
      if (state.pending) state.notice = UNKNOWN_SAVE;
      else if (!state.review && state.mode !== 'success' && state.notice.startsWith('Chưa kiểm tra')) state.notice = '';
      render();
    } catch (error) {
      if (disposed || thisEpoch !== epoch || thisGeneration !== generation) return;
      state.access = isUnavailable(error) ? 'unavailable' : 'offline';
      state.notice = isUnavailable(error) ? UNAVAILABLE : error.status === 503 ? 'Studio đang tạm gián đoạn kết nối. Phần đang viết vẫn được giữ; bạn thử lại sau nhé.' : 'Chưa kiểm tra lại được đường dẫn. Nội dung đang viết vẫn được giữ; bạn thử lại khi có kết nối nhé.';
      if (isUnavailable(error)) clearServerData();
      render();
    } finally { browser.clearTimeout(timeout); }
  }
  async function save(retry = false) {
    if (state.access !== 'active' || state.saving || state.transition || (state.review && !retry)) return;
    if (!retry) {
      if (state.pending) return;
      state.fields = validateFeedback(state.draft, state.snapshot.schema.limits);
      if (Object.keys(state.fields).length) { render(); root.querySelector('[aria-invalid="true"]')?.focus(); return; }
      const requestKey = browser.crypto.randomUUID();
      state.pending = { payload: makeFeedbackRequest(state.draft, state.snapshot, requestKey), fingerprint: draftFingerprint(state.draft) };
    }
    const pending = state.pending;
    if (!pending) return;
    const thisEpoch = epoch;
    const thisAccess = accessRevision;
    state.saving = true; state.notice = ''; render();
    const controller = new AbortController();
    const timeout = browser.setTimeout(() => controller.abort(), 25000);
    try {
      const snapshot = await request('PUT', pending.payload, controller.signal);
      if (disposed || thisEpoch !== epoch) return;
      const moreEdits = draftFingerprint(state.draft) !== pending.fingerprint;
      const newer = snapshot.latestVersion > snapshot.acknowledgedVersion;
      state.pending = null; state.saving = false;
      if (!newer) state.editVersion = snapshot.acknowledgedVersion;
      // A save ACK reconciles its request even when a newer permission check is pending.
      // Its snapshot must never restore access after that newer check.
      if (thisAccess !== accessRevision || state.access !== 'active') {
        state.notice = 'Lần gửi trước đã được máy chủ xác nhận. Đang kiểm tra lại đường dẫn.';
        if (!moreEdits && !newer) { state.baseline = draftFingerprint(state.draft); state.success = pending.payload.expectedVersion === 0 ? 'first' : 'updated'; state.mode = snapshot.changed === false ? 'view' : 'success'; }
        await revalidate();
        return;
      }
      ++generation; readController?.abort();
      if (snapshot.latestVersion < state.snapshot.latestVersion) { await revalidate(); return; }
      state.snapshot = snapshot;
      if (moreEdits || newer) {
        state.mode = 'edit';
        state.notice = newer ? 'Lần gửi trước đã được lưu. Hiện hồ sơ có một bản cập nhật mới hơn.' : 'Lần gửi trước đã được lưu. Phần bạn viết thêm chưa được gửi; bạn kiểm tra rồi chủ động lưu cập nhật nhé.';
        if (newer) state.review = 'version';
      } else {
        state.draft = feedbackDraft(snapshot); state.baseline = draftFingerprint(state.draft);
        state.success = pending.payload.expectedVersion === 0 ? 'first' : 'updated';
        state.mode = snapshot.changed === false ? 'view' : 'success';
        state.notice = snapshot.changed === false ? 'Nội dung vẫn như lần gửi gần nhất.' : '';
      }
      render();
    } catch (error) {
      if (disposed || thisEpoch !== epoch) return;
      state.saving = false;
      if (isUnavailable(error)) {
        ++generation; ++accessRevision; readController?.abort();
        state.access = 'unavailable'; state.notice = UNAVAILABLE; clearServerData();
      } else if (error.status === 422) {
        state.pending = null; state.fields = error.data?.fields || {};
        state.notice = 'Bạn kiểm tra lại các phần được đánh dấu trước khi gửi nhé.';
      } else if (error.status === 409) {
        state.pending = null;
        const code = error.data?.code;
        state.review = code === 'CONTEXT_CHANGED' ? 'context' : code === 'FORM_VERSION_UNSUPPORTED' ? 'form' : 'version';
        state.notice = code === 'CONTEXT_CHANGED' ? 'Thông tin buổi chụp vừa được studio cập nhật. Phần bạn đang viết vẫn được giữ; bạn xem lại thông tin trước khi gửi nhé.' : code === 'FORM_VERSION_UNSUPPORTED' ? 'Biểu mẫu đã được cập nhật. Phần bạn đang viết vẫn được giữ; bạn tải mẫu mới và kiểm tra lại trước khi gửi nhé.' : ['REQUEST_KEY_REUSED', 'REQUEST_KEY_CONFLICT'].includes(code) ? 'Mã của lần gửi không khớp nội dung. Phần đang viết vẫn được giữ; bạn kiểm tra bản mới nhất trước khi gửi lại nhé.' : CONFLICT;
      } else if (error.status === 429) {
        state.notice = 'Bạn đã thử gửi nhiều lần trong thời gian ngắn. Vui lòng đợi một chút rồi kiểm tra lần gửi trước.';
      } else state.notice = error.status === 503 ? 'Studio đang tạm gián đoạn kết nối. ' + UNKNOWN_SAVE : UNKNOWN_SAVE;
      render();
      root.querySelector('[aria-invalid="true"]')?.focus();
    } finally { browser.clearTimeout(timeout); }
  }
  function updateRating(key, value) {
    state.draft.ratings[key] = value;
    const fieldset = root.querySelector(`[name="rating-${key}"]`)?.closest('fieldset');
    if (!fieldset) return;
    fieldset.querySelectorAll('input').forEach(input => { input.checked = Number(input.value) === value; input.closest('label').classList.toggle('is-selected', Number(input.value) <= value); });
    fieldset.querySelector(`#feedback-rating-${key}`).textContent = LEVELS[value || 0];
    fieldset.querySelector('[data-clear]').hidden = !value;
  }
  const inputHandler = event => {
    const target = event.target;
    if (!state.draft || state.access !== 'active') return;
    if (['name', 'message', 'improvement'].includes(target.name)) {
      state.draft[target.name] = target.value;
      const limit = state.snapshot.schema.limits?.[target.name] || { name: 150, message: 3000, improvement: 1500 }[target.name];
      root.querySelector(`#feedback-${target.name}-count`).textContent = `${target.value.length.toLocaleString('vi-VN')} / ${limit.toLocaleString('vi-VN')}`;
      if (state.fields[target.name]) { delete state.fields[target.name]; target.removeAttribute('aria-invalid'); root.querySelector(`#feedback-${target.name}-error`).textContent = ''; }
    } else if (target.name?.startsWith('rating-')) updateRating(target.name.slice(7), Number(target.value));
  };
  const submitHandler = event => { event.preventDefault(); event.stopPropagation(); void save(); };
  const clickHandler = async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.clear && state.access === 'active') { updateRating(button.dataset.clear, null); root.querySelector(`[name="rating-${button.dataset.clear}"]`)?.focus(); return; }
    const action = button.dataset.action;
    if (action === 'skip') root.querySelector('main')?.focus();
    else if (action === 'reload') await revalidate();
    else if (action === 'retry-save') await save(true);
    else if (action === 'review') await revalidate({ review: true });
    else if (action === 'accept-review') { state.review = null; state.reviewed = false; state.editVersion = state.snapshot.latestVersion; state.editContext = state.snapshot.contextVersion; state.editFormVersion = state.snapshot.schema.formVersion; state.mode = 'edit'; state.notice = ''; render(); root.querySelector('input')?.focus(); }
    else if (action === 'view') { state.mode = 'view'; render(); }
    else if (action === 'edit') { state.mode = 'edit'; state.editVersion = state.snapshot.latestVersion; state.editContext = state.snapshot.contextVersion; state.editFormVersion = state.snapshot.schema.formVersion; state.draft = feedbackDraft(state.snapshot); state.baseline = draftFingerprint(state.draft); state.notice = ''; render(); root.querySelector('input')?.focus(); }
    else if (action === 'cancel') {
      if (dirty() && !browser.confirm('Bỏ phần chưa gửi? Phần chỉnh sửa này chưa được lưu. Cảm nhận đã gửi trước đó vẫn giữ nguyên.')) return;
      state.draft = feedbackDraft(state.snapshot); state.baseline = draftFingerprint(state.draft); state.mode = 'view'; state.notice = ''; state.review = null; state.fields = {}; render();
    } else if (action === 'copy') {
      try { await browser.navigator.clipboard.writeText(copyText(state.draft)); button.textContent = 'Đã sao chép phần đang viết'; }
      catch { const details = root.querySelector('.feedback-recovery'); if (details) { details.open = true; details.querySelector('textarea')?.select(); } }
    } else if (action === 'change-context') { context = state.transition.context; reset(); await revalidate(); }
  };
  const changeContext = () => {
    const next = readFeedbackContext(browser.location);
    if (sameContext(next, context) && !state.transition) return;
    ++epoch; ++generation; ++accessRevision; readController?.abort();
    if (mustKeep()) { state.transition = { context: next }; state.snapshot = null; state.saving = false; render(); }
    else { context = next; reset(); void revalidate(); }
  };
  const resume = () => { if (!state.transition && browser.document.visibilityState !== 'hidden') void revalidate(); };
  const visibility = () => {
    if (browser.document.visibilityState === 'hidden') {
      ++generation; ++accessRevision; readController?.abort(); state.access = 'checking'; render();
    } else resume();
  };
  const unload = event => { if (mustKeep()) { event.preventDefault(); event.returnValue = ''; } };
  root.addEventListener('input', inputHandler);
  root.addEventListener('submit', submitHandler);
  root.addEventListener('click', clickHandler);
  browser.addEventListener('hashchange', changeContext);
  browser.addEventListener('popstate', changeContext);
  browser.addEventListener('pageshow', resume);
  browser.addEventListener('online', resume);
  browser.addEventListener('beforeunload', unload);
  browser.document.addEventListener('visibilitychange', visibility);
  void revalidate();
  return () => {
    disposed = true; ++epoch; readController?.abort();
    root.removeEventListener('input', inputHandler); root.removeEventListener('submit', submitHandler); root.removeEventListener('click', clickHandler);
    browser.removeEventListener('hashchange', changeContext); browser.removeEventListener('popstate', changeContext);
    browser.removeEventListener('pageshow', resume); browser.removeEventListener('online', resume); browser.removeEventListener('beforeunload', unload);
    browser.document.removeEventListener('visibilitychange', visibility);
    root.replaceChildren();
  };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) mountFeedbackPage(root);
}

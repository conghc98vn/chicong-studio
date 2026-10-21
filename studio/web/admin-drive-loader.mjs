// Public pages and the login form do not need the Drive administration UI.
// Share module loads across navigation. Optional Drive styling must not block
// inquiries, calendar or the rest of admin when its request fails or stalls.
let pending;
let stylesheet;
let styleAttempt = 0;
function loadStyles() {
  if (stylesheet) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // A removed link can leave its request pending in the browser. Give retries
  // a distinct URL so they do not join the same stalled network request.
  link.href = '/app/drive-sync.css' + (styleAttempt ? '?retry=' + styleAttempt : '');
  styleAttempt++;
  const retryLater = () => {
    clearTimeout(timer);
    link.remove();
    if (stylesheet === link) stylesheet = undefined;
  };
  const timer = setTimeout(retryLater, 10000);
  link.onload = () => clearTimeout(timer);
  link.onerror = retryLater;
  stylesheet = link;
  document.head.append(link);
}
export function loadAdminDrive() {
  loadStyles();
  if (pending) return pending;
  pending = Promise.all([
    import('./drive-album-entry.mjs'),
    import('./drive-album-status.mjs'),
    import('./drive-panel.mjs')
  ]).then(([entry, status, panel]) => ({...entry, ...status, ...panel})).catch(error => {
    pending = undefined;
    throw error;
  });
  return pending;
}

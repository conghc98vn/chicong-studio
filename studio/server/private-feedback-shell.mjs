// Feedback has its own document: no gallery bootstrap, analytics or customer
// metadata is included in HTML, including malformed/case-variant URLs.
export const feedbackPrivateHeaders = {
 'Cache-Control': 'private, no-store',
 'Referrer-Policy': 'no-referrer',
 'X-Robots-Tag': 'noindex, nofollow, noarchive',
 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

export function isFeedbackPath(pathname) {
 try { pathname = decodeURIComponent(pathname); } catch { /* retain safe raw path */ }
 return /^\/(?:feedback|api\/feedback|api\/admin\/handovers)(?:\/|$)/i.test(pathname);
}

export function privateFeedbackHeaders(req, res, next) {
 if (isFeedbackPath(req.path)) res.set(feedbackPrivateHeaders);
 next();
}

export const feedbackShell = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cảm nhận gửi Chí Công · ChiCong Studio</title>
<meta name="description" content="Chia sẻ riêng với Chí Công về trải nghiệm của bạn.">
<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#faf8f5"><meta property="og:title" content="Cảm nhận gửi Chí Công">
<meta property="og:description" content="Chia sẻ riêng với Chí Công về trải nghiệm của bạn.">
<link rel="icon" type="image/svg+xml" href="/app/favicon.svg">
<link rel="stylesheet" href="/app/fonts/fonts.css"><link rel="stylesheet" href="/app/feedback.css">
<script type="module" src="/app/feedback-page.mjs"></script></head>
<body><div id="root"><main id="main" tabindex="-1"><p role="status">Đang mở trang cảm nhận…</p></main></div>
<noscript>Vui lòng bật JavaScript để mở trang cảm nhận riêng của bạn.</noscript></body></html>`;

export function registerFeedbackShell(app) {
 app.use((req, res, next) => {
  let pathname=req.path;try{pathname=decodeURIComponent(pathname);}catch{}
  if(!['GET','HEAD'].includes(req.method)||!/^\/feedback(?:\/|$)/i.test(pathname))return next();
  res.set(feedbackPrivateHeaders).type('html').send(feedbackShell);
 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFeedbackContext, feedbackDraft, draftFingerprint, validateFeedback, makeFeedbackRequest, mountFeedbackPage } from '../web/feedback-page.mjs';

const snapshot = (latestVersion = 0) => ({ handover: { id: 'one', clientName: 'Tên khách', title: 'Buổi chụp riêng' }, contextVersion: 1, schema: { formVersion: 1, limits: { name: 150, message: 3000, improvement: 1500 } }, latestVersion, latestFeedback: latestVersion ? { name: 'Tên đã gửi', message: 'Cảm nhận riêng', improvement: '', ratings: { overall: 4 }, version: latestVersion } : null });
test('fragment context handles encoded tokens without reading query values', () => {
  assert.deepEqual(readFeedbackContext({ pathname: '/feedback/one/', hash: '#token=abc.def' }), { id: 'one', token: 'abc.def' });
  assert.equal(readFeedbackContext({ pathname: '/feedback/one', hash: '#%E0%A4%A' }), null);
  assert.equal(readFeedbackContext({ pathname: '/feedback/one', hash: '' }), null);
  assert.equal(readFeedbackContext({ pathname: '/feedback/one', hash: '#bad%0Atoken' }), null);
});
test('empty ratings stay nullable and do not infer a score from overall', () => {
  assert.deepEqual(feedbackDraft(snapshot()).ratings, { overall: null, shoot: null, product: null, delivery: null });
  assert.deepEqual(feedbackDraft(snapshot(1)).ratings, { overall: 4, shoot: null, product: null, delivery: null });
});
test('first-save payload is immutable across subsequent edits and carries context version', () => {
  const draft = feedbackDraft(snapshot());
  draft.message = 'Lần gửi trước';
  const pending = makeFeedbackRequest(draft, snapshot(), 'request-one');
  draft.message = 'Phần vừa viết thêm'; draft.ratings.overall = 5;
  assert.equal(pending.message, 'Lần gửi trước'); assert.equal(pending.ratings.overall, null);
  assert.equal(pending.expectedContextVersion, 1); assert.equal(pending.expectedVersion, 0);
  assert.throws(() => { pending.ratings.overall = 3; }, TypeError);
  assert.equal('expectedContextVersion' in makeFeedbackRequest(draft, snapshot(2), 'request-two'), false);
});
test('validation requires actual name and message and respects the current schema limits', () => {
  const draft = feedbackDraft(snapshot()); draft.name = '  '; draft.message = '\n  ';
  assert.deepEqual(Object.keys(validateFeedback(draft)), ['name', 'message']);
  draft.name = 'Bạn'; draft.message = '1234';
  assert.ok(validateFeedback(draft, { message: 3 }).message);
  assert.deepEqual(validateFeedback(draft), {});
  assert.notEqual(draftFingerprint(draft), draftFingerprint({ ...draft, ratings: { ...draft.ratings, product: 5 } }));
});

function harness() {
  const listeners = new Map(); const documentListeners = new Map(); const rootListeners = new Map(); const requests = [];
  const root = { innerHTML: '', addEventListener: (key, fn) => rootListeners.set(key, fn), removeEventListener() {}, querySelector: () => null, replaceChildren() {} };
  const browser = {
    location: { pathname: '/feedback/one', hash: '#one-token' },
    document: { visibilityState: 'visible', addEventListener: (key, fn) => documentListeners.set(key, fn), removeEventListener() {} },
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener() {}, setTimeout, clearTimeout,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  };
  const dispose = mountFeedbackPage(root, browser);
  const settle = async (index, data, status = 200) => {
    requests[index].resolve({ ok: status === 200, status, json: async () => data });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { root, browser, requests, listeners, documentListeners, rootListeners, dispose, settle };
}
test('old context responses cannot reveal content after the fragment changes', async () => {
  const h = harness();
  h.browser.location.hash = '#new-token'; h.listeners.get('hashchange')();
  assert.equal(h.requests.length, 2);
  await h.settle(1, { code: 'LINK_UNAVAILABLE' }, 403);
  await h.settle(0, snapshot(1));
  assert.match(h.root.innerHTML, /Đường dẫn hiện không dùng được/);
  assert.doesNotMatch(h.root.innerHTML, /Cảm nhận riêng|Buổi chụp riêng/);
  assert.equal(h.requests[1].options.headers.Authorization, 'Bearer new-token');
  h.dispose();
});
test('a later permission denial wins over an older active GET in the same context', async () => {
  const h = harness();
  h.listeners.get('online')();
  await h.settle(1, { code: 'LINK_UNAVAILABLE' }, 403);
  await h.settle(0, snapshot(1));
  assert.doesNotMatch(h.root.innerHTML, /Cảm nhận riêng|Buổi chụp riêng/);
  assert.match(h.root.innerHTML, /Đường dẫn hiện không dùng được/);
  h.dispose();
});
test('page restoration conceals server content until the fresh permission check succeeds', async () => {
  const h = harness(); await h.settle(0, snapshot(1));
  assert.match(h.root.innerHTML, /Cảm nhận riêng/);
  h.listeners.get('pageshow')();
  assert.doesNotMatch(h.root.innerHTML, /Cảm nhận riêng|Buổi chụp riêng/);
  await h.settle(1, snapshot(1)); assert.match(h.root.innerHTML, /Cảm nhận riêng/);
  h.dispose();
});

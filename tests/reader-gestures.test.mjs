// Exercise the actual modules and the top-frame bridge. Layout is the only jsdom stub;
// tools/browser QA uses Chromium touch input to cover hit testing and pointer capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { decorate, initGestures, resetGestures } from '../web/read/gestures.mjs';
import { closePopover } from '../web/read/popover.mjs';

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const rect = (top = 240, bottom = 280, left = 20, right = 320) =>
  ({ top, bottom, left, right, width: right - left, height: bottom - top });

function fixture(t, { storage = {}, text = null } = {}) {
  const dom = new JSDOM('<button id="shell">Shell</button><iframe id="reader"></iframe>', {
    url: 'https://localhost/', pretendToBeVisual: true,
  });
  const outer = dom.window, w = outer.document.getElementById('reader').contentWindow;
  w.document.body.innerHTML = `<header id="header">Article title</header><div id="readerView">
    <article id="article"><div class="para"><p>Birds fly. Rain falls.</p></div>
    <div class="para"><p>While the rain fell, the children stayed inside and read their books.</p></div></article>
    </div><button id="blank">Blank</button>`;
  const article = w.document.getElementById('article');
  if (text) article.querySelector('p').textContent = text;
  for (const [key, value] of Object.entries(storage)) outer.localStorage.setItem(key, value);
  w.Element.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  w.Element.prototype.getBoundingClientRect = function () { return rect(); };
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 300 });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 120 });
  Object.assign(globalThis, { window: w, document: w.document, localStorage: outer.localStorage,
    CustomEvent: w.CustomEvent, getComputedStyle: outer.getComputedStyle.bind(outer), IntersectionObserver: undefined });

  const state = { mode: 'ok', calls: [], cancelled: [], pending: [], toasts: [], tabs: [], errors: [] };
  const answer = (kind, text) => kind === 'translate' ? { translation: '鸟会飞。' }
    : { analysis: { schemaVersion: 2, segments: [{ type: 'pred', label: '主干', text }] } };
  const request = (kind, payload) => {
    state.calls.push({ kind, ...payload });
    if (state.mode === 'fail') return Promise.reject(new Error('当前网络不可用'));
    if (state.mode === 'cancel') return Promise.reject(Object.assign(new Error('请求已取消'), { code: 'CANCELLED' }));
    if (state.mode === 'quota') return Promise.reject(Object.assign(new Error('扇贝额度已用完；尚未配置回退 API'), {
      code: 'FALLBACK_UNAVAILABLE', data: { quotaResetAt: '2026-11-12 00:00:00' },
    }));
    if (state.mode === 'hold') return new Promise(resolve => state.pending.push(() => resolve(answer(kind, payload.text))));
    return Promise.resolve(answer(kind, payload.text));
  };
  outer.hwfeeToast = (message, options) => state.toasts.push({ message, ...options });
  outer.hwfeeShowTab = name => state.tabs.push(name);
  outer.Capacitor = { Plugins: {
    Llm: { translate: payload => request('translate', payload), analyze: payload => request('analyze', payload),
      cancelSentence: async ({ requestId }) => { state.cancelled.push(requestId); } },
    Shanbay: { request: async ({ path }) => ({ body: JSON.stringify(path.startsWith('/abc/words/senses')
      ? { id: 'fixture-word', definitions: { cn: [{ pos: 'n.', def: '测试词义' }] } }
      : path.startsWith('/wordscollection/words_check')
        ? { objects: [{ vocab_id: 'fixture-word', exists: false }] } : {}) }) },
  } };
  // These calls must never hit the iframe's injected bridge (which hangs in a real app).
  w.Capacitor = { Plugins: { Llm: { translate() { assert.fail('iframe bridge used'); } } } };
  w.addEventListener('error', e => state.errors.push(e.error || e.message));
  w.addEventListener('unhandledrejection', e => state.errors.push(e.reason));
  decorate(article);
  initGestures(article);
  const event = (node, type, init = {}) => {
    const view = node.ownerDocument.defaultView;
    const e = new view.MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
      clientX: 60, clientY: 250, detail: type === 'click' ? 1 : 0, ...init });
    Object.defineProperties(e, {
      pointerId: { value: init.pointerId ?? 1 }, pointerType: { value: 'touch' },
      isPrimary: { value: init.isPrimary ?? true },
    });
    node.dispatchEvent(e);
    return e;
  };
  const tap = (node, init) => { event(node, 'pointerdown', init); event(node, 'pointerup', init); event(node, 'click', init); };
  const advance = async ms => { t.mock.timers.tick(ms); await flush(); };
  const f = { dom, w, outer, article, state, event, tap, advance,
    card: () => w.document.querySelector('.popover'),
    word: () => article.querySelector('.w'),
    sentence: () => article.querySelector('.sent'),
    blank: w.document.getElementById('blank'),
    async hold(node = article.querySelector('.w')) {
      event(node, 'pointerdown'); await advance(520);
      event(node, 'pointerup'); event(node, 'click'); await flush();
    },
    async close() {
      resetGestures(article); closePopover(); await flush();
      assert.deepEqual(state.errors, [], 'no uncaught exceptions');
      dom.window.close();
    },
  };
  return f;
}

async function check(t, run, options) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fixture(t, options);
  try { await run(f); } finally { await f.close(); }
}

const singleCard = f => assert.equal(f.w.document.querySelectorAll('.popover').length, 1);
const noCard = f => {
  assert.equal(f.card(), null);
  assert.equal(f.article.querySelectorAll('.is-anchor').length, 0, 'no orphan highlights');
};

test('word taps and long-press release clicks open exactly one card; every outside surface dismisses', t => check(t, async f => {
  f.tap(f.word()); await flush(); singleCard(f);
  f.tap(f.blank); noCard(f);
  for (const outside of [f.blank, f.w.document.getElementById('header'), f.article.querySelector('.para'),
    f.article.querySelectorAll('.w')[2], f.outer.document.getElementById('shell')]) {
    await f.hold(); singleCard(f);
    assert.match(f.card().textContent, /鸟会飞/);
    const calls = f.state.calls.length;
    f.tap(outside); await flush(); noCard(f);
    assert.equal(f.state.calls.length, calls, 'a dismissal must not request another sentence');
  }
}));

test('click-only accessibility activation dismisses inside or outside the iframe; another word dismisses first', t => check(t, async f => {
  for (const outside of [f.blank, f.w.document.getElementById('header'), f.outer.document.getElementById('shell')]) {
    await f.hold(); outside.click(); noCard(f);
  }
  f.word().click(); await flush(); singleCard(f);
  const other = f.article.querySelectorAll('.w')[2];
  other.click(); noCard(f);
  other.click(); await flush(); singleCard(f);
  assert.match(f.card().textContent, /Rain/);
}));

test('a retargeted dismissal and a cancelled dismissal never reopen or swallow the next fresh tap', t => check(t, async f => {
  const words = f.article.querySelectorAll('.w');
  f.tap(words[0]); await flush();
  f.event(words[1], 'pointerdown'); f.event(words[2], 'pointerup'); f.event(words[2], 'click');
  noCard(f);
  f.tap(words[2]); await flush(); singleCard(f);
  f.event(words[1], 'pointerdown'); f.event(words[1], 'pointercancel');
  f.tap(words[2]); await flush(); singleCard(f);
  assert.match(f.card().textContent, /Rain/);
}));

test('120 rapid taps followed by another long press leave no orphan cards or stuck gesture', t => check(t, async f => {
  const words = f.article.querySelectorAll('.w');
  for (let i = 0; i < 120; i++) {
    f.tap(words[i % words.length]);
    assert.ok(f.w.document.querySelectorAll('.popover').length <= 1);
  }
  f.tap(f.blank); await flush(); noCard(f);
  await f.hold(); singleCard(f);
  assert.match(f.card().textContent, /鸟会飞/);
}));

test('small finger drift is allowed; a drag cancels both long press and accidental word lookup', t => check(t, async f => {
  f.event(f.word(), 'pointerdown');
  for (const dx of [2, -3, 5]) f.event(f.word(), 'pointermove', { clientX: 60 + dx });
  await f.advance(520); singleCard(f);
  f.event(f.word(), 'pointerup'); f.event(f.word(), 'click'); singleCard(f);
  f.tap(f.blank);
  f.event(f.word(), 'pointerdown');
  f.event(f.word(), 'pointermove', { clientX: 80 });
  await f.advance(600); f.event(f.word(), 'pointerup'); f.event(f.word(), 'click'); noCard(f);
  await f.hold(); singleCard(f);
}));

test('release outside the article and pointercancel clear the timer; an unrelated pointerup does not', t => check(t, async f => {
  for (const type of ['pointerup', 'pointercancel']) {
    f.event(f.word(), 'pointerdown'); await f.advance(100);
    f.event(f.blank, type); await f.advance(600); noCard(f);
  }
  f.event(f.word(), 'pointerdown'); f.event(f.blank, 'pointerup', { pointerId: 2 });
  await f.advance(520); singleCard(f);
  f.event(f.word(), 'pointerup'); f.event(f.word(), 'click'); singleCard(f);
}));

test('a second finger, including outside the iframe, cancels the hold without disabling later holds', t => check(t, async f => {
  for (const second of [f.word(), f.blank, f.outer.document.getElementById('shell')]) {
    f.event(f.word(), 'pointerdown'); await f.advance(100);
    f.event(second, 'pointerdown', { pointerId: 2, isPrimary: false });
    await f.advance(600); noCard(f);
    f.event(second, 'pointerup', { pointerId: 2, isPrimary: false });
    f.event(f.word(), 'pointerup');
    await f.hold(); singleCard(f); f.tap(f.blank);
  }
}));

test('nested scrolling, leaving the page and visibility loss cancel a pending hold', t => check(t, async f => {
  for (const cancel of [
    () => f.article.dispatchEvent(new f.w.Event('scroll')),
    () => f.w.dispatchEvent(new f.w.Event('blur')),
    () => f.w.dispatchEvent(new f.w.Event('pagehide')),
    () => resetGestures(),
  ]) {
    f.event(f.word(), 'pointerdown'); await f.advance(100); cancel();
    await f.advance(600); noCard(f);
  }
  f.event(f.word(), 'pointerdown');
  Object.defineProperty(f.w.document, 'hidden', { configurable: true, value: true });
  f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));
  await f.advance(600); noCard(f);
  Object.defineProperty(f.w.document, 'hidden', { configurable: true, value: false });
  await f.hold(); singleCard(f);
}));

test('article replacement and disconnected or hidden sentences cannot resurrect an old hold', t => check(t, async f => {
  f.event(f.word(), 'pointerdown');
  decorate(f.article); await f.advance(600); noCard(f);
  await f.hold(); singleCard(f);
  decorate(f.article); noCard(f);
  f.event(f.word(), 'pointerdown'); f.sentence().remove();
  await f.advance(600); noCard(f);
  f.event(f.word(), 'pointerdown'); f.w.document.getElementById('readerView').hidden = true;
  await f.advance(600); noCard(f);
  f.w.document.getElementById('readerView').hidden = false;
  await f.hold(); singleCard(f);
}));

test('network failure explains recovery; repeated clicks on the same retry make only one new request', t => check(t, async f => {
  f.state.mode = 'fail'; await f.hold(); singleCard(f);
  assert.match(f.card().textContent, /翻译失败：当前网络不可用/);
  assert.match(f.card().textContent, /卡片内重试.*卡片外收起/);
  assert.equal(f.card().querySelector('[aria-busy]'), null);
  const retry = f.card().querySelector('.pop-btn');
  f.state.mode = 'hold';
  for (let i = 0; i < 30; i++) retry.click();
  assert.equal(f.state.calls.length, 2);
  assert.match(f.card().textContent, /正在翻译.*取消等待/s);
  f.state.pending.splice(0).forEach(resolve => resolve()); await flush();
  assert.match(f.card().textContent, /鸟会飞/);
  f.tap(f.blank); f.state.mode = 'ok'; await f.hold(); singleCard(f);
}));

test('CANCELLED while the card is open shows a working retry, never a permanent skeleton', t => check(t, async f => {
  f.state.mode = 'cancel'; await f.hold(); singleCard(f);
  assert.match(f.card().textContent, /请求已中断，请重试/);
  assert.equal(f.card().querySelector('[aria-busy]'), null);
  f.state.mode = 'ok'; f.card().querySelector('.pop-btn').click(); await flush();
  assert.match(f.card().textContent, /鸟会飞/);
}));

test('quota failure includes its reset time and Settings action; closing it never blocks another hold', t => check(t, async f => {
  f.state.mode = 'quota'; await f.hold();
  assert.match(f.card().textContent, /扇贝额度已用完/);
  assert.match(f.card().textContent, /额度恢复时间：2026-11-12 00:00:00/);
  const settings = f.card().querySelector('.pop-link');
  settings.click(); noCard(f);
  assert.deepEqual(f.state.tabs, ['settings']);
  f.state.mode = 'ok'; await f.hold(); singleCard(f);
  settings.click(); singleCard(f);
  assert.deepEqual(f.state.tabs, ['settings'], 'a queued click from an old card cannot navigate again');
}));

test('slow and timed-out requests give feedback, cancel their subscriptions and allow retry', t => check(t, async f => {
  f.state.mode = 'hold'; await f.hold();
  assert.match(f.card().textContent, /正在翻译句子/);
  await f.advance(8000);
  assert.match(f.card().textContent, /仍在等待结果，可收起后重试/);
  assert.equal(f.state.calls.length, 1, 'waiting never automatically repeats a billable call');
  await f.advance(172000);
  assert.match(f.card().textContent, /超时/);
  assert.equal(f.state.cancelled.length, 1);
  assert.equal(f.card().querySelector('[aria-busy]'), null);
  f.state.mode = 'ok'; f.card().querySelector('.pop-btn').click(); await flush();
  assert.match(f.card().textContent, /鸟会飞/);
}));

test('rapid tab switching shares requests; closing cancels both and late answers cannot replace a new card', t => check(t, async f => {
  f.state.mode = 'hold'; const long = f.article.querySelectorAll('.sent')[2].querySelector('.w');
  await f.hold(long);
  const tabs = f.card().querySelectorAll('.pop-seg-btn');
  for (let i = 0; i < 60; i++) tabs[i % 2].click();
  assert.equal(f.state.calls.length, 2, 'one request per tab');
  f.tap(f.blank); noCard(f);
  assert.equal(new Set(f.state.cancelled).size, 2);
  f.state.mode = 'ok'; await f.hold(); singleCard(f);
  const latest = f.card();
  f.state.pending.splice(0).forEach(resolve => resolve()); await flush();
  assert.equal(f.card(), latest);
  assert.match(f.card().textContent, /鸟会飞/);
  assert.equal(f.card().querySelector('.ana-flow'), null);
}));

test('a missing bridge is visible and retry works after reconnecting', t => check(t, async f => {
  const api = f.outer.Capacitor.Plugins.Llm; delete f.outer.Capacitor.Plugins.Llm;
  await f.hold(); assert.match(f.card().textContent, /请更新 App/);
  assert.equal(f.card().querySelector('[aria-busy]'), null);
  f.outer.Capacitor.Plugins.Llm = api; f.card().querySelector('.pop-btn').click(); await flush();
  assert.match(f.card().textContent, /鸟会飞/);
}));

test('a full reload with persisted preparation failure still permits manual sentence requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const first = fixture(t, { storage: { 'hwfee:pretranslation-failure': JSON.stringify({ id: 'old', detail: '额度已用完' }) } });
  first.state.mode = 'fail'; await first.hold();
  const saved = Object.fromEntries(Object.entries(first.outer.localStorage));
  await first.close();
  const second = fixture(t, { storage: saved });
  try { await second.hold(); assert.match(second.card().textContent, /鸟会飞/); }
  finally { await second.close(); }
});

test('long selections give an actionable size hint instead of a silent no-op', t => check(t, async f => {
  await f.hold(); noCard(f);
  assert.equal(f.state.calls.length, 0);
  assert.match(f.state.toasts[0].message, /上限 300 词/);
  assert.match(f.state.toasts[0].detail, /缩小选择范围/);
}, { text: Array.from({ length: 301 }, () => 'word').join(' ') + '.' }));

test('a sentence filling the viewport explains both scrolling and reducing the font size', t => check(t, async f => {
  const sent = f.sentence();
  sent.getBoundingClientRect = () => rect(60, 760);
  await f.hold(); noCard(f);
  assert.equal(f.state.calls.length, 0);
  assert.match(f.state.toasts[0].message, /屏幕放不下/);
  assert.match(f.state.toasts[0].detail, /滚动或缩小字号/);
}));

test('an omitted release-click cannot swallow a later activation, even after an extended hold', t => check(t, async f => {
  f.event(f.word(), 'pointerdown'); await f.advance(520); singleCard(f);
  await f.advance(5000);
  f.event(f.word(), 'pointerup'); f.event(f.word(), 'click'); singleCard(f);
  f.tap(f.blank);
  f.event(f.word(), 'pointerdown'); await f.advance(520);
  f.event(f.word(), 'pointerup'); // Android may omit the following click after a long hold.
  await f.advance(1300);
  f.word().click(); noCard(f);
  await f.hold(); singleCard(f);
}));

test('a copied dataset marker does not prevent binding real gesture listeners', t => check(t, async f => {
  const next = f.article.cloneNode(true); f.article.replaceWith(next);
  assert.equal(next.dataset.gestures, '1');
  initGestures(next); initGestures(next);
  await f.hold(next.querySelector('.w')); singleCard(f);
  assert.equal(f.state.calls.length, 1, 'listeners bind exactly once');
  resetGestures(next);
}));

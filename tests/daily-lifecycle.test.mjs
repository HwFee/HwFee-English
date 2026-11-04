import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../web/read/index.html', import.meta.url), 'utf8');
const script = (await readFile(new URL('../web/read/app.js', import.meta.url), 'utf8')).replace(/^import .+;\r?$/gm, '');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function fixture({ sessionFails = false, saved = null, pendingState = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://localhost/read/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  let now = Date.parse('2026-11-03T12:00:00+08:00');
  let calls = 0, sessions = 0;
  const preparations = [];
  const notices = [];
  let failure = null, offline = false, vocabFailure = null;
  let counts = null;
  const RealDate = w.Date;
  w.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const date = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  Object.assign(w, {
    matchMedia: () => ({ matches: false }), scrollTo() {}, hydrateIcons() {}, initGestures() {}, decorate() {},
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    loadHighlightVocab: async () => { if (vocabFailure) throw new Error(vocabFailure); },
    feedback: (message, options) => { notices.push({ message, ...options }); },
    refreshVocabCounts: async () => {}, vocabCounts: () => counts,
    articleLegendCounts: () => ({}), cachedArticles: () => [], cachedArticle: () => null,
    cachedState: () => saved,
    backfillArticleCovers: async () => false, closePopover() {}, openPopover() {},
    getProgress: () => null, lastArticleDate: () => null, setReading() {}, setProgress() {}, markRead() {}, markUnread() {},
    describe: () => ({ label: '待读' }), icon: () => w.document.createElement('span'),
    hasSession: async () => { sessions++; if (sessionFails) throw new Error('offline'); return true; },
    loadState: async () => {
      calls++;
      if (pendingState) return new Promise(() => {});
      if (failure) throw new Error(failure);
      return { today: { date: date(), status: { a_count: 1, a_finished_count: 0, c_count: 0, c_finished_count: 0 } },
        article: { date: date(), title: 'Daily article', subtitle: '每日文章', paragraphs: ['Birds fly.'] }, offline,
        offlineReason: offline ? '网络请求超时' : undefined };
    },
    prepareTranslation: async (article) => { preparations.push(article.date); },
  });
  w.eval(script);
  return { dom, w, preparations, notices, calls: () => calls, sessions: () => sessions,
    fail(message) { failure = message; }, offline(value) { offline = value; }, failVocab(message) { vocabFailure = message; },
    tomorrow() { now += 86400000; }, restoreSession() { sessionFails = false; },
    setCounts(value) { counts = value; w.document.dispatchEvent(new w.CustomEvent('hwfee:vocab')); } };
}

test('only changed totals transition and stat nodes survive refreshes', async () => {
  const f = fixture();
  const animations = [];
  f.w.HTMLElement.prototype.animate = function(frames, options) { animations.push({ node: this, frames, options }); };
  try {
    await settle();
    f.setCounts({ wordbook: 364, learned: 79 });
    const tiles = [...f.w.document.querySelectorAll('#stats .stat')];
    const wordbook = tiles[2].querySelector('.v');
    assert.equal(wordbook.textContent, '364词');
    animations.length = 0;
    f.setCounts({ wordbook: 364, learned: 79 });
    assert.equal(animations.length, 0, 'rechecking the same totals causes no flashing');
    f.setCounts({ wordbook: 365, learned: 79 });
    assert.equal(tiles[2].querySelector('.v'), wordbook);
    assert.deepEqual([...f.w.document.querySelectorAll('#stats .stat')], tiles);
    assert.equal(wordbook.textContent, '365词');
    assert.equal(animations.length, 1);
    assert.equal(animations[0].node, wordbook);
    f.w.matchMedia = () => ({ matches: true });
    f.setCounts({ wordbook: 366, learned: 79 });
    assert.equal(animations.length, 1, 'reduced motion updates without animation');
  } finally { f.dom.window.close(); }
});

test('startup prepares today before reading; repeated foreground events reuse that day and a new day loads once', async () => {
  const f = fixture();
  try {
    await settle();
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.preparations, ['2026-11-03']);
    await Promise.all([f.w.hwfeePrepareDaily(), f.w.hwfeePrepareDaily()]);
    assert.equal(f.calls(), 1, 'same-day resume must not refetch the article');
    f.tomorrow();
    f.w.dispatchEvent(new f.w.Event('focus'));
    await Promise.all([f.w.hwfeePrepareDaily(), f.w.hwfeePrepareDaily()]);
    await settle();
    assert.equal(f.calls(), 2, 'all new-day triggers must share one fetch');
    assert.ok(f.preparations.includes('2026-11-04'));
  } finally { f.dom.window.close(); }
});

test('a saved article renders and prepares before the startup network request resolves', async () => {
  const f = fixture({ pendingState: true, saved: {
    today: { date: '2026-11-03', status: { a_count: 45, a_finished_count: 3 }, book: 'CET4' },
    article: { date: '2026-11-03', title: 'Saved today', subtitle: '本地文章', paragraphs: ['Saved text.'] },
  } });
  try {
    await settle();
    assert.equal(f.calls(), 1, 'the study records still synchronize in the background');
    assert.match(f.w.document.getElementById('heroSlot').textContent, /Saved today/);
    assert.deepEqual(f.preparations, ['2026-11-03']);
    assert.doesNotMatch(f.w.document.getElementById('heroSlot').textContent, /正在读取/);
  } finally { f.dom.window.close(); }
});

test('returning to the app recovers when the initial session check had no network', async () => {
  const f = fixture({ sessionFails: true });
  try {
    await settle();
    assert.equal(f.calls(), 0);
    f.restoreSession();
    await f.w.hwfeePrepareDaily();
    await settle();
    assert.equal(f.sessions(), 2);
    assert.equal(f.calls(), 1);
    assert.ok(f.preparations.includes('2026-11-03'));
  } finally { f.dom.window.close(); }
});

test('manual refresh reports success, partial failures, offline fallback and errors using the shared feedback', async () => {
  const f = fixture();
  try {
    await settle();
    await Promise.all([f.w.hwfeeRefreshRead(), f.w.hwfeeRefreshRead()]);
    assert.equal(f.calls(), 2, 'a repeated refresh tap must not duplicate network work');
    assert.equal(f.notices.at(-1).kind, 'success');
    assert.match(f.notices.at(-1).message, /已刷新/);
    f.failVocab('词表接口超时');
    await f.w.hwfeeRefreshRead();
    assert.match(f.notices.at(-1).message, /词表同步失败/);
    assert.match(f.notices.at(-1).detail, /词表接口超时/);
    f.offline(true);
    await f.w.hwfeeRefreshRead();
    assert.match(f.notices.at(-1).message, /离线缓存/);
    assert.match(f.notices.at(-1).detail, /网络请求超时/);
    f.fail('登录已失效');
    await f.w.hwfeeRefreshRead();
    assert.equal(f.notices.at(-1).message, '刷新失败');
    assert.equal(f.notices.at(-1).detail, '登录已失效');
    assert.match(f.w.document.getElementById('heroSlot').textContent, /Daily article/);
    assert.equal(f.w.document.getElementById('refreshBtn').disabled, false);
  } finally { f.dom.window.close(); }
});

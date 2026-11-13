import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = (await readFile(new URL('../web/shell.js', import.meta.url), 'utf8')).replace(/^import .+;\r?$/gm, '');
const savedState = await readFile(new URL('../web/listen/saved-state.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const savedItem = { k: 'cet6-current#4', dir: 'cet6-current', n: 4, a: 30, b: 35, s: 'Saved sentence' };
const lessonRows = [{ id: 'current', dir: '/lessons/current', legacyIds: ['cet6-current'] }];

function fixture({ hang = false, llm } = {}) {
  const dom = new JSDOM(html, { url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document, states = [], waits = [], timers = new Map(), listeners = new Map();
  let timerId = -1;
  let appearance = { mode: 'system', dark: false };
  const timeout = w.setTimeout.bind(w), clear = w.clearTimeout.bind(w);
  w.setTimeout = (fn, ms, ...args) => {
    if (ms === 8000 || ms === 2000) { timers.set(timerId, { fn, ms }); return timerId--; }
    return timeout(fn, ms, ...args);
  };
  w.clearTimeout = id => { if (id < 0) timers.delete(id); else clear(id); };
  w.hydrateIcons = () => {}; w.setIcon = () => {}; w.parseCookie = x => x;
  w.icon = () => doc.createElement('span');
  w.getUsage = args => llm.getUsage(args); w.getDeepSeekBalance = args => llm.getDeepSeekBalance(args);
  w.getShanbayQuota = args => llm.getShanbayQuota(args);
  w.fetch = async () => ({ ok: true, status: 200, text: async () => '<script id="data">' + JSON.stringify({ sentences: [savedItem] }) + '</script>' });
  w.Capacitor = { Plugins: { Llm: llm, TabBar: {
    getMetrics: async () => ({ available: true, reserve: 100, navInset: 20 }),
    addListener: async (name, listener) => { listeners.set(name, listener); return { remove() { listeners.delete(name); } }; },
    setState: state => {
      states.push(state);
      if (hang) return new Promise(() => {});
      if (state.hidden) return new Promise(resolve => waits.push(resolve));
      return Promise.resolve({ settled: true });
    },
  }, Lessons: { consumeShared: async () => ({ imported: [] }), list: async () => ({ data: JSON.stringify({ lessons: lessonRows }) }) } } };
  const library = doc.getElementById('listenFrame');
  library.contentDocument.open();
  library.contentDocument.write('<body><a id="lesson" href="/lessons/current/player.html#seg=1">Lesson</a><img src="https://unreachable.invalid/cover.jpg"></body>');
  library.contentDocument.close();
  Object.defineProperty(library.contentDocument, 'readyState', { configurable: true, get: () => 'interactive' });
  w.eval(savedState); w.eval(script);
  return { dom, w, doc, library, states, listeners,
    open() { library.contentDocument.getElementById('lesson').click(); },
    ready() {
      const player = doc.getElementById('playerFrame');
      player.addEventListener('load', event => event.stopImmediatePropagation(), true);
      player.contentDocument.open(); player.contentDocument.write('<body><audio></audio></body>'); player.contentDocument.close();
      Object.defineProperty(player.contentDocument, 'readyState', { configurable: true, get: () => 'interactive' });
      w.hwfeePlayerReady(player.contentWindow);
    },
    finishChrome() { waits.splice(0).forEach(resolve => resolve({ settled: true })); },
    run(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}

test('navigation inset changes update shell and iframe clearances, including a zero inset', async () => {
  const f = fixture();
  try {
    await settle();
    for (const id of ['playerFrame', 'readFrame']) {
      const doc = f.doc.getElementById(id).contentDocument;
      doc.open(); doc.write('<html><body></body></html>'); doc.close();
    }
    for (const [reserve, navInset] of [[128, 48], [80, 0]]) {
      f.listeners.get('metricsChanged')({ available: true, reserve, navInset });
      for (const doc of [f.doc, f.library.contentDocument,
        f.doc.getElementById('playerFrame').contentDocument, f.doc.getElementById('readFrame').contentDocument]) {
        assert.equal(doc.documentElement.style.getPropertyValue('--island-reserve'), `${reserve}px`);
        assert.equal(doc.documentElement.style.getPropertyValue('--hwfee-nav-inset'), `${navInset}px`);
      }
    }
    f.listeners.get('metricsChanged')({ available: true, reserve: NaN, navInset: Infinity });
    assert.equal(f.doc.documentElement.style.getPropertyValue('--island-reserve'), '80px');
    assert.equal(f.doc.documentElement.style.getPropertyValue('--hwfee-nav-inset'), '0px');
  } finally { f.dom.window.close(); }
});

test('library links and player readiness work while image load is still pending', async () => {
  const f = fixture(); await settle(); f.open();
  const player = f.doc.getElementById('playerFrame');
  assert.equal(player.dataset.src, '/lessons/current/player.html#seg=1');
  assert.equal(f.library.contentWindow.location.pathname, '/listen/library.html');
  f.ready(); await settle();
  assert.equal(player.hidden, true, 'waits for the shared native animation');
  f.finishChrome(); await settle();
  assert.equal(player.hidden, false, 'does not wait for the iframe load/image event');
  f.w.hwfeeClosePlayer();
  assert.equal(f.doc.getElementById('app').classList.contains('is-immersive'), false);
  f.dom.window.close();
});

test('saved clips preserve the course checkpoint and reopening replaces its old native lease', async () => {
  const f = fixture(); await settle(); f.open(); f.ready(); await settle(); f.finishChrome(); await settle();
  const player = f.doc.getElementById('playerFrame'); let flushed = 0, paused = 0;
  player.contentDocument.querySelector('audio').pause = () => { paused++; };
  player.contentWindow.__hwfeeFlushProgress = () => { flushed++; };
  f.w.hwfeeClosePlayer(); f.w.hwfeeBeforeSavedClip();
  assert.equal(paused, 1); assert.equal(flushed, 1); assert.equal(player.dataset.savedClip, '1');
  f.open(); await settle();
  assert.equal(player.dataset.savedClip, undefined);
  assert.equal(player.hidden, true, 'reopens the source through the normal readiness path');
  assert.equal(flushed, 2);
  f.dom.window.close();
});

test('saved sentence transport stays in the library instead of opening another player document', async () => {
  const f = fixture(); await settle();
  let played;
  f.library.contentWindow.__hwfeeSaved = { play: async item => { played = item; } };
  await f.w.hwfeeOpenSavedSentence(savedItem); await settle();
  assert.equal(played, savedItem);
  assert.equal(f.doc.getElementById('playerFrame').dataset.src, undefined);
  assert.equal(f.library.hidden, false);
  f.dom.window.close();
});

test('Android Back closes a visible review panel before leaving the library', async () => {
  const f = fixture(); await settle(); let closed = 0;
  const opening = f.w.hwfeeReviewView(true);
  f.finishChrome(); await opening;
  assert.equal(f.doc.getElementById('app').classList.contains('is-immersive'), true);
  f.library.contentWindow.hwfeeCloseReview = () => {
    closed++; void f.w.hwfeeReviewView(false); return true;
  };
  assert.equal(f.w.hwfeeBack(), true);
  assert.equal(closed, 1); assert.equal(f.library.hidden, false);
  await settle();
  assert.equal(f.doc.getElementById('app').classList.contains('is-immersive'), false);
  f.dom.window.close();
});

test('inline saved playback flushes the normal checkpoint and normal opening reloads its native lease', async () => {
  const f = fixture(); await settle(); f.open(); f.ready(); await settle(); f.finishChrome(); await settle();
  const player = f.doc.getElementById('playerFrame');
  let flushed = 0;
  player.contentDocument.querySelector('audio').pause = () => {};
  player.contentWindow.__hwfeeFlushProgress = () => { flushed++; };
  f.library.contentDocument.body.innerHTML += '<script id="data" type="application/json">{"lessons":[{"id":"current","dir":"/lessons/current"}]}</script>';
  f.w.hwfeeClosePlayer();
  f.library.contentWindow.__hwfeeSaved = { play: async () => f.w.hwfeeBeforeSavedClip(), pause: async () => {} };
  await f.w.hwfeeOpenSavedSentence({ ...savedItem, dir: '/lessons/current' }); await settle();
  assert.equal(flushed, 1, 'normal checkpoint is flushed before entering review');
  assert.equal(player.dataset.savedClip, '1');
  assert.equal(player.dataset.src, '/lessons/current/player.html#seg=1');
  f.open(); await settle();
  assert.equal(player.dataset.review, '0');
  assert.equal(player.dataset.savedClip, undefined);
  assert.match(player.dataset.src, /^\/lessons\/current\/player.html\?resumeCheckpoint=1&resumeAt=\d+#seg=1$/);
  f.dom.window.close();
});

test('reimporting the open course discards its old sentence timeline even with the same URL', async () => {
  const f = fixture(); await settle(); f.open(); f.ready(); await settle(); f.finishChrome(); await settle();
  const player = f.doc.getElementById('playerFrame'); let paused = 0;
  player.contentDocument.querySelector('audio').pause = () => { paused++; };
  f.w.Capacitor.Plugins.Lessons.importZip = async () => ({ imported: ['current'], failed: [] });
  f.doc.getElementById('importBtn').click(); await settle();
  assert.equal(paused, 1);
  assert.equal(player.dataset.src, undefined);
  assert.equal(player.getAttribute('src'), 'about:blank');
  assert.equal(player.hidden, true);
  f.dom.window.close();
});

test('import checks saved sentences once and ordinary library changes only read cached state', async () => {
  const f = fixture(); await settle();
  let reads = 0;
  f.w.fetch = async () => { reads++; return { ok: true, status: 200,
    text: async () => '<script id="data">' + JSON.stringify({ sentences: [savedItem] }) + '</script>' }; };
  const missing = { ...savedItem, k: 'old-missing', s: 'This sentence no longer exists.' };
  f.w.localStorage.setItem('cherina-pod:saved', JSON.stringify([savedItem, missing]));
  f.w.hwfeeSavedChanged(); f.w.hwfeeShowTab('read'); f.w.hwfeeShowTab('listen'); await settle();
  assert.equal(reads, 0);
  f.w.Capacitor.Plugins.Lessons.importZip = async () => ({ imported: ['current'], failed: [] });
  f.doc.getElementById('importBtn').click(); await settle();
  assert.equal(reads, 1);
  assert.equal(JSON.parse(f.w.localStorage.getItem('cherina-pod:saved')).length, 1);
  f.w.hwfeeSavedChanged(); await settle(); assert.equal(reads, 1);
  f.dom.window.close();
});

test('shared imports reconcile saved state, while cancelled or failed imports do not', async () => {
  const f = fixture(); await settle(); let checks = 0;
  f.w.localStorage.setItem('cherina-pod:saved', JSON.stringify([savedItem]));
  f.w.__hwfeeSavedState.reconcile = async () => { checks++; };
  f.w.Capacitor.Plugins.Lessons.importZip = async () => ({ imported: [], failed: ['bad archive'] });
  f.doc.getElementById('importBtn').click(); await settle(); assert.equal(checks, 0);
  f.w.Capacitor.Plugins.Lessons.consumeShared = async () => ({ imported: ['current'], failed: [] });
  f.w.dispatchEvent(new f.w.Event('hwfee:shared')); await settle(); assert.equal(checks, 1);
  f.dom.window.close();
});

test('a failed lesson load restores navigation instead of leaving the library trapped', async () => {
  const f = fixture(); await settle(); f.open(); f.run(8000); await settle();
  assert.equal(f.doc.getElementById('app').classList.contains('is-immersive'), false);
  assert.equal(f.library.hidden, false); assert.equal(f.states.at(-1).hidden, false);
  f.dom.window.close();
});

test('leaving an opening lesson cancels its pending navigation and allows a later reopen', async () => {
  const f = fixture();
  try {
    await settle();
    f.open();
    f.w.hwfeeShowTab('read');
    f.ready(); await settle();
    f.finishChrome(); await settle();
    f.w.hwfeeShowTab('listen');
    assert.equal(f.library.hidden, false);
    assert.equal(f.doc.getElementById('app').classList.contains('is-immersive'), false);
    f.open(); f.finishChrome(); await settle();
    assert.equal(f.doc.getElementById('playerFrame').hidden, false);
  } finally { f.dom.window.close(); }
});

test('shared ZIPs report failed lessons even if some or none of them imported', async () => {
  const f = fixture();
  const toast = f.doc.getElementById('toast');
  try {
    await settle();
    for (const imported of [[], ['current']]) {
      f.w.Capacitor.Plugins.Lessons.consumeShared = async () => ({ imported, failed: ['示例课程缺少句子数据'] });
      f.w.dispatchEvent(new f.w.Event('hwfee:shared')); await settle();
      assert.equal(toast.classList.contains('is-error'), true);
      assert.match(toast.textContent, /示例课程缺少句子数据/);
      if (imported.length) assert.match(toast.textContent, /导入 1 节，1 节失败/);
      else assert.match(toast.textContent, /没有导入成功/);
    }
    const previous = toast.textContent;
    f.w.Capacitor.Plugins.Lessons.consumeShared = async () => ({ imported: [], failed: [] });
    f.w.dispatchEvent(new f.w.Event('hwfee:shared')); await settle();
    assert.equal(toast.textContent, previous, 'launching without a shared file stays silent');
  } finally { f.dom.window.close(); }
});

test('a draft API key, destination and model stay together when returning to Settings', async () => {
  const config = { has: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
  const f = fixture({ llm: { getConfig: async () => config } });
  try {
    f.w.hwfeeShowTab('settings'); await settle();
    const draft = { llmKey: 'test-draft', llmBase: 'https://example.invalid/v1', llmModel: 'my-model' };
    f.doc.querySelector('#llmModelList [data-id=""]').click();
    for (const [id, value] of Object.entries(draft)) {
      const field = f.doc.getElementById(id);
      field.value = value;
      field.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    }
    f.w.hwfeeShowTab('read'); f.w.hwfeeShowTab('settings'); await settle();
    for (const [id, value] of Object.entries(draft)) assert.equal(f.doc.getElementById(id).value, value, id);
    assert.equal(f.doc.getElementById('llmManualField').hidden, false);
  } finally { f.dom.window.close(); }
});

test('a missing native animation reply falls back to working web navigation', async () => {
  const f = fixture({ hang: true }); await settle(); f.open(); f.ready(); f.run(2000); await settle();
  assert.equal(f.doc.documentElement.classList.contains('hwfee-native-chrome'), false);
  assert.equal(f.doc.querySelector('.tabs').hidden, false);
  assert.equal(f.doc.getElementById('playerFrame').hidden, false);
  f.w.hwfeeClosePlayer();
  assert.equal(f.doc.getElementById('app').classList.contains('is-immersive'), false);
  f.dom.window.close();
});

test('repeated playback state packets preserve the existing play icon DOM', async () => {
  const f = fixture(); await settle(); f.open(); f.ready(); await settle(); f.finishChrome(); await settle();
  const link = f.library.contentDocument.getElementById('lesson');
  link.innerHTML = '<span class="go"></span>';
  f.w.hwfeePlayerState({ dir: 'current', playing: false });
  const glyph = link.querySelector('.go svg');
  assert.ok(glyph);
  for (let i = 0; i < 30; i++) f.w.hwfeePlayerState({ dir: 'current', playing: false });
  assert.equal(link.querySelector('.go svg'), glyph);
  f.dom.window.close();
});

test('import progress stays visible and a background pretranslation failure waits for the operation result', async () => {
  const f = fixture(); await settle();
  const timers = [];
  f.w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 10000 + timers.length; };
  f.w.hwfeeToast('正在导入课程', { kind: 'progress' });
  assert.equal(timers.length, 0, 'long imports must not lose their progress prompt after 60 seconds');
  f.w.hwfeePretranslationStatus('预译失败', { error: '账户余额不足', notify: true });
  assert.match(f.doc.getElementById('toast').textContent, /正在导入课程/);
  f.w.hwfeeToast('已导入 39 节课', { kind: 'success' });
  timers.find(timer => timer.ms === 2600).fn();
  timers.find(timer => timer.ms === 220).fn();
  assert.match(f.doc.getElementById('toast').textContent, /文章预加载未完成/);
  assert.match(f.doc.getElementById('toast').textContent, /账户余额不足/);
  f.dom.window.close();
});

test('usage display keeps exact monetary strings and only input, output and cache details', async () => {
  const f = fixture({ llm: {
    getUsage: async () => ({ shanbay: { connected: true, remainingPercent: 76, usageAt: Date.now() },
      llm: { configured: true, stats: { totalTokens: 1035, inputTokens: 510, outputTokens: 525, cachedInputTokens: 30, requests: 4, missingUsageRequests: 2 } } }),
    getDeepSeekBalance: async () => ({ isAvailable: true, observedAt: Date.now(), balanceInfos: [
      { currency: 'CNY', totalBalance: '1234567890.123456789012345678', grantedBalance: '0.00', toppedUpBalance: '1234567890.123456789012345678' },
    ] }),
  } });
  try {
    f.doc.getElementById('usageRefresh').click(); await settle();
    assert.match(f.doc.getElementById('usageBalanceVal').textContent, /1234567890\.123456789012345678/);
    assert.equal(f.doc.getElementById('usageTokensComp').textContent, '输入 510 · 输出 525 · 缓存 30');
    assert.equal(f.doc.getElementById('usageStamp'), null);
    assert.equal(f.doc.getElementById('usageQuotaTime').hidden, false);
    assert.match(f.doc.getElementById('usageQuotaTime').textContent, /^\d{2}:\d{2} 更新$/);
    assert.equal(f.doc.getElementById('usageBalanceTime'), null, 'V3 keeps the balance column to one detail line');
    assert.deepEqual([...f.doc.querySelectorAll('#usageFoot .usage-stat')].map(x => x.textContent), ['4请求', '0缓存', '0预译', '0分析']);
    assert.ok(f.doc.getElementById('usageFoot').compareDocumentPosition(f.doc.getElementById('usageQuotaFill')) & f.w.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.doesNotMatch(f.doc.getElementById('usageQuotaVal').textContent, /观测/);
    assert.doesNotMatch(f.doc.getElementById('usageTokensComp').textContent, /次请求/);
    assert.doesNotMatch(f.doc.getElementById('usageQuotaVal').textContent, /每日重置/);
  } finally { f.dom.window.close(); }
});

test('quota refresh replaces a stale zero and shows failures without advancing the observation time', async () => {
  let calls = 0, fail = false;
  const observed = Date.now();
  const f = fixture({ llm: {
    getUsage: async () => ({ shanbay: { connected: true, remainingPercent: calls ? 100 : 0, usageAt: observed } }),
    getDeepSeekBalance: async () => ({}),
    getShanbayQuota: async options => {
      assert.equal(options.forceRefresh, true); calls++;
      if (fail) throw new Error('网络连接失败');
      return { connected: true, remainingPercent: 100, usageAt: observed };
    },
  } });
  try {
    f.doc.getElementById('usageRefresh').click();
    assert.equal(f.doc.getElementById('usageRefresh').textContent, '读取中…');
    await settle();
    assert.equal(f.doc.getElementById('usageQuotaVal').textContent, '剩余100%');
    assert.equal(f.doc.getElementById('usageRefresh').disabled, false);
    const time = f.doc.getElementById('usageQuotaTime').title;
    fail = true; f.doc.getElementById('usageRefresh').click(); await settle();
    assert.equal(calls, 2);
    assert.equal(f.doc.getElementById('usageQuotaVal').textContent, '剩余100%');
    assert.match(f.doc.getElementById('usageQuotaSub').textContent, /查询失败.*已保留旧值/);
    assert.equal(f.doc.getElementById('usageQuotaTime').title, time);
  } finally { f.dom.window.close(); }
});

test('translation settings show a short status without API fallback configuration text', async () => {
  for (const [config, expected] of [
    [{ hasShanbay: true, has: true }, '扇贝优先'],
    [{ hasShanbay: false, has: true }, '个人 API'],
    [{ hasShanbay: false, has: false }, '未配置'],
  ]) {
    const f = fixture({ llm: {
      getConfig: async () => ({ ...config, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }),
      listModels: async () => ({ models: [] }),
      getUsage: async () => ({}),
      getDeepSeekBalance: async () => ({}),
    } });
    try {
      f.doc.querySelector('[data-tab="settings"]').click();
      await settle();
      assert.equal(f.doc.getElementById('llmState').textContent, expected);
    } finally { f.dom.window.close(); }
  }
});

test('clearing a key during a balance read discards the old account and queues the new read', async () => {
  let resolveOld, reads = 0;
  const f = fixture({ llm: {
    getUsage: async () => ({ shanbay: { connected: false }, llm: { configured: false, stats: {} } }),
    getDeepSeekBalance: () => ++reads === 1 ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.reject(Object.assign(new Error('missing key'), { code: 'NO_API_KEY' })),
    clearConfig: async () => ({}),
    getConfig: async () => ({ has: false, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }),
  } });
  try {
    f.w.confirm = () => true;
    f.doc.getElementById('usageRefresh').click(); await settle();
    f.doc.getElementById('llmClear').click(); await settle();
    resolveOld({ isAvailable: true, balanceInfos: [{ currency: 'CNY', totalBalance: '99.99' }] });
    await settle();
    assert.equal(reads, 2);
    assert.doesNotMatch(f.doc.getElementById('usageBalanceVal').textContent, /99\.99/);
    assert.match(f.doc.getElementById('usageBalanceComp').textContent, /保存 API Key/);
  } finally { f.dom.window.close(); }
});

test('a quota refresh keeps the request and cache counters from the usage snapshot', async () => {
  const f = fixture({ llm: {
    getUsage: async () => ({ shanbay: { connected: true, remainingPercent: 40, usageAt: Date.now(),
      stats: { requests: 5, cacheHits: 3 } }, llm: { configured: false, stats: {} } }),
    getDeepSeekBalance: async () => ({}),
    getShanbayQuota: async () => ({ connected: true, remainingPercent: 84, usageAt: Date.now() }),
  } });
  try {
    f.doc.getElementById('usageRefresh').click(); await settle();
    assert.equal(f.doc.getElementById('usageRequests').textContent, '5');
    assert.equal(f.doc.getElementById('usageCacheHits').textContent, '3');
    assert.equal(f.doc.getElementById('usageQuotaVal').textContent, '剩余84%');
    assert.equal(f.doc.querySelector('#usageQuotaVal > small').textContent, '剩余');
  } finally { f.dom.window.close(); }
});

test('the four usage counters keep one grid rule and no legacy flex override', async () => {
  const css = await readFile(new URL('../web/shell.css', import.meta.url), 'utf8');
  const rule = /\.usage-stats\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /display:\s*grid/, 'the counters are a grid');
  assert.match(rule, /repeat\(4/);
  assert.match(rule, /text-align:\s*center/);
  assert.doesNotMatch(css, /#usageFoot\s*(\{|>)/, 'no id rule may override the grid');
  assert.match(css, /\.usage-stat \+ \.usage-stat \{ border-left/, 'dividers sit only between counters');
  const dom = new JSDOM(await readFile(new URL('../web/index.html', import.meta.url), 'utf8'));
  const stats = [...dom.window.document.querySelectorAll('.usage-stat')];
  assert.equal(stats.length, 4);
  assert.equal(dom.window.document.querySelector('.usage-stats').id, 'usageFoot');
  dom.window.close();
});

test('V3 preload uses quiet status copy without help buttons and failure offers an explicit retry', async () => {
  const f = fixture();
  await settle();
  try {
    assert.equal(f.doc.getElementById('pretranslationHelp'), null);
    assert.equal(f.doc.getElementById('routingHelp'), null);
    assert.match(f.doc.getElementById('pretranslationState').textContent, /缓存 30 天/);
    assert.equal(f.doc.getElementById('autoTranslate').checked, false);
    let options;
    f.doc.getElementById('readFrame').contentWindow.hwfeePrepareDaily = value => { options = value; };
    f.w.hwfeePretranslationStatus('long error', { error: 'Provider response invalid' });
    assert.equal(f.doc.getElementById('pretranslationState').textContent, '未完成 · 已暂停自动重试');
    assert.match(f.doc.getElementById('pretranslationDetail').textContent, /Provider response invalid/);
    f.doc.getElementById('pretranslationRetry').click();
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { forceTranslation: true });
  } finally { f.dom.window.close(); }
});

test('V3 mini-player follows playback across tabs and can pause and dismiss without unloading the lesson', async () => {
  const f = fixture();
  try {
    await settle(); f.open(); f.ready(); await settle(); f.finishChrome(); await settle();
    const player = f.doc.getElementById('playerFrame');
    const audio = player.contentDocument.querySelector('audio');
    let paused = true, plays = 0, pauses = 0;
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
    audio.play = () => { paused = false; plays++; return Promise.resolve(); };
    audio.pause = () => { paused = true; pauses++; };
    f.w.hwfeePlayerState({ dir: 'current', title: 'Current lesson', segment: 2, step: 1,
      playing: false, position: 30, duration: 120, artwork: '' });
    f.w.hwfeeClosePlayer(); f.w.hwfeeShowTab('read');
    const mini = f.doc.getElementById('miniPlayer');
    assert.equal(mini.hidden, false);
    assert.equal(f.doc.getElementById('miniTitle').textContent, 'Current lesson');
    assert.match(f.doc.getElementById('miniState').textContent, /第 2 段 · 精听/);
    assert.equal(f.doc.getElementById('miniProgress').style.width, '25%');
    f.doc.getElementById('miniToggle').click();
    assert.equal(plays, 1);
    f.doc.getElementById('miniClose').click();
    assert.equal(pauses, 1); assert.equal(mini.hidden, true);
    f.w.hwfeePlayerState({ dir: 'current', playing: true, position: 31, duration: 120 });
    f.doc.getElementById('miniOpen').click(); await settle(); f.finishChrome(); await settle();
    assert.equal(f.doc.querySelector('.pane[data-pane="listen"]').classList.contains('is-active'), true);
    assert.equal(player.hidden, false);
  } finally { f.dom.window.close(); }
});

test('V3 cookie fallback parses cURL input and saves only through the native vault bridge', async () => {
  const f = fixture();
  try {
    await settle(); let saved;
    f.w.Capacitor.Plugins.Shanbay = {
      setCookie: async value => { saved = value; return { saved: true }; },
      hasCookie: async () => ({ has: true }),
    };
    f.doc.getElementById('cookieInput').value = 'curl https://example.invalid -H "cookie: auth_token=token; csrftoken=csrf"';
    f.doc.getElementById('cookieSave').click(); await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), { cookie: 'auth_token=token; csrftoken=csrf' });
    assert.equal(f.doc.getElementById('cookieInput').value, '');
    assert.equal(f.doc.getElementById('shanbayState').textContent, '已连接');
  } finally { f.dom.window.close(); }
});

test('V3 model selection closes its disclosure and manual selection reveals the model field', async () => {
  const f = fixture({ llm: {
    getConfig: async () => ({ has: true, hasShanbay: true, canTranslate: true,
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }),
    listModels: async () => ({ models: [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }] }),
  } });
  try {
    f.w.hwfeeShowTab('settings'); await settle();
    const head = f.doc.getElementById('llmModelHead'), list = f.doc.getElementById('llmModelList');
    head.click(); assert.equal(list.hidden, false);
    list.querySelector('.model-row.is-manual').click();
    assert.equal(list.hidden, true);
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    assert.equal(head.classList.contains('is-open'), false);
    assert.equal(f.doc.getElementById('llmManualField').hidden, false);
    assert.equal(f.doc.activeElement.id, 'llmModel');
    head.click(); list.querySelector('.model-row:not(.is-manual)').click();
    assert.equal(list.hidden, true);
    assert.equal(f.doc.getElementById('llmManualField').hidden, true);
  } finally { f.dom.window.close(); }
});

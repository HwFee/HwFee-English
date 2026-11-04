import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const script = (await readFile(new URL('../web/shell.js', import.meta.url), 'utf8')).replace(/^import .+;\r?$/gm, '');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture({ hang = false, llm } = {}) {
  const dom = new JSDOM(html, { url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document, states = [], waits = [], timers = new Map();
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
  w.Capacitor = { Plugins: { Llm: llm, TabBar: {
    getMetrics: async () => ({ available: true, reserve: 100, navInset: 20 }),
    addListener: async () => ({ remove() {} }),
    setState: state => {
      states.push(state);
      if (hang) return new Promise(() => {});
      if (state.hidden) return new Promise(resolve => waits.push(resolve));
      return Promise.resolve({ settled: true });
    },
  }, Lessons: { consumeShared: async () => ({ imported: [] }) } } };
  const library = doc.getElementById('listenFrame');
  library.contentDocument.open();
  library.contentDocument.write('<body><a id="lesson" href="/lessons/current/player.html#seg=1">Lesson</a><img src="https://unreachable.invalid/cover.jpg"></body>');
  library.contentDocument.close();
  Object.defineProperty(library.contentDocument, 'readyState', { configurable: true, get: () => 'interactive' });
  w.eval(script);
  return { dom, w, doc, library, states,
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

test('a failed lesson load restores navigation instead of leaving the library trapped', async () => {
  const f = fixture(); await settle(); f.open(); f.run(8000); await settle();
  assert.equal(f.doc.getElementById('app').classList.contains('is-immersive'), false);
  assert.equal(f.library.hidden, false); assert.equal(f.states.at(-1).hidden, false);
  f.dom.window.close();
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
    for (const name of ['usageQuotaTime', 'usageBalanceTime']) {
      assert.equal(f.doc.getElementById(name).hidden, false);
      assert.match(f.doc.getElementById(name).textContent, /^\d{2}:\d{2} 更新$/);
    }
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
    assert.equal(f.doc.getElementById('usageQuotaVal').textContent, '剩余 100%');
    assert.equal(f.doc.getElementById('usageRefresh').disabled, false);
    const time = f.doc.getElementById('usageQuotaTime').title;
    fail = true; f.doc.getElementById('usageRefresh').click(); await settle();
    assert.equal(calls, 2);
    assert.equal(f.doc.getElementById('usageQuotaVal').textContent, '剩余 100%');
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

test('preload help opens without toggling the switch and failure offers an explicit retry', async () => {
  const f = fixture();
  await settle();
  try {
    const button = f.doc.getElementById('pretranslationHelp');
    const help = f.doc.getElementById('autoTranslateHint');
    assert.equal(help.hidden, true);
    button.click();
    assert.equal(help.hidden, false);
    assert.equal(f.doc.getElementById('autoTranslate').checked, false);
    f.doc.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(help.hidden, true);
    let options;
    f.doc.getElementById('readFrame').contentWindow.hwfeePrepareDaily = value => { options = value; };
    f.w.hwfeePretranslationStatus('long error', { error: 'Provider response invalid' });
    assert.equal(f.doc.getElementById('pretranslationState').textContent, '未完成 · 已暂停自动重试');
    assert.match(f.doc.getElementById('pretranslationDetail').textContent, /Provider response invalid/);
    f.doc.getElementById('pretranslationRetry').click();
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { forceTranslation: true });
  } finally { f.dom.window.close(); }
});

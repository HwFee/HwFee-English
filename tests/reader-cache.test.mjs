import test from 'node:test';
import assert from 'node:assert/strict';

const LAST_STATE_KEY = 'hwfee:reader:last-successful';
const todayDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

class FakeStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function successPlugin(date = todayDate()) {
  return {
    hasCookie: async () => ({ has: true }),
    request: async ({ path }) => {
      if (path === '/wordsapp/user_material_books/current') {
        return { body: JSON.stringify({ materialbook_id: 7, materialbook: { name: 'CET4' } }) };
      }
      if (path.endsWith('/statuses')) {
        return { body: JSON.stringify({ date, is_finished: false, a_finished_count: 3, a_count: 45, c_finished_count: 8, c_count: 135 }) };
      }
      if (path.endsWith('/items/sync')) return { body: JSON.stringify({ date, a_not_finished_items: [], c_not_finished_items: [] }) };
      if (path.includes('today_learning_items')) return { body: JSON.stringify({ objects: [], total: 0 }) };
      if (path === '/abc/applets/cross_learning/article') return { body: JSON.stringify({ id: 'article-1' }) };
      if (path === '/news/articles/article-1?source=1') {
        return { body: JSON.stringify({
          id: 'article-1', title_en: 'Offline capable', title_cn: '可离线阅读', date,
          content: '<para><sent>First paragraph.</sent></para><para><sent>Second paragraph.</sent></para>',
        }) };
      }
      throw new Error('Unexpected path ' + path);
    },
  };
}

async function setup(plugin = successPlugin()) {
  const storage = new FakeStorage();
  globalThis.localStorage = storage;
  globalThis.window = { top: { Capacitor: { Plugins: { Shanbay: plugin } } } };
  const bridge = await import(`../web/read/bridge.mjs?test=${Math.random()}`);
  return { storage, bridge };
}

function offlinePlugin(code = 'NETWORK_ERROR') {
  return {
    hasCookie: async () => ({ has: true }),
    request: async () => { throw Object.assign(new Error('offline'), { code }); },
  };
}

test('online state persists today shape and article for later offline reading', async () => {
  const { storage, bridge } = await setup();
  const state = await bridge.loadState();

  assert.equal(state.offline, false);
  assert.equal(state.today.date, todayDate());
  assert.equal(state.today.status.a_finished_count, 3);
  assert.deepEqual(state.article.paragraphs, ['First paragraph.', 'Second paragraph.']);
  assert.deepEqual(JSON.parse(storage.getItem(LAST_STATE_KEY)), { today: state.today, article: state.article });
  assert.ok(storage.getItem('hwfee:article:' + todayDate()));
});

test('network failure returns the last successful state with its original date and counts', async () => {
  const { bridge } = await setup();
  const online = await bridge.loadState();
  globalThis.window.top.Capacitor.Plugins.Shanbay = offlinePlugin();

  const offline = await bridge.loadState();
  assert.equal(offline.offline, true);
  assert.deepEqual(offline.today, online.today);
  assert.deepEqual(offline.article, online.article);
  assert.equal(offline.today.status.a_finished_count, 3);
});

test('authorization errors never fall back to cached content', async () => {
  const { bridge } = await setup();
  await bridge.loadState();
  globalThis.window.top.Capacitor.Plugins.Shanbay = offlinePlugin('UNAUTHORIZED');

  await assert.rejects(bridge.loadState(), (error) => error.code === 'UNAUTHORIZED');
});

test('authorization errors from the optional article source are not hidden by the fallback source', async () => {
  const { bridge } = await setup();
  await bridge.loadState();
  const healthy = successPlugin();
  globalThis.window.top.Capacitor.Plugins.Shanbay = {
    ...healthy,
    request: ({ path, ...rest }) => path === '/abc/applets/cross_learning/article'
      ? Promise.reject(Object.assign(new Error('denied'), { code: 'UNAUTHORIZED' }))
      : healthy.request({ path, ...rest }),
  };

  await assert.rejects(bridge.loadState({ force: true }), (error) => error.code === 'UNAUTHORIZED');
});

test('an unavailable matching article still falls back to the latest article', async () => {
  const healthy = successPlugin();
  const { bridge } = await setup({
    ...healthy,
    request: ({ path, ...rest }) => {
      if (path === '/abc/applets/cross_learning/article') {
        throw Object.assign(new Error('no matching article yet'), { code: 'NOT_READY' });
      }
      if (path === '/news/retrieve/articles?ipp=10&page=1') {
        return Promise.resolve({ body: JSON.stringify({ objects: [{ id: 'article-1' }] }) });
      }
      return healthy.request({ path, ...rest });
    },
  });
  const state = await bridge.loadState();
  assert.equal(state.offline, false);
  assert.equal(state.article.title, 'Offline capable');
});

test('network failure without a usable cache remains an error', async () => {
  const { bridge } = await setup(offlinePlugin());
  await assert.rejects(bridge.loadState(), (error) => error.code === 'NETWORK_ERROR');
});

test('corrupted and stale last-state cache entries are rejected', async (t) => {
  for (const [name, mutate] of [
    ['paragraph types', (state) => { state.article.paragraphs = ['ok', 42]; }],
    ['old date', (state) => {
      const stale = new Date(Date.now() - 61 * 86400000).toISOString().slice(0, 10);
      state.today.date = stale;
      state.today.status.date = stale;
      state.article.date = stale;
    }],
  ]) {
    await t.test(name, async () => {
      const { storage, bridge } = await setup(offlinePlugin());
      const state = {
        today: { date: todayDate(), status: { date: todayDate(), a_finished_count: 3 }, book: 'CET4' },
        article: { date: todayDate(), title: 'Title', subtitle: '标题', paragraphs: ['Paragraph.'] },
      };
      mutate(state);
      storage.setItem(LAST_STATE_KEY, JSON.stringify(state));
      await assert.rejects(bridge.loadState(), (error) => error.code === 'NETWORK_ERROR');
    });
  }
});

test('bridge timeout is a network error and its timer is cleared after fallback', async () => {
  const { bridge } = await setup();
  const online = await bridge.loadState();
  globalThis.window.top.Capacitor.Plugins.Shanbay = { request: () => new Promise(() => {}) };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callbacks = [];
  const cleared = new Set();
  let id = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 45000) return originalSetTimeout(callback, delay, ...args);
    const handle = { id: ++id };
    callbacks.push({ callback, args, handle });
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    if (handle && typeof handle === 'object' && 'id' in handle) cleared.add(handle);
    else originalClearTimeout(handle);
  };
  try {
    const pending = bridge.loadState();
    await Promise.resolve();
    assert.equal(callbacks.length, 1);
    callbacks[0].callback(...callbacks[0].args);
    const offline = await pending;
    assert.equal(offline.offline, true);
    assert.deepEqual(offline.today, online.today);
    assert.ok(cleared.has(callbacks[0].handle));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('successful bridge calls clear their timeout timers', async () => {
  const { bridge } = await setup();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const handles = [];
  const cleared = new Set();
  let id = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay !== 45000) return originalSetTimeout(callback, delay, ...args);
    const handle = { id: ++id };
    handles.push(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    if (handle && typeof handle === 'object' && 'id' in handle) cleared.add(handle);
    else originalClearTimeout(handle);
  };
  try {
    await bridge.loadState();
    assert.ok(handles.length > 0);
    assert.equal(cleared.size, handles.length);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

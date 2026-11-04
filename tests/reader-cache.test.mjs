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

test('saved reader state is readable without network and uses the latest local article', async () => {
  const { storage, bridge } = await setup();
  const online = await bridge.loadState();
  const edited = { ...online.article, paragraphs: ['Latest local text.'] };
  storage.setItem('hwfee:article:' + online.today.date, JSON.stringify(edited));
  window.top.Capacitor.Plugins.Shanbay = offlinePlugin();
  assert.deepEqual(bridge.cachedState().article, edited);
});

test('an account change cannot restore the previous account daily state or reuse its current article', async () => {
  const healthy = successPlugin();
  let account = 'account-a', articleRequests = 0;
  const { bridge } = await setup({ ...healthy,
    hasCookie: async () => ({ has: true, sessionScope: account }),
    request: args => { if (args.path.startsWith('/news/articles/')) articleRequests++; return healthy.request(args); },
  });
  await bridge.hasSession();
  await bridge.loadState();
  assert.ok(bridge.cachedState());
  account = 'account-b';
  await bridge.hasSession();
  assert.equal(bridge.cachedState(), null);
  await bridge.loadState();
  assert.equal(articleRequests, 2, 'the current article must be resolved for the newly connected account');
});

test('unavailable local storage does not prevent loading an article online', async () => {
  const healthy = successPlugin();
  const { bridge, storage } = await setup({ ...healthy,
    hasCookie: async () => ({ has: true, sessionScope: 'account-a' }),
  });
  await bridge.hasSession();
  storage.getItem = storage.setItem = () => { throw new Error('storage blocked'); };
  assert.equal((await bridge.loadState()).article.title, 'Offline capable');
});

test('startup requests are shared and repeated forced refreshes queue one fresh fetch after startup', async () => {
  const healthy = successPlugin();
  let books = 0, articles = 0;
  const { bridge } = await setup({ ...healthy, request: args => {
    if (args.path === '/wordsapp/user_material_books/current') books++;
    if (args.path.startsWith('/news/articles/')) articles++;
    return healthy.request(args);
  } });
  const initial = bridge.loadState();
  assert.equal(bridge.loadState(), initial);
  await Promise.all([initial, bridge.loadState({ force: true }), bridge.loadState({ force: true })]);
  assert.equal(books, 2);
  assert.equal(articles, 2, 'one initial fetch followed by one genuine forced refresh');
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

test('fetched articles keep an https thumbnail as cover and ignore other schemes', async (t) => {
  for (const [name, thumbnails, expected] of [
    ['https thumbnail kept', ['https://img.example.com/cover.jpg'], 'https://img.example.com/cover.jpg'],
    ['http thumbnail dropped', ['http://img.example.com/cover.jpg'], undefined],
    ['non-string thumbnail dropped', [42], undefined],
    ['no thumbnails', undefined, undefined],
  ]) {
    await t.test(name, async () => {
      const plugin = successPlugin();
      const { storage, bridge } = await setup({
        ...plugin,
        request: ({ path, ...rest }) => path === '/news/articles/article-1?source=1'
          ? Promise.resolve({ body: JSON.stringify({
              id: 'article-1', title_en: 'Titled', title_cn: '标题', date: todayDate(),
              content: '<para><sent>Body.</sent></para>',
              ...(thumbnails ? { thumbnail_urls: thumbnails } : {}),
            }) })
          : plugin.request({ path, ...rest }),
      });
      await bridge.loadState();
      const stored = JSON.parse(storage.getItem('hwfee:article:' + todayDate()));
      assert.equal(stored.cover, expected);
    });
  }
});

test('cachedArticles exposes words/paragraphs/cover and cachedArticle returns the validated entry', async () => {
  const { storage, bridge } = await setup();
  const article = {
    date: todayDate(), title: 'Readable', subtitle: '可读',
    paragraphs: ['One two three.', 'Four five.'],
    cover: 'https://img.example.com/c.jpg',
  };
  storage.setItem('hwfee:article:' + article.date, JSON.stringify(article));

  assert.deepEqual(bridge.cachedArticles(), [{
    date: article.date, title: 'Readable', words: 5, paragraphs: 2, cover: article.cover,
  }]);
  assert.equal(bridge.cachedArticle(article.date).title, 'Readable');
  assert.equal(bridge.cachedArticle('1999-01-01'), null);
});

test('cached entries with malformed covers are rejected', async (t) => {
  for (const [name, cover] of [
    ['http url', 'http://img.example.com/c.jpg'],
    ['non-url string', 'not a url'],
    ['non-string', 42],
  ]) {
    await t.test(name, async () => {
      const { storage, bridge } = await setup();
      const article = {
        date: todayDate(), title: 'Readable', subtitle: '可读',
        paragraphs: ['One.'], cover,
      };
      storage.setItem('hwfee:article:' + article.date, JSON.stringify(article));
      assert.deepEqual(bridge.cachedArticles(), []);
      assert.equal(bridge.cachedArticle(article.date), null);
    });
  }
});

function legacyArticle(daysAgo = 0, id = 'article-1') {
  const date = new Date(Date.parse(todayDate() + 'T00:00:00Z') - daysAgo * 86400000).toISOString().slice(0, 10);
  return {
    date, title: 'Saved article', subtitle: '保存的文章',
    source: 'https://web.shanbay.com/reading/web-news/articles/' + id,
    paragraphs: ['Keep the saved paragraphs.'],
    associationWords: ['saved'], matchedTodayWords: ['paragraph'],
  };
}

test('missing covers are repaired for old and current cached articles without replacing their text', async () => {
  const calls = [];
  const cover = 'https://img.example.com/restored.jpg';
  const { storage, bridge } = await setup({
    request: async ({ path }) => {
      calls.push(path);
      return { body: JSON.stringify({ title_en: 'Changed remotely', content: 'Different text', thumbnail_urls: [cover] }) };
    },
  });
  const current = legacyArticle();
  const older = legacyArticle(1, 'older-article');
  for (const article of [current, older]) storage.setItem('hwfee:article:' + article.date, JSON.stringify(article));
  const last = { today: { date: current.date, book: 'CET4', status: { date: current.date } }, article: current };
  storage.setItem(LAST_STATE_KEY, JSON.stringify(last));

  const pending = bridge.backfillArticleCovers();
  assert.equal(bridge.backfillArticleCovers(), pending, 'concurrent callers share the same repair');
  assert.equal(await pending, 2);
  for (const article of [current, older]) assert.deepEqual(bridge.cachedArticle(article.date), { ...article, cover });
  assert.deepEqual(JSON.parse(storage.getItem(LAST_STATE_KEY)), { ...last, article: { ...current, cover } });
  assert.deepEqual(calls, ['/news/articles/article-1?source=1', '/news/articles/older-article?source=1']);
  assert.equal(await bridge.backfillArticleCovers(), 0);
  assert.equal(calls.length, 2, 'saved covers are not fetched again');
});

test('cover repair preserves readable articles when offline and retries after reconnection', async () => {
  const { storage, bridge } = await setup(offlinePlugin());
  const article = legacyArticle(1);
  storage.setItem('hwfee:article:' + article.date, JSON.stringify(article));

  assert.equal(await bridge.backfillArticleCovers(), 0);
  assert.deepEqual(bridge.cachedArticle(article.date), article);
  const cover = 'https://img.example.com/reconnected.jpg';
  window.top.Capacitor.Plugins.Shanbay = {
    request: async () => ({ body: JSON.stringify({ thumbnail_urls: [cover] }) }),
  };
  assert.equal(await bridge.backfillArticleCovers(), 1);
  assert.equal(bridge.cachedArticle(article.date).cover, cover);
});

test('cover repair ignores unsafe or absent thumbnails and unrecognized article sources', async (t) => {
  for (const [name, source, thumbnails, requests] of [
    ['http cover', undefined, ['http://img.example.com/cover.jpg'], 1],
    ['missing cover', undefined, undefined, 1],
    ['invalid cover type', undefined, [42], 1],
    ['external source', 'https://example.com/reading/web-news/articles/article-1', [], 0],
    ['http source', 'http://web.shanbay.com/reading/web-news/articles/article-1', [], 0],
    ['invalid article path', 'https://web.shanbay.com/reading/web-news/articles/a/b', [], 0],
  ]) {
    await t.test(name, async () => {
      let called = 0;
      const { storage, bridge } = await setup({
        request: async () => { called++; return { body: JSON.stringify({ thumbnail_urls: thumbnails }) }; },
      });
      const article = { ...legacyArticle(), ...(source ? { source } : {}) };
      storage.setItem('hwfee:article:' + article.date, JSON.stringify(article));
      assert.equal(await bridge.backfillArticleCovers(), 0);
      assert.equal(called, requests);
      assert.deepEqual(bridge.cachedArticle(article.date), article);
    });
  }
});

test('late cover responses do not restore cleared articles or overwrite replacements', async (t) => {
  for (const action of ['clear', 'replace', 'edit']) {
    await t.test(action, async () => {
      let respond;
      const { storage, bridge } = await setup({ request: () => new Promise((resolve) => { respond = resolve; }) });
      const article = legacyArticle();
      const key = 'hwfee:article:' + article.date;
      storage.setItem(key, JSON.stringify(article));
      const pending = bridge.backfillArticleCovers();
      const replacement = { ...article, title: 'New local title', paragraphs: ['New local paragraph.'] };
      if (action === 'clear') storage.removeItem(key);
      else {
        if (action === 'replace') replacement.source = 'https://web.shanbay.com/reading/web-news/articles/replacement';
        storage.setItem(key, JSON.stringify(replacement));
      }
      const cover = 'https://img.example.com/late.jpg';
      respond({ body: JSON.stringify({ thumbnail_urls: [cover] }) });
      assert.equal(await pending, action === 'edit' ? 1 : 0);
      assert.deepEqual(bridge.cachedArticle(article.date), action === 'clear' ? null : {
        ...replacement, ...(action === 'edit' ? { cover } : {}),
      });
    });
  }
});

test('cover repair requests only the ten visible recent articles', async () => {
  const calls = [];
  const { storage, bridge } = await setup({
    request: async ({ path }) => { calls.push(path); return { body: JSON.stringify({ thumbnail_urls: ['https://img.example.com/cover.jpg'] }) }; },
  });
  for (let i = 0; i < 12; i++) {
    const article = legacyArticle(i, 'saved-' + i);
    storage.setItem('hwfee:article:' + article.date, JSON.stringify(article));
  }
  assert.equal(await bridge.backfillArticleCovers(), 10);
  assert.deepEqual(calls, Array.from({ length: 10 }, (_, i) => `/news/articles/saved-${i}?source=1`));
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

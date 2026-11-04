import test from 'node:test';
import assert from 'node:assert/strict';

const article = { date: '2026-11-03', source: 'https://web.shanbay.com/article/1',
  paragraphs: ['Dr. Smith paid $3.50. He left.', 'He left.'] };

function storedPreparation() {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

async function fixture(overrides = {}) {
  const calls = [];
  const config = { has: true, autoTranslate: true, baseUrl: 'https://provider.invalid', model: 'model' };
  globalThis.window = { top: { Capacitor: { Plugins: { Llm: {
    getConfig: async () => config,
    pretranslate: async ({ sentences }) => {
      calls.push(sentences);
      return { total: sentences.length, completed: sentences.length, expiresAt: 10000000, stopped: false };
    }, ...overrides,
  } } } } };
  const module = await import(`../web/read/pretranslation.mjs?test=${Math.random()}`);
  return { calls, config, ...module };
}

test('pretranslation and long press use identical sentence boundaries and remove duplicates', async () => {
  const f = await fixture();
  assert.deepEqual(f.articleSentences(article), ['Dr. Smith paid $3.50.', 'He left.']);
  await f.prepareTranslation(article, { now: 1000 });
  assert.deepEqual(f.calls, [['Dr. Smith paid $3.50.', 'He left.']]);
});

test('disabled pretranslation and missing keys never issue paid requests', async () => {
  const f = await fixture();
  f.config.autoTranslate = false;
  await f.prepareTranslation(article);
  f.config.autoTranslate = true;
  f.config.has = false;
  await f.prepareTranslation(article);
  assert.equal(f.calls.length, 0);
});

test('a connected Shanbay account can pretranslate with no personal API key and account changes invalidate completion', async () => {
  const f = await fixture();
  Object.assign(f.config, { has: false, canTranslate: true, hasShanbay: true, routing: 'shanbay-first', sessionScope: 'account-a' });
  await f.prepareTranslation(article, { now: 1000 });
  assert.equal(f.calls.length, 1);
  f.config.sessionScope = 'account-b';
  await f.prepareTranslation(article, { now: 2000 });
  assert.equal(f.calls.length, 2);
});

test('simultaneous foreground events share preparation and completion lasts only until native cache expiry', async () => {
  const f = await fixture();
  await Promise.all([f.prepareTranslation(article, { now: 1000 }), f.prepareTranslation(article, { now: 1000 })]);
  await f.prepareTranslation(article, { now: 2000 });
  assert.equal(f.calls.length, 1);
  await f.prepareTranslation(article, { now: 10000001 });
  assert.equal(f.calls.length, 2);
});

test('changing provider, model, article or opting in again prepares the appropriate sentences', async () => {
  const f = await fixture();
  await f.prepareTranslation(article, { now: 1000 });
  f.config.model = 'other-model';
  await f.prepareTranslation(article, { now: 2000 });
  f.config.baseUrl = 'https://other.invalid';
  await f.prepareTranslation(article, { now: 3000 });
  await f.prepareTranslation({ ...article, date: '2026-11-04' }, { now: 4000 });
  await f.prepareTranslation({ ...article, date: '2026-11-04' }, { now: 5000, force: true });
  assert.equal(f.calls.length, 5);
});

test('failed preparations stay paused until an explicit retry and do not prevent reading', async () => {
  let calls = 0;
  const f = await fixture({ pretranslate: async () => { calls++; throw new Error('offline'); } });
  assert.equal(await f.prepareTranslation(article, { now: 1000 }), null);
  await f.prepareTranslation(article, { now: 2000 });
  assert.equal(calls, 1);
  await f.prepareTranslation(article, { now: 121001 });
  assert.equal(calls, 1);
  await f.prepareTranslation(article, { now: 122000, force: true });
  assert.equal(calls, 2);
});

test('a paused batch remains retryable when the switch is re-enabled', async () => {
  let calls = 0;
  const f = await fixture({ pretranslate: async () => { calls++; return { stopped: true, completed: 1, total: 2 }; } });
  await f.prepareTranslation(article, { now: 1000 });
  await f.prepareTranslation(article, { now: 2000, force: true });
  assert.equal(calls, 2);
});

test('a replacement article stops obsolete preparation and prepares the latest article next', async () => {
  let finish;
  const calls = [];
  let cancelled = 0;
  const f = await fixture({
    cancelPretranslation: async () => { cancelled++; },
    pretranslate: ({ sentences }) => {
      calls.push(sentences);
      if (calls.length === 1) return new Promise(resolve => { finish = resolve; });
      return Promise.resolve({ total: sentences.length, completed: sentences.length, stopped: false });
    },
  });
  const old = f.prepareTranslation(article);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  void f.prepareTranslation({ ...article, date: '2026-11-04', paragraphs: ['A new article.'] });
  finish({ total: 2, completed: 1, stopped: true });
  await old;
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(cancelled, 1);
  assert.deepEqual(calls[1], ['A new article.']);
});

test('analysis preparation preserves the reader text and unfinished analyses cannot mark an article ready', async () => {
  const text = 'While  the rain fell, the children stayed inside and read.';
  let calls = 0, latest;
  const f = await fixture({ pretranslate: async args => {
    latest = args; calls++;
    return { total: 1, completed: 1, stopped: false, expiresAt: 10000000,
      analysis: { total: 1, completed: calls === 1 ? 0 : 1 } };
  } });
  const daily = { ...article, paragraphs: [text] };
  assert.deepEqual(f.articleSentences(daily), [text]);
  await f.prepareTranslation(daily, { now: 1000 });
  assert.equal(latest.includeAnalysis, true);
  assert.deepEqual(latest.sentences, [text]);
  await f.prepareTranslation(daily, { now: 121001, force: true });
  assert.equal(calls, 2, 'a successful translation alone cannot suppress an unfinished analysis retry');
  await f.prepareTranslation(daily, { now: 122000 });
  assert.equal(calls, 2, 'both cached tasks now count as prepared');
});

test('a failed article stays paused after module recreation and a new article can prepare', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  try {
    const first = await fixture({ pretranslate: async () => { throw new Error('quota exhausted'); } });
    await first.prepareTranslation(article, { now: 1000 });
    const reopened = await fixture();
    await reopened.prepareTranslation(article, { now: 1000000 });
    assert.equal(reopened.calls.length, 0);
    await reopened.prepareTranslation({ ...article, date: '2026-11-04' }, { now: 1000001 });
    assert.equal(reopened.calls.length, 1);
  } finally { delete globalThis.localStorage; }
});

test('completed preparation restores ready after restart without running another batch', async () => {
  storedPreparation();
  try {
    const first = await fixture();
    await first.prepareTranslation(article, { now: 1000 });
    const reopened = await fixture();
    const messages = [];
    window.top.hwfeePretranslationStatus = message => messages.push(message);
    await reopened.prepareTranslation(article, { now: 2000 });
    assert.equal(reopened.calls.length, 0);
    assert.deepEqual(messages, ['今日文章已就绪']);
    await reopened.prepareTranslation(article, { now: 10000001 });
    assert.equal(reopened.calls.length, 1, 'native cache expiry makes the completion marker expire too');
  } finally { delete globalThis.localStorage; }
});

test('restored completion is invalidated by account, model and backend cache changes', async () => {
  for (const change of [{ sessionScope: 'new-account' }, { model: 'new-model' }, { cacheVersion: 'new-version' }]) {
    storedPreparation();
    try {
      const first = await fixture();
      await first.prepareTranslation(article, { now: 1000 });
      const reopened = await fixture();
      Object.assign(reopened.config, change);
      await reopened.prepareTranslation(article, { now: 2000 });
      assert.equal(reopened.calls.length, 1);
    } finally { delete globalThis.localStorage; }
  }
});

test('an empty or incomplete batch cannot persist a ready state', async () => {
  const f = await fixture({ pretranslate: async () => ({ total: 0, completed: 0, stopped: false }) });
  const messages = [];
  window.top.hwfeePretranslationStatus = message => messages.push(message);
  await f.prepareTranslation(article);
  assert.ok(!messages.includes('今日文章已就绪'));
});

test('a forced retry failure invalidates an earlier ready marker', async () => {
  storedPreparation();
  try {
    const first = await fixture();
    await first.prepareTranslation(article, { now: 1000 });
    window.top.Capacitor.Plugins.Llm.pretranslate = async () => { throw new Error('failed retry'); };
    await first.prepareTranslation(article, { now: 2000, force: true });
    const reopened = await fixture();
    const messages = [];
    window.top.hwfeePretranslationStatus = message => messages.push(message);
    await reopened.prepareTranslation(article, { now: 3000 });
    assert.deepEqual(messages, ['预加载未完成']);
    assert.equal(reopened.calls.length, 0, 'failed work stays paused');
  } finally { delete globalThis.localStorage; }
});

test('late results and errors cannot overwrite the disabled preparation state', async () => {
  for (const reject of [false, true]) {
    let finish;
    const f = await fixture({ pretranslate: () => new Promise((resolve, fail) => {
      finish = () => reject ? fail(new Error('late failure')) : resolve({ total: 2, completed: 2 });
    }) });
    const messages = [];
    window.top.hwfeePretranslationStatus = message => messages.push(message);
    const running = f.prepareTranslation(article);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    f.config.autoTranslate = false;
    messages.push('已关闭自动预加载');
    finish();
    await running;
    assert.equal(messages.at(-1), '已关闭自动预加载');
  }
});

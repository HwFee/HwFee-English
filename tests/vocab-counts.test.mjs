import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLiveVocabCounts } from '../web/read/vocab.mjs';

const VOCAB_KEY = 'hwfee:vocab';
const HOUR = 60 * 60 * 1000;
const ALL_CATEGORIES = ['today', 'wordbook', 'learned', 'unlearned'];

class FakeStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function categoryOf(path) {
  if (path.startsWith('/wordscollection/words?')) return 'wordbook';
  if (path.includes('/simple_learned_items?')) return 'learned';
  return /categories=([a-z]+)/.exec(path)?.[1] ?? null;
}

/** A `ipp=1` metadata page that honours the filter, with a matching sample entry. */
function metadataPage(name, totals) {
  if (name === 'wordbook' || name === 'learned') return { total: totals[name], objects: [] };
  const bit = { today: 1, wordbook: 2, learned: 4, unlearned: 8 }[name];
  return { total: totals[name], vocabs: totals[name] > 0 ? [{ vocab: 'sample', categories: bit }] : [] };
}

/**
 * Seeds the six-hour highlight cache the way the app leaves it: a complete feed
 * plus counts that were true when the feed was downloaded.
 */
function seedCache(storage, counts = { today: 45, wordbook: 233, learned: 500, unlearned: 1200 }) {
  storage.setItem(VOCAB_KEY, JSON.stringify({
    at: Date.now() - 5 * HOUR,
    entries: [['alpha', 2], ['beta', 1]],
    counts,
    countsVersion: 2,
  }));
}

async function setup({ storage = new FakeStorage(), request } = {}) {
  const calls = [];
  const events = [];
  globalThis.localStorage = storage;
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.document = { dispatchEvent(event) { events.push(event); } };
  globalThis.window = { top: { Capacitor: { Plugins: { Shanbay: {
    request: async ({ path, method }) => {
      calls.push({ path, method });
      if (path === '/wordsapp/user_material_books/current') return { body: JSON.stringify({ materialbook_id: 'fixture-book' }) };
      return { body: JSON.stringify(await request(path, method)) };
    },
  } } } } };
  const gestures = await import(`../web/read/gestures.mjs?counts=${Math.random()}`);
  return { gestures, storage, calls, events };
}

test('concurrent full vocabulary refreshes share one paginated feed and publish it once', async () => {
  const f = await setup({ request: async () => ({ total: 1, vocabs: [{ vocab: 'shared', categories: 2 }] }) });
  await Promise.all([f.gestures.loadHighlightVocab({ force: true }), f.gestures.loadHighlightVocab({ force: true })]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.filter(event => event.type === 'hwfee:vocab').length, 1);
  assert.equal(f.gestures.vocabCounts(), null, 'highlight membership cannot supply dashboard totals');
});

test('a live count replaces a stale cached wordbook number without re-downloading the feed', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const { gestures, calls, events } = await setup({
    storage, request: async (path) => metadataPage(categoryOf(path), totals),
  });

  assert.equal(await gestures.loadHighlightVocab(), 2);
  assert.equal(calls.length, 0, 'the fresh-enough highlight cache is used as is');
  assert.equal(gestures.vocabCounts().wordbook, 233);

  const counts = await gestures.refreshVocabCounts();
  assert.equal(counts.wordbook, 235, 'the live number wins over the cached one');
  assert.equal(counts.learned, 501);
  assert.equal(gestures.vocabCounts().wordbook, 235);

  assert.deepEqual(calls.map(({ path }) => categoryOf(path)).filter(Boolean).sort(), [...ALL_CATEGORIES].sort());
  assert.ok(calls.some(({ path }) => path === '/wordscollection/words?page=1&ipp=1'));
  assert.ok(calls.some(({ path }) => path.includes('/fixture-book/learning/words/simple_learned_items?')));
  assert.ok(!calls.some(({ path }) => /categories=(wordbook|learned)/.test(path)));
  assert.ok(calls.every(({ path }) => !path.includes('ipp=1000')), 'the multi-thousand-entry feed is not refetched');

  const published = events.filter((event) => event.type === 'hwfee:vocab');
  assert.equal(published.length, 2, 'cache load and live count each publish once');
  assert.equal(published.at(-1).detail.counts.wordbook, 235);
});

test('verified counts survive reopening offline without renewing the highlight cache', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const original = JSON.parse(storage.getItem(VOCAB_KEY));
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const first = await setup({ storage, request: async path => metadataPage(categoryOf(path), totals) });
  await first.gestures.loadHighlightVocab();
  await first.gestures.refreshVocabCounts();

  const saved = JSON.parse(storage.getItem(VOCAB_KEY));
  assert.deepEqual(saved.counts, totals);
  assert.equal(saved.at, original.at, 'updating counters must not extend the six-hour highlight cache');
  assert.deepEqual(saved.entries, original.entries);

  const reopened = await setup({ storage, request: async () => { throw new Error('offline'); } });
  await reopened.gestures.loadHighlightVocab();
  assert.deepEqual(reopened.gestures.vocabCounts(), totals);
  await reopened.gestures.refreshVocabCounts({ force: true });
  assert.deepEqual(reopened.gestures.vocabCounts(), totals, 'a failed refresh retains the last verified values');
});

test('reading the highlight cache again cannot replace verified counts or reset their throttle', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const f = await setup({ storage, request: async path => metadataPage(categoryOf(path), totals) });
  await f.gestures.loadHighlightVocab();
  await f.gestures.refreshVocabCounts();
  await f.gestures.loadHighlightVocab();
  assert.deepEqual(f.gestures.vocabCounts(), totals);
  const calls = f.calls.length;
  await f.gestures.refreshVocabCounts();
  assert.equal(f.calls.length, calls);
});

test('a full feed finishing after the live count cannot overwrite it in memory or on disk', async () => {
  const storage = new FakeStorage();
  let finishFeed;
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const f = await setup({ storage, request: path => path.includes('ipp=1000')
    ? new Promise(resolve => { finishFeed = resolve; }) : metadataPage(categoryOf(path), totals) });
  const feed = f.gestures.loadHighlightVocab({ force: true });
  await f.gestures.refreshVocabCounts();
  finishFeed({ total: 1, vocabs: [{ vocab: 'outdated', categories: 2 }] });
  await feed;
  assert.deepEqual(f.gestures.vocabCounts(), totals);
  assert.deepEqual(JSON.parse(storage.getItem(VOCAB_KEY)).counts, totals);
});

test('verified counts persist even when no usable highlight feed is available after reopening', async () => {
  const storage = new FakeStorage();
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const first = await setup({ storage, request: async path => metadataPage(categoryOf(path), totals) });
  await first.gestures.refreshVocabCounts();
  const reopened = await setup({ storage, request: async () => { throw new Error('offline'); } });
  await assert.rejects(reopened.gestures.loadHighlightVocab(), /offline/);
  assert.deepEqual(reopened.gestures.vocabCounts(), totals);
});

test('a successful count replaces malformed stored data and remains recoverable', async () => {
  const storage = new FakeStorage();
  storage.setItem(VOCAB_KEY, '{broken');
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const f = await setup({ storage, request: async path => metadataPage(categoryOf(path), totals) });
  await f.gestures.refreshVocabCounts();
  assert.deepEqual(JSON.parse(storage.getItem(VOCAB_KEY)).counts, totals);
});

test('a failed live count keeps the cached number and retries next time', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const { gestures, calls, events } = await setup({
    storage, request: async () => { throw new Error('network failed'); },
  });

  await gestures.loadHighlightVocab();
  const publishedBefore = events.length;

  assert.equal(await gestures.refreshVocabCounts({ force: true }), gestures.vocabCounts());
  assert.equal(gestures.vocabCounts().wordbook, 233, 'the cached count is still shown');
  assert.equal(events.length, publishedBefore, 'nothing is published when nothing was read');

  const attempts = calls.length;
  assert.equal(attempts, 5);
  await gestures.refreshVocabCounts();
  assert.equal(calls.length, attempts + 5, 'a failure does not start the throttle window');
});

test('a category that fails alone leaves its cached count while the others update', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const { gestures } = await setup({
    storage,
    request: async (path) => {
      if (categoryOf(path) === 'wordbook') throw new Error('network failed');
      return metadataPage(categoryOf(path), totals);
    },
  });

  await gestures.loadHighlightVocab();
  const counts = await gestures.refreshVocabCounts();
  assert.equal(counts.wordbook, 233, 'the failed category keeps its cached number');
  assert.equal(counts.learned, 501);
});

test('counts are throttled, forced on demand, and invalidated by a wordbook write', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  let wordbook = totals.wordbook;
  const { gestures, calls } = await setup({
    storage, request: async (path) => metadataPage(categoryOf(path), { ...totals, wordbook }),
  });

  await gestures.loadHighlightVocab();
  await gestures.refreshVocabCounts();
  const afterFirst = calls.length;
  await gestures.refreshVocabCounts();
  assert.equal(calls.length, afterFirst, 'a second look within a minute reuses the live count');

  await gestures.refreshVocabCounts({ force: true });
  assert.equal(calls.length, afterFirst + 5, 'force bypasses the throttle');

  wordbook = 236;
  gestures.patchWordbook('alpha', true);
  assert.equal(gestures.vocabCounts().wordbook, 235, 'a confirmed write retains the displayed total during refresh');
  const counts = await gestures.refreshVocabCounts();
  assert.equal(counts.wordbook, 236, 'the write resets the throttle');
});

test('no cached counts is not the same as a zero count', async () => {
  const storage = new FakeStorage();
  storage.setItem(VOCAB_KEY, JSON.stringify({
    at: Date.now() - HOUR, entries: [['alpha', 2]],
  }));
  let partial = true;
  const totals = { today: 45, wordbook: 235, learned: 501, unlearned: 1200 };
  const { gestures } = await setup({
    storage,
    request: async (path) => {
      if (partial && categoryOf(path) !== 'wordbook') throw new Error('network failed');
      return metadataPage(categoryOf(path), totals);
    },
  });

  await gestures.loadHighlightVocab();
  assert.equal(gestures.vocabCounts(), null);
  assert.deepEqual(await gestures.refreshVocabCounts({ force: true }),
    { today: null, wordbook: 235, learned: null, unlearned: null }, 'known totals can display without inventing zeros');

  partial = false;
  const counts = await gestures.refreshVocabCounts({ force: true });
  assert.deepEqual(counts, totals);
});

test('fetchLiveVocabCounts keeps good categories, drops ignored filters and failures', async () => {
  const pages = {
    today: { total: 45, vocabs: [{ vocab: 'a', categories: 1 }] },
    wordbook: { total: 235, objects: [] },
    learned: { total: 501, vocabs: [{ vocab: 'c', categories: 4 }] }, // highlight count is not the current book's mastered total
    unlearned: { total: 1200, vocabs: [{ vocab: 'd', categories: 8 }] },
  };
  const counts = await fetchLiveVocabCounts(async (name) => {
    if (name === 'unlearned') throw new Error('network failed');
    return pages[name];
  });

  assert.deepEqual(counts, { today: 45, wordbook: 235 });
  assert.deepEqual(await fetchLiveVocabCounts(async () => ({ total: 3, vocabs: null }), { categories: ['wordbook'] }), {});
  assert.deepEqual(await fetchLiveVocabCounts(async () => ({ total: -1, vocabs: [] }), { categories: ['wordbook'] }), {});
});

test('old highlight-derived cache counts are discarded without discarding highlights', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const old = JSON.parse(storage.getItem(VOCAB_KEY));
  delete old.countsVersion;
  old.countsAt = Date.now();
  storage.setItem(VOCAB_KEY, JSON.stringify(old));
  const f = await setup({ storage, request: async path => metadataPage(categoryOf(path),
    { today: 45, wordbook: 364, learned: 79, unlearned: 1200 }) });
  assert.equal(await f.gestures.loadHighlightVocab(), 2);
  assert.equal(f.gestures.vocabCounts(), null);
  await f.gestures.refreshVocabCounts();
  assert.equal(f.gestures.vocabCounts().wordbook, 364);
  assert.equal(f.gestures.vocabCounts().learned, 79);
});

test('saved official totals are available before any network or highlight load', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  const saved = JSON.parse(storage.getItem(VOCAB_KEY));
  delete saved.entries; delete saved.at;
  storage.setItem(VOCAB_KEY, JSON.stringify(saved));
  const f = await setup({ storage, request: async () => { throw new Error('offline'); } });
  assert.equal(f.gestures.vocabCounts().wordbook, 233);
  assert.equal(f.gestures.vocabCounts().learned, 500);
  assert.equal(f.calls.length, 0);
  await f.gestures.refreshVocabCounts({ force: true });
  assert.equal(f.gestures.vocabCounts().wordbook, 233);
});

test('a confirmed edit starts a new count immediately and late pre-edit totals cannot overwrite it', async () => {
  const storage = new FakeStorage();
  seedCache(storage);
  let finishOld, delayFirst = true;
  const f = await setup({ storage, request: path => {
    const totals = { today: 45, wordbook: 236, learned: 501, unlearned: 1200 };
    if (categoryOf(path) === 'wordbook' && delayFirst) {
      delayFirst = false;
      return new Promise(resolve => { finishOld = () => resolve(metadataPage('wordbook', { ...totals, wordbook: 233 })); });
    }
    return metadataPage(categoryOf(path), totals);
  } });
  await f.gestures.loadHighlightVocab();
  const old = f.gestures.refreshVocabCounts({ force: true });
  f.gestures.patchWordbook('new-word', true);
  assert.equal(f.gestures.vocabCounts().wordbook, 233, 'no placeholder while a fresh request runs');
  assert.equal(JSON.parse(storage.getItem(VOCAB_KEY)).counts.wordbook, 233, 'restart also retains the last number');
  await f.gestures.refreshVocabCounts({ force: true });
  assert.equal(f.gestures.vocabCounts().wordbook, 236);
  finishOld(); await old;
  assert.equal(f.gestures.vocabCounts().wordbook, 236);
});

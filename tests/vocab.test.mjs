import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchVocabulary, fetchVocabularyWithCounts, validateVocabularyCache, validateVocabularyCounts, wordbookMembership } from '../web/read/vocab.mjs';

test('wordbook status matches the requested id and rejects missing or invalid answers', () => {
  assert.equal(wordbookMembership({ objects: [
    { vocab_id: 'other', exists: true }, { vocab_id: 'target', exists: false },
  ] }, 'target'), false);
  assert.throws(() => wordbookMembership({ objects: [] }, 'target'), /没有返回/);
  assert.throws(() => wordbookMembership({ objects: [{ vocab_id: 'target', exists: 'false' }] }, 'target'), /没有返回/);
  assert.throws(() => wordbookMembership({}, 'target'), /格式无效/);
});

class FakeStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
}

test('reads more than six pages before returning a complete vocabulary set', async () => {
  const pages = [];
  const entries = await fetchVocabulary(async (page) => {
    pages.push(page);
    return {
      total: 7000,
      vocabs: Array.from({ length: 1000 }, (_, index) => ({
        vocab: `word-${page}-${index}`, categories: page % 2 ? 1 : 2,
      })),
    };
  });

  assert.equal(pages.length, 7);
  assert.deepEqual(pages, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(entries.length, 7000);
  assert.ok(entries.some(([word]) => word === 'word-7-999'));
});

test('ORs category masks for repeated words and variants', async () => {
  const entries = await fetchVocabulary(async () => ({
    total: 2,
    vocabs: [
      { vocab: 'Shared', categories: 1, variants: ['Foo', 'Foos'] },
      { vocab: 'FOO', categories: 2, variants: ['shared'] },
    ],
  }));

  assert.deepEqual(new Map(entries), new Map([['shared', 3], ['foo', 3], ['foos', 1]]));
});

test('partial page failure does not replace the last complete cache', async () => {
  const storage = new FakeStorage();
  globalThis.localStorage = storage;
  let failSecondPage = false;
  let calls = 0;
  globalThis.window = { top: { Capacitor: { Plugins: { Shanbay: {
    request: async ({ path }) => {
      calls++;
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      if (failSecondPage && page === 2) throw new Error('network failed');
      const payload = failSecondPage
        ? { total: 2, vocabs: [{ vocab: 'partial', categories: 1 }] }
        : { total: 2, vocabs: [{ vocab: 'complete-one', categories: 1 }, { vocab: 'complete-two', categories: 2 }] };
      return { body: JSON.stringify(payload) };
    },
  } } } } };
  const gestures = await import(`../web/read/gestures.mjs?case=${Math.random()}`);

  assert.equal(await gestures.loadHighlightVocab({ force: true }), 2);
  const key = 'hwfee:vocab';
  const original = storage.getItem(key);
  assert.ok(original);

  failSecondPage = true;
  await assert.rejects(gestures.loadHighlightVocab({ force: true }), /network failed/);
  assert.equal(storage.getItem(key), original);

  const beforeCachedRead = calls;
  assert.equal(await gestures.loadHighlightVocab(), 2);
  assert.equal(calls, beforeCachedRead);
});

test('rejects malformed, expired, and future vocabulary caches safely', () => {
  const now = 10_000;
  const options = { now, ttlMs: 5_000 };
  const valid = { at: 9_000, entries: [['Known', 3]] };
  assert.deepEqual(validateVocabularyCache(valid, options), [['known', 3]]);
  assert.equal(validateVocabularyCache({ at: 9_000, entries: [['bad', 'mask']] }, options), null);
  assert.equal(validateVocabularyCache({ at: 1, entries: [['old', 1]] }, options), null);
  assert.equal(validateVocabularyCache({ at: 10_001, entries: [['future', 1]] }, options), null);
  assert.equal(validateVocabularyCache({ at: 9_000, entries: [null] }, options), null);
});

test('fetchVocabularyWithCounts counts distinct headwords per category, not variants', async () => {
  const { entries, counts } = await fetchVocabularyWithCounts(async () => ({
    total: 3,
    vocabs: [
      { vocab: 'Shared', categories: 1, variants: ['Foo'] },
      { vocab: 'SHARED', categories: 2 },
      { vocab: 'Solo', categories: 4, variants: ['Solos'] },
    ],
  }));

  assert.deepEqual(new Map(entries), new Map([['shared', 3], ['foo', 1], ['solo', 4], ['solos', 4]]));
  assert.deepEqual(counts, { today: 1, wordbook: 1, learned: 1, unlearned: 0 });
});

test('validateVocabularyCounts accepts four non-negative integers and rejects the rest', () => {
  assert.deepEqual(
    validateVocabularyCounts({ today: 1, wordbook: 2, learned: 3, unlearned: 0 }),
    { today: 1, wordbook: 2, learned: 3, unlearned: 0 });
  assert.equal(validateVocabularyCounts({ today: 1, wordbook: 2, learned: 3 }), null);
  assert.equal(validateVocabularyCounts({ today: 1, wordbook: -2, learned: 3, unlearned: 0 }), null);
  assert.equal(validateVocabularyCounts({ today: 1.5, wordbook: 2, learned: 3, unlearned: 0 }), null);
  assert.equal(validateVocabularyCounts(null), null);
  assert.equal(validateVocabularyCounts('counts'), null);
});

test('highlight counts never become dashboard totals or survive as official cached totals', async () => {
  const storage = new FakeStorage();
  globalThis.localStorage = storage;
  const payload = { total: 2, vocabs: [{ vocab: 'one', categories: 1 }, { vocab: 'two', categories: 2 }] };
  globalThis.window = { top: { Capacitor: { Plugins: { Shanbay: {
    request: async () => ({ body: JSON.stringify(payload) }),
  } } } } };
  const gestures = await import(`../web/read/gestures.mjs?case=${Math.random()}`);

  assert.equal(await gestures.loadHighlightVocab({ force: true }), 2);
  assert.equal(gestures.vocabCounts(), null);
  assert.equal(JSON.parse(storage.getItem('hwfee:vocab')).counts, null);

  // Records written before counts existed stay valid; their counts are just null.
  storage.setItem('hwfee:vocab', JSON.stringify({ at: Date.now(), entries: [['old', 3]] }));
  assert.equal(await gestures.loadHighlightVocab(), 1);
  assert.equal(gestures.vocabCounts(), null);
});

test('detects repeated/stalled and malformed pagination', async () => {
  const page = { total: 4, vocabs: [{ vocab: 'one', categories: 1 }, { vocab: 'two', categories: 2 }] };
  await assert.rejects(fetchVocabulary(async () => page, { pageSize: 2 }), /没有前进/);
  await assert.rejects(fetchVocabulary(async () => ({ total: 2, vocabs: null })), /格式无效/);
  await assert.rejects(fetchVocabulary(async () => ({ total: 2, vocabs: [] })), /提前结束/);
});

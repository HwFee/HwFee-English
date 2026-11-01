import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchVocabulary, validateVocabularyCache } from '../web/read/vocab.mjs';

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

test('detects repeated/stalled and malformed pagination', async () => {
  const page = { total: 4, vocabs: [{ vocab: 'one', categories: 1 }, { vocab: 'two', categories: 2 }] };
  await assert.rejects(fetchVocabulary(async () => page, { pageSize: 2 }), /没有前进/);
  await assert.rejects(fetchVocabulary(async () => ({ total: 2, vocabs: null })), /格式无效/);
  await assert.rejects(fetchVocabulary(async () => ({ total: 2, vocabs: [] })), /提前结束/);
});

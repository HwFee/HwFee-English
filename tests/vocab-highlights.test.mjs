import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { vocabularyKey, vocabularyMask, fetchVocabularyWithCounts, countArticleCategories } from '../web/read/vocab.mjs';

const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const feed = (vocabs, extra = {}) => ({ total: vocabs.length, vocabs, covered_categories: 15, date: day(), ...extra });

async function fixture({ cached = null, payload = feed([]), text = "Birds fly. The bird's wings and the reader’s book are strong." } = {}) {
  const dom = new JSDOM('<article id="article"><div class="para"><p></p></div></article>', { url: 'https://localhost/read/', pretendToBeVisual: true });
  const w = dom.window;
  w.document.querySelector('p').textContent = text;
  Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage,
    CustomEvent: w.CustomEvent, getComputedStyle: w.getComputedStyle.bind(w), IntersectionObserver: undefined });
  if (cached) localStorage.setItem('hwfee:vocab', JSON.stringify(cached));
  const state = { payload, calls: 0 };
  w.Capacitor = { Plugins: { Shanbay: { request: async () => {
    state.calls++;
    if (state.payload instanceof Error) throw state.payload;
    return { body: JSON.stringify(state.payload) };
  } } } };
  const api = await import(`../web/read/gestures.mjs?highlights=${Math.random()}`);
  const root = document.getElementById('article');
  api.decorate(root);
  return { dom, w, api, root, state,
    word: value => [...root.querySelectorAll('.w')].find(e => e.textContent === value),
    saved: () => localStorage.getItem('hwfee:vocab'),
    close: () => dom.window.close() };
}

test('typographic apostrophes and nonbreaking hyphens match without inventing inflections', () => {
  assert.equal(vocabularyKey(' Reader’s '), "reader's");
  assert.equal(vocabularyKey('oxygen‑starved'), 'oxygen-starved');
  const masks = new Map([['reader', 2], ["it's", 1], ['it', 2], ['oxygen-starved', 3]]);
  assert.equal(vocabularyMask('Reader’s', masks), 2, 'a possessive can use its exact headword');
  assert.equal(vocabularyMask('it’s', masks), 1, 'an explicit provider entry takes precedence');
  assert.equal(vocabularyMask('oxygen‑starved', masks), 3);
  assert.equal(vocabularyMask('readers', masks), 0, 'no suffix guessing');
  assert.deepEqual(countArticleCategories(['Reader’s', "reader's", 'unknown'], masks), { today: 0, wordbook: 1 });
});

test('daily NEW/REVIEW headwords supplement the feed and carry provider-supplied variants in either arrival order', async t => {
  for (const first of ['daily', 'feed']) await t.test(first, async () => {
    const f = await fixture({ payload: feed([{ vocab: 'bird', categories: 2, variants: ['birds'] }]) });
    try {
      if (first === 'daily') f.api.setTodayVocabulary([{ id: 'daily-bird', word: 'Bird' }], day());
      await f.api.loadHighlightVocab({ force: true });
      if (first === 'feed') f.api.setTodayVocabulary([{ id: 'daily-bird', word: 'Bird' }], day());
      for (const word of ['Birds', "bird's"]) {
        assert.ok(f.word(word).classList.contains('hl-today'), word);
        assert.ok(f.word(word).classList.contains('hl-wordbook'), word);
      }
      assert.equal(f.word('wings').classList.contains('hl-today'), false);
      assert.deepEqual(f.api.articleLegendCounts(f.root), { today: 2, wordbook: 2 });
      assert.equal(f.root.textContent, "Birds fly. The bird's wings and the reader’s book are strong.");
    } finally { f.close(); }
  });
});

test('nonbreaking-hyphen compounds remain one tappable word and match the provider spelling', async () => {
  const f = await fixture({ text: 'Oxygen‑starved peat preserves artefacts.',
    payload: feed([{ vocab: 'oxygen-starved', categories: 3 }]) });
  try {
    await f.api.loadHighlightVocab({ force: true });
    const word = f.word('Oxygen‑starved');
    assert.ok(word, 'typographic hyphens must not split the headword');
    assert.ok(word.classList.contains('hl-today'));
    assert.ok(word.classList.contains('hl-wordbook'));
    assert.equal(f.root.textContent, 'Oxygen‑starved peat preserves artefacts.');
  } finally { f.close(); }
});

test('a fresh cached feed can be explicitly revalidated to show words added elsewhere', async () => {
  const f = await fixture({ cached: { at: Date.now() - 1000, entries: [['bird', 2]] },
    payload: feed([{ vocab: 'bird', categories: 3, variants: ['birds'] }, { vocab: 'reader', categories: 2 }]) });
  try {
    await f.api.loadHighlightVocab();
    assert.equal(f.state.calls, 0);
    assert.equal(f.word('reader’s').classList.contains('hl-wordbook'), false);
    await f.api.loadHighlightVocab({ force: true });
    assert.equal(f.state.calls, 1);
    assert.ok(f.word('reader’s').classList.contains('hl-wordbook'));
    assert.ok(f.word('Birds').classList.contains('hl-today'));
  } finally { f.close(); }
});

test('variants and daily supplements still match after restoring the offline cache', async () => {
  const first = await fixture({ payload: feed([{ vocab: 'bird', categories: 2, variants: ['birds'] }]) });
  await first.api.loadHighlightVocab({ force: true });
  const cached = JSON.parse(first.saved()); first.close();
  const second = await fixture({ cached, payload: new Error('offline') });
  try {
    second.api.setTodayVocabulary([{ word: 'bird' }], day());
    await second.api.loadHighlightVocab();
    assert.ok(second.word('Birds').classList.contains('hl-today'));
    assert.ok(second.word('Birds').classList.contains('hl-wordbook'));
    assert.equal(second.state.calls, 0);
  } finally { second.close(); }
});

test('missing covered_categories bits retain the last category and reject false full-success caching', async () => {
  const f = await fixture({ payload: feed([{ vocab: 'bird', categories: 3, variants: ['birds'] }]) });
  try {
    await f.api.loadHighlightVocab({ force: true });
    const complete = f.saved();
    f.state.payload = feed([{ vocab: 'reader', categories: 1 }], { covered_categories: 13, degraded: true });
    await assert.rejects(f.api.loadHighlightVocab({ force: true }), /不完整/);
    assert.ok(f.word('Birds').classList.contains('hl-wordbook'), 'missing wordbook data cannot erase the old wordbook');
    assert.equal(f.saved(), complete, 'an incomplete feed cannot renew the complete cache');
    f.state.payload = feed([{ vocab: 'reader', categories: 2 }]);
    await f.api.loadHighlightVocab({ force: true });
    assert.ok(f.word('reader’s').classList.contains('hl-wordbook'));
    assert.notEqual(f.saved(), complete);
  } finally { f.close(); }
});

test('degraded data is visible as partial even when all category bits are present', async () => {
  const f = await fixture({ payload: feed([{ vocab: 'bird', categories: 1 }], { degraded: true }) });
  try {
    await assert.rejects(f.api.loadHighlightVocab({ force: true }), /不完整/);
    assert.equal(f.saved(), null);
  } finally { f.close(); }
});

test('cross-midnight caches and in-memory tables never mark yesterday as today', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-12T00:05:00+08:00') });
  const f = await fixture({ cached: { at: Date.parse('2026-11-11T23:55:00+08:00'), entries: [['bird', 3], ['birds', 3]] } });
  try {
    f.api.setTodayVocabulary([{ word: 'bird' }], '2026-11-11');
    await f.api.loadHighlightVocab();
    assert.ok(f.word('Birds').classList.contains('hl-wordbook'));
    assert.equal(f.word('Birds').classList.contains('hl-today'), false);
    f.state.payload = feed([{ vocab: 'bird', categories: 3, variants: ['birds'] }]);
    await f.api.loadHighlightVocab({ force: true });
    assert.ok(f.word('Birds').classList.contains('hl-today'));
    t.mock.timers.tick(86400000);
    f.api.decorate(f.root);
    assert.equal(f.word('Birds').classList.contains('hl-today'), false);
    assert.ok(f.word('Birds').classList.contains('hl-wordbook'));
  } finally { f.close(); }
});

test('the feed records coverage, dates and exact variant families and rejects changing page dates', async () => {
  const one = await fetchVocabularyWithCounts(async () => feed([{ vocab: 'Reader', categories: 2, variants: ['readers'] }]));
  assert.equal(one.coveredCategories, 15);
  assert.equal(one.syncDate, day());
  assert.deepEqual(one.families, [['reader', 'readers']]);
  await assert.rejects(fetchVocabularyWithCounts(async page => ({ total: 2,
    vocabs: [{ vocab: `word-${page}`, categories: 1 }], date: page === 1 ? '2026-11-11' : '2026-11-12',
  })), /日期在分页中发生变化/);
});

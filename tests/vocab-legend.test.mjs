import test from 'node:test';
import assert from 'node:assert/strict';
import { countArticleCategories, CATEGORY_BITS } from '../web/read/vocab.mjs';

test('legend counts each distinct word once per category', () => {
  const masks = new Map([
    ['hotel', CATEGORY_BITS.wordbook],
    ['village', CATEGORY_BITS.today],
  ]);
  const counts = countArticleCategories(['hotel', 'the', 'hotel', 'village', 'hotel'], masks);
  assert.equal(counts.wordbook, 1);
  assert.equal(counts.today, 1);
});

test('a variant word counts through the mask of its entry', () => {
  // "hotels" is a variant in the same entry — it carries the entry's wordbook bit.
  const masks = new Map([
    ['hotel', CATEGORY_BITS.wordbook],
    ['hotels', CATEGORY_BITS.wordbook],
  ]);
  const counts = countArticleCategories(['hotels'], masks);
  assert.equal(counts.wordbook, 1);
});

test('a word in both categories counts in both', () => {
  const masks = new Map([
    ['sun-blanched', CATEGORY_BITS.wordbook | CATEGORY_BITS.today],
    ['plain', CATEGORY_BITS.today],
  ]);
  const counts = countArticleCategories(['sun-blanched', 'plain'], masks);
  assert.equal(counts.wordbook, 1);
  assert.equal(counts.today, 2);
});

test('unknown words and casing differences are handled', () => {
  const masks = new Map([['gordes', CATEGORY_BITS.wordbook]]);
  const counts = countArticleCategories(['Gordes', 'nonexistent'], masks);
  assert.equal(counts.wordbook, 1);
  assert.equal(counts.today, 0);
});

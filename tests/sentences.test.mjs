import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from '../web/read/sentences.mjs';

test('keeps a title and decimal inside the complete sentence', () => {
  const text = 'Dr. Smith paid $3.50. Next sentence!';
  const sentences = splitSentences(text);
  assert.deepEqual(sentences, ['Dr. Smith paid $3.50. ', 'Next sentence!']);
  assert.equal(sentences.join(''), text);
});

test('keeps punctuation and closing quotes with the sentence', () => {
  const text = 'Mr. Jones asked, “Are you ready?” Yes, I am.';
  assert.deepEqual(splitSentences(text), ['Mr. Jones asked, “Are you ready?” ', 'Yes, I am.']);
});

test('fallback keeps decimals and common abbreviations on older WebViews', () => {
  const text = 'Prof. Lee paid 2.75 dollars. Try e.g. apples. It worked!';
  assert.deepEqual(splitSentences(text, null), [
    'Prof. Lee paid 2.75 dollars. ', 'Try e.g. apples. ', 'It worked!',
  ]);
  assert.equal(splitSentences(text, null).join(''), text);
});

test('keeps text without punctuation, whitespace and line breaks intact', () => {
  const text = '  One sentence.\nNext sentence without a period';
  assert.equal(splitSentences(text).join(''), text);
  assert.equal(splitSentences(text, null).join(''), text);
  assert.deepEqual(splitSentences(''), []);
});

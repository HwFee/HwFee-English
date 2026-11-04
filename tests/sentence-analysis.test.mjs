import test from 'node:test';
import assert from 'node:assert/strict';
import { clauseSplit } from '../web/read/analysis.mjs';

test('clauseSplit keeps a short simple sentence as one main segment', () => {
  const segments = clauseSplit('He left early.');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, 'pred');
  assert.equal(segments[0].label, '主干');
  assert.equal(segments[0].text, 'He left early.');
});

test('clauseSplit cuts before clause markers and tags them', () => {
  const segments = clauseSplit(
    'The findings suggest that the effect, which researchers measured carefully, persists because the conditions remain stable.');
  assert.equal(segments[0].label, '主干');
  const byText = (prefix) => segments.find((segment) => segment.text.startsWith(prefix));
  assert.equal(byText('that').label, '从句');
  assert.equal(byText('that').type, 'clause');
  assert.equal(byText('which').label, '从句');
  assert.equal(byText('which').type, 'clause');
  assert.equal(byText('because').label, '状语从句');
  assert.equal(byText('because').type, 'prep');
  const joined = segments.map((segment) => segment.text).join(' ');
  assert.ok(joined.includes('persists because the conditions remain stable'));
});

test('clauseSplit marks coordinators as 并列', () => {
  const segments = clauseSplit('She opened the window and she let the morning air in.');
  assert.equal(segments.length, 2);
  assert.equal(segments[1].label, '并列');
  assert.equal(segments[1].type, 'coord');
  assert.equal(segments[1].text, 'and she let the morning air in.');
});

test('clauseSplit treats a parenthesised stretch as an insert', () => {
  const segments = clauseSplit('The method (first described in 1962) still works today.');
  const insert = segments.find((segment) => segment.label === '插入语');
  assert.ok(insert);
  assert.equal(insert.type, 'appos');
  assert.ok(insert.text.startsWith('('));
});

test('clauseSplit caps output and never yields empty segments', () => {
  const long = 'a '.repeat(60) + 'that b, which c, because d, and e, if f, when g, who h, or i.';
  const segments = clauseSplit(long);
  assert.ok(segments.length <= 8);
  assert.ok(segments.every((segment) => segment.text.length > 0));
});

test('clauseSplit handles empty input', () => {
  assert.deepEqual(clauseSplit(''), []);
  assert.deepEqual(clauseSplit(null), []);
});

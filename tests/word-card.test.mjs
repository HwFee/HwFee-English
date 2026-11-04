import test from 'node:test';
import assert from 'node:assert/strict';
import { briefMeaning } from '../web/read/gestures.mjs';

test('briefMeaning keeps at most three meanings of a sense', () => {
  assert.equal(briefMeaning('进餐；用饭'), '进餐；用饭');
  assert.equal(briefMeaning('a；b；c；d；e'), 'a；b；c');
  assert.equal(briefMeaning('one; two; three; four'), 'one；two；three');
  assert.equal(briefMeaning(''), '');
  assert.equal(briefMeaning(undefined), '');
});

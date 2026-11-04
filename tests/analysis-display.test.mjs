import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisDisplaySegments } from '../web/read/analysis-display.mjs';

test('punctuation keeps its place without receiving an independent grammar label', () => {
  const parts = [
    ['“', 'other', '标点'], ['The children', 'subj', '主语'], [', ', 'other', '其他'],
    ['(', 'other', '标点'], ['still tired', 'appos', '插入语'], [') ', 'other', '标点'],
    ['stayed inside', 'pred', '谓语'], ['.”', 'other', '标点'],
  ].map(([text, type, label]) => ({ text, type, label }));
  const source = parts.map(s => s.text).join('');
  const result = analysisDisplaySegments(source, parts);
  assert.equal(result.map(s => s.text).join(''), source);
  assert.deepEqual(result.map(s => s.label), ['主语', '插入语', '谓语']);
  assert.equal(result[0].text, '“The children, ');
  assert.equal(result[1].text, '(still tired) ');
  assert.equal(result[2].text, 'stayed inside.”');
  assert.equal(parts[0].text, '“', 'cached provider data is untouched');
});

test('word-by-word fragments of one role combine without merging across a comma', () => {
  const parts = ['The ', 'young ', 'children, ', 'their parents'].map(text => ({ text, type: 'subj', label: '主语' }));
  assert.deepEqual(analysisDisplaySegments(parts.map(s => s.text).join(''), parts).map(s => s.text),
    ['The young children, ', 'their parents']);
});

test('unanalysed words reject the result instead of hiding missing analysis', () => {
  for (const label of ['其他', '未分析', '未知', '']) {
    assert.throws(() => analysisDisplaySegments('This remains.', [{ text: 'This remains.', type: 'other', label }]), /尚未完成/);
  }
  assert.equal(analysisDisplaySegments('happy', [{ text: 'happy', type: 'other', label: '表语' }])[0].label, '表语');
});

test('source whitespace and numeric components survive display cleanup', () => {
  const result = analysisDisplaySegments('In  1962,\tthey left.', [
    { text: 'In ', type: 'prep', label: '介词' }, { text: '1962', type: 'obj', label: '时间' },
    { text: ', ', type: 'other', label: '标点' }, { text: 'they left.', type: 'clause', label: '主句' },
  ]);
  assert.equal(result.map(s => s.text).join(''), 'In  1962,\tthey left.');
  assert.equal(result[1].label, '时间');
  assert.throws(() => analysisDisplaySegments('Different.', [{ text: 'Original.', label: '主句' }]), /不匹配/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const sentence = 'While the rain fell, the children stayed inside and read.';
const valid = { provider: 'shanbay', cached: true, remainingPercent: 98,
  analysis: { schemaVersion: 2, sentence, segments: [
    { type: 'clause', text: 'While the rain fell, ', label: '让步状语从句' },
    { type: 'pred', text: 'the children stayed inside and read.', label: '完整主句' },
  ] } };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

async function fixture(api, text = sentence) {
  const dom = new JSDOM('<span id="sentence"></span>', { url: 'https://localhost', pretendToBeVisual: true });
  const w = dom.window;
  w.document.getElementById('sentence').textContent = text;
  w.Capacitor = { Plugins: { Llm: api } };
  const notices = [];
  w.hwfeeToast = (message, options) => notices.push({ message, options });
  w.Element.prototype.getClientRects = () => [{ left: 20, top: 140, right: 180, bottom: 165 }];
  w.Element.prototype.getBoundingClientRect = () => ({ left: 20, top: 140, right: 180, bottom: 165 });
  globalThis.window = w; globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w); globalThis.IntersectionObserver = undefined;
  const { sentenceCard } = await import('../web/read/gestures.mjs');
  const { closePopover } = await import('../web/read/popover.mjs');
  return { w, notices, open: () => sentenceCard(w.document.getElementById('sentence')),
    close() { closePopover(); w.close(); } };
}

test('analysis and translation show only their content without provider, cache or quota footers', async () => {
  let analyzes = 0, translations = 0;
  const f = await fixture({ analyze: async ({ text }) => { analyzes++; assert.equal(text, sentence); return valid; },
    translate: async () => { translations++; return { translation: '孩子们在室内阅读。', provider: 'llm', model: 'fixture', cached: true,
      fallbackReason: '扇贝今日额度已用完', remainingPercent: 0, quotaResetAt: '2026-11-04T00:00:00+08:00' }; } });
  try {
    f.open(); await settle();
    assert.equal(analyzes, 1); assert.equal(translations, 0);
    const marks = [...document.querySelectorAll('.ana-seg')];
    assert.equal(marks.map(mark => mark.firstChild.textContent).join(''), sentence);
    assert.deepEqual(marks.map(mark => mark.querySelector('.ana-tag').textContent), ['让步状语从句', '完整主句']);
    assert.equal(document.querySelector('.ana-note'), null);
    assert.doesNotMatch(document.querySelector('.popover').textContent, /扇贝|缓存|98%/);
    [...document.querySelectorAll('.pop-seg-btn')].find(tab => tab.textContent.includes('翻译')).click();
    await settle();
    assert.equal(translations, 1);
    assert.equal(document.querySelector('.popover-body').textContent, '孩子们在室内阅读。');
    assert.equal(document.querySelector('.ana-note'), null);
  } finally { f.close(); }
});

test('cached placeholders cannot appear as a successful complete analysis', async () => {
  const f = await fixture({ analyze: async () => ({ ...valid, analysis: { ...valid.analysis,
    segments: [{ type: 'other', text: sentence, label: '未分析' }] } }) });
  try {
    f.open(); await settle();
    assert.equal(document.querySelector('.ana-seg'), null);
    assert.match(document.querySelector('.popover-body').textContent, /整句分析尚未完成/);
    assert.equal(document.querySelector('.pop-btn').textContent, '重试分析');
  } finally { f.close(); }
});

test('closing a pending analysis cancels only its subscription and late results cannot reopen the card', async () => {
  let finish, sent, cancelled;
  const f = await fixture({ analyze: args => { sent = args; return new Promise(resolve => { finish = resolve; }); },
    cancelSentence: async args => { cancelled = args; } });
  try {
    const card = f.open(); await settle();
    assert.ok(sent.requestId);
    card.close(); await settle();
    assert.equal(cancelled.requestId, sent.requestId);
    finish(valid); await settle();
    assert.equal(document.querySelector('.popover'), null);
  } finally { f.close(); }
});

test('word gates avoid unnecessary analysis calls and never submit an over-300-word selection', async () => {
  let analyses = 0, translations = 0;
  for (const count of [9, 121, 301]) {
    const f = await fixture({ analyze: async () => { analyses++; return valid; },
      translate: async () => { translations++; return { translation: '测试译文', provider: 'shanbay' }; } }, 'word '.repeat(count).trim());
    try {
      f.open(); await settle();
      assert.equal(document.querySelectorAll('.pop-seg-btn').length, count <= 300 ? 1 : 0);
      if (count > 300) assert.match(f.notices.at(-1).message, /301 词，上限 300 词/);
    } finally { f.close(); }
  }
  assert.equal(analyses, 0); assert.equal(translations, 2);
});

test('an invalid analysis is shown as an error with retry instead of being replaced by local heuristics', async () => {
  let attempts = 0;
  const f = await fixture({ analyze: async () => ++attempts === 1
    ? { ...valid, analysis: { ...valid.analysis, segments: [{ type: 'subj', text: 'Wrong', label: '主语' }] } } : valid });
  try {
    f.open(); await settle();
    assert.equal(document.querySelector('.ana-seg'), null);
    assert.match(document.querySelector('.popover').textContent, /与原句不匹配/);
    const retry = document.querySelector('.popover .pop-btn');
    assert.equal(retry.textContent, '重试分析');
    retry.click(); await settle();
    assert.equal(attempts, 2); assert.equal(document.querySelectorAll('.ana-seg').length, 2);
  } finally { f.close(); }
});

test('a provider that normalized the sentence spacing still renders instead of failing', async () => {
  // Shanbay echoes runs of spaces, tabs and NBSP back as single spaces; that must not reject a
  // usable analysis, and the source spacing is what the card shows.
  const spaced = 'While the rain  fell, the children\tstayed inside and read.';
  const normalized = { ...valid, analysis: { schemaVersion: 2, sentence: spaced, segments: [
    { type: 'clause', text: 'While the rain fell, ', label: '让步状语从句' },
    { type: 'pred', text: 'the children stayed inside and read.', label: '完整主句' },
  ] } };
  const f = await fixture({ analyze: async () => normalized }, spaced);
  try {
    f.open(); await settle();
    const marks = [...document.querySelectorAll('.ana-seg')];
    assert.equal(marks.length, 2);
    assert.equal(marks.map(mark => mark.firstChild.textContent).join(''), spaced);
    assert.equal(document.querySelector('.pop-btn'), null);
  } finally { f.close(); }
});

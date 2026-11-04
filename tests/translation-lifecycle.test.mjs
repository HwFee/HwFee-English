import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('missing native bridge leaves its message visible after the translation skeleton', async () => {
  const dom = new JSDOM('<span id="sentence">Birds fly.</span>', { url: 'https://localhost/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.IntersectionObserver = undefined;
  dom.window.Element.prototype.getClientRects = () => [{ left: 20, top: 140, right: 160, bottom: 165 }];
  dom.window.Element.prototype.getBoundingClientRect = () => ({ left: 20, top: 140, right: 160, bottom: 165 });
  const { sentenceCard } = await import('../web/read/gestures.mjs');
  const { closePopover } = await import('../web/read/popover.mjs');
  try {
    sentenceCard(document.getElementById('sentence'));
    const tabs = [...document.querySelectorAll('.pop-seg-btn')];
    const translation = tabs.find(tab => tab.textContent.includes('翻译'));
    translation.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.match(document.querySelector('.popover').textContent, /请更新 App/);
    assert.equal(document.querySelector('.popover [aria-busy="true"]'), null);
    tabs[0].click();
    translation.click();
    assert.match(document.querySelector('.popover').textContent, /请更新 App/);
  } finally { closePopover(); dom.window.close(); }
});

test('the analysis adapter uses the top bridge and passes through the structured backend result', async () => {
  let received;
  const response = { analysis: { schemaVersion: 1, sentence: 'Birds fly.', segments: [] }, model: 'model', cached: true };
  globalThis.window = { top: { Capacitor: { Plugins: { Llm: { analyze: async args => { received = args; return response; } } } } },
    Capacitor: { Plugins: { Llm: { analyze: () => assert.fail('iframe bridge must not be used') } } } };
  const { analyzeSentence } = await import('../web/read/llm.mjs');
  assert.deepEqual(await analyzeSentence('Birds fly.'), response);
  assert.deepEqual(received, { text: 'Birds fly.' });
});

test('failed translation offers a working retry inside the same open sentence card', async () => {
  const dom = new JSDOM('<span id="sentence">Birds fly.</span>', { url: 'https://localhost/', pretendToBeVisual: true });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.Element.prototype.getClientRects = () => [{ left: 20, top: 140, right: 160, bottom: 165 }];
  dom.window.Element.prototype.getBoundingClientRect = () => ({ left: 20, top: 140, right: 160, bottom: 165 });
  let calls = 0;
  dom.window.Capacitor = { Plugins: { Llm: { translate: async () => {
    if (++calls === 1) throw new Error('请求太频繁');
    return { translation: '鸟会飞。' };
  } } } };
  const { sentenceCard } = await import('../web/read/gestures.mjs');
  const { closePopover } = await import('../web/read/popover.mjs');
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  try {
    sentenceCard(document.getElementById('sentence'));
    [...document.querySelectorAll('.pop-seg-btn')].find(tab => tab.textContent.includes('翻译')).click();
    await settle();
    const retry = document.querySelector('.popover .pop-btn');
    assert.equal(retry.textContent, '重试翻译');
    retry.click(); await settle();
    assert.equal(document.querySelector('.pop-translation').textContent, '鸟会飞。');
    assert.equal(calls, 2);
    assert.equal(document.querySelector('[aria-busy="true"]'), null);
  } finally { closePopover(); dom.window.close(); }
});

test('a bridge reply that never arrives times out and a later retry remains usable', async () => {
  const { translateSentence } = await import('../web/read/llm.mjs');
  const schedule = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = new Map();
  let sequence = 0, cleared = 0;
  globalThis.setTimeout = (fn) => { const id = ++sequence; timers.set(id, fn); return id; };
  globalThis.clearTimeout = id => { timers.delete(id); cleared++; };
  globalThis.window = { top: { Capacitor: { Plugins: { Llm: { translate: () => new Promise(() => {}) } } } } };
  try {
    const pending = translateSentence('Birds fly.');
    const rejected = assert.rejects(pending, error => error.code === 'TIMEOUT');
    timers.get(1)(); await rejected;
    window.top.Capacitor.Plugins.Llm.translate = async () => ({ translation: '鸟会飞。', cached: true });
    assert.equal((await translateSentence('Birds fly.')).cached, true);
    assert.equal(timers.size, 0);
    assert.equal(cleared, 2);
  } finally { globalThis.setTimeout = schedule; globalThis.clearTimeout = clear; }
});

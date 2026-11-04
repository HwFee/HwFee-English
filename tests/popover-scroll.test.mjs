// The sentence card's 长难句分析 / 翻译 tabs must stay pinned while only the answer scrolls.
// jsdom has no layout engine, so this pins the structural + CSS contract that produces the
// behaviour, and the real-browser pass proves the rendered result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const sentence = 'While the rain fell, the children stayed inside and read.';
const longAnalysis = { provider: 'shanbay', cached: false, analysis: { schemaVersion: 2, sentence, segments: [
  { type: 'clause', text: 'While the rain fell, ', label: '让步状语从句' },
  { type: 'pred', text: 'the children stayed inside and read.', label: '完整主句' },
] } };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

const css = await readFile(new URL('../web/read/gestures.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, `missing rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};
const darkBlock = () => {
  const start = css.indexOf('@media (prefers-color-scheme: dark)');
  assert.notEqual(start, -1, 'missing dark-mode block');
  return css.slice(start, css.indexOf('\n}', start));
};

test('the card header is outside the scroll container and the card itself never scrolls', async () => {
  const dom = new JSDOM('<span id="sentence"></span>', { url: 'https://localhost', pretendToBeVisual: true });
  const w = dom.window;
  w.document.getElementById('sentence').textContent = sentence;
  w.Capacitor = { Plugins: { Llm: { analyze: async () => longAnalysis } } };
  w.Element.prototype.getClientRects = () => [{ left: 20, top: 140, right: 180, bottom: 165 }];
  w.Element.prototype.getBoundingClientRect = () => ({ left: 20, top: 140, right: 180, bottom: 165, width: 160, height: 25 });
  // A tall card in a short viewport: this is the case that used to scroll the tabs away.
  // offsetHeight/offsetWidth live on HTMLElement.prototype in jsdom, so override them there.
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList?.contains('popover') ? 600 : 40; } });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 320; } });
  globalThis.window = w; globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w);
  globalThis.IntersectionObserver = undefined;
  const { sentenceCard } = await import('../web/read/gestures.mjs');
  const { closePopover } = await import('../web/read/popover.mjs');
  try {
    sentenceCard(w.document.getElementById('sentence'));
    await settle();
    const popover = w.document.querySelector('.popover.is-sentence');
    assert.ok(popover, 'the sentence card opened');
    const body = popover.querySelector(':scope > .popover-body');
    assert.ok(body, '.popover-body is a direct child of the card');
    const tabs = popover.querySelector(':scope > .pop-seg');
    assert.ok(tabs, 'the tablist is a direct child of the card, not of the body');
    assert.equal(body.contains(tabs), false);
    assert.equal(body.querySelector('.pop-seg'), null);
    // Tabs must be first, body last: the header cannot end up below scrolling content.
    assert.equal(popover.firstElementChild, tabs);
    assert.equal(popover.lastElementChild, body);
    // The cap lands on the card; scrolling must not be moved onto the card.
    assert.match(popover.style.maxHeight, /^\d+px$/);
    assert.equal(popover.style.overflowY, '');
    assert.ok(Number.parseFloat(popover.style.maxHeight) < 600, 'the card is capped below its natural height');
  } finally {
    closePopover();
    w.close();
  }
});

test('the stylesheet pins the header and gives the body the scroll', () => {
  assert.match(rule('.popover'), /display:\s*flex/);
  assert.match(rule('.popover'), /flex-direction:\s*column/);
  assert.match(rule('.pop-seg,\n.popover-kicker'), /flex:\s*0 0 auto/);
  assert.match(rule('.popover-body'), /overflow-y:\s*auto/);
  assert.match(rule('.popover-body'), /min-height:\s*0/);
});

test('the scrolling body shows no scrollbar and never scrolls sideways', () => {
  const body = rule('.popover-body');
  assert.match(body, /overflow-x:\s*hidden/, 'a horizontal scrollbar must be impossible');
  assert.match(body, /scrollbar-width:\s*none/, 'Firefox/WebView standard way to hide the bar');
  assert.match(css, /\.popover-body::-webkit-scrollbar\s*\{[^}]*width:\s*0/, 'the WebKit bar is hidden too');
  assert.doesNotMatch(body, /overflow-x:\s*auto/);
});

test('long-sentence analysis has its own dark palette per role colour', () => {
  const dark = darkBlock();
  for (const role of ['subj', 'pred', 'obj', 'clause', 'prep', 'nonpred', 'appos', 'coord', 'other']) {
    assert.match(dark, new RegExp(`\\.ana-seg\\.is-${role}[^{]*\\{[^}]*background`), `dark ${role} span`);
  }
  assert.match(dark, /\.ana-seg\s*\{[^}]*color:\s*var\(--ink\)/, 'dark spans use light text');
  // The light palette must not leak hardcoded near-black text into the dark theme.
  assert.match(rule('.ana-seg'), /color:\s*rgb\(38, 38, 38\)/);
});

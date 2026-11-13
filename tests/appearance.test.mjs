import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const shell = (await readFile(new URL('../web/shell.js', import.meta.url), 'utf8')).replace(/^import .+;\r?$/gm, '');
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture({ fail = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  let theme = { mode: 'system', dark: true };
  const changes = [];
  w.hydrateIcons = () => {}; w.setIcon = () => {}; w.icon = () => w.document.createElement('span');
  w.Capacitor = { Plugins: { TabBar: {
    getMetrics: async () => ({ available: false }), addListener: async () => ({ remove() {} }),
    setState: async () => ({}), getAppearance: async () => ({ ...theme }),
    setAppearance: async ({ mode }) => {
      changes.push(mode);
      if (fail) throw new Error('保存失败');
      theme = { mode, dark: mode !== 'light' };
      return { ...theme };
    },
  }, Lessons: { consumeShared: async () => ({ imported: [] }) } } };
  w.eval(shell);
  return { dom, w, doc: w.document, changes };
}

test('three-segment appearance control shows current mode, switches directly, and supports keyboard navigation', async () => {
  const f = fixture(); await settle();
  const seg = f.doc.getElementById('appearanceSeg');
  const btn = (mode) => seg.querySelector(`[data-mode="${mode}"]`);
  assert.equal(seg.dataset.active, '0');
  assert.equal(seg.classList.contains('is-disabled'), false);
  assert.equal(btn('system').getAttribute('aria-checked'), 'true');
  assert.equal(btn('light').getAttribute('aria-checked'), 'false');
  assert.equal(btn('dark').getAttribute('aria-checked'), 'false');
  assert.equal(btn('system').disabled, false);
  assert.equal(f.doc.getElementById('appearanceSystem'), null, 'legacy reset link is gone');

  // Clicking the already-selected segment does not fire a redundant write
  btn('system').click(); await settle();
  assert.deepEqual(f.changes, []);

  btn('light').click(); await settle();
  assert.deepEqual(f.changes, ['light']);
  assert.equal(seg.dataset.active, '1');
  assert.equal(btn('light').getAttribute('aria-checked'), 'true');
  assert.match(f.doc.getElementById('appearanceState').textContent, /已固定为浅色/);

  btn('dark').click(); await settle();
  assert.deepEqual(f.changes, ['light', 'dark']);
  assert.equal(seg.dataset.active, '2');
  assert.equal(btn('dark').getAttribute('aria-checked'), 'true');
  assert.match(f.doc.getElementById('appearanceState').textContent, /已固定为深色/);

  // ArrowRight wraps from dark (2) back to system (0)
  seg.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await settle();
  assert.equal(f.changes.at(-1), 'system');
  assert.equal(seg.dataset.active, '0');
  assert.equal(btn('system').getAttribute('aria-checked'), 'true');
  assert.match(f.doc.getElementById('appearanceState').textContent, /跟随系统/);
  assert.equal(f.doc.getElementById('autoTranslate').closest('.card'), f.doc.getElementById('llmState').closest('.card'));
  f.dom.window.close();
});

test('a failed appearance write restores the last confirmed segment state', async () => {
  const f = fixture({ fail: true }); await settle();
  const seg = f.doc.getElementById('appearanceSeg');
  const light = seg.querySelector('[data-mode="light"]');
  const system = seg.querySelector('[data-mode="system"]');
  light.click(); await settle();
  assert.equal(seg.dataset.active, '0');
  assert.equal(system.getAttribute('aria-checked'), 'true');
  assert.equal(light.getAttribute('aria-checked'), 'false');
  assert.equal(light.disabled, false);
  assert.match(f.doc.getElementById('toast').textContent, /外观切换失败/);
  f.dom.window.close();
});

test('explicit palettes reach shell and loaded lesson styles without relying on the system media query', async () => {
  const f = fixture(); await settle();
  const style = f.doc.createElement('style');
  style.textContent = '@media (prefers-color-scheme: dark) { body { color: white; } }';
  f.doc.head.append(style);
  const frame = f.doc.getElementById('listenFrame');
  frame.contentDocument.open();
  frame.contentDocument.write('<html><head><style>@media (prefers-color-scheme:dark){body{background:black}}</style></head><body></body></html>');
  frame.contentDocument.close();
  frame.dispatchEvent(new f.w.Event('load'));
  assert.equal(style.sheet.cssRules[0].media.mediaText, 'all');
  assert.equal(frame.contentDocument.styleSheets[0].cssRules[0].media.mediaText, 'all');
  const seg = f.doc.getElementById('appearanceSeg');
  seg.querySelector('[data-mode="light"]').click(); await settle();
  assert.equal(style.sheet.cssRules[0].media.mediaText, 'not all');
  assert.equal(frame.contentDocument.styleSheets[0].cssRules[0].media.mediaText, 'not all');
  assert.equal(frame.contentDocument.documentElement.style.colorScheme, 'light');
  seg.querySelector('[data-mode="dark"]').click(); await settle();
  assert.equal(style.sheet.cssRules[0].media.mediaText, 'all');
  f.dom.window.close();
});

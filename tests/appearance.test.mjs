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

test('appearance switch shows the current mode, changes immediately, and can return to system', async () => {
  const f = fixture(); await settle();
  const input = f.doc.getElementById('darkMode'), system = f.doc.getElementById('appearanceSystem');
  assert.equal(input.checked, true); assert.equal(input.disabled, false); assert.equal(system.hidden, true);
  input.checked = false; input.dispatchEvent(new f.w.Event('change')); await settle();
  assert.deepEqual(f.changes, ['light']); assert.equal(input.checked, false); assert.equal(system.hidden, false);
  input.checked = true; input.dispatchEvent(new f.w.Event('change')); await settle();
  assert.deepEqual(f.changes, ['light', 'dark']); assert.match(f.doc.getElementById('appearanceState').textContent, /深色/);
  system.click(); await settle();
  assert.equal(f.changes.at(-1), 'system'); assert.equal(system.hidden, true);
  assert.equal(f.doc.getElementById('autoTranslate').closest('.card'), f.doc.getElementById('llmState').closest('.card'));
  f.dom.window.close();
});

test('a failed appearance write restores the last confirmed switch state', async () => {
  const f = fixture({ fail: true }); await settle();
  const input = f.doc.getElementById('darkMode');
  input.checked = false; input.dispatchEvent(new f.w.Event('change')); await settle();
  assert.equal(input.checked, true); assert.equal(input.disabled, false);
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
  const input = f.doc.getElementById('darkMode');
  input.checked = false; input.dispatchEvent(new f.w.Event('change')); await settle();
  assert.equal(style.sheet.cssRules[0].media.mediaText, 'not all');
  assert.equal(frame.contentDocument.styleSheets[0].cssRules[0].media.mediaText, 'not all');
  assert.equal(frame.contentDocument.documentElement.style.colorScheme, 'light');
  input.checked = true; input.dispatchEvent(new f.w.Event('change')); await settle();
  assert.equal(style.sheet.cssRules[0].media.mediaText, 'all');
  f.dom.window.close();
});

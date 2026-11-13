import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const css = await readFile(new URL('../web/shell.css', import.meta.url), 'utf8');
const preview = await readFile(new URL('../designs/ux-pm-preview.html', import.meta.url), 'utf8').catch(() => null);

test('draft and saved API keys use the same large filled-circle font while the field stays a native password input', async () => {
  const dom = new JSDOM(await readFile(new URL('../web/index.html', import.meta.url), 'utf8'));
  try {
    const input = dom.window.document.getElementById('llmKey');
    assert.equal(input.type, 'password');
    assert.equal(input.autocomplete, 'off');
    assert.equal(input.value, '', 'a saved key is never returned to the field');
    assert.match(css, /font-family: 'HwFee Password Dots';[\s\S]*unicode-range: U\+2022, U\+25CF/);
    assert.match(css, /\.field input#llmKey \{[^}]*font-family: 'HwFee Password Dots', var\(--ui\);[^}]*font-size: 13px;[^}]*letter-spacing: 2\.5px/s);
    assert.match(css, /\.field input#llmKey\.has-saved-key::placeholder \{[^}]*font-family: 'HwFee Password Dots'/);
    if (preview) assert.match(preview, /#apiKeyDemo \{[^}]*font-family: 'HwFee Password Dots'/);
    const font = await readFile(new URL('../web/fonts/PasswordDots.woff2', import.meta.url));
    assert.equal(font.toString('ascii', 0, 4), 'wOF2');
    assert.ok(font.length < 4096, 'the mask-only asset does not bundle a second UI font');
  } finally { dom.window.close(); }
});

test('settings keeps the preview heading, disclosure spacing, quota label and scrollbar-free viewport', () => {
  assert.match(css, /\.set-wrap h1 \{[^}]*line-height: 1\.15/s);
  assert.match(css, /\.api-fields \{ padding-top: 10px; \}/);
  assert.match(css, /\.cookie-fields \{ padding-top: 10px; \}/);
  assert.match(css, /\.field-label \{[^}]*font-size: 12\.5px/);
  assert.match(css, /\.ua-val small \{[^}]*font-size: 12px;[^}]*font-weight: 500/);
  assert.match(css, /\.pane-settings \{[^}]*overflow-y: auto;[^}]*scrollbar-width: none/);
  assert.match(css, /\.appearance-seg \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*height: 36px/s);
});

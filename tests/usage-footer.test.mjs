// The usage card's supporting lines are single-line by contract: each row shows one line of
// detail, the observation time appears once, and the footer stays on one line. jsdom has no
// layout engine, so this pins the CSS that the browser pass measures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../web/shell.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const start = css.indexOf('\n' + selector + ' {');
  assert.notEqual(start, -1, `missing rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

test('row detail lines and the footer never wrap', () => {
  for (const selector of ['.ua-sub', '.ue-comp', '.u-foot']) {
    const body = rule(selector);
    assert.match(body, /white-space:\s*nowrap/, `${selector} must not wrap`);
    assert.match(body, /overflow:\s*hidden/, `${selector} must clip instead of spilling`);
    assert.match(body, /text-overflow:\s*ellipsis/, `${selector} must ellipsize rather than cut mid-glyph`);
  }
});

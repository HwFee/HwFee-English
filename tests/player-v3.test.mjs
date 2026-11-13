import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../web/listen/player-v3.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function fixture({ fail = false } = {}) {
  const dom = new JSDOM('<div class="app" id="app"><header class="top"><div class="col"><a id="bHome"><svg></svg></a><button id="bList"></button></div></header><div class="veil" id="veil"></div></div>', {
    url: 'https://localhost/lessons/course/player.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, calls = [], notices = [];
  w.Capacitor = { Plugins: { Audio: { sleep: async value => {
    calls.push(value); if (fail) throw new Error('睡眠定时需要先开始播放'); return { seconds: value.minutes * 60 };
  } } } };
  Object.defineProperty(w, 'parent', { value: { hwfeeToast: (...args) => notices.push(args) } });
  w.eval(source);
  return { dom, w, calls, notices };
}

test('V3 player adds a back chevron, blind-listening copy and a working native sleep timer', async () => {
  const f = fixture();
  try {
    assert.equal(f.w.document.getElementById('bHome').getAttribute('aria-label'), '返回课程库');
    assert.match(f.w.document.getElementById('veil').textContent, /盲听阶段/);
    const sleep = f.w.document.getElementById('hwfeeSleep'), scrim = f.w.document.getElementById('hwfeeSleepScrim');
    assert.equal(sleep.textContent, '', 'the sleep control is an icon only');
    assert.equal(sleep.querySelectorAll('svg').length, 1);
    sleep.click(); assert.equal(scrim.hidden, false); assert.equal(sleep.getAttribute('aria-expanded'), 'true');
    f.w.document.querySelector('[data-minutes="15"]').click(); await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ minutes: 15 }]);
    assert.equal(scrim.hidden, true);
    assert.equal(sleep.classList.contains('is-active'), true);
    assert.match(sleep.getAttribute('aria-label'), /15 分钟/);
    f.w.document.querySelector('[data-minutes="0"]').click(); await settle();
    assert.equal(sleep.classList.contains('is-active'), false);
    assert.equal(sleep.getAttribute('aria-label'), '睡眠定时');
    sleep.click(); f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(scrim.hidden, true);
  } finally { f.dom.window.close(); }
});

test('V3 sleep timer keeps the sheet open when native playback has no session', async () => {
  const f = fixture({ fail: true });
  try {
    f.w.document.getElementById('hwfeeSleep').click();
    f.w.document.querySelector('[data-minutes="30"]').click(); await settle();
    assert.equal(f.w.document.getElementById('hwfeeSleepScrim').hidden, false);
    assert.match(f.notices.at(-1)[0], /无法设置睡眠定时/);
    assert.match(f.notices.at(-1)[1].detail, /先开始播放/);
  } finally { f.dom.window.close(); }
});

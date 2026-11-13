import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const library = await readFile(new URL('../web/listen/library-shim.js', import.meta.url), 'utf8');
const savedState = await readFile(new URL('../web/listen/saved-state.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function fixture() {
  const lessons = [
    { id: 'active', dir: '/lessons/active', title: 'Active course', podcast: 'Podcast', segments: 3, duration: 180 },
    { id: 'fresh', dir: '/lessons/fresh', title: 'Fresh course', podcast: 'Podcast', segments: 2, duration: 120 },
  ];
  const cards = lessons.map(lesson => `<div class="card" data-course="${lesson.id}"><div class="top"><div class="cover"></div><div><div class="tt">${lesson.title}</div></div></div><div class="pg"><i></i></div><div class="pgt"></div><div class="links"><a class="pri" href="${lesson.dir}/player.html#seg=1">精听</a><a href="${lesson.dir}/handout.html">讲义</a></div></div>`).join('');
  const dom = new JSDOM(`<script id="data" type="application/json">${JSON.stringify({ lessons })}</script><div id="stats"></div><a id="hero"></a><h2 id="hSaved"></h2><div id="saved"></div><h2 id="hLib"></h2><div id="grid">${cards}</div><div id="rv"><div id="rvB"></div></div><div id="stRev"><div class="k">待复习</div><div class="v"></div></div>`, {
    url: 'https://localhost/listen/library.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, opened = [], played = [], removed = [], notices = [];
  const saved = Array.from({ length: 5 }, (_, i) => ({ k: `/lessons/active#${i + 1}`, dir: '/lessons/active', n: i + 1,
    a: i * 5, b: i * 5 + 4, s: `Sentence ${i + 1}`, t: `句子 ${i + 1}`, title: 'Active course', at: i + 1 }));
  w.localStorage.setItem('cherina-pod:saved', JSON.stringify(saved));
  w.localStorage.setItem('cherina-lesson:active', JSON.stringify({ steps: { 1: 4 }, seg: 1 }));
  w.eval(savedState);
  w.__hwfeeSaved = { play: async item => played.push(item), pause: async () => {}, paint() {} };
  w.hwfeeRefreshSaved = () => { w.renderSaved(); w.__hwfeeSaved.paint(); };
  Object.defineProperty(w, 'parent', { value: {
    hwfeeOpenSavedSentenceInLesson: item => opened.push(item),
    hwfeeToast: (message, options) => notices.push({ message, options }),
    hwfeeRemoveLesson: async lesson => { removed.push(lesson.id); return true; },
  } });
  w.eval(library);
  return { dom, w, saved, opened, played, removed, notices };
}

test('V3 saved sentences form one grouped card with three-row expansion, separate navigation and undo', async () => {
  const f = fixture();
  try {
    assert.equal(f.w.document.querySelectorAll('#saved .sv').length, 3);
    assert.equal(f.w.document.querySelector('#hSaved small').textContent, '5');
    assert.equal(f.w.document.querySelectorAll('#saved .sv')[0].querySelector('.s').textContent, 'Sentence 5');
    f.w.document.querySelector('.saved-toggle').click();
    assert.equal(f.w.document.querySelectorAll('#saved .sv').length, 5);
    const first = f.w.document.querySelector('#saved .sv');
    first.querySelector('.sv-play').click(); await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(f.played)), [f.saved[4]]);
    first.querySelector('.sv-main').click();
    assert.deepEqual(JSON.parse(JSON.stringify(f.opened)), [f.saved[4]]);
    first.querySelector('.sv-remove').click(); await settle();
    assert.equal(f.w.__hwfeeSavedState.read().length, 4);
    assert.equal(f.w.document.querySelectorAll('#saved .sv').length, 4);
    assert.equal(f.notices.at(-1).message, '已取消收藏');
    f.notices.at(-1).options.undo();
    assert.equal(f.w.__hwfeeSavedState.read().length, 5);
    assert.equal(f.w.document.querySelectorAll('#saved .sv').length, 5);
  } finally { f.dom.window.close(); }
});

test('V3 course filter counts only unfinished started courses and the more menu reaches native removal', async () => {
  const f = fixture();
  try {
    assert.equal(f.w.document.querySelector('#courseFilter [data-filter="all"]').textContent, '全部 2');
    assert.equal(f.w.document.querySelector('#courseFilter [data-filter="active"]').textContent, '练习中 1');
    assert.equal(f.w.document.querySelector('[data-course="active"] .links .pri').textContent, '继续第 2 段');
    f.w.document.querySelector('#courseFilter [data-filter="active"]').click();
    assert.equal(f.w.document.querySelector('[data-course="active"]').hidden, false);
    assert.equal(f.w.document.querySelector('[data-course="fresh"]').hidden, true);
    const card = f.w.document.querySelector('[data-course="active"]');
    card.querySelector('.dots').click();
    assert.equal(card.querySelector('.course-menu').hidden, false);
    card.querySelector('.course-menu button').click(); await settle();
    assert.deepEqual(f.removed, ['active']);
  } finally { f.dom.window.close(); }
});

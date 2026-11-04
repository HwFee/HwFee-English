import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const identity = await readFile(new URL('../web/listen/player-identity.js', import.meta.url), 'utf8');
const library = await readFile(new URL('../web/listen/library-shim.js', import.meta.url), 'utf8');

test('served lesson identity separates level variants while preserving an existing position', () => {
  const dom = new JSDOM('<script id="data" type="application/json">{"id":"episode","dir":"episode","audio":"audio/episode.mp4"}</script>', {
    url: 'https://localhost/lessons/cet6-episode/player.html', runScripts: 'outside-only',
  });
  const { window: w } = dom;
  w.localStorage.setItem('cherina-lesson:episode', '{"seg":2,"step":1}');
  w.localStorage.setItem('cherina-lesson:cet4-episode', '{"seg":0,"step":0}');
  w.eval(identity);
  const data = JSON.parse(w.document.getElementById('data').textContent);
  assert.equal(data.id, 'cet6-episode');
  assert.equal(data.dir, '/lessons/cet6-episode');
  assert.equal(data.audio, 'audio/episode.mp4');
  assert.equal(JSON.parse(w.localStorage.getItem('cherina-lesson:cet6-episode')).seg, 2);
  assert.equal(JSON.parse(w.localStorage.getItem('cherina-lesson:cet4-episode')).seg, 0);
  w.localStorage.setItem('cherina-lesson:cet6-episode', '{"seg":3}');
  w.eval(identity);
  assert.equal(JSON.parse(w.localStorage.getItem('cherina-lesson:cet6-episode')).seg, 3);
  dom.window.close();
});

test('library follows the active lesson, current segment and pause state without a reload', () => {
  const lessons = ['cet4-old', 'cet6-new'].map(id => ({ id, dir: '/lessons/' + id, title: id,
    podcast: 'Podcast', segments: 4, duration: 600 }));
  const dom = new JSDOM('<script id="data" type="application/json"></script><a id="hero"></a><div id="grid"></div>', {
    url: 'https://localhost/listen/library.html', runScripts: 'outside-only',
  });
  const w = dom.window;
  w.document.getElementById('data').textContent = JSON.stringify({ lessons });
  w.localStorage.setItem('cherina-pod:last', JSON.stringify({ id: 'old' }));
  w.localStorage.setItem('cherina-lesson:cet6-new', JSON.stringify({ seg: 2, step: 1, steps: { 1: 4 } }));
  w.eval(library);
  w.hwfeeUpdateLibrary({ dir: 'cet6-new', segment: 3, step: 1, playing: true });
  const hero = w.document.getElementById('hero');
  assert.match(hero.href, /cet6-new\/player.html#seg=3$/);
  assert.equal(hero.querySelector('.tt').textContent, 'cet6-new');
  assert.match(hero.textContent, /正在播放 · 第 3 段 · 精听/);
  assert.equal(hero.querySelectorAll('.go rect').length, 2);
  w.hwfeeUpdateLibrary({ dir: 'cet6-new', segment: 4, step: 2, playing: false });
  assert.match(hero.textContent, /已暂停 · 第 4 段 · 对照/);
  assert.match(hero.href, /#seg=4$/);
  w.localStorage.setItem('hwfee:listen:last', JSON.stringify({ dir: 'cet6-new', segment: 4 }));
  w.hwfeeUpdateLibrary(null);
  assert.equal(hero.querySelector('.tt').textContent, 'cet6-new');
  assert.match(hero.textContent, /继续练习/);
  dom.window.close();
});

test('unchanged playback updates reuse parsed course progress while changed storage still reaches the hero', () => {
  const lessons = Array.from({ length: 39 }, (_, i) => ({ id: 'lesson' + i, dir: '/lessons/lesson' + i,
    title: 'Lesson ' + i, segments: 40 }));
  const dom = new JSDOM('<script id="data" type="application/json"></script><a id="hero"></a><div id="grid"></div>', {
    url: 'https://localhost/listen/library.html', runScripts: 'outside-only',
  });
  const w = dom.window;
  w.document.getElementById('data').textContent = JSON.stringify({ lessons });
  for (const lesson of lessons) w.localStorage.setItem('cherina-lesson:' + lesson.id, JSON.stringify({ seg: 2, step: 1, steps: { 0: 4 } }));
  w.eval(library);
  let parses = 0;
  const original = w.JSON.parse;
  w.JSON.parse = (...args) => { parses++; return original(...args); };
  for (let i = 0; i < 200; i++) w.hwfeeUpdateLibrary({ dir: 'lesson0', segment: 3, step: 1, playing: true });
  assert.equal(parses, 0, 'steady playback must not keep parsing the whole library');
  w.localStorage.setItem('cherina-lesson:lesson0', JSON.stringify({ seg: 3, step: 2, steps: { 0: 4, 1: 4 } }));
  w.hwfeeUpdateLibrary({ dir: 'lesson0', segment: 4, step: 2, playing: false });
  assert.equal(parses, 1);
  assert.match(w.document.getElementById('hero').textContent, /第 4 段 · 对照/);
  dom.window.close();
});

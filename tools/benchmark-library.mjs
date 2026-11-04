import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const lessons = Array.from({ length: 39 }, (_, i) => ({ id: 'lesson' + i, dir: '/lessons/lesson' + i,
  title: 'Lesson ' + i, segments: 40 }));
const dom = new JSDOM('<script id="data" type="application/json"></script><a id="hero"></a><div id="grid"></div>', {
  url: 'https://localhost/listen/library.html', runScripts: 'outside-only',
});
const w = dom.window;
w.document.getElementById('data').textContent = JSON.stringify({ lessons });
for (const lesson of lessons) w.localStorage.setItem('cherina-lesson:' + lesson.id, JSON.stringify({
  seg: 2, step: 1, steps: { 0: 4 }, parts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i,
    { cur: i * 10, step: 1, t: i * 30, stages: { 0: { cur: i * 10, step: 0, t: 1 } } } ])),
}));
w.eval(await readFile(new URL('../web/listen/library-shim.js', import.meta.url), 'utf8'));
let parses = 0;
const parse = w.JSON.parse;
w.JSON.parse = (...args) => { parses++; return parse(...args); };
const start = performance.now();
for (let i = 0; i < 200; i++) w.hwfeeUpdateLibrary({ dir: 'lesson0', segment: 3, step: 1, playing: true });
console.log(JSON.stringify({ scenario: '39 lessons, 200 unchanged playback updates', jsonParses: parses,
  elapsedMs: Math.round(performance.now() - start) }));
dom.window.close();

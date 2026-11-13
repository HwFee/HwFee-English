// Run after npm test, which emits the actual Java-served library fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('android/app/build/reports/listening-library-fixture.html', root), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/listen/library.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, commands = [], preparations = [], navigations = [];
const key = 'cherina-pod:saved';
const sentences = [0, 10, 20].map((a, i) => ({ n: i + 1, a, b: a + 5, s: 'Saved sentence ' + (i + 1) + '.', t: '收藏句子。' }));
const rows = sentences.map((s, i) => ({ ...s, dir: '/lessons/course', k: i ? '/lessons/course#' + s.n : 'legacy#7',
  title: 'Course', due: Date.now() + 86400000, reps: 0, at: 3 - i }));
w.localStorage.setItem(key, JSON.stringify(rows));
const checkpoint = JSON.stringify({ cur: 2, step: 1, t: 42.25 });
w.localStorage.setItem('cherina-lesson:course', checkpoint);
let fileReads = 0, before = 0;
w.fetch = async () => { fileReads++; return { ok: true, status: 200,
  text: async () => '<script id="data">' + JSON.stringify({ sentences, audio: 'audio/episode.mp4' }) + '</script>' }; };
w.Capacitor = { Plugins: { Audio: {
  addListener: async () => ({ remove() {} }),
  nativePrepare: async data => { preparations.push(data); return { prepared: true }; },
  nativeControl: async data => { commands.push(data); return {}; },
} } };
Object.defineProperty(w, 'parent', { value: {
  hwfeeOpenSavedSentence: item => navigations.push(item), hwfeeBeforeSavedClip: () => { before++; },
} });
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const count = () => Number(w.document.querySelector('#stRev .v').firstChild.textContent);
const saved = () => JSON.parse(w.localStorage.getItem(key));
try {
  for (const node of w.document.querySelectorAll('script')) {
    if (node.type === 'application/json') continue;
    w.eval(node.src ? await readFile(new URL('web' + new URL(node.src).pathname, root), 'utf8') : node.textContent);
  }
  assert.equal(count(), 3, 'all saved sentences count as pending even when their old due date is in the future');
  assert.equal(fileReads, 0, 'display must use the saved cache');
  w.document.querySelector('#saved button').click(); await settle();
  assert.equal(preparations.length, 1); assert.equal(navigations.length, 0);
  assert.equal(commands.find(command => command.action === 'play').drill, true);
  assert.equal(w.document.querySelector('#saved button').getAttribute('aria-label'), '暂停句子');
  w.document.getElementById('stRev').click(); await settle();
  assert.ok(w.document.getElementById('rv').classList.contains('on'));
  assert.equal(w.document.getElementById('rvN').textContent, '1 / 3');
  assert.equal(w.document.getElementById('rvP').getAttribute('aria-label'), '暂停句子',
    'opening review while its first bookmark is already playing must leave it playing');
  assert.deepEqual([...w.document.querySelectorAll('#rvG button')].map(button => button.textContent), ['忘了', '模糊', '记住了']);
  const grade = async value => {
    w.document.getElementById('rvF').click();
    w.document.querySelector('#rvG button[data-g="' + value + '"]').click(); await settle();
  };
  await grade(0); assert.equal(saved().length, 3); assert.equal(count(), 3);
  assert.equal(w.document.getElementById('rvN').textContent, '2 / 3');
  await grade(1); assert.equal(saved().length, 3); assert.equal(count(), 3);
  await grade(2); assert.equal(saved().length, 2); assert.equal(count(), 2);
  assert.equal(saved().some(item => item.s === sentences[2].s), false);
  assert.ok(w.document.querySelector('#rvB .done'));
  w.document.getElementById('rvX').click(); await settle();
  w.document.getElementById('stRev').click(); await settle();
  await grade(2); assert.equal(count(), 1);
  assert.equal(w.document.getElementById('rvN').textContent, '1 / 1');
  await grade(2); assert.equal(count(), 0); assert.deepEqual(saved(), []);
  assert.equal(w.document.querySelectorAll('#saved .sv').length, 0);
  assert.ok(w.document.querySelector('#rvB .done'));
  w.document.getElementById('rvX').click(); await settle();
  assert.equal(w.document.getElementById('rv').classList.contains('on'), false);
  assert.equal(w.localStorage.getItem('cherina-lesson:course'), checkpoint);
  assert.equal(navigations.length, 0); assert.ok(before > 0);

  w.localStorage.setItem(key, JSON.stringify(rows));
  w.hwfeeRefreshSaved();
  const healthyFetch = w.fetch;
  w.fetch = async () => ({ ok: false, status: 503 });
  w.document.getElementById('stRev').click(); await settle();
  assert.equal(count(), 3, 'a temporary course read failure must not consume the review queue');
  assert.deepEqual(saved(), rows);
  assert.equal(w.document.getElementById('rvN').textContent, '1 / 3');
  w.fetch = healthyFetch;
  w.document.getElementById('rvP').click(); await settle();
  assert.equal(w.document.getElementById('rvP').getAttribute('aria-label'), '暂停句子');
  w.document.getElementById('rvX').click(); await settle();
  // A bookmark saved from another document leaves the template's SAV copy stale; the
  // review entry must still open on the fresh list instead of doing nothing.
  w.localStorage.removeItem(key);
  w.hwfeeRefreshSaved();
  w.localStorage.setItem(key, JSON.stringify([rows[0]]));
  const reviewLink = w.document.querySelector('#hSaved .review-link');
  assert.ok(reviewLink, 'the review entry exists after a refresh');
  reviewLink.click(); await settle();
  assert.equal(w.document.getElementById('rv').classList.contains('on'), true,
    'a stale SAV copy must not make the review entry a no-op');
  assert.equal(w.document.getElementById('rvN').textContent, '1 / 1');
  w.document.getElementById('rvX').click(); await settle();
  console.log(JSON.stringify({ servedLibrary: true, inlinePlayback: true, originalLabels: true,
    allSavedArePending: true, rememberedRemovesSaved: true, counts: [3, 2, 1, 0],
    emptyState: true, normalCheckpointUnchanged: true, staleSaveStillOpensReview: true, fileReads }, null, 2));
} finally { dom.window.close(); }
// All assertions completed; do not let mocked browser socket handles keep the CLI alive.
process.exit(0);

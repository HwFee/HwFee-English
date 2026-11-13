import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../web/listen/saved-state.js', import.meta.url), 'utf8');
const key = 'cherina-pod:saved';
const lesson = { id: 'course', dir: '/lessons/course', legacyIds: ['cet6-course'], title: 'Course' };
const kept = { k: 'cet6-course#10', dir: 'cet6-course', n: 10, a: 20, b: 30, s: 'Still here.', due: 123, reps: 5, iv: 2, at: 50 };
const removed = { ...kept, k: 'cet6-course#11', s: 'A long old sentence that was split.', a: 30, b: 40 };
const sentences = [{ n: 4, a: 19.8, b: 29.5, s: 'Still here.', t: '仍然存在。' },
  { n: 5, a: 30, b: 35, s: 'A long old sentence.' }, { n: 6, a: 35, b: 40, s: 'That was split.' }];
function fixture(rows = [kept, removed]) {
  const dom = new JSDOM('', { url: 'https://localhost/index.html', runScripts: 'outside-only' });
  const w = dom.window, calls = [];
  w.localStorage.setItem(key, JSON.stringify(rows));
  w.fetch = async (...args) => { calls.push(args); return { ok: true, status: 200,
    text: async () => '<script type="application/json" id="data">' + JSON.stringify({ sentences }) + '</script>' }; };
  w.eval(source);
  return { dom, w, state: w.__hwfeeSavedState, calls, rows: () => JSON.parse(w.localStorage.getItem(key)) };
}

test('import keeps exact surviving sentences, updates their keys/times and removes split originals', async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0, 'opening a page must use cached saved state');
  await f.state.reconcile([lesson]);
  assert.equal(f.calls.length, 1, 'read one payload per bookmarked course during import');
  const rows = f.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].k, '/lessons/course#4');
  assert.equal(rows[0].n, 4); assert.equal(rows[0].a, 19.8); assert.equal(rows[0].b, 29.5);
  assert.equal(rows[0].due, 123); assert.equal(rows[0].reps, 5);
  for (let i = 0; i < 5; i++) f.state.read();
  assert.equal(f.calls.length, 1, 'display reads never revalidate course files');
  f.state.remove(rows[0]); assert.deepEqual(f.rows(), []);
  f.dom.window.close();
});

test('missing courses and confirmed missing files are removed, while temporary read failures keep the cache', async () => {
  const f = fixture();
  f.w.fetch = async () => ({ ok: false, status: 500 });
  await f.state.reconcile([lesson]);
  assert.equal(f.rows().length, 2);
  f.w.fetch = async () => ({ ok: false, status: 404 });
  await f.state.reconcile([lesson]); assert.deepEqual(f.rows(), []);
  f.w.localStorage.setItem(key, JSON.stringify([kept]));
  await f.state.reconcile([]); assert.deepEqual(f.rows(), []);
  f.dom.window.close();
});

test('text matching never substitutes the sentence at an old timestamp or an ambiguous duplicate', () => {
  const f = fixture();
  assert.equal(f.state.match(removed, sentences), -1);
  assert.equal(f.state.match({ ...kept, s: '  Still\n here.  ' }, sentences), 0);
  const repeated = [{ ...sentences[0], a: 10, b: 15 }, { ...sentences[0], a: 40, b: 45 }];
  assert.equal(f.state.match(kept, repeated), -1);
  assert.equal(f.state.match({ ...kept, a: 40 }, repeated), 1);
  f.dom.window.close();
});

test('import validation cannot resurrect a removed bookmark or overwrite a newer review grade', async () => {
  const f = fixture();
  let finish;
  f.w.fetch = () => new Promise(resolve => { finish = resolve; });
  const validating = f.state.reconcile([lesson]);
  const fresh = { k: '/lessons/other#1', dir: '/lessons/other', s: 'Newly saved.' };
  f.w.localStorage.setItem(key, JSON.stringify([{ ...kept, due: 999, reps: 8 }, fresh]));
  finish({ ok: true, status: 200, text: async () => '<script id="data">' + JSON.stringify({ sentences }) + '</script>' });
  await validating;
  assert.equal(f.rows().length, 2);
  assert.equal(f.rows()[0].due, 999); assert.equal(f.rows()[0].reps, 8);
  assert.equal(f.rows()[1].k, fresh.k);
  f.dom.window.close();
});

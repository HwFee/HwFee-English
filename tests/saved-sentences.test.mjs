import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../web/listen/saved-sentences.js', import.meta.url), 'utf8');
const shim = await readFile(new URL('../web/listen/player-shim.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const item = { k: 'course#2', dir: '/lessons/course', a: 31.2, b: 35.6, s: 'Saved sentence', t: '收藏的句子', title: 'Course' };

function fixture({ fail = false } = {}) {
  const dom = new JSDOM('<div id="saved"><button data-k="course#2"><svg width="16" height="16"></svg></button></div><audio id="au"></audio><script type="application/json" id="data"></script>', {
    url: 'https://localhost/listen/library.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, commands = [], preparations = [], errors = [];
  let listener, before = 0;
  w.document.getElementById('data').textContent = JSON.stringify({ lessons: [{ id: 'course', dir: '/lessons/course', legacyIds: ['cet6-course'] }] });
  w.hwfeeBeforeSavedClip = () => { before++; };
  w.hwfeeToast = (...args) => errors.push(args);
  w.Capacitor = { Plugins: { Audio: {
    addListener: async (_, callback) => { listener = callback; return { remove() {} }; },
    nativePrepare: async data => { preparations.push(data); if (fail) throw new Error('File unavailable'); return { prepared: true }; },
    nativeControl: async data => { commands.push(data); return {}; },
  } } };
  w.eval(source);
  return { dom, w, commands, preparations, errors, get before() { return before; }, publish: data => listener(data) };
}

test('saved playback prepares the native decoder and uses the exact clip range without end padding', async () => {
  const f = fixture(); await settle();
  await f.w.__hwfeeSaved.play(item);
  assert.equal(f.before, 1);
  assert.equal(f.preparations[0].source, 'https://localhost/lessons/course/audio/episode.mp4');
  const play = f.commands.find(command => command.action === 'play');
  assert.equal(play.start, 31.2); assert.equal(play.end, 35.6); assert.equal(play.loop, false);
  assert.equal(f.commands.find(command => command.action === 'seek').position, 31.2);
  assert.equal(f.w.document.querySelector('audio').getAttribute('src'), null, 'Android owns clip decoding');
  assert.equal(f.w.document.querySelector('button').getAttribute('aria-label'), '暂停句子');
  f.publish({ sourceId: play.sourceId, playing: false, event: 'boundary', sequence: 1 });
  assert.equal(f.w.document.querySelector('button').getAttribute('aria-label'), '播放句子');
  f.dom.window.close();
});

test('embedded saved and review playback opens the original player without starting an inline decoder', async () => {
  const f = fixture(), opened = [];
  Object.defineProperty(f.w, 'parent', { value: { hwfeeOpenSavedSentence: row => opened.push(row) } });
  await f.w.__hwfeeSaved.play(item);
  assert.deepEqual(opened, [item]);
  assert.equal(f.preparations.length, 0);
  assert.equal(f.commands.length, 0);
  f.dom.window.close();
});

test('the library refreshes immediately when a saved line changes in another document', async () => {
  const f = fixture(); let updates = 0;
  f.w.__hwfeeSaved.mount(() => { updates++; });
  const before = updates;
  f.w.localStorage.setItem('cherina-pod:saved', JSON.stringify([item]));
  f.w.dispatchEvent(new f.w.StorageEvent('storage', { key: 'cherina-pod:saved' }));
  assert.equal(updates, before + 1);
  f.dom.window.close();
});

test('old relative saved paths resolve against imported lessons and failures are visible', async () => {
  const f = fixture({ fail: true });
  await f.w.__hwfeeSaved.play({ ...item, dir: 'cet6-course' });
  assert.equal(f.preparations[0].source, 'https://localhost/lessons/course/audio/episode.mp4');
  assert.equal(f.errors.length, 1); assert.match(f.errors[0][0], /播放失败/);
  assert.equal(f.w.document.querySelector('button').disabled, false);
  f.dom.window.close();
});

test('a bookmark click notifies the library after the original stopped-bubbling handler saves it', async () => {
  const dom = new JSDOM('<div class="ln"><button class="act bm">Save</button></div><script id="data" type="application/json">{}</script>', {
    url: 'https://localhost/lessons/course/player.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window; let changed;
  w.hwfeeSavedChanged = () => { changed = JSON.parse(w.localStorage.getItem('cherina-pod:saved')); };
  w.document.querySelector('.ln').addEventListener('click', event => {
    event.stopPropagation(); w.localStorage.setItem('cherina-pod:saved', JSON.stringify([item]));
  });
  w.eval(shim); w.document.querySelector('button').click(); await settle();
  assert.equal(changed[0].k, item.k);
  dom.window.close();
});

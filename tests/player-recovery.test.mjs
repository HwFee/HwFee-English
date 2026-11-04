import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../web/listen/player-shim.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture({ initialError = null, status = 206, rejectPlay = false } = {}) {
  const dom = new JSDOM('<div id="warn"></div><audio src="audio/episode.mp4"></audio><script id="data" type="application/json"></script>', {
    url: 'https://localhost/lessons/current/player.html', runScripts: 'outside-only',
  });
  const w = dom.window, audio = w.document.querySelector('audio');
  let paused = true, error = initialError, ready = initialError ? 0 : 1, network = 1, loads = 0, plays = 0;
  const timers = new Map(); let timerId = 0;
  w.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; };
  w.clearTimeout = id => timers.delete(id);
  w.document.getElementById('data').textContent = JSON.stringify({ id: 'current', title: 'Current lesson', podcast: 'Podcast', image: 'https://example.com/cover.jpg' });
  const reports = [];
  w.Capacitor = { Plugins: { Audio: { state: async x => reports.push(x), start: async () => {} } } };
  w.fetch = async () => ({ status, body: { cancel: async () => {} } });
  Object.defineProperties(audio, { paused: { get: () => paused }, error: { get: () => error },
    readyState: { get: () => ready }, networkState: { get: () => network }, duration: { get: () => 600 } });
  const emit = event => audio.dispatchEvent(new w.Event(event));
  const nativePlay = () => {
    plays++;
    if (rejectPlay) { rejectPlay = false; return Promise.reject(new w.DOMException('Decoder unavailable', 'NotSupportedError')); }
    paused = false; emit('play'); emit('playing'); return Promise.resolve();
  };
  audio.play = nativePlay;
  audio.pause = () => { paused = true; emit('pause'); };
  audio.load = () => { loads++; error = null; ready = 0; audio.currentTime = 0; paused = true; emit('pause'); };
  w.eval(source);
  return { dom, w, audio, reports, emit,
    get loads() { return loads; }, get plays() { return plays; },
    fail() { error = { code: 3, message: 'Decoder lost after background' }; paused = true; ready = 0; emit('error'); },
    metadata() { ready = 1; emit('loadedmetadata'); },
    async resumeNatively() { error = null; ready = 4; await nativePlay(); },
    run(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}

test('decoder recovery retains playing intent, position and speed after background failure', async () => {
  const f = fixture();
  await f.audio.play();
  f.audio.playbackRate = 1.25; f.audio.currentTime = 172; f.emit('timeupdate');
  f.fail(); await settle();
  f.run(300);
  assert.equal(f.loads, 1);
  assert.equal(JSON.parse(f.w.localStorage.getItem('hwfee:pos:/lessons/current/player.html')).t, 172);
  f.metadata(); await settle();
  assert.equal(f.audio.currentTime, 172);
  assert.equal(f.audio.playbackRate, 1.25);
  assert.equal(f.audio.paused, false);
  assert.equal(f.w.document.getElementById('warn').style.display, 'none');
  assert.equal(f.reports.at(-1).artwork, 'https://example.com/cover.jpg');
  f.dom.window.close();
});

test('a play rejection without an error event repairs the decoder on the first tap', async () => {
  const f = fixture({ rejectPlay: true });
  await assert.rejects(f.audio.play(), { name: 'NotSupportedError' });
  f.run(300); f.metadata(); await settle();
  assert.equal(f.loads, 1);
  assert.equal(f.audio.paused, false);
  f.dom.window.close();
});

test('an error that happened before the shim loaded is recovered and a paused lesson stays paused', async () => {
  const f = fixture({ initialError: { code: 3 } });
  await settle(); f.run(300); f.metadata(); await settle();
  assert.equal(f.loads, 1);
  assert.equal(f.audio.paused, true);
  f.dom.window.close();
});

test('a successful resume cancels every earlier retry instead of interrupting healthy audio', async () => {
  const f = fixture();
  await f.audio.play(); f.audio.currentTime = 42; f.emit('timeupdate');
  f.fail(); await settle();
  await f.resumeNatively();
  f.run(300); f.run(1200); f.run(10000);
  assert.equal(f.loads, 0);
  assert.equal(f.audio.currentTime, 42);
  assert.equal(f.audio.paused, false);
  assert.equal(f.w.document.getElementById('warn').style.display, 'none');
  f.dom.window.close();
});

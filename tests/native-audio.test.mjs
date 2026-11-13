import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const script = await readFile(new URL('../web/listen/native-audio.js', import.meta.url), 'utf8');
const shim = await readFile(new URL('../web/listen/player-shim.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture() {
  const dom = new JSDOM('<div id="warn"></div><audio></audio><script id="data" type="application/json"></script>', {
    url: 'https://localhost/lessons/current/player.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, audio = w.document.querySelector('audio'), commands = [], preparations = [];
  w.document.getElementById('data').textContent = JSON.stringify({ id: 'current', title: 'Lesson', podcast: 'Podcast',
    image: 'images/cover.jpg', duration: 120 });
  let listener, tickCalls = 0;
  let state = { source: '', prepared: true, playing: false, position: 0, duration: 120, rate: 1,
    seeking: false, ended: false, error: '' };
  const publish = patch => { state = { ...state, event: '', ...patch }; listener?.({ ...state }); };
  w.Capacitor = { Plugins: { Audio: {
    addListener: async (_, callback) => { listener = callback; return { remove() { listener = null; } }; },
    nativePrepare: async data => {
      preparations.push(data); state.source = data.source; return { ...state };
    },
    nativeControl: async data => {
      commands.push(data);
      if (data.action === 'play') publish({ playing: true, error: '' });
      if (data.action === 'pause') publish({ playing: false });
      if (data.action === 'seek') publish({ position: data.position, seeking: false, event: 'seeked' });
      if (data.action === 'rate') publish({ rate: data.rate });
      return { ...state };
    },
    state: async () => assert.fail('native playback must not use WebView state as its decoder'),
    start: async () => assert.fail('native playback owns the foreground service directly'),
  } } };
  w.__hwfeeNativeRange = () => ({ start: 30, end: 60, loop: false });
  w.__hwfeeNativeTick = () => { tickCalls++; };
  w.eval(script);
  return { dom, w, audio, commands, preparations, publish, get ticks() { return tickCalls; } };
}

test('local media goes to Android without assigning a source to the WebView decoder', async () => {
  const f = fixture();
  let metadata = 0; f.audio.addEventListener('loadedmetadata', () => metadata++);
  f.audio.src = 'audio/episode.mp4'; await settle();
  assert.equal(f.audio.getAttribute('src'), null);
  assert.equal(f.preparations[0].source, 'https://localhost/lessons/current/audio/episode.mp4');
  assert.equal(f.preparations[0].artwork, 'https://localhost/lessons/current/images/cover.jpg');
  assert.equal(metadata, 1);
  await f.audio.play();
  assert.equal(f.audio.paused, false);
  assert.deepEqual({ ...f.commands.find(x => x.action === 'play') }, {
    action: 'play', sourceId: f.preparations[0].sourceId, start: 30, end: 60, loop: false });
  assert.equal(f.commands.some(x => x.action === 'range'), false, 'play carries its range in one bridge call');
  f.audio.currentTime = 41; await settle();
  assert.ok(Math.abs(f.audio.currentTime - 41) < .2);
  f.audio.pause(); assert.equal(f.audio.paused, true);
  f.dom.window.close();
});

test('native boundaries drive the existing stage logic and native failures do not start reload loops', async () => {
  const f = fixture(); f.audio.src = 'audio/episode.mp4'; await settle();
  f.w.eval(shim);
  let reloads = 0; f.w.hwfeeReloadPlayer = () => { reloads++; return true; };
  await f.audio.play();
  f.publish({ playing: false, position: 59.99, event: 'boundary' });
  assert.equal(f.ticks, 1);
  f.publish({ error: 'Decoder unavailable', playing: false, event: 'error' });
  await settle();
  assert.equal(f.preparations.length, 1);
  assert.equal(reloads, 0);
  assert.equal(f.commands.filter(x => x.action === 'play').length, 1);
  f.w.document.querySelector('#warn button').click(); await settle();
  assert.equal(f.commands.filter(x => x.action === 'play').length, 2, 'only an explicit retry starts playback again');
  assert.equal(f.preparations.length, 1);
  f.dom.window.close();
});

test('reopening an actively playing native lesson cannot seek it back during metadata restoration', async () => {
  const f = fixture();
  f.publish({ playing: true, position: 40, reused: true });
  f.audio.addEventListener('loadedmetadata', () => { f.audio.currentTime = 0; });
  f.audio.src = 'audio/episode.mp4'; await settle();
  assert.equal(f.commands.some(x => x.action === 'seek'), false);
  assert.ok(f.audio.currentTime >= 40);
  f.dom.window.close();
});

test('compact native packets retain playback and an earlier document cannot overwrite the current source', async () => {
  const f = fixture();
  f.audio.src = 'data:audio/mp4;base64,AAAA'; await settle();
  const token = f.preparations[0].sourceId;
  f.publish({ source: '', sourceId: token, position: 25, playing: true });
  assert.ok(f.audio.currentTime >= 25);
  f.publish({ source: '', sourceId: 'obsolete-document', position: 90, playing: false });
  assert.equal(f.audio.paused, false);
  assert.ok(f.audio.currentTime < 26);
  f.audio.pause(); await settle();
  assert.equal(f.commands.find(x => x.action === 'pause').sourceId, token);
  f.dom.window.close();
});

test('a delayed foreground snapshot cannot reverse a newer playback state', async () => {
  const f = fixture(); f.audio.src = 'audio/episode.mp4'; await settle();
  f.publish({ sequence: 40, position: 45, playing: true });
  f.publish({ sequence: 39, position: 10, playing: false });
  assert.equal(f.audio.paused, false); assert.ok(f.audio.currentTime >= 45);
  f.publish({ sequence: 41, position: 46, playing: false });
  assert.equal(f.audio.paused, true);
  f.dom.window.close();
});

test('pause before a pending play dispatch cancels that play instead of resuming later', async () => {
  const f = fixture(); f.audio.src = 'audio/episode.mp4'; await settle();
  const play = f.audio.play(); f.audio.pause();
  await assert.rejects(play, { name: 'AbortError' }); await settle();
  assert.equal(f.commands.some(x => x.action === 'play'), false);
  assert.equal(f.audio.paused, true);
  await f.audio.play(); assert.equal(f.audio.paused, false);
  f.dom.window.close();
});

test('repeated foreground refresh signals share one native state query', async () => {
  const f = fixture(); f.audio.src = 'audio/episode.mp4'; await settle();
  const first = f.audio.hwfeeRefreshNative();
  const second = f.audio.hwfeeRefreshNative();
  assert.equal(first, second);
  await first;
  assert.equal(f.commands.filter(x => x.action === 'state').length, 1);
  f.dom.window.close();
});

test('bounded playback never extrapolates into the next sentence while waiting for completion', async () => {
  const f = fixture(); f.audio.src = 'audio/episode.mp4'; await settle();
  let now = 1000;
  f.w.performance.now = () => now;
  f.publish({ playing: true, position: 59.9, bounded: true, clipStart: 30, clipEnd: 60 });
  now += 1500;
  assert.equal(f.audio.currentTime, 60);
  assert.equal(f.audio.hwfeeBoundedPlayback, true);
  assert.equal(f.audio.paused, false, 'only decoder completion ends a bounded sentence');
  f.publish({ playing: false, position: 60, event: 'boundary' });
  assert.equal(f.audio.paused, true);
  assert.equal(f.ticks, 1);
  assert.equal(f.commands.some(command => command.action === 'pause'), false);
  f.dom.window.close();
});

test('switching sentences keeps the requested time until the native seek is acknowledged', async () => {
  const f = fixture(); f.audio.src = 'audio/episode.mp4'; await settle();
  f.publish({ sequence: 1, playing: true, position: 59, bounded: true, clipStart: 30, clipEnd: 60 });
  const api = f.w.Capacitor.Plugins.Audio, control = api.nativeControl;
  let acknowledge;
  api.nativeControl = data => data.action === 'seek'
    ? new Promise(resolve => { acknowledge = resolve; }) : control(data);
  f.audio.currentTime = 75;
  assert.equal(f.audio.currentTime, 75, 'the previous clip end must not clamp a new sentence start');
  f.publish({ sequence: 2, playing: false, position: 59.1 });
  assert.equal(f.audio.currentTime, 75, 'an in-flight old position cannot resynchronise the page to the old sentence');
  acknowledge({ sourceId: f.preparations[0].sourceId, sequence: 3, position: 75, seeking: true });
  await settle();
  assert.equal(f.audio.currentTime, 75);
  f.publish({ sequence: 4, playing: true, position: 75, seeking: false, clipStart: 70, clipEnd: 80 });
  f.publish({ sequence: 2, playing: false, position: 59.1 });
  assert.equal(f.audio.paused, false);
  assert.ok(f.audio.currentTime >= 75 && f.audio.currentTime < 76);
  f.dom.window.close();
});

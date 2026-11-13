import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const load = path => readFile(new URL(path, import.meta.url), 'utf8');
const template = await load('../listening/cherina-pod/scripts/templates/player.html');
const server = await load('../android/app/src/main/java/com/hwfee/english/LessonServer.java');
const native = await load('../web/listen/native-audio.js');
const progress = await load('../web/listen/lesson-progress.js');
const sleep = await load('../web/listen/sleep-playback.js');
const chrome = await load('../web/listen/player-v3.js');
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const method = server.slice(server.indexOf('static String injectNativeAudioHooks'), server.indexOf('static String injectActivityFixes'));
const literal = method.slice(method.indexOf('String hooks ='), method.indexOf('return html.replace'));
const hooks = [...literal.matchAll(/"(?:\\.|[^"\\])*"/g)].map(match => JSON.parse(match[0])).join('');

async function fixture({ step = 1, loop = false, pendingSleep = false, failSleep = false } = {}) {
  const data = { id: 'sleep-test', title: 'Sleep test', podcast: '', audio: 'audio/course.mp4', duration: 60,
    ui: 'zh', source_lang: 'en', target_lang: 'zh', notes: [],
    segments: [{ n: 1, from: 0, to: 3, start: 0, end: 30, rate: 100 }, { n: 2, from: 3, to: 6, start: 30, end: 60, rate: 100 }],
    sentences: [0, 10, 20, 30, 40, 50].map((a, i) => ({ a, b: a + 10, n: i + 1,
      s: `Sentence number ${i + 1}.`, t: '完整译文。', w: [a] })) };
  const dom = new JSDOM(template.replace('__DATA__', JSON.stringify(data)), {
    url: 'https://localhost/lessons/sleep-test/player.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, audio = w.document.querySelector('audio'), commands = [], preparations = [], calls = [], errors = [];
  w.performance.now = () => 1000;
  w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
  w.addEventListener('error', event => errors.push(event.error || event.message));
  let listener, acceptSleep;
  let state = { source: '', sourceId: '', prepared: true, playing: false, duration: 60, position: 0,
    rate: 1, seeking: false, ended: false, bounded: false, sleepSeconds: 0, sleepContinuous: false };
  const publish = patch => { state = { ...state, event: '', ...patch }; listener?.({ ...state }); };
  const api = {
    addListener: async (_, callback) => { listener = callback; return { remove() {} }; },
    nativePrepare: async payload => { preparations.push(payload); state = { ...state, source: payload.source, sourceId: payload.sourceId }; return { ...state }; },
    nativeControl: async payload => {
      commands.push(payload);
      if (payload.action === 'play') publish({ playing: true, ended: false });
      if (payload.action === 'pause') publish({ playing: false });
      if (payload.action === 'seek') publish({ position: payload.position, seeking: false, event: 'seeked' });
      if (payload.action === 'rate') publish({ rate: payload.rate });
      return { ...state };
    },
    sleep: async payload => {
      calls.push(payload);
      if (failSleep) throw new Error('睡眠定时需要先开始播放');
      if (pendingSleep) await new Promise(resolve => { acceptSleep = resolve; });
      publish({ sleepSeconds: payload.minutes * 60, sleepContinuous: payload.minutes > 0,
        playing: payload.minutes > 0 && state.sleepSeconds === 0 ? true : state.playing, bounded: false, event: 'sleep' });
      return { seconds: payload.minutes * 60 };
    },
  };
  w.Capacitor = { Plugins: { Audio: api } };
  w.hwfeeToast = () => {};
  w.eval(native); w.eval(progress); w.eval(sleep);
  let code = [...w.document.querySelectorAll('script')].find(node => !node.type && node.textContent.includes('function tick()')).textContent;
  const marker = 'renderTop();renderSteps();renderStage();renderTicks();renderSide();renderCtl();renderTime();';
  code = code.replace(marker, hooks + marker);
  for (const replacement of method.matchAll(/\.replace\(("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*")\)/g)) {
    code = code.replaceAll(JSON.parse(replacement[1]), JSON.parse(replacement[2]));
  }
  code = code.replace(/\}\)\(\);\s*$/, 'window.testPlayer={state:st,play:playSentence,setStep:setStep,tick:tick,next:next};})();');
  w.eval(code); w.eval(chrome); await flush();
  const player = w.testPlayer;
  player.setStep(step, false);
  if (loop) w.document.getElementById('bLoop').click();
  player.play(0); await flush(); audio.currentTime = 3.4; await flush();
  w.__hwfeeFlushProgress();
  const initial = JSON.parse(w.localStorage.getItem('cherina-lesson:sleep-test'));
  return { dom, w, audio, player, commands, preparations, calls, publish, initial,
    stored: () => JSON.parse(w.localStorage.getItem('cherina-lesson:sleep-test')),
    async choose(minutes) { w.document.getElementById('hwfeeSleep').click(); w.document.querySelector(`[data-minutes="${minutes}"]`).click(); await flush(); },
    async expire() { publish({ sleepSeconds: 0, sleepContinuous: false, playing: false, event: 'sleep' }); await flush(); },
    accept: () => acceptSleep?.(),
    close() { assert.deepEqual(errors, []); dom.window.close(); },
  };
}

test('all four stages ignore automatic sentence/segment stops and loops while sleep mode follows the whole lesson', async t => {
  for (const step of [0, 1, 2, 3]) for (const loop of [false, true]) await t.test(`step ${step}, loop ${loop}`, async () => {
    const f = await fixture({ step, loop });
    try {
      await f.choose(15);
      const checkpoint = f.stored(); // Opening sleep flushes the current practice second once.
      assert.equal(checkpoint.parts[0].t, 3.4);
      assert.equal(f.preparations[0].continuousLesson, true);
      assert.equal(f.audio.hwfeeSleepActive, true);
      assert.deepEqual(JSON.parse(JSON.stringify(f.w.__hwfeeNativeRange())), { start: 0, end: 0, loop: false, drill: false });
      assert.equal(f.w.document.getElementById('bLoop').disabled, true);
      f.commands.length = 0;
      for (const position of [9.99, 10.8, 29.99, 35, 59.99]) {
        f.publish({ position, playing: true }); f.player.tick(); await flush();
        assert.equal(f.audio.paused, false);
        assert.equal(f.audio.currentTime, position, 'no loop, gap skip or sentence rewind');
      }
      assert.equal(f.player.state.seg, 1);
      assert.equal(f.player.state.cur, 5);
      assert.equal(f.commands.some(command => command.action === 'pause' || command.action === 'seek'), false);
      assert.deepEqual(f.stored(), checkpoint, 'passive listening cannot overwrite normal practice');
      assert.equal(f.w.document.querySelector('.sheet.on'), null, 'no automatic rating prompt');
      await f.expire();
      assert.equal(f.audio.paused, true);
      assert.equal(f.audio.hwfeeSleepActive, false);
      assert.equal(f.audio.currentTime, 3.4);
      assert.equal(f.player.state.seg, f.initial.seg);
      assert.equal(f.player.state.cur, f.initial.cur);
      assert.equal(f.player.state.step, step);
      assert.deepEqual(f.stored().steps, f.initial.steps, 'sleep never completes a practice stage');
      assert.equal(f.w.document.getElementById('bLoop').disabled, false);
      assert.equal(f.w.document.getElementById('hwfeeSleep').classList.contains('is-active'), false);
      assert.equal(f.w.document.querySelector('[data-minutes="0"]').classList.contains('is-on'), true);
    } finally { f.close(); }
  });
});

test('entry after a hidden-frame update keeps the native-time checkpoint, not a stale lyric cursor', async () => {
  const f = await fixture({ step: 0 });
  try {
    f.publish({ position: 15.5, playing: true }); // Native time advances while rAF is suspended.
    assert.equal(f.player.state.cur, 0);
    await f.choose(15);
    f.publish({ position: 35, playing: true }); f.player.tick();
    await f.expire();
    assert.equal(f.player.state.cur, 1);
    assert.equal(f.audio.currentTime, 15.5);
    assert.equal(f.stored().parts[0].cur, 1);
    assert.equal(f.stored().parts[0].t, 15.5);
  } finally { f.close(); }
});

test('manual pause and resume remain usable without rewinding the current sentence', async () => {
  const f = await fixture();
  try {
    await f.choose(15); f.publish({ position: 10.2, playing: true }); f.player.tick();
    f.w.document.getElementById('bPlay').click(); await flush();
    assert.equal(f.audio.paused, true); assert.equal(f.audio.hwfeeSleepActive, true);
    await f.choose(30);
    assert.equal(f.audio.paused, true, 'editing the timer must not undo a manual pause');
    f.commands.length = 0;
    f.w.document.getElementById('bPlay').click(); await flush();
    assert.equal(f.audio.paused, false);
    assert.equal(f.audio.currentTime, 10.2);
    assert.equal(f.commands.some(command => command.action === 'seek'), false);
    assert.equal(f.commands.filter(command => command.action === 'play').length, 1);
  } finally { f.close(); }
});

test('a pending timer command suppresses a late boundary immediately; rapid choices send only one request', async () => {
  const f = await fixture({ pendingSleep: true, loop: true });
  try {
    f.w.document.getElementById('hwfeeSleep').click();
    for (const minutes of [15, 30, 45, 0, 15]) f.w.document.querySelector(`[data-minutes="${minutes}"]`).click();
    assert.equal(f.calls.length, 1);
    assert.equal(f.audio.hwfeeSleepActive, true);
    f.publish({ position: 10, playing: false, sleepSeconds: 0, sleepContinuous: false, event: 'boundary' }); await flush();
    assert.equal(f.player.state.cur, 1);
    assert.equal(f.commands.filter(command => command.action === 'pause').length, 0);
    f.accept(); await flush();
    assert.equal(f.audio.paused, false);
    assert.equal(f.audio.hwfeeSleepSeconds, 900);
    assert.equal(f.w.document.getElementById('hwfeeSleepScrim').hidden, true);
  } finally { f.close(); }
});

test('changing or cancelling the timer keeps the first practice checkpoint and ordinary drill still stops afterwards', async () => {
  const f = await fixture();
  try {
    await f.choose(15); f.publish({ position: 35, playing: true }); f.player.tick();
    await f.choose(30); assert.equal(f.audio.hwfeeSleepSeconds, 1800);
    await f.choose(0);
    assert.equal(f.audio.paused, true);
    assert.equal(f.audio.currentTime, 3.4);
    assert.equal(f.player.state.seg, 0);
    await f.audio.play();
    f.publish({ position: 9.99, playing: true }); f.player.tick(); await flush();
    assert.equal(f.audio.paused, true, 'ordinary per-sentence practice is not disabled globally');
    assert.equal(f.audio.currentTime, 9.95);
  } finally { f.close(); }
});

test('a failed sleep command rolls back the temporary mode and leaves a retryable sheet', async () => {
  const f = await fixture({ failSleep: true });
  try {
    await f.choose(15);
    assert.equal(f.audio.hwfeeSleepActive, false);
    assert.equal(f.audio.hwfeeSleepSeconds, 0);
    assert.equal(f.audio.currentTime, 3.4);
    assert.equal(f.w.document.getElementById('hwfeeSleepScrim').hidden, false);
    assert.equal(f.w.document.querySelector('[data-minutes="30"]').disabled, false);
  } finally { f.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [template, server, identity, progress, shim, activity] = await Promise.all([
  read('web/listen/player.template.html'), read('android/app/src/main/java/com/hwfee/english/LessonServer.java'),
  read('web/listen/player-identity.js'), read('web/listen/lesson-progress.js'), read('web/listen/player-shim.js'), read('web/listen/activity.js'),
]);
const payload = { id: 'test', title: 'Test', podcast: '', audio: '', ui: 'zh', source_lang: 'en', target_lang: 'zh', notes: [],
  segments: [{ n: 1, from: 0, to: 2, start: 0, end: 30 }, { n: 2, from: 2, to: 4, start: 30, end: 60 }],
  sentences: [0, 15, 30, 45].map((a, i) => ({ n: i + 1, a, b: a + 15, s: 'A complete sentence.', t: '一句完整的话。', w: [a] })) };
const snapshot = w => Object.fromEntries(Object.keys(w.localStorage).sort().map(k => [k, w.localStorage.getItem(k)]));
function fixture(review, storage) {
  const dom = new JSDOM(template.replace('__DATA__', JSON.stringify(payload)), {
    url: 'https://localhost/lessons/test/player.html' + (review ? '?review=1' : ''), runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, audio = w.document.querySelector('audio');
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  let paused = true;
  Object.defineProperties(audio, { paused: { get: () => paused }, readyState: { get: () => 4 } });
  audio.pause = () => { paused = true; audio.dispatchEvent(new w.Event('pause')); };
  audio.play = () => { paused = false; audio.dispatchEvent(new w.Event('play')); return Promise.resolve(); };
  w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
  w.eval(identity); w.eval(progress); w.eval(activity);
  const method = server.slice(server.indexOf('static String injectNativeAudioHooks'), server.indexOf('static String injectActivityFixes'));
  const literal = method.slice(method.indexOf('String hooks ='), method.indexOf('return html.replace'));
  const hooks = [...literal.matchAll(/"(?:\\.|[^"\\])*"/g)].map(x => JSON.parse(x[0])).join('');
  const marker = 'renderTop();renderSteps();renderStage();renderTicks();renderSide();renderCtl();renderTime();';
  let code = [...w.document.querySelectorAll('script')].find(s => !s.type && s.textContent.includes('function tick()')).textContent;
  code = code.replace(marker, hooks + marker);
  for (const x of method.matchAll(/\.replace\(("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*")\)/g)) code = code.replaceAll(JSON.parse(x[1]), JSON.parse(x[2]));
  code = code.replace(/\}\)\(\);\s*$/, 'window.inspectPlayer={st:st,goSeg:goSeg,setStep:setStep,save:save};})();');
  w.eval(code); w.eval(shim);
  audio.dispatchEvent(new w.Event('loadedmetadata'));
  return { dom, w, audio };
}

test('bookmark replay cannot overwrite checkpoints, resume links or completion data, and normal reopening restores the old position', async () => {
  const normal = { seg: 1, cur: 2, step: 0, speed: .9, steps: { 1: 4 }, ratings: { 1: { r1: 3 } }, completionVersion: 2,
    parts: { 1: { cur: 2, step: 0, t: 42.25, speed: .9 } } };
  const storage = {
    'cherina-lesson:test': JSON.stringify(normal),
    'cherina-pod:last': JSON.stringify({ id: 'test', dir: '/lessons/test', seg: 2 }),
    'hwfee:listen:last': JSON.stringify({ dir: 'test', segment: 2, step: 0 }),
    'hwfee:pos:/lessons/test/player.html': JSON.stringify({ i: 2, t: 42.25 }),
    'cherina-pod:activity': JSON.stringify({ days: {}, completed: {} }),
  };
  const f = fixture(true, storage);
  try {
    f.w.__hwfeeOpenSentence({ n: 1, a: 0 });
    assert.equal(f.audio.currentTime, 0);
    assert.equal(f.w.inspectPlayer.st.step, 1);
    f.audio.currentTime = 12;
    for (const event of ['timeupdate', 'seeked', 'ratechange', 'pause']) f.audio.dispatchEvent(new f.w.Event(event));
    f.w.inspectPlayer.goSeg(1); f.w.inspectPlayer.setStep(3, false);
    f.w.inspectPlayer.st.steps[2] = 4; f.w.inspectPlayer.save();
    f.w.__hwfeeActivity.completeSegment(2);
    f.w.dispatchEvent(new f.w.Event('pagehide'));
    assert.deepEqual(snapshot(f.w), storage);
  } finally { await new Promise(setImmediate); f.dom.window.close(); }
  const reopened = fixture(false, storage);
  try {
    assert.equal(reopened.w.inspectPlayer.st.seg, 1);
    assert.equal(reopened.w.inspectPlayer.st.step, 0);
    assert.equal(reopened.w.inspectPlayer.st.cur, 2);
    assert.equal(reopened.audio.currentTime, 42.25);
  } finally { await new Promise(setImmediate); reopened.dom.window.close(); }
});

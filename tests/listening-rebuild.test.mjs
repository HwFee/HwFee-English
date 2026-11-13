import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'node:vm';

const migration = await readFile(new URL('../web/listen/progress-migration.js', import.meta.url), 'utf8');
const progress = await readFile(new URL('../web/listen/lesson-progress.js', import.meta.url), 'utf8');
const template = await readFile(new URL('../listening/cherina-pod/scripts/templates/player.html', import.meta.url), 'utf8');
const lessonServer = await readFile(new URL('../android/app/src/main/java/com/hwfee/english/LessonServer.java', import.meta.url), 'utf8');
const savedState = await readFile(new URL('../web/listen/saved-state.js', import.meta.url), 'utf8');

test('reimporting split sentences restores the same audio time, stage, ratings and completed segments from either old level', () => {
  const dom = new JSDOM('<audio></audio>', { url: 'https://localhost/lessons/episode/player.html', runScripts: 'outside-only' });
  const w = dom.window;
  const sentences = Array.from({ length: 8 }, (_, i) => ({ a: i * 15, b: (i + 1) * 15 }));
  const segments = [{ n: 1, from: 0, to: 4, start: 0, end: 60 }, { n: 2, from: 4, to: 8, start: 60, end: 120 }];
  const data = { id: 'episode', sentences, segments, hwfeeCourse: { schema: 2, revision: 'v2',
    legacyIds: ['cet6-episode', 'cet4-episode'], legacyTimeline: { sentences: [0, 30, 60, 90].map(a => ({ a, b: a + 30 })) } } };
  const old = { seg: 1, cur: 3, step: 1, speed: .9, ratings: { 1: { r1: 3 } }, steps: { 1: 4, 2: 1 },
    parts: { 1: { cur: 3, t: 105.5, step: 1, speed: .9, at: 20, stages: { 0: { cur: 2, t: 78, step: 0 } } } } };
  w.localStorage.setItem('cherina-lesson:cet6-episode', JSON.stringify(old));
  w.localStorage.setItem('cherina-lesson:cet4-episode', JSON.stringify({ seg: 0, cur: 0, step: 0, steps: { 2: 4 }, parts: { 0: { cur: 1, t: 40, step: 0, at: 10 } } }));
  w.eval(migration);
  const state = w.__hwfeeProgressMigration.migrate(data);
  assert.equal(state.seg, 1); assert.equal(state.cur, 7); assert.equal(state.step, 1);
  assert.equal(state.parts[1].t, 105.5); assert.equal(state.parts[1].stages[0].cur, 5);
  assert.equal(state.parts[0].cur, 2); assert.equal(state.speed, .9);
  assert.equal(state.steps[1], 4); assert.equal(state.steps[2], 4); assert.equal(state.ratings[1].r1, 3);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('cherina-lesson:cet6-episode')), old);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('hwfee:progress-backup:cet6-episode:v2')), old);
  const audio = w.document.querySelector('audio');
  w.eval(progress);
  w.__hwfeeProgress.install({ state, audio, sentences, segments, save() {}, goSeg() {}, render() {} });
  audio.dispatchEvent(new w.Event('loadedmetadata'));
  assert.equal(audio.currentTime, 105.5);
  state.cur = 6; state.parts[1].t = 99;
  w.localStorage.setItem('cherina-lesson:episode', JSON.stringify(state));
  assert.equal(w.__hwfeeProgressMigration.migrate(data).cur, 6, 'reimport cannot remap an already migrated checkpoint again');
  dom.window.close();
});

test('legacy progress without second checkpoints maps the old sentence start to its new sentence', () => {
  const dom = new JSDOM('', { url: 'https://localhost', runScripts: 'outside-only' });
  const w = dom.window;
  w.localStorage.setItem('cherina-lesson:cet4-ep', JSON.stringify({ seg: 0, cur: 1, step: 1, steps: { 1: 1 } }));
  w.eval(migration);
  const state = w.__hwfeeProgressMigration.migrate({ id: 'ep', sentences: [0, 10, 20, 30].map(a => ({ a, b: a + 10 })),
    segments: [{ from: 0, to: 4, start: 0, end: 40 }], hwfeeCourse: { schema: 2, revision: 'r2', legacyIds: ['cet4-ep'],
      legacyTimeline: { sentences: [{ a: 0 }, { a: 20 }] } } });
  assert.equal(state.cur, 2); assert.equal(state.step, 1);
  dom.window.close();
});

test('the first drill sentence cannot complete the stage, and the last must finish before Next advances', () => {
  const data = { id: 'test', title: 'Test', podcast: '', audio: '', ui: 'zh', source_lang: 'en', target_lang: 'zh', notes: [],
    segments: [{ n: 1, from: 0, to: 3, start: 0, end: 30, rate: 100 }],
    sentences: [0, 10, 20].map((a, i) => ({ a, b: a + 10, n: i + 1, s: 'A complete sentence.', t: '一句完整的话。', w: [a] })) };
  const dom = new JSDOM(template.replace('__DATA__', JSON.stringify(data)), {
    url: 'https://localhost/lessons/test/player.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, audio = w.document.querySelector('audio');
  let paused = true;
  Object.defineProperty(audio, 'paused', { get: () => paused });
  audio.play = () => { paused = false; return Promise.resolve(); };
  audio.pause = () => { paused = true; };
  w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
  const code = [...w.document.querySelectorAll('script')].find(node => !node.type && node.textContent.includes('function tick()')).textContent;
  w.eval(code.replace(/\}\)\(\);\s*$/, 'window.testPlayer={st:st,setStep:setStep,play:playSentence,tick:tick,next:next};})();'));
  const player = w.testPlayer;
  player.st.steps[1] = 1;
  player.setStep(1, false); player.play(0); audio.currentTime = 9.99; player.tick();
  assert.equal(player.st.steps[1], 1); assert.equal(w.document.querySelectorAll('#steps button.done').length, 1);
  player.play(2); audio.currentTime = 21; player.next();
  assert.equal(player.st.step, 1); assert.equal(player.st.steps[1], 1);
  audio.currentTime = 29.99; player.tick();
  assert.equal(player.st.steps[1], 2);
  player.next(); assert.equal(player.st.step, 2);
  dom.window.close();
});

test('served saved-sentence navigation waits for metadata and matches the original sentence text', async () => {
  const data = { id: 'test', title: 'Test', podcast: '', audio: '', ui: 'zh', source_lang: 'en', target_lang: 'zh', notes: [],
    segments: [{ n: 1, from: 0, to: 3, start: 0, end: 30, rate: 100 }],
    sentences: [0, 10, 20].map((a, i) => ({ a, b: a + 10, n: i + 1, s: 'Sentence number ' + (i + 1) + '.', t: '一句完整的话。', w: [a] })) };
  const dom = new JSDOM(template.replace('__DATA__', JSON.stringify(data)), {
    url: 'https://localhost/lessons/test/player.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  try {
    const w = dom.window, audio = w.document.querySelector('audio');
    let ready = 0, paused = true, plays = 0;
    Object.defineProperties(audio, { readyState: { get: () => ready }, paused: { get: () => paused } });
    audio.play = () => { paused = false; plays++; return Promise.resolve(); };
    audio.pause = () => { paused = true; };
    w.requestAnimationFrame = () => 1; w.cancelAnimationFrame = () => {};
    w.eval(progress); w.eval(savedState);
    const method = lessonServer.slice(lessonServer.indexOf('static String injectNativeAudioHooks'));
    const literal = method.slice(method.indexOf('String hooks ='), method.indexOf('return html.replace'));
    const hooks = [...literal.matchAll(/"(?:\\.|[^"\\])*"/g)].map(match => JSON.parse(match[0])).join('');
    const marker = 'renderTop();renderSteps();renderStage();renderTicks();renderSide();renderCtl();renderTime();';
    const code = [...w.document.querySelectorAll('script')].find(node => !node.type && node.textContent.includes('function tick()')).textContent;
    w.eval(code.replace(marker, hooks + marker).replace(/\}\)\(\);\s*$/, 'window.testState=st;})();'));
    w.__hwfeeOpenSentence({ n: 1, a: 15, s: 'Sentence number 2.' });
    assert.equal(plays, 0);
    ready = 4; audio.dispatchEvent(new w.Event('loadedmetadata'));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(plays, 1);
    assert.equal(audio.currentTime, 10);
    assert.equal(w.testState.cur, 1);
    assert.equal(w.testState.step, 1);
    const missing = { k: 'test#old', n: 2, a: 15, s: 'This whole sentence was split and no longer exists.' };
    w.localStorage.setItem('cherina-pod:saved', JSON.stringify([missing]));
    w.__hwfeeOpenSentence(missing);
    assert.equal(plays, 1, 'a nearby timestamp must not play a different sentence');
    assert.deepEqual(JSON.parse(w.localStorage.getItem('cherina-pod:saved')), []);
  } finally { dom.window.close(); }
});

test('a delayed second-stage tick stops the current sentence instead of advancing to the next', () => {
  let tick = template.slice(template.indexOf('function tick(){'), template.indexOf('au.addEventListener("play"'));
  const method = lessonServer.slice(lessonServer.indexOf('static String injectNativeAudioHooks'), lessonServer.indexOf('static String injectActivityFixes'));
  for (const replacement of method.matchAll(/\.replace\(("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*")\)/g)) {
    tick = tick.replaceAll(JSON.parse(replacement[1]), JSON.parse(replacement[2]));
  }
  for (const step of [0, 1, 2, 3]) {
    const state = { cur: 0, seg: 0, step, steps: {} };
    const audio = { currentTime: 10.8, paused: false, pause() { this.paused = true; } };
    const scope = { st: state, au: audio, S: [{ a: 0, b: 10 }, { a: 10, b: 20 }], G: [{ n: 1, to: 2 }],
      loop: false, findIdx: () => 1, segOf: () => 0, setCur: i => { state.cur = i; },
      trackTime() {}, markWords() {}, renderTime() {}, requestAnimationFrame() { return 1; } };
    runInNewContext(tick + ';tick();', scope);
    assert.equal(audio.paused, step === 1);
    assert.equal(state.cur, step === 1 ? 0 : 1);
    if (step === 1) assert.equal(audio.currentTime, 9.95);
  }
});

test('bounded native drill and loop wait for decoder completion instead of a page timer', () => {
  let tick = template.slice(template.indexOf('function tick(){'), template.indexOf('au.addEventListener("play"'));
  const method = lessonServer.slice(lessonServer.indexOf('static String injectNativeAudioHooks'), lessonServer.indexOf('static String injectActivityFixes'));
  for (const replacement of method.matchAll(/\.replace\(("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*")\)/g)) {
    tick = tick.replaceAll(JSON.parse(replacement[1]), JSON.parse(replacement[2]));
  }
  for (const loop of [false, true]) {
    const state = { cur: 0, seg: 0, step: 1, steps: {} };
    let pauses = 0;
    const audio = { currentTime: 9.99, paused: false, hwfeeBoundedPlayback: true,
      pause() { pauses++; this.paused = true; } };
    const scope = { st: state, au: audio, S: [{ a: 0, b: 10 }, { a: 10, b: 20 }], G: [{ n: 1, to: 2 }],
      loop, trackTime() {}, markWords() {}, renderTime() {}, requestAnimationFrame() { return 1; } };
    runInNewContext(tick + ';tick();', scope);
    assert.equal(pauses, 0);
    assert.equal(audio.currentTime, 9.99, 'the page cannot seek before the native clip finishes');
    if (!loop) {
      audio.currentTime = 10; audio.paused = true;
      runInNewContext(tick + ';tick();', scope);
      assert.equal(pauses, 1);
      assert.equal(state.cur, 0);
      assert.equal(audio.currentTime, 9.95);
    }
  }
});

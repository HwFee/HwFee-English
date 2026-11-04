import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const script = await readFile(new URL('../web/listen/lesson-progress.js', import.meta.url), 'utf8');

function fixture(saved) {
  const dom = new JSDOM('<audio></audio>', { url: 'https://localhost/lessons/course-a/player.html', runScripts: 'outside-only' });
  const w = dom.window, audio = w.document.querySelector('audio');
  Object.defineProperty(audio, 'readyState', { get: () => 4 });
  const state = saved ? JSON.parse(saved) : { seg: 0, cur: 0, step: 0, speed: 1, steps: {} };
  const segments = [{ n: 1, from: 0, to: 2 }, { n: 2, from: 2, to: 4 }];
  const sentences = [0, 30, 60, 90].map(a => ({ a, b: a + 30 }));
  w.eval(script);
  let snapshot, progress;
  progress = w.__hwfeeProgress.install({ state, audio, segments, sentences,
    save: () => { snapshot = JSON.stringify(state); },
    goSeg: (index, line) => {
      audio.dispatchEvent(new w.Event('pause'));
      state.seg = index; state.cur = line ?? segments[index].from; state.step = 0;
      progress.save(); audio.currentTime = sentences[state.cur].a;
    }, render: () => {},
  });
  return { dom, w, audio, state, progress, saved: () => snapshot };
}

test('every segment retains its own stage, sentence and seconds before completion', () => {
  const f = fixture();
  f.state.cur = 1; f.state.step = 1; f.audio.currentTime = 41.25; f.progress.save();
  f.progress.goSeg(1);
  f.state.cur = 3; f.state.step = 2; f.audio.currentTime = 105.5; f.progress.save();
  f.progress.goSeg(0);
  assert.equal(f.state.step, 1); assert.equal(f.state.cur, 1); assert.equal(f.audio.currentTime, 41.25);
  assert.equal(f.state.parts[1].step, 2); assert.equal(f.state.parts[1].t, 105.5);
  assert.equal(Object.keys(f.state.steps).length, 0, 'no completed stage is required to save');
  f.progress.goSeg(1);
  assert.equal(f.state.step, 2); assert.equal(f.audio.currentTime, 105.5);
  f.dom.window.close();
});

test('switching to another course and recreating this document restores blind listening mid-part', () => {
  const a = fixture();
  a.state.cur = 1; a.audio.currentTime = 40; a.progress.save();
  const saved = a.saved(); a.dom.window.close();
  const b = fixture(); b.state.step = 3; b.audio.currentTime = 20; b.progress.save(); b.dom.window.close();
  const returned = fixture(saved);
  returned.audio.dispatchEvent(new returned.w.Event('loadedmetadata'));
  assert.equal(returned.state.seg, 0); assert.equal(returned.state.step, 0);
  assert.equal(returned.state.cur, 1); assert.equal(returned.audio.currentTime, 40);
  returned.dom.window.close();
});

test('each stage has a checkpoint and a hidden player saves the actual sentence at its current second', () => {
  const f = fixture();
  f.audio.currentTime = 40; f.progress.save();
  assert.equal(f.state.cur, 0, 'saving must not change the visible transcript behind its renderer');
  assert.equal(f.state.parts[0].cur, 1, 'the persisted checkpoint follows native playback');
  f.state.step = 1; f.state.cur = 1; f.audio.currentTime = 42; f.progress.save();
  assert.equal(f.state.parts[0].stages[0].t, 40);
  assert.equal(f.state.parts[0].stages[1].t, 42);
  const saved = f.saved(); f.dom.window.close();
  const returned = fixture(saved);
  returned.audio.dispatchEvent(new returned.w.Event('loadedmetadata'));
  assert.equal(returned.state.step, 1); assert.equal(returned.state.cur, 1);
  assert.equal(returned.audio.currentTime, 42);
  returned.dom.window.close();
});

test('an old first-sentence checkmark is corrected without erasing later verified stages', () => {
  const saved = { seg: 0, cur: 0, step: 1, speed: 1, steps: { 1: 2, 2: 3 }, parts: {
    0: { cur: 0, step: 1, t: 29.95 }, 1: { cur: 3, step: 3, t: 105 },
  } };
  const f = fixture(JSON.stringify(saved));
  assert.equal(f.state.steps[1], 1);
  assert.equal(f.state.steps[2], 3);
  assert.equal(f.state.cur, 0); assert.equal(f.state.step, 1);
  assert.equal(f.state.completionVersion, 2);
  f.dom.window.close();
});

test('returning to a paused native source after a saved clip restores the course checkpoint', () => {
  const f = fixture(JSON.stringify({ seg: 0, cur: 1, step: 1, speed: .9, steps: {},
    parts: { 0: { cur: 1, step: 1, t: 42.25, speed: .9 } } }));
  f.audio.dataset.hwfeeNativeReused = '1';
  f.audio.currentTime = 12;
  f.audio.dispatchEvent(new f.w.Event('loadedmetadata'));
  assert.equal(f.audio.currentTime, 42.25);
  f.dom.window.close();
});

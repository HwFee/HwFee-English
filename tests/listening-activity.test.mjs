import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../web/listen/activity.js', import.meta.url), 'utf8');
function fixture(start = new Date(2026, 10, 2, 12).getTime(), rate = 1) {
  const dom = new JSDOM('<audio></audio>', { url: 'https://localhost/lessons/test/player.html', runScripts: 'outside-only' });
  const w = dom.window, audio = w.document.querySelector('audio');
  let now = start, paused = false, seeking = false;
  const DateClass = w.Date;
  w.Date = class extends DateClass {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  Object.defineProperties(audio, { paused: { get: () => paused }, seeking: { get: () => seeking } });
  audio.playbackRate = rate;
  w.eval(source);
  return { dom, w, audio, tracker: w.__hwfeeActivity,
    advance(seconds, media = seconds * audio.playbackRate) { now += seconds * 1000; audio.currentTime += media; w.__hwfeeActivity.tick(true); },
    pause(value) { paused = value; audio.dispatchEvent(new w.Event(value ? 'pause' : 'play')); },
    seek(position) { seeking = true; audio.currentTime = position; audio.dispatchEvent(new w.Event('seeking'));
      seeking = false; audio.dispatchEvent(new w.Event('seeked')); },
  };
}

test('background media progress counts even when no animation frame ran for three minutes', () => {
  const f = fixture();
  f.advance(180);
  assert.equal(f.tracker.summary().seconds, 180);
  assert.equal(f.tracker.summary().streak, 1);
  f.dom.window.close();
});

test('pauses, seeks and decoder stalls cannot manufacture listening time', () => {
  const f = fixture();
  f.advance(30);
  f.pause(true); f.advance(600, 0); f.pause(false);
  f.seek(900); f.advance(60, 0); f.advance(10);
  assert.equal(f.tracker.summary().seconds, 40);
  assert.equal(f.tracker.summary().streak, 0);
  f.dom.window.close();
});

test('speed counts real listening seconds and playback spanning midnight splits across dates', () => {
  const fast = fixture(undefined, 2);
  fast.advance(60, 120);
  assert.equal(fast.tracker.summary().seconds, 60);
  fast.dom.window.close();
  const f = fixture(new Date(2026, 10, 1, 23, 59, 30).getTime());
  f.advance(90);
  const days = f.tracker.summary().days;
  assert.equal(days['2026-11-01'].sec, 30);
  assert.equal(days['2026-11-02'].sec, 60);
  f.dom.window.close();
});

test('streak permits an unfinished today, breaks at a missed day and deduplicates completion', () => {
  const f = fixture();
  f.w.localStorage.setItem('cherina-pod:activity', JSON.stringify({ days: {
    '2026-10-30': { sec: 600 }, '2026-11-01': { sec: 120 },
  } }));
  assert.equal(f.tracker.summary().streak, 1);
  f.tracker.completeSegment(1); f.tracker.completeSegment(1);
  assert.equal(f.tracker.summary().streak, 2);
  assert.equal(f.tracker.summary().segments, 1);
  f.dom.window.close();
});

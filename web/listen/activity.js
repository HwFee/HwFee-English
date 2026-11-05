// Listening time follows media progress, so background timer throttling does not erase it.
(() => {
  const review = new URLSearchParams(location.search).get('review') === '1';
  const KEY = 'cherina-pod:activity';
  const audio = document.querySelector('audio');
  const dayKey = (at) => {
    const date = new Date(at);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const load = () => {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (data && typeof data.days === 'object' && data.days) return data;
    } catch {}
    return { days: {} };
  };
  const pending = {};
  let lastFlush = 0;
  const snapshot = () => ({ at: Date.now(), position: audio?.currentTime || 0,
    rate: audio?.playbackRate || 1, playing: Boolean(audio && !audio.paused && !audio.ended && !audio.error) });
  let previous = snapshot();

  function flush() {
    if (!Object.keys(pending).length) return;
    const data = load();
    for (const [day, seconds] of Object.entries(pending)) {
      const entry = data.days[day] ||= { sec: 0, segs: 0 };
      entry.sec = (Number(entry.sec) || 0) + seconds;
    }
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { return; }
    for (const day of Object.keys(pending)) delete pending[day];
    lastFlush = Date.now();
  }

  function tick(force = false) {
    if (review || !audio) return;
    const next = snapshot();
    const elapsed = (next.at - previous.at) / 1000;
    if (!force && elapsed < .2 && elapsed >= 0) return;
    const advanced = next.position - previous.position;
    if (previous.playing && !audio.seeking && !audio.error && elapsed > 0 && advanced > 0
        && advanced <= elapsed * previous.rate + .75) {
      const seconds = Math.min(elapsed, advanced / previous.rate);
      let from = next.at - seconds * 1000;
      // Attribute continuous playback on either side of midnight to the correct day.
      while (from < next.at) {
        const date = new Date(from);
        const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
        const end = Math.min(next.at, midnight);
        const key = dayKey(from);
        pending[key] = (pending[key] || 0) + (end - from) / 1000;
        from = end;
      }
    }
    previous = next;
    if (force || next.at - lastFlush >= 5000) flush();
  }

  function completeSegment(segment) {
    if (review) return;
    tick(true);
    const data = load();
    const id = `${location.pathname}#${segment}`;
    const completed = data.completed ||= {};
    if (completed[id]) return;
    completed[id] = dayKey(Date.now());
    const day = data.days[completed[id]] ||= { sec: 0, segs: 0 };
    day.segs = (Number(day.segs) || 0) + 1;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  }

  function summary(at = Date.now()) {
    const data = load();
    const qualifies = (date) => {
      const day = data.days[dayKey(date)];
      return Boolean(day && (Number(day.segs) > 0 || Number(day.sec) >= 120));
    };
    const cursor = new Date(at);
    if (!qualifies(cursor)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (qualifies(cursor)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return { streak, seconds: Number(data.days[dayKey(at)]?.sec) || 0,
      segments: Object.values(data.days).reduce((sum, day) => sum + (Number(day.segs) || 0), 0),
      days: data.days };
  }

  window.__hwfeeActivity = { tick, completeSegment, summary };
  if (!audio) return;
  const reset = () => { previous = snapshot(); };
  audio.addEventListener('timeupdate', () => tick());
  audio.addEventListener('play', reset);
  audio.addEventListener('playing', reset);
  audio.addEventListener('ratechange', () => tick(true));
  for (const event of ['pause', 'ended', 'error']) audio.addEventListener(event, () => tick(true));
  for (const event of ['seeking', 'seeked', 'loadedmetadata', 'emptied']) audio.addEventListener(event, reset);
  document.addEventListener('visibilitychange', () => tick(true));
  window.addEventListener('pagehide', () => tick(true));
})();

// The saved list is the display cache. Only import and explicit playback inspect course files.
(() => {
  const key = 'cherina-pod:saved';
  const read = () => { try { const rows = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; } };
  const text = value => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const identity = item => JSON.stringify([item.k, item.dir, item.s, item.a, item.b]);
  const merge = (item, next) => ({ ...item, ...next, due: item.due, iv: item.iv, reps: item.reps, at: item.at });
  function write(rows) {
    const unique = new Map();
    for (const row of rows) {
      const before = unique.get(row.k);
      if (!before || (row.at || 0) > (before.at || 0)) unique.set(row.k, row);
    }
    localStorage.setItem(key, JSON.stringify([...unique.values()]));
  }
  function replace(item, next) {
    const fingerprint = identity(item);
    write(read().flatMap(row => identity(row) !== fingerprint ? [row] : next ? [merge(row, next)] : []));
  }
  function lessonFor(item, lessons) {
    const raw = String(item.dir || '').replace(/\/$/, '');
    const id = /^\/lessons\/([^/]+)/.exec(raw)?.[1] || raw.split('/').pop();
    return lessons.find(row => row.id === id || row.dir === raw || row.legacyIds?.includes(id));
  }
  function match(item, sentences) {
    const wanted = text(item.s);
    if (!wanted || !Array.isArray(sentences)) return -1;
    const matches = [];
    sentences.forEach((sentence, index) => {
      if (text(sentence.s) === wanted && Number.isFinite(sentence.a) && Number.isFinite(sentence.b)
          && sentence.b > sentence.a) matches.push(index);
    });
    if (matches.length === 1) return matches[0];
    const timed = matches.filter(index => Number.isFinite(item.a) && Math.abs(sentences[index].a - item.a) < .002);
    return timed.length === 1 ? timed[0] : -1;
  }
  function canonical(item, lesson, sentence) {
    return { ...item, k: lesson.dir + '#' + sentence.n, dir: lesson.dir, n: sentence.n,
      a: sentence.a, b: sentence.b, s: sentence.s, t: sentence.t || '',
      title: lesson.title || item.title, podcast: lesson.podcast || item.podcast };
  }
  async function load(lesson) {
    const response = await fetch(lesson.dir + '/player.html', { cache: 'no-store' });
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new Error('课程暂时无法读取');
    const html = await response.text();
    const data = /<script\b[^>]*\bid\s*=\s*["']data["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    const payload = data && JSON.parse(data[1]);
    if (!Array.isArray(payload?.sentences)) throw new Error('课程句子数据不可用');
    return payload;
  }
  async function resolve(item, lessons) {
    const lesson = lessonFor(item, lessons);
    if (!lesson?.dir) return null;
    const payload = await load(lesson);
    const index = match(item, payload?.sentences);
    return index < 0 ? null : { item: canonical(item, lesson, payload.sentences[index]), lesson,
      source: new URL(payload.audio || 'audio/episode.mp4', new URL(lesson.dir + '/', location.origin)).href };
  }
  async function reconcile(lessons) {
    const before = read();
    const courses = new Map(), outcomes = new Map();
    for (const item of before) {
      const lesson = lessonFor(item, lessons);
      if (!lesson?.dir) { outcomes.set(identity(item), null); continue; }
      if (!courses.has(lesson.dir)) {
        // A read failure is not proof that a sentence disappeared; keep its cached entry.
        try { courses.set(lesson.dir, { payload: await load(lesson) }); }
        catch { courses.set(lesson.dir, { failed: true }); }
      }
      const course = courses.get(lesson.dir);
      if (course.failed) continue;
      const index = match(item, course.payload?.sentences);
      outcomes.set(identity(item), index < 0 ? null : canonical(item, lesson, course.payload.sentences[index]));
    }
    // Re-read at commit so edits, review grades and new bookmarks made while loading survive.
    write(read().flatMap(item => {
      const fingerprint = identity(item);
      if (!outcomes.has(fingerprint)) return [item];
      const next = outcomes.get(fingerprint);
      return next ? [merge(item, next)] : [];
    }));
  }
  function restore(item) {
    if (!item?.k || read().some(row => row.k === item.k)) return;
    write([...read(), item]);
  }
  window.__hwfeeSavedState = { read, match, resolve, reconcile, replace, restore, remove: item => replace(item, null) };
})();

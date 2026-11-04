// Rebuilt lessons keep segment identities and move sentence checkpoints by audio time.
(() => {
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const recency = state => Math.max(Number(state?.updatedAt) || 0,
    ...Object.values(state?.parts || {}).map(point => Number(point?.at) || 0));
  function migrate(data) {
    const course = data.hwfeeCourse;
    if (course?.schema !== 2 || !Array.isArray(course.legacyIds)) return read('cherina-lesson:' + data.id);
    const key = 'cherina-lesson:' + data.id;
    const current = read(key);
    if (current?.timelineVersion === course.revision) return current;
    const candidates = [...new Set([data.id, ...course.legacyIds])]
      .map(id => ({ id, state: read('cherina-lesson:' + id) })).filter(row => row.state && typeof row.state === 'object');
    if (!candidates.length) return null;
    candidates.sort((a, b) => recency(b.state) - recency(a.state));
    const state = JSON.parse(JSON.stringify(candidates[0].state));
    const sentences = data.sentences, segments = data.segments, old = course.legacyTimeline;
    if (!sentences?.length || !segments?.length || !old?.sentences?.length) return current;
    const groupAt = value => Math.max(0, Math.min(segments.length - 1, Number.isInteger(value) ? value : 0));
    const sentenceAt = (time, seg) => {
      const group = segments[seg];
      let index = group.from;
      for (let i = group.from; i < group.to; i++) {
        if (sentences[i].a <= time) index = i;
        else if (time > sentences[index].b && sentences[i].a - time < time - sentences[index].b) index = i;
      }
      return index;
    };
    const pointAt = (point, seg) => {
      const time = Number.isFinite(point.t) ? point.t : old.sentences[point.cur]?.a ?? segments[seg].start;
      return { ...point, cur: sentenceAt(time, seg),
        t: Math.max(segments[seg].start, Math.min(segments[seg].end, time)) };
    };
    state.parts = {}; state.steps = {}; state.ratings = {};
    for (const row of [...candidates].reverse()) {
      const previous = row.state;
      Object.assign(state.ratings, previous.ratings || {});
      for (const [seg, value] of Object.entries(previous.steps || {})) {
        state.steps[seg] = Math.max(state.steps[seg] || 0, value);
      }
      for (const [name, point] of Object.entries(previous.parts || {})) {
        const seg = Number(name);
        if (!Number.isInteger(seg) || seg < 0 || seg >= segments.length || !point) continue;
        const mapped = pointAt(point, seg);
        mapped.stages = Object.fromEntries(Object.entries(point.stages || {}).map(([step, checkpoint]) => [step, pointAt(checkpoint, seg)]));
        const prior = state.parts[seg];
        if (!prior || (point.at || 0) >= (prior.at || 0)) {
          mapped.stages = { ...prior?.stages, ...mapped.stages };
          state.parts[seg] = mapped;
        } else prior.stages = { ...mapped.stages, ...prior.stages };
      }
    }
    state.seg = groupAt(state.seg);
    const point = state.parts[state.seg] || pointAt(state, state.seg);
    state.cur = point.cur;
    state.timelineVersion = course.revision;
    state.migratedFrom = candidates.map(row => row.id);
    // Back up each old state before the first remap. Legacy keys remain readable.
    for (const row of candidates) {
      const backup = 'hwfee:progress-backup:' + row.id + ':' + course.revision;
      if (!localStorage.getItem(backup)) localStorage.setItem(backup, JSON.stringify(row.state));
    }
    localStorage.setItem(key, JSON.stringify(state));
    return state;
  }
  window.__hwfeeProgressMigration = { migrate };
})();

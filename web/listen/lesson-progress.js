// Checkpoints live inside the existing per-lesson state, one entry per segment.
(() => {
  window.__hwfeeProgress = {
    install({ state, audio, segments, sentences, save: originalSave, goSeg: originalGo, setStep: originalStep, render }) {
      if (!state.parts || typeof state.parts !== 'object' || Array.isArray(state.parts)) state.parts = {};
      if (state.completionVersion !== 2) {
        for (let index = 0; index < segments.length; index++) {
          const group = segments[index], point = state.parts[index] || (index === state.seg ? state : null);
          // Old players marked the whole drill after its first sentence. Later stages
          // prove completion; an unfinished drill checkpoint does not.
          if (state.steps?.[group.n] === 2 && point?.step <= 1 && !point.stages?.[2]
              && !point.stages?.[3] && !(point.cur === group.to - 1 && point.t >= sentences[group.to - 1].b - .2)) {
            state.steps[group.n] = 1;
          }
        }
        state.completionVersion = 2;
      }
      let switching = false, lastSaved = 0;
      const valid = point => point && Number.isInteger(point.cur) && Number.isInteger(point.step)
        && point.step >= 0 && point.step < 4 && Number.isFinite(point.t);
      const capture = () => {
        const previous = state.parts[state.seg];
        const current = audio.readyState >= 1 && Number.isFinite(audio.currentTime)
          ? audio.currentTime : previous?.t ?? sentences[state.cur]?.a ?? 0;
        const group = segments[state.seg];
        const t = Math.max(sentences[group.from].a, Math.min(sentences[group.to - 1].b, current));
        let cur = state.cur;
        if (state.step !== 1) for (let i = group.from; i < group.to; i++) {
          if (t >= sentences[i].a) cur = i;
        }
        const point = { cur, step: state.step, t, speed: state.speed, at: Date.now() };
        const stages = { ...previous?.stages };
        if (previous && !stages[previous.step]) stages[previous.step] = { ...previous, stages: undefined };
        stages[state.step] = { ...point };
        state.parts[state.seg] = { ...point, stages };
      };
      if (!state.parts[state.seg]) {
        let t = sentences[state.cur]?.a || 0;
        try {
          const old = JSON.parse(localStorage.getItem('hwfee:pos:' + location.pathname) || 'null');
          const group = segments[state.seg];
          if (old && old.t >= sentences[group.from].a && old.t <= sentences[group.to - 1].b) t = old.t;
        } catch {}
        state.parts[state.seg] = { cur: state.cur, step: state.step, t, speed: state.speed, at: Date.now() };
      }
      const restore = point => {
        const group = segments[state.seg];
        if (!valid(point) || point.cur < group.from || point.cur >= group.to) return;
        state.cur = point.cur; state.step = point.step;
        if (Number.isFinite(point.speed)) state.speed = point.speed;
        render();
        audio.currentTime = Math.max(sentences[group.from].a, Math.min(sentences[group.to - 1].b, point.t));
        audio.playbackRate = state.speed;
      };
      const save = () => {
        if (!switching) capture();
        state.updatedAt = Date.now();
        originalSave(); lastSaved = Date.now();
      };
      const goSeg = (index, line) => {
        save();
        const next = state.parts[Math.max(0, Math.min(segments.length - 1, index))];
        const checkpoint = next ? { ...next } : null;
        switching = true;
        try { originalGo(index, line); if (line == null) restore(checkpoint); }
        finally { switching = false; }
        save();
      };
      const setStep = originalStep ? (step, auto) => { save(); originalStep(step, auto); } : undefined;
      const initial = state.parts[state.seg];
      const group = segments[state.seg];
      if (valid(initial) && initial.cur >= group.from && initial.cur < group.to) {
        state.cur = initial.cur; state.step = initial.step;
      }
      audio.dataset.hwfeeProgressManaged = '1';
      audio.addEventListener('loadedmetadata', () => {
        if (audio.dataset.hwfeeNativeReused === '1' && !audio.paused) return;
        restore(state.parts[state.seg]);
      });
      audio.addEventListener('timeupdate', () => { if (Date.now() - lastSaved >= 1000) save(); });
      for (const event of ['pause', 'seeked', 'ratechange']) audio.addEventListener(event, save);
      window.addEventListener('pagehide', save);
      window.__hwfeeFlushProgress = save;
      return { save, goSeg, setStep };
    },
  };
})();

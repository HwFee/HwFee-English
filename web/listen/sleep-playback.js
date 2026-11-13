// Continuous listening is temporary: follow the audio without completing practice stages.
// The original lesson remains untouched; LessonServer wires these callbacks inside its player.
(() => {
  window.__hwfeeSleepPlayback = {
    install({ audio, state, indexAt, segmentOf, render, renderLine, finishTick }) {
      let checkpoint = null;
      const sync = () => {
        if (audio.hwfeeSleepActive) {
          if (!checkpoint) {
            const part = window.__hwfeeReviewPlayback ? null : state.parts?.[state.seg];
            const saved = part?.step === state.step && Number.isInteger(part.cur) && Number.isFinite(part.t);
            // A hidden frame's lyric cursor can lag the checkpoint derived from native time.
            checkpoint = { seg: state.seg, cur: saved ? part.cur : state.cur, step: state.step,
              time: saved ? part.t : audio.currentTime };
            render();
          }
          return;
        }
        if (!checkpoint) return;
        const previous = checkpoint;
        checkpoint = null;
        audio.dataset.hwfeeSleepRestoring = '1';
        try {
          state.seg = previous.seg; state.cur = previous.cur; state.step = previous.step;
          audio.pause();
          render();
          audio.currentTime = previous.time;
        } finally { delete audio.dataset.hwfeeSleepRestoring; }
        window.__hwfeeFlushProgress?.();
      };
      audio.addEventListener('hwfee:sleepchange', sync);
      sync();
      return () => {
        sync();
        if (!audio.hwfeeSleepActive) return false;
        const index = indexAt(audio.currentTime);
        const segment = segmentOf(index);
        if (segment !== state.seg) {
          // goSeg() is a practice command: it pauses and seeks. Do not use it for sleep progress.
          state.seg = segment; state.cur = index; render();
        } else if (index !== state.cur) {
          state.cur = index; renderLine();
        }
        finishTick();
        return true;
      };
    },
  };
})();

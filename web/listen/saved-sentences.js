// Saved/review clips share the native decoder; the generated library keeps its layout.
(() => {
  const audio = document.getElementById('au');
  let api;
  try { api = window.top?.Capacitor?.Plugins?.Audio; } catch {}
  const native = Boolean(api?.nativePrepare && api?.nativeControl);
  let lessons = [];
  try { lessons = JSON.parse(document.getElementById('data').textContent).lessons || []; } catch {}
  let request = 0, lease = '', activeKey = '', playing = false, loading = false, end = 0;
  let refresh, cancelMetadata, listener, frame = 0, sequence = -1;

  function paint() {
    for (const button of document.querySelectorAll('#saved .sv-play,#saved button[data-k]:not([data-remove-saved]),#rvP')) {
      const active = button.id === 'rvP' ? Boolean(activeKey) : button.dataset.k === activeKey;
      button.disabled = active && loading;
      button.setAttribute('aria-busy', String(active && loading));
      const label = active && playing ? '暂停句子' : '播放句子';
      button.setAttribute('aria-label', label);
      button.style.opacity = active && loading ? '.5' : '';
      const svg = button.querySelector('svg');
      if (svg) svg.innerHTML = active && playing
        ? '<rect x="7" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
        : '<path d="M8.2 5.6v12.8a1.2 1.2 0 0 0 1.84 1.02l10.1-6.4a1.2 1.2 0 0 0 0-2.04l-10.1-6.4A1.2 1.2 0 0 0 8.2 5.6z"/>';
    }
  }
  function errorMessage(error) {
    try {
      if (window.parent?.hwfeeToast) {
        window.parent.hwfeeToast('句子播放失败', { kind: 'error', detail: error.message || String(error) });
        return;
      }
    } catch {}
    let status = document.getElementById('savedPlaybackStatus');
    if (!status) {
      status = document.createElement('p'); status.id = 'savedPlaybackStatus';
      status.className = 'empty'; status.setAttribute('role', 'status');
      document.getElementById('saved')?.after(status);
    }
    status.textContent = '句子播放失败：' + (error.message || String(error));
  }
  function onState(state) {
    if (!lease || state.sourceId !== lease) return;
    if (Number.isFinite(state.sequence)) {
      if (state.sequence < sequence) return;
      sequence = state.sequence;
    }
    if (state.playing || ['boundary', 'ended', 'error'].includes(state.event)) loading = false;
    if (!loading) playing = Boolean(state.playing);
    if (state.event === 'error') errorMessage(new Error(state.error || '原生音频不可用'));
    paint();
  }
  function stopClip() {
    cancelMetadata?.();
    cancelAnimationFrame(frame);
    if (native) {
      return lease ? api.nativeControl({ action: 'pause', sourceId: lease }).catch(() => {}) : Promise.resolve();
    }
    audio?.pause();
    return Promise.resolve();
  }
  function pause() {
    ++request;
    playing = false;
    loading = false;
    paint();
    return stopClip();
  }
  function watchClip() {
    if (!audio || audio.paused) return;
    if (audio.currentTime >= end - .02) { void pause(); return; }
    frame = requestAnimationFrame(watchClip);
  }
  async function play(item, { toggle = true } = {}) {
    if (!item) return;
    if (activeKey === item.k && playing) {
      if (toggle) await pause();
      else paint(); // A newly opened review button must inherit the clip already playing.
      return;
    }
    const current = ++request;
    const stopped = stopClip();
    lease = ''; // Ignore the previous decoder's events while resolving the next bookmark.
    activeKey = item.k; loading = true; playing = false; paint();
    document.getElementById('savedPlaybackStatus')?.remove();
    try {
      await stopped;
      if (current !== request) return;
      const original = item;
      const resolved = await window.__hwfeeSavedState.resolve(original, lessons);
      if (current !== request) return;
      if (!resolved) { window.__hwfeeSavedState.remove(original); loading = false; activeKey = ''; update(); return; }
      item = resolved.item;
      window.__hwfeeSavedState.replace(original, item);
      try { window.hwfeeSavedResolved?.(original.k, item); } catch {}
      activeKey = item.k;
      update();
      if (!Number.isFinite(item.a) || !Number.isFinite(item.b) || item.b <= item.a) throw new Error('收藏句子的时间无效');
      const { source, lesson } = resolved;
      end = item.b;
      if (native) {
        try { window.parent?.hwfeeBeforeSavedClip?.(); } catch {}
        await api.nativeControl({ action: 'pause' });
        if (current !== request) return;
        lease = 'saved:' + Date.now() + ':' + current + ':' + Math.random().toString(36).slice(2);
        sequence = -1;
        await api.nativePrepare({ source, sourceId: lease, lesson: lesson?.id || '',
          title: item.title || lesson?.title || '收藏句子', artist: item.podcast || lesson?.podcast || '',
          artwork: lesson?.image ? new URL(lesson.image, location.origin).href : '' });
        if (current !== request) return;
        await api.nativeControl({ action: 'seek', sourceId: lease, position: item.a });
        if (current !== request) return;
        await api.nativeControl({ action: 'rate', sourceId: lease, rate: 1 });
        if (current !== request) return;
        await api.nativeControl({ action: 'play', sourceId: lease, start: item.a, end: item.b, loop: false, drill: true });
      } else {
        if (audio.currentSrc !== source || audio.readyState < 1) {
          await new Promise((resolve, reject) => {
            const cleanup = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', ready); audio.removeEventListener('error', failed); cancelMetadata = null; };
            const ready = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error('课程音频无法读取，请重新导入对应课程')); };
            const timer = setTimeout(failed, 10000);
            cancelMetadata = () => { cleanup(); reject(new DOMException('播放已取消', 'AbortError')); };
            audio.addEventListener('loadedmetadata', ready); audio.addEventListener('error', failed);
            audio.src = source; audio.load();
          });
        }
        if (current !== request) return;
        audio.currentTime = item.a; audio.playbackRate = 1;
        await audio.play();
        if (current === request) frame = requestAnimationFrame(watchClip);
      }
      if (current === request && loading) { loading = false; playing = true; paint(); }
    } catch (error) {
      if (current !== request || error.name === 'AbortError') return;
      loading = false; playing = false; paint(); errorMessage(error);
    }
  }
  function update() { refresh?.(); paint(); }
  window.__hwfeeSaved = { play, pause, paint, mount(callback) { refresh = callback; update(); } };
  if (native) api.addListener('nativeAudioState', onState).then(value => { listener = value; }).catch(() => {});
  else {
    audio?.addEventListener('timeupdate', () => { if (playing && audio.currentTime >= end) void pause(); });
    audio?.addEventListener('pause', () => { playing = false; paint(); });
    audio?.addEventListener('error', () => { if (!loading && playing) errorMessage(new Error('课程音频播放失败')); });
  }
  window.addEventListener('storage', event => { if (!event.key || event.key === 'cherina-pod:saved') update(); });
  window.addEventListener('pageshow', update);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  window.addEventListener('pagehide', () => { void pause(); listener?.remove(); });
})();

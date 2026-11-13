// Present the generated player with its audio API while Android owns the decoder.
(() => {
  let api;
  try { api = window.top?.Capacitor?.Plugins?.Audio; } catch {}
  const element = document.querySelector('audio');
  if (!api?.nativePrepare || !api?.nativeControl || !element) return;
  let payload;
  try { payload = JSON.parse(document.getElementById('data').textContent); } catch { return; }
  element.dataset.hwfeeNativeAudio = '1';
  let source = '', sourceId = '', generation = 0, preparedGeneration = -1, attached = true, ignoreMetadataSeek = false;
  let preparePromise = Promise.resolve();
  let state = { playing: false, prepared: false, seeking: false, ended: false,
    position: 0, duration: Number(payload.duration) || 0, rate: 1, error: '' };
  let anchoredAt = performance.now();
  let pendingPause = 0, commandId = 0, latestSequence = -1, refreshPromise = null;
  let seekId = 0, pendingSeek = null, sleepPending = null;
  const sleepSeconds = () => sleepPending === null ? Number(state.sleepSeconds) || 0 : sleepPending * 60;
  const continuousSleep = () => sleepSeconds() > 0 && (sleepPending !== null || Boolean(state.sleepContinuous));
  const emit = event => element.dispatchEvent(new Event(event));
  const currentTime = () => pendingSeek ? pendingSeek.position
    : Math.min(state.bounded && !state.seeking ? state.clipEnd : state.duration || Infinity, Math.max(0, state.position
    + (state.playing && !state.seeking ? (performance.now() - anchoredAt) / 1000 * state.rate : 0)));
  const command = (action, data = {}) => api.nativeControl({ action, sourceId, ...data });

  function apply(next) {
    if (!attached || !next || (next.source && next.source !== source)) return;
    if (next.sourceId && next.sourceId !== sourceId) return;
    if (pendingPause && next.playing) return;
    if (Number.isFinite(next.sequence)) {
      if (next.sequence < latestSequence) return;
      latestSequence = next.sequence;
    }
    const before = state, oldSleep = sleepSeconds(), oldContinuous = continuousSleep();
    state = { ...state, ...next };
    if (sleepPending !== null && next.sleepSeconds === sleepPending * 60) sleepPending = null;
    anchoredAt = performance.now();
    if (state.prepared && preparedGeneration !== generation) {
      preparedGeneration = generation;
      element.dataset.hwfeeNativeReused = next.reused ? '1' : '0';
      ignoreMetadataSeek = Boolean(next.reused && next.playing);
      emit('loadedmetadata');
      ignoreMetadataSeek = false;
      emit('durationchange');
    }
    if (oldSleep !== sleepSeconds() || oldContinuous !== continuousSleep()) emit('hwfee:sleepchange');
    if (next.event === 'seeked') emit('seeked');
    if (state.playing && !before.playing) { emit('play'); emit('playing'); }
    emit('timeupdate');
    if (next.event === 'boundary') window.__hwfeeNativeTick?.();
    if (!state.playing && before.playing) emit('pause');
    if (next.event === 'ended') emit('ended');
    if (next.event === 'error') emit('hwfee:native-error');
  }

  function prepare(value) {
    source = value.startsWith('data:') ? value : new URL(value, location.href).href;
    const requested = ++generation;
    sourceId = `${payload.id}:${Date.now()}:${generation}:${Math.random().toString(36).slice(2)}`;
    preparedGeneration = -1;
    latestSequence = -1;
    pendingSeek = null; ++seekId;
    state = { ...state, prepared: false, playing: false, seeking: false, ended: false, position: 0, error: '' };
    anchoredAt = performance.now();
    preparePromise = api.nativePrepare({ source, sourceId, lesson: payload.id, title: payload.title || document.title,
      restoreCheckpoint: new URLSearchParams(location.search).get('resumeCheckpoint') === '1',
      continuousLesson: true,
      artist: payload.podcast || '', artwork: payload.image ? new URL(payload.image, location.href).href : '' })
      .then(next => { if (requested === generation) apply(next); })
      .catch(error => {
        if (requested !== generation || !attached) return;
        state.error = String(error?.message || error); emit('hwfee:native-error');
        throw error;
      });
    // Source assignment does not have a caller to receive a rejected promise.
    preparePromise.catch(() => {});
  }

  function syncRange() {
    const range = window.__hwfeeNativeRange?.();
    return range ? command('range', range) : Promise.resolve();
  }

  Object.defineProperties(element, {
    src: { configurable: true, get: () => source, set: prepare },
    currentSrc: { configurable: true, get: () => source },
    currentTime: { configurable: true, get: currentTime, set: value => {
      if (ignoreMetadataSeek || !Number.isFinite(Number(value))) return;
      state.position = Math.max(0, Number(value)); anchoredAt = performance.now(); state.seeking = true;
      const request = ++seekId;
      pendingSeek = { request, position: state.position };
      emit('seeking');
      command('seek', { position: state.position }).then(next => {
        if (pendingSeek?.request !== request) return;
        pendingSeek = null;
        apply(next);
        // A very short clip can finish while the seek acknowledgement is in transit.
        if (state.event === 'boundary' && !state.playing) window.__hwfeeNativeTick?.();
      }).catch(() => { if (pendingSeek?.request === request) { pendingSeek = null; element.hwfeeRefreshNative?.(); } });
      syncRange().catch(() => {});
    } },
    duration: { configurable: true, get: () => state.duration },
    paused: { configurable: true, get: () => !state.playing },
    ended: { configurable: true, get: () => state.ended },
    seeking: { configurable: true, get: () => state.seeking },
    hwfeeBoundedPlayback: { configurable: true, get: () => Boolean(state.bounded) },
    hwfeeSleepActive: { configurable: true, get: continuousSleep },
    hwfeeSleepSeconds: { configurable: true, get: sleepSeconds },
    readyState: { configurable: true, get: () => state.prepared ? 4 : 0 },
    networkState: { configurable: true, get: () => state.prepared ? 1 : 2 },
    error: { configurable: true, get: () => state.error ? { code: 3, message: state.error } : null },
    playbackRate: { configurable: true, get: () => state.rate, set: value => {
      state.position = currentTime(); anchoredAt = performance.now(); state.rate = Number(value) || 1;
      emit('ratechange'); command('rate', { rate: state.rate }).catch(() => {});
    } },
  });
  element.load = () => { if (source) prepare(source); };
  element.play = () => {
    pendingPause = 0;
    const request = ++commandId, requestedGeneration = generation;
    return preparePromise.catch(() => {}).then(() => {
      if (!attached || request !== commandId || requestedGeneration !== generation)
        throw new DOMException('播放操作已取消', 'AbortError');
      return command('play', window.__hwfeeNativeRange?.() || {});
    });
  };
  element.pause = () => {
    state.position = currentTime(); anchoredAt = performance.now();
    const playing = state.playing; state.playing = false;
    if (playing) emit('pause');
    const request = ++commandId;
    pendingPause = request;
    command('pause').then(next => {
      if (pendingPause === request) { pendingPause = 0; apply(next); }
    }).catch(() => { if (pendingPause === request) pendingPause = 0; });
  };
  // Disable page auto-pauses immediately while the service is accepting the timer command.
  // A failure rolls this back; only a matching native timer acknowledgement clears the intent.
  element.hwfeeSetSleepPending = minutes => {
    const oldSeconds = sleepSeconds(), oldContinuous = continuousSleep();
    sleepPending = minutes === null ? null : Math.max(0, Number(minutes) || 0);
    if (oldSeconds !== sleepSeconds() || oldContinuous !== continuousSleep()) emit('hwfee:sleepchange');
  };
  element.hwfeeRefreshNative = () => {
    if (!refreshPromise) refreshPromise = command('state').then(apply).catch(() => {}).finally(() => { refreshPromise = null; });
    return refreshPromise;
  };
  api.addListener('nativeAudioState', apply).then(listener => {
    window.addEventListener('pagehide', () => { attached = false; listener.remove(); }, { once: true });
  }).catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) element.hwfeeRefreshNative();
  });
  document.addEventListener('click', event => {
    if (event.target.closest?.('#bLoop,#steps,#bSeg')) queueMicrotask(() => syncRange().catch(() => {}));
  });
  for (const id of ['steps', 'segName']) {
    const node = document.getElementById(id);
    if (node) new MutationObserver(() => syncRange().catch(() => {})).observe(node,
      { childList: true, subtree: true, characterData: true });
  }
})();

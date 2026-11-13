// Injected into player.html at serve time. Reports what the audio element is doing to the native
// side and accepts transport commands from the lock screen. player.html itself stays untouched.
(() => {
  let lastReport = 0;
  let started = false;
  let restored = false;

  const plugin = () => {
    try { return (window.top?.Capacitor ?? window.Capacitor)?.Plugins?.Audio ?? null; } catch { return null; }
  };
  const audio = () => document.querySelector('audio');
  document.addEventListener('click', event => {
    if (event.target.closest?.('.act.bm')) queueMicrotask(() => {
      try { window.parent?.hwfeeSavedChanged?.(); } catch {}
    });
  }, true);
  let payload = {};
  try { payload = JSON.parse(document.getElementById('data')?.textContent || '{}'); } catch {}
  const dir = /^\/lessons\/([^/]+)\//.exec(location.pathname)?.[1] || '';
  let wantedPlaying = false;
  let lastGoodTime = 0;
  let recovering = false;
  let resumeAfterReload = null;
  const reloadKey = 'hwfee:audio-reload:' + location.pathname;
  try {
    resumeAfterReload = JSON.parse(sessionStorage.getItem(reloadKey) || 'null');
    sessionStorage.removeItem(reloadKey);
    if (Date.now() - resumeAfterReload?.at > 30000) resumeAfterReload = null;
  } catch {}

  // ------------------------------------------------------------- resume position
  // cherina-pod restores the sentence, not the seconds inside it. One key per lesson keeps
  // the offset local, and the sentence index is stored so a changed sentence never seeks.

  const posKey = () => 'hwfee:pos:' + location.pathname;
  let lastSave = 0;

  function lineIndex() {
    const current = document.querySelector('#ly .ln.cur') || document.querySelector('.ln.cur');
    return current ? Number(current.dataset.i) : -1;
  }

  function savePos(force) {
    if (window.__hwfeeReviewPlayback) return;
    const el = audio();
    if (!el || el.hwfeeSleepActive || el.dataset.hwfeeSleepRestoring === '1'
        || recovering || el.error || el.readyState < 1 || !Number.isFinite(el.currentTime)) return;
    const now = Date.now();
    if (!force && now - lastSave < 2000) return;
    lastSave = now;
    try {
      localStorage.setItem(posKey(), JSON.stringify({ i: lineIndex(), t: el.currentTime, at: now }));
    } catch {}
  }

  function restorePos() {
    if (restored) return;
    const el = audio();
    if (!el) return;
    if (el.dataset.hwfeeProgressManaged === '1') { restored = true; return; }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(posKey()) || 'null'); } catch { return; }
    if (resumeAfterReload) saved = { t: resumeAfterReload.position };
    if (!saved || !Number.isFinite(saved.t) || saved.t < 0) return;
    restored = true;
    const index = lineIndex();
    if (Number.isInteger(saved.i) && index >= 0 && saved.i !== index) return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    const limit = duration > 0 ? duration : saved.t + 1;
    if (Math.abs(saved.t - el.currentTime) >= 0.75) {
      try { el.currentTime = Math.min(saved.t, Math.max(0, limit - 0.25)); } catch {}
    }
    lastGoodTime = el.currentTime;
    if (resumeAfterReload) {
      const resume = resumeAfterReload;
      resumeAfterReload = null;
      el.playbackRate = resume.rate || 1;
      if (resume.playing) { wantedPlaying = true; el.play().catch(() => {}); }
    }
  }

  // --------------------------------------------------------- media self-repair
  // Chromium can drop the decoder while the app is in the background (or when the frame
  // is hidden). The element then fires error and cherina-pod paints "Audio not found",
  // so rebuild the pipeline at the same second instead of leaving a dead player.

  const RETRY_DELAYS = [300, 1200, 3000, 8000];
  let recoveries = 0;
  let lastRecovery = 0;
  let recoveryTimer = 0;
  let recoveryTimeout = 0;
  let cancelResume = null;
  let checkingFailure = false;
  let missingFile = false;
  let failureGeneration = 0;
  let playWatchdog = 0;

  function hideWarn() {
    const warn = document.getElementById('warn');
    if (warn) warn.style.display = 'none';
  }

  function warnShown() {
    const warn = document.getElementById('warn');
    return Boolean(warn) && warn.style.display === 'block';
  }

  /** Why the media died, kept for diagnosis: the last five failures. */
  function noteError(el, status = null) {
    try {
      const log = JSON.parse(localStorage.getItem('hwfee:audio-errors') || '[]');
      log.push({
        at: Date.now(),
        code: el.error?.code ?? null,
        message: el.error?.message || '',
        src: (el.currentSrc || el.src || '').startsWith('data:') ? 'inline audio' : el.currentSrc || el.src || '',
        status,
        ready: el.readyState,
        network: el.networkState,
        visibility: document.visibilityState,
      });
      localStorage.setItem('hwfee:audio-errors', JSON.stringify(log.slice(-5)));
    } catch {}
  }

  function showFailure(message, retry = true) {
    const warn = document.getElementById('warn');
    if (!warn) return;
    warn.replaceChildren(document.createTextNode(message));
    if (retry) {
      const button = document.createElement('button');
      button.textContent = '重试';
      button.style.cssText = 'margin-left:12px;text-decoration:underline;font-weight:600';
      button.onclick = () => {
        missingFile = false;
        if (audio()?.dataset.hwfeeNativeAudio === '1') audio().play().catch(() => {});
        else recoverMedia(true);
      };
      warn.append(button);
    }
    warn.style.display = 'block';
  }

  function recoverMedia(force) {
    const el = audio();
    if (!el) return;
    if (force) recoveries = 0;
    clearTimeout(recoveryTimer);
    clearTimeout(recoveryTimeout);
    cancelResume?.();
    if (recoveries >= RETRY_DELAYS.length) return;
    ++failureGeneration;
    recoveries++;
    lastRecovery = Date.now();
    showFailure('正在恢复音频…', false);
    const at = lastGoodTime || (Number.isFinite(el.currentTime) ? el.currentTime : 0);
    const rate = el.playbackRate;
    const wasPlaying = wantedPlaying;
    recovering = true;
    const resume = () => {
      clearTimeout(recoveryTimeout);
      cancelResume?.();
      try { if (at > 0.2) el.currentTime = at; } catch {}
      el.playbackRate = rate;
      recovering = false;
      hideWarn();
      if (wasPlaying) el.play().catch(() => {});
    };
    el.addEventListener('loadedmetadata', resume, { once: true });
    cancelResume = () => { el.removeEventListener('loadedmetadata', resume); cancelResume = null; };
    recoveryTimeout = setTimeout(() => { recovering = false; scheduleRecovery(); }, 10000);
    try {
      // Re-assigning the source is the one thing load() cannot do when the pipeline is gone.
      if (!el.getAttribute('src') && el.currentSrc) el.src = el.currentSrc;
      el.load();
      if (el.readyState >= 1) setTimeout(resume, 0);
    } catch {}
  }

  function scheduleRecovery() {
    if (recoveries >= RETRY_DELAYS.length) {
      clearTimeout(recoveryTimeout);
      cancelResume?.();
      if (!askParentToReload()) showFailure('音频暂时无法播放，请重试。');
      return;
    }
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(
      () => {
        const el = audio();
        if (el && (el.error || el.readyState < 2 || (wantedPlaying && el.paused))) recoverMedia(false);
        else hideWarn();
      },
      RETRY_DELAYS[Math.min(recoveries, RETRY_DELAYS.length - 1)]);
  }

  /** Out of in-page retries: ask the shell for a fresh document, which re-runs the request. */
  function askParentToReload() {
    try {
      sessionStorage.setItem(reloadKey, JSON.stringify({
        at: Date.now(), position: lastGoodTime, playing: wantedPlaying, rate: audio()?.playbackRate || 1,
      }));
      if (window.parent !== window && window.parent.hwfeeReloadPlayer?.()) return true;
      sessionStorage.removeItem(reloadKey);
    } catch {}
    return false;
  }

  async function mediaFailed() {
    const el = audio();
    if (!el || checkingFailure) return;
    checkingFailure = true;
    const generation = ++failureGeneration;
    clearTimeout(recoveryTimeout);
    cancelResume?.();
    recovering = false;
    let status = null;
    const source = el.currentSrc || el.src;
    if (source && !source.startsWith('data:') && !source.startsWith('blob:')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(source, { headers: { Range: 'bytes=0-0' }, cache: 'no-store', signal: controller.signal });
        status = response.status;
        await response.body?.cancel();
      } catch {} finally { clearTimeout(timer); }
    }
    checkingFailure = false;
    if (generation !== failureGeneration || !el.error) return;
    noteError(el, status);
    missingFile = status === 404;
    if (missingFile) { showFailure('课程音频文件缺失，请重新导入这节课。'); return; }
    showFailure(el.error?.code === 3 ? '音频解码中断，正在恢复…' : '音频加载中断，正在恢复…', false);
    scheduleRecovery();
  }

  // The player's own grid button is a link into the lesson template's own library. Inside the
  // shell the player lives in its own frame, and going back must only hide it: this document
  // is what owns the audio, so navigating it away would stop playback.
  function fixHome() {
    const home = document.getElementById('bHome');
    if (!home) return;
    home.setAttribute('href', '/listen/library.html');
    home.addEventListener('click', (event) => {
      try {
        if (window.parent !== window && window.parent.hwfeeClosePlayer?.()) event.preventDefault();
      } catch {}
    });
  }

  fixHome();

  // ---------------------------------------------------------------- stage lock
  // cherina-pod renders every step chip as tappable, so a blind listen can be skipped
  // straight into 对照. A chip may only open a stage that has been reached: the current
  // one, anything already completed, and nothing past the stage being worked on.

  function stepState(box) {
    const buttons = [...box.querySelectorAll('button')];
    const step = buttons.findIndex((button) => button.classList.contains('on'));
    const done = buttons.filter((button) => button.classList.contains('done')).length;
    return { buttons, unlocked: Math.max(step < 0 ? 0 : step, Math.min(3, done)) };
  }

  let hintTimer = 0;

  function hint(text) {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    let el = document.getElementById('hwfee-hint');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hwfee-hint';
      el.className = 'hwfee-note';
      nav.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('is-on');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => el.classList.remove('is-on'), 1600);
  }

  function lockSteps() {
    const box = document.getElementById('steps');
    if (!box || box.dataset.hwfeeLock === '1') return;
    box.dataset.hwfeeLock = '1';
    const paint = () => {
      const { buttons, unlocked } = stepState(box);
      buttons.forEach((button, index) => button.classList.toggle('hwfee-locked', index > unlocked));
    };
    box.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const { buttons, unlocked } = stepState(box);
      if (buttons.indexOf(button) > unlocked) {
        event.stopPropagation();
        event.preventDefault();
        hint('先听完这一段');
      }
    }, true);
    document.addEventListener('keydown', (event) => {
      if (!/^[1-4]$/.test(event.key)) return;
      if (Number(event.key) - 1 > stepState(box).unlocked) {
        event.stopImmediatePropagation();
        event.preventDefault();
        hint('先听完这一段');
      }
    }, true);
    new MutationObserver(paint).observe(box, { childList: true });
    paint();
  }

  lockSteps();

  function meta() {
    const heading = document.querySelector('h1, .tt, .title');
    const sub = document.querySelector('.pd, .podcast, .sub');
    return {
      title: (payload.title || heading?.textContent || document.title || '精听').trim().slice(0, 120),
      artist: (payload.podcast || sub?.textContent || '').trim().slice(0, 120),
      artwork: (() => { try { return payload.image ? new URL(payload.image, location.href).href : ''; } catch { return ''; } })(),
    };
  }

  function report(force) {
    const el = audio();
    const api = plugin();
    if (!el) return;
    const now = Date.now();
    if (!force && now - lastReport < 900) return;
    lastReport = now;

    const info = meta();
    let progress = {};
    try { progress = JSON.parse(localStorage.getItem('cherina-lesson:' + payload.id) || '{}'); } catch {}
    const detail = { dir, title: info.title, segment: (progress.seg || 0) + 1,
      step: progress.step || 0, playing: !el.paused && !el.ended && !el.error,
      position: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0, artwork: info.artwork };
    try {
      if (!window.__hwfeeReviewPlayback && !el.hwfeeSleepActive && el.dataset.hwfeeSleepRestoring !== '1')
        localStorage.setItem('hwfee:listen:last', JSON.stringify({ ...detail, at: now }));
      window.parent?.hwfeePlayerState?.(detail);
    } catch {}
    if (!api || el.dataset.hwfeeNativeAudio === '1') return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    api.state({
      playing: detail.playing,
      position: el.currentTime || 0,
      duration,
      title: info.title,
      artist: info.artist,
      artwork: info.artwork,
      lesson: dir,
      rate: el.playbackRate || 1,
    }).catch(() => {});

    if (detail.playing && !started) {
      started = true;
      api.start({ ...info, lesson: dir, duration }).catch(() => {});
    }
  }

  function attach() {
    const el = audio();
    if (!el || el.dataset.hwfeeShim === '1') return Boolean(el);
    el.dataset.hwfeeShim = '1';
    const nativeAudio = el.dataset.hwfeeNativeAudio === '1';
    wantedPlaying = !el.paused || Boolean(resumeAfterReload?.playing);
    // The generated page swallows play() rejections. Catch a dead decoder on the
    // user's first tap too, even when Chromium emits no new media error event.
    if (!nativeAudio) {
    const nativePlay = el.play.bind(el);
    el.play = () => {
      wantedPlaying = true;
      if (el.error) {
        if (!recovering) recoverMedia(true);
        return Promise.resolve();
      }
      clearTimeout(playWatchdog);
      playWatchdog = setTimeout(() => {
        if (wantedPlaying && !recovering && el.readyState < 2) recoverMedia(true);
      }, 6000);
      const attempt = nativePlay();
      return attempt?.catch(error => {
        if (wantedPlaying && !recovering && ['NotSupportedError', 'NotReadableError', 'NetworkError', 'AbortError'].includes(error.name)) {
          noteError(el);
          scheduleRecovery();
        }
        throw error;
      });
    };
    }
    el.addEventListener('play', () => { wantedPlaying = true; });
    el.addEventListener('pause', () => { if (!recovering && !el.error) wantedPlaying = false; });
    for (const event of ['timeupdate', 'seeked']) el.addEventListener(event, () => {
      if (!recovering && !el.error && el.readyState >= 1) lastGoodTime = el.currentTime;
    });
    for (const event of ['play', 'pause', 'loadedmetadata', 'seeked', 'ended']) {
      el.addEventListener(event, () => report(true));
    }
    el.addEventListener('timeupdate', () => report(false));
    // Registered after the page's own loadedmetadata handler, so this runs once the
    // sentence start is in place and can keep the seconds the listener had already heard.
    el.addEventListener('loadedmetadata', restorePos);
    for (const event of ['pause', 'ended', 'seeked']) {
      el.addEventListener(event, () => savePos(true));
    }
    el.addEventListener('timeupdate', () => savePos(false));
    // A dead media pipeline repaints "Audio not found"; rebuild it and clear the warning.
    if (!nativeAudio) el.addEventListener('error', mediaFailed);
    else el.addEventListener('hwfee:native-error', () => showFailure('音频暂时无法播放，点重试继续。'));
    el.addEventListener('playing', () => {
      clearTimeout(playWatchdog);
      clearTimeout(recoveryTimer);
      clearTimeout(recoveryTimeout);
      cancelResume?.();
      ++failureGeneration;
      recovering = false;
      hideWarn();
      missingFile = false;
      if (Date.now() - lastRecovery > 10000) recoveries = 0;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { savePos(true); return; }
      // Returning from the background is when the decoder is usually gone; retry there
      // even if the earlier attempts were used up while the app was hidden.
      if (nativeAudio) { el.hwfeeRefreshNative?.(); return; }
      if (!missingFile && (el.error || warnShown())) recoverMedia(true);
    });
    window.addEventListener('pagehide', () => savePos(true));
    report(true);
    // Metadata may already have loaded before this shim ran.
    if (el.readyState >= 1) setTimeout(restorePos, 500);
    if (!nativeAudio && (el.error || warnShown())) mediaFailed();
    for (const id of ['steps', 'segName']) {
      const node = document.getElementById(id);
      if (node) new MutationObserver(() => report(true)).observe(node, { childList: true, subtree: true, characterData: true });
    }
    return true;
  }

  if (!attach()) {
    const timer = setInterval(() => { if (attach()) clearInterval(timer); }, 400);
    setTimeout(() => clearInterval(timer), 30000);
  }

  // Native transport controls land here.
  window.__hwfeeAudio = {
    play() {
      wantedPlaying = true;
      if (audio()?.dataset.hwfeeNativeAudio === '1') audio().play().catch(() => {});
      else if (audio()?.error) recoverMedia(true);
      else audio()?.play?.().catch(() => {});
    },
    pause() { wantedPlaying = false; audio()?.pause?.(); },
    foreground() {
      const el = audio();
      if (el?.dataset.hwfeeNativeAudio === '1') { el.hwfeeRefreshNative?.(); return; }
      if (!el || missingFile || recovering) return;
      if (!el.error && !el.paused && el.readyState >= 2) { hideWarn(); return; }
      if (el.error || warnShown() || (el.readyState === 0 && el.networkState === 3)) recoverMedia(true);
    },
    toggle() {
      const el = audio();
      if (!el) return;
      if (el.paused) el.play?.().catch(() => {});
      else el.pause?.();
    },
    seekTo(seconds) {
      const el = audio();
      if (!el || !Number.isFinite(seconds)) return;
      const limit = Number.isFinite(el.duration) ? el.duration : seconds;
      el.currentTime = Math.max(0, Math.min(seconds, limit));
    },
  };
  // The player script and audio are ready even when an unrelated image is still loading.
  try { window.parent?.hwfeePlayerReady?.(window); } catch {}
})();

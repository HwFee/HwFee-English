// Injected into player.html at serve time. Reports what the audio element is doing to the native
// side and accepts transport commands from the lock screen. player.html itself stays untouched.
(() => {
  let lastReport = 0;
  let started = false;

  const plugin = () => {
    try { return (window.top?.Capacitor ?? window.Capacitor)?.Plugins?.Audio ?? null; } catch { return null; }
  };
  const audio = () => document.querySelector('audio');

  function meta() {
    const heading = document.querySelector('h1, .tt, .title');
    const sub = document.querySelector('.pd, .podcast, .sub');
    return {
      title: (heading?.textContent || document.title || '精听').trim().slice(0, 120),
      artist: (sub?.textContent || '').trim().slice(0, 120),
    };
  }

  function report(force) {
    const el = audio();
    const api = plugin();
    if (!el || !api) return;
    const now = Date.now();
    if (!force && now - lastReport < 900) return;
    lastReport = now;

    const info = meta();
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    api.state({
      playing: !el.paused,
      position: el.currentTime || 0,
      duration,
      title: info.title,
      artist: info.artist,
    }).catch(() => {});

    if (!el.paused && !started) {
      started = true;
      api.start({ title: info.title, artist: info.artist, duration }).catch(() => {});
    }
  }

  function attach() {
    const el = audio();
    if (!el || el.dataset.hwfeeShim === '1') return Boolean(el);
    el.dataset.hwfeeShim = '1';
    for (const event of ['play', 'pause', 'loadedmetadata', 'seeked', 'ended']) {
      el.addEventListener(event, () => report(true));
    }
    el.addEventListener('timeupdate', () => report(false));
    report(true);
    return true;
  }

  if (!attach()) {
    const timer = setInterval(() => { if (attach()) clearInterval(timer); }, 400);
    setTimeout(() => clearInterval(timer), 30000);
  }

  // Native transport controls land here.
  window.__hwfeeAudio = {
    play() { audio()?.play?.().catch(() => {}); },
    pause() { audio()?.pause?.(); },
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
})();

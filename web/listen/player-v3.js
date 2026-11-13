// V3 player chrome, injected at serve time. Imported lesson files stay unchanged.
(() => {
  const home = document.getElementById('bHome');
  if (home) {
    home.setAttribute('aria-label', '返回课程库');
    home.title = '返回课程库';
    home.innerHTML = '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg>';
    // The preview leads with the back button; the generated player puts it after the title.
    const column = home.parentElement;
    if (column && column.firstElementChild !== home) column.prepend(home);
  }

  const veil = document.getElementById('veil');
  if (veil && !veil.querySelector('.v3-blind-copy')) {
    const copy = document.createElement('span');
    copy.className = 'v3-blind-copy';
    copy.textContent = '盲听阶段 · 专注听整段语流';
    veil.append(copy);
  }

  const list = document.getElementById('bList');
  if (!list || document.getElementById('hwfeeSleep')) return;
  const sleep = document.createElement('button');
  sleep.type = 'button'; sleep.id = 'hwfeeSleep'; sleep.className = 'round sleep';
  sleep.setAttribute('aria-label', '睡眠定时'); sleep.title = '睡眠定时';
  sleep.setAttribute('aria-haspopup', 'dialog'); sleep.setAttribute('aria-expanded', 'false');
  sleep.innerHTML = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23Z"/></svg>';
  list.before(sleep);

  const scrim = document.createElement('div');
  scrim.id = 'hwfeeSleepScrim'; scrim.className = 'v3-sleep-scrim'; scrim.hidden = true;
  scrim.innerHTML = '<section class="v3-sleep-sheet" role="dialog" aria-modal="true" aria-labelledby="hwfeeSleepTitle">'
    + '<div class="v3-sheet-grab" aria-hidden="true"></div><h3 id="hwfeeSleepTitle">睡眠定时</h3>'
    + '<p>连续播放，跳过逐句和逐段暂停<br>到时自动暂停，保留原精听进度</p><div class="v3-sleep-grid">'
    + '<button type="button" data-minutes="0" class="is-on">关闭</button>'
    + '<button type="button" data-minutes="15">15 分钟</button>'
    + '<button type="button" data-minutes="30">30 分钟</button>'
    + '<button type="button" data-minutes="45">45 分钟</button></div></section>';
  document.getElementById('app')?.append(scrim);

  const audio = document.querySelector('audio');
  const options = [...scrim.querySelectorAll('[data-minutes]')];
  let busy = false;
  const paint = minutes => {
    for (const button of options) button.classList.toggle('is-on', Number(button.dataset.minutes) === minutes);
    sleep.classList.toggle('is-active', minutes > 0);
    sleep.setAttribute('aria-label', minutes ? `睡眠定时 ${minutes} 分钟，连续播放` : '睡眠定时');
  };
  const sync = () => {
    if (Number.isFinite(audio?.hwfeeSleepSeconds)) paint(audio.hwfeeSleepSeconds / 60);
  };
  audio?.addEventListener('hwfee:sleepchange', sync);
  sync();
  const close = () => {
    scrim.hidden = true; sleep.setAttribute('aria-expanded', 'false');
  };
  sleep.addEventListener('click', () => {
    sync();
    scrim.hidden = false; sleep.setAttribute('aria-expanded', 'true');
    scrim.querySelector('.is-on')?.focus();
  });
  scrim.addEventListener('click', event => { if (event.target === scrim) close(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || scrim.hidden) return;
    event.preventDefault(); close(); sleep.focus();
  });
  options.forEach(option => {
    option.addEventListener('click', async () => {
      if (busy) return;
      const minutes = Number(option.dataset.minutes);
      let api;
      try { api = window.top?.Capacitor?.Plugins?.Audio; } catch {}
      if (!api?.sleep) {
        try { window.parent?.hwfeeToast?.('睡眠定时只在 Android app 里可用'); } catch {}
        return;
      }
      busy = true;
      for (const button of options) button.disabled = true;
      if (minutes > 0 && !audio?.hwfeeSleepActive) window.__hwfeeFlushProgress?.();
      audio?.hwfeeSetSleepPending?.(minutes);
      try {
        await api.sleep({ minutes });
        paint(minutes);
        close();
        try { window.parent?.hwfeeToast?.(minutes ? `睡眠模式：连续播放 ${minutes} 分钟` : '已关闭睡眠定时', { kind: 'success' }); } catch {}
      } catch (error) {
        audio?.hwfeeSetSleepPending?.(null);
        sync();
        try { window.parent?.hwfeeToast?.('无法设置睡眠定时', { kind: 'error', detail: error.message || String(error) }); } catch {}
      } finally {
        busy = false;
        for (const button of options) button.disabled = false;
      }
    });
  });
})();

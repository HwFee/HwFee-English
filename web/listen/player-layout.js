// Keep the active bilingual line inside the available stage, including older lessons.
(() => {
  if (window.__hwfeeFitLyrics) { window.__hwfeeFitLyrics(); return; }
  let previousLine;
  const style = document.createElement('style');
  style.id = 'hwfee-player-layout';
  style.textContent = '.stage{min-height:0}.ln.cur{max-height:var(--hwfee-line-height,none);'
    + 'padding:var(--hwfee-line-padding,14px) 0;overflow-y:auto;overscroll-behavior:contain;'
    + '-webkit-overflow-scrolling:touch}.ln.cur .s,.ln.cur .t{overflow-wrap:anywhere}'
    + '.stage.hwfee-tall{-webkit-mask-image:none;mask-image:none}'
    + '.stage.hwfee-tall .lyrics{transition:opacity .4s}';
  document.head.append(style);

  function fit() {
    const stage = document.getElementById('stage'), lyrics = document.getElementById('ly');
    const line = lyrics?.querySelector('.ln.cur');
    if (!stage || !line) return;
    const height = stage.getBoundingClientRect().height;
    const pad = Math.min(12, Math.max(0, (height - 100) / 4));
    stage.style.setProperty('--hwfee-line-height', Math.max(0, height - pad * 2) + 'px');
    stage.style.setProperty('--hwfee-line-padding', Math.min(14, Math.max(0, (height - 100) / 4)) + 'px');
    const lineHeight = line.getBoundingClientRect().height;
    stage.classList.toggle('hwfee-tall', lineHeight > height * .7);
    if (line !== previousLine) { previousLine = line; line.scrollTop = 0; }
    const top = Math.max(pad, Math.min(height - lineHeight - pad, height * .44 - lineHeight / 2));
    const offset = line.getBoundingClientRect().top - lyrics.getBoundingClientRect().top;
    lyrics.style.transform = 'translateY(' + (top - offset) + 'px)';
  }
  window.__hwfeeFitLyrics = fit;
  function observe() {
    const stage = document.getElementById('stage');
    if (stage && window.ResizeObserver) new ResizeObserver(fit).observe(stage);
    fit();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
  else observe();
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  document.fonts?.ready.then(fit);
})();

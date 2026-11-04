// The handout's print range/mode are already applied to its DOM and print stylesheet.
(() => {
  const button = document.querySelector('.tool button[onclick*="print"]');
  if (!button) return;
  button.id = 'hwfee-save-pdf';
  button.textContent = '存为 PDF';
  button.removeAttribute('onclick');
  button.addEventListener('click', async event => {
    event.preventDefault();
    if (button.disabled) return;
    let api;
    try { api = window.top?.Capacitor?.Plugins?.Lessons; } catch {}
    if (!api?.saveHandoutPdf) { window.print(); return; }
    button.disabled = true;
    button.textContent = '正在准备 PDF…';
    try {
      const copy = document.documentElement.cloneNode(true);
      copy.querySelectorAll('script,.tool,.hbf').forEach(node => node.remove());
      await api.saveHandoutPdf({
        html: '<!doctype html>' + copy.outerHTML,
        baseUrl: location.href.split('#')[0],
        title: (document.querySelector('h1')?.textContent || document.title || '精听讲义').trim(),
      });
    } catch (error) {
      try { window.top?.hwfeeToast?.('PDF 保存界面未打开', { kind: 'error', detail: String(error?.message || error) }); } catch {}
    } finally {
      button.disabled = false;
      button.textContent = '存为 PDF';
    }
  });
})();

// Share the shell's import prompt island. Standalone reader previews keep visible feedback too.
export function feedback(message, options = {}) {
  try {
    if (window.top?.hwfeeToast) { window.top.hwfeeToast(message, options); return; }
  } catch { /* Standalone or cross-origin preview. */ }
  let status = document.getElementById('readerFeedback');
  if (!status) {
    status = document.createElement('div');
    status.id = 'readerFeedback';
    status.className = 'reader-feedback';
    status.setAttribute('role', 'status');
    document.body.append(status);
  }
  status.replaceChildren();
  const title = document.createElement('b');
  title.textContent = message;
  status.append(title);
  if (options.detail) {
    const detail = document.createElement('small');
    detail.textContent = options.detail;
    status.append(detail);
  }
  status.hidden = false;
  window.clearTimeout(status.hideTimer);
  if (options.kind !== 'progress') status.hideTimer = window.setTimeout(() => { status.hidden = true; },
    options.ms || (options.kind === 'error' ? 6000 : 2600));
}

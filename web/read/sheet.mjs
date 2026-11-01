// Bottom sheet shared by the translation and word popups.
let current = null;

export function openSheet({ kicker = '', title = '', content = null, actions = [] } = {}) {
  closeSheet();

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';

  const panel = document.createElement('div');
  panel.className = 'sheet';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const grab = document.createElement('span');
  grab.className = 'sheet-grab';
  panel.append(grab);

  if (kicker) {
    const k = document.createElement('p');
    k.className = 'sheet-kicker';
    k.textContent = kicker;
    panel.append(k);
  }

  const heading = document.createElement('p');
  heading.className = 'sheet-title';
  heading.textContent = title;
  panel.append(heading);

  const body = document.createElement('div');
  body.className = 'sheet-body';
  if (content) body.append(content);
  panel.append(body);

  const row = document.createElement('div');
  row.className = 'sheet-actions';
  for (const action of actions) {
    const button = document.createElement('button');
    button.className = 'sheet-btn' + (action.primary ? ' is-primary' : '');
    button.textContent = action.label;
    button.disabled = Boolean(action.disabled);
    button.onclick = () => action.onClick?.({ button, close: closeSheet });
    row.append(button);
  }
  if (row.children.length) panel.append(row);

  overlay.append(panel);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeSheet();
  });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  current = { overlay, panel, body, heading };
  return {
    body,
    setBody(node) { body.replaceChildren(node); },
    setTitle(text) { heading.textContent = text; },
    close: closeSheet,
  };
}

export function closeSheet() {
  if (!current) return;
  const { overlay } = current;
  current = null;
  overlay.classList.remove('is-open');
  setTimeout(() => overlay.remove(), 180);
}

export function line(text, className) {
  const p = document.createElement('p');
  p.className = className || 'sheet-line';
  p.textContent = text;
  return p;
}

export function spinner(text) {
  const box = document.createElement('div');
  box.className = 'sheet-loading';
  const dot = document.createElement('i');
  box.append(dot, document.createTextNode(text || '正在处理…'));
  return box;
}

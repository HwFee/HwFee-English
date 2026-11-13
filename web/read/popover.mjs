// Anchored paper cards: one at a time, no scrim, never covering the anchor.
// Translation for a long-pressed sentence, dictionary card for a tapped word.
import { icon } from '../icons/icons.mjs';
import { feedback } from './feedback.mjs';

const RESERVE_TOP = 60;    // fixed reader controls

// The shell publishes the native bar's footprint on the top document; fall back
// to the web island's height when it isn't there.
function reserveBottom() {
  try {
    const value = parseFloat(getComputedStyle(window.top.document.documentElement)
      .getPropertyValue('--island-reserve'));
    return Number.isFinite(value) ? value : 84;
  } catch { return 84; }
}
const MARGIN = 12;
const GAP = 8;

let current = null;
let dismissedWord = null;

/** Dismiss first, then allow a fresh gesture; a retargeted release must not reopen a card. */
export function consumeDismissedWordTap(target, event = null) {
  const pending = dismissedWord;
  dismissedWord = null;
  if (!pending || Date.now() - pending.at >= 1200) return false;
  if (event?.type === 'pointerdown' || pending.event?.type === 'click') return pending.event === event;
  if (event) return pending.event?.pointerId == null || event.pointerId == null
    || pending.event.pointerId === event.pointerId;
  return target?.closest?.('.w') === pending.word;
}

/**
 * Pure placement. Everything is in viewport coordinates; the anchor uses its
 * bounding box vertically and its first rect's start horizontally.
 * Result never intersects the anchor: below wins, flips above, else the larger
 * side with a maxHeight for internal scroll.
 */
export function placePopover({ anchor, popover, viewport,
                               reserveTop = 0, reserveBottom = 0, margin = MARGIN, gap = GAP,
                               preferredSide = null, expectedHeight = popover.height }) {
  const viewTop = viewport.top || 0, viewLeft = viewport.left || 0;
  const topLimit = Math.max(viewTop + margin, reserveTop);
  const bottomLimit = Math.min(viewTop + viewport.height - margin,
    (viewport.layoutHeight ?? viewTop + viewport.height) - reserveBottom);
  const maxWidth = Math.max(0, viewport.width - 2 * margin);
  const visible = anchor.bottom > topLimit && anchor.top < bottomLimit
    && anchor.right > viewLeft && anchor.left < viewLeft + viewport.width;
  const spaceBelow = Math.max(0, bottomLimit - Math.max(anchor.bottom, topLimit) - gap);
  const spaceAbove = Math.max(0, Math.min(anchor.top, bottomLimit) - topLimit - gap);

  let side;
  if (preferredSide === 'above' || preferredSide === 'below') {
    side = preferredSide;
  } else if (spaceBelow >= expectedHeight) {
    side = 'below';
  } else if (spaceAbove >= expectedHeight) {
    side = 'above';
  } else {
    side = spaceBelow >= spaceAbove ? 'below' : 'above';
  }
  const available = side === 'below' ? spaceBelow : spaceAbove;
  const maxHeight = popover.height > available ? available : null;

  const height = maxHeight === null ? popover.height : Math.min(popover.height, maxHeight);
  const top = side === 'below' ? Math.max(anchor.bottom, topLimit) + gap : Math.min(anchor.top, bottomLimit) - gap - height;
  const right = viewLeft + viewport.width - margin - Math.min(popover.width, maxWidth);
  const left = Math.min(Math.max(anchor.left, viewLeft + margin), Math.max(viewLeft + margin, right));
  return { top, left, side, maxHeight, maxWidth, visible };
}

export function closePopover() {
  if (!current) return;
  const { el, anchor, observer, onPointerDown, onClick, parentDocument, onParentPointerDown, onResize,
    onScroll, onVisibility, viewport, onClose } = current;
  current = null;
  dismissedWord = null;
  anchor?.classList.remove('is-anchor');
  observer?.disconnect();
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('click', onClick, true);
  parentDocument?.removeEventListener('pointerdown', onParentPointerDown, true);
  parentDocument?.removeEventListener('click', onParentPointerDown, true);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onScroll, true);
  document.removeEventListener('visibilitychange', onVisibility);
  viewport?.removeEventListener('resize', onResize);
  viewport?.removeEventListener('scroll', onResize);
  el.remove();
  onClose?.();
}

/** iOS-style segmented control for the sentence card: tab switch only, body is the caller's. */
function segmented(tabs, onTab) {
  const seg = document.createElement('div');
  seg.className = 'pop-seg';
  seg.setAttribute('role', 'tablist');
  for (const [index, tab] of tabs.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pop-seg-btn' + (index === 0 ? ' is-active' : '');
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    if (tab.icon) button.append(icon(tab.icon, 14));
    button.append(tab.label);
    button.onclick = () => {
      if (button.classList.contains('is-active')) return;
      for (const item of seg.children) {
        item.classList.remove('is-active');
        item.setAttribute('aria-selected', 'false');
      }
      button.classList.add('is-active');
      button.setAttribute('aria-selected', 'true');
      onTab?.(tab.id);
    };
    seg.append(button);
  }
  return seg;
}

export function openPopover({ anchor, kind = 'sentence', label = '', tabs = null, onTab = null, onClose = null,
  expectedHeight = null } = {}) {
  closePopover();
  if (!anchor) return null;

  const el = document.createElement('div');
  el.className = 'popover is-' + kind;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label || (kind === 'word' ? '单词' : '译文'));

  if (kind === 'sentence') {
    if (tabs?.length) {
      el.append(segmented(tabs, onTab));
    } else {
      const kicker = document.createElement('p');
      kicker.className = 'popover-kicker';
      kicker.append(icon('translate', 16), '译文');
      el.append(kicker);
    }
  }

  const body = document.createElement('div');
  body.className = 'popover-body';
  el.append(body);

  document.body.append(el);
  anchor.classList.add('is-anchor');
  let placementSide = null;

  function place() {
    if (!current || current.el !== el) return;
    if (!anchor.isConnected) { closePopover(); return; }
    const rects = anchor.getClientRects();
    if (!rects.length) { closePopover(); return; }
    const bounds = anchor.getBoundingClientRect();
    const first = rects[0];

    // Measure natural size first; a previous maxHeight would under-report it.
    const visibleViewport = window.visualViewport;
    el.style.maxWidth = Math.max(0, (visibleViewport?.width || window.innerWidth) - 2 * MARGIN) + 'px';
    el.style.maxHeight = '';
    el.style.visibility = 'hidden';
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const result = placePopover({
      anchor: { top: bounds.top, bottom: bounds.bottom, left: first.left, right: first.right },
      popover: size,
      viewport: { width: visibleViewport?.width || window.innerWidth, height: visibleViewport?.height || window.innerHeight,
        left: visibleViewport?.offsetLeft || 0, top: visibleViewport?.offsetTop || 0, layoutHeight: window.innerHeight },
      reserveTop: RESERVE_TOP,
      reserveBottom: reserveBottom(),
      margin: MARGIN,
      gap: GAP,
      preferredSide: placementSide,
      expectedHeight: typeof expectedHeight === 'function' ? expectedHeight(size.width) : expectedHeight ?? size.height,
    });
    if (!result.visible || (result.maxHeight !== null && result.maxHeight < Math.min(size.height, 88))) {
      closePopover();
      if (result.visible) feedback('屏幕放不下这张卡片', { kind: 'error',
        detail: '稍作滚动或缩小字号后，再次长按句子' });
      return;
    }

    // Hold the initial side through skeletons, responses, retries and tab changes.
    if (body.hasChildNodes() || expectedHeight !== null) placementSide = result.side;

    el.classList.toggle('is-above', result.side === 'above');
    // Cap the card, not the scroll: the header (segmented tabs / kicker) must stay pinned while
    // only .popover-body scrolls. The body's overflow is set in gestures.css.
    el.style.maxHeight = result.maxHeight === null ? '' : Math.round(result.maxHeight) + 'px';

    // Document coordinates: the popover scrolls along with its anchor.
    el.style.left = Math.round(result.left + window.scrollX) + 'px';
    el.style.top = Math.round(result.top + window.scrollY) + 'px';
    el.style.visibility = '';
  }

  const dismiss = () => { if (current?.el === el) closePopover(); };
  const onPointerDown = (event) => {
    if (current?.el !== el || el.contains(event.target)) return;
    const word = event.target.closest?.('.w');
    dismiss();
    // Pointer capture and small finger movement can change the eventual click target.
    // Remember the gesture, not just the word that received pointerdown.
    const pending = { word, event, at: Date.now() };
    dismissedWord = pending;
    setTimeout(() => { if (dismissedWord === pending) dismissedWord = null; }, 1200);
  };
  // Keyboard, accessibility services and some WebViews can send a click without pointerdown.
  // Reader gestures consume the release-click of a long press before this capture listener.
  const onClick = onPointerDown;
  let parentDocument = null;
  try { if (window.top !== window) parentDocument = window.top.document; } catch {}
  const onParentPointerDown = dismiss;
  const onResize = dismiss;
  const onScroll = (event) => {
    // Let the card's own long answer scroll; page or parent-container scrolling dismisses it.
    if (event.target?.nodeType && el.contains(event.target)) return;
    dismiss();
  };
  const onVisibility = () => { if (document.hidden) dismiss(); };
  const viewport = window.visualViewport;
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        if (!entries[0]?.isIntersecting) dismiss();
      })
    : null;

  current = { el, anchor, observer, onPointerDown, onClick, parentDocument, onParentPointerDown, onResize,
    onScroll, onVisibility, viewport, onClose };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  parentDocument?.addEventListener('pointerdown', onParentPointerDown, true);
  parentDocument?.addEventListener('click', onParentPointerDown, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  viewport?.addEventListener('resize', onResize, { passive: true });
  viewport?.addEventListener('scroll', onResize, { passive: true });
  observer?.observe(anchor);
  place();
  if (current?.el !== el) return null;

  return {
    el,
    body,
    setBody(node) {
      if (current?.el !== el) return;
      body.replaceChildren(node);
      place();
    },
    close() { if (current?.el === el) closePopover(); },
  };
}

export function line(text, className) {
  const p = document.createElement('p');
  p.className = className || 'pop-line';
  p.textContent = text;
  return p;
}

/** Placeholder bars shaped like the card that is loading. */
export function skeleton({ head = true, button = true } = {}) {
  const box = document.createElement('div');
  box.setAttribute('aria-busy', 'true');
  for (const part of [head && 'head', 'l1', 'l2', button && 'btn'].filter(Boolean)) {
    const bar = document.createElement('span');
    bar.className = 'pop-skel ' + part;
    box.append(bar);
  }
  return box;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openPopover, closePopover, line, skeleton } from '../web/read/popover.mjs';

test('page scrolling dismisses the card, internal scrolling works, and late callbacks cannot alter a newer card', () => {
  const dom = new JSDOM('<span id="anchor">Birds fly.</span>', { url: 'https://localhost', pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w; globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w);
  globalThis.IntersectionObserver = undefined;
  const anchor = document.getElementById('anchor');
  anchor.getClientRects = () => [{ left: 20, right: 180, top: 140, bottom: 165 }];
  anchor.getBoundingClientRect = () => anchor.getClientRects()[0];
  try {
    const first = openPopover({ anchor });
    first.setBody(line('First'));
    first.body.dispatchEvent(new w.Event('scroll'));
    assert.ok(document.querySelector('.popover'), 'answers may scroll inside their card');
    w.dispatchEvent(new w.Event('scroll'));
    assert.equal(document.querySelector('.popover'), null);
    const second = openPopover({ anchor });
    second.setBody(line('Second'));
    first.setBody(line('Late first result'));
    first.close();
    assert.equal(document.querySelector('.popover-body').textContent, 'Second');
    anchor.remove();
    second.setBody(line('Late second result'));
    assert.equal(document.querySelector('.popover'), null, 'removed article anchors cannot reopen a card');
  } finally { closePopover(); dom.window.close(); }
});

test('loading and oversized results stay on the precomputed side and keep the anchor clear', () => {
  const dom = new JSDOM('<span id="anchor">An English sentence.</span>', { url: 'https://localhost', pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w; globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w); globalThis.IntersectionObserver = undefined;
  Object.defineProperty(w, 'innerHeight', { value: 844 });
  let height = 40;
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { get: () => height });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { get: () => 340 });
  const anchor = document.getElementById('anchor');
  anchor.getClientRects = () => [{ left: 20, right: 180, top: 460, bottom: 490 }];
  anchor.getBoundingClientRect = () => anchor.getClientRects()[0];
  try {
    const pop = openPopover({ anchor, expectedHeight: 300 });
    assert.ok(pop.el.classList.contains('is-above'));
    height = 80; pop.setBody(skeleton());
    assert.ok(pop.el.classList.contains('is-above'));
    height = 900; pop.setBody(line('A much longer analysis result.'));
    assert.ok(pop.el.classList.contains('is-above'));
    assert.equal(pop.el.style.maxHeight, '392px');
    // The cap stays on the card; the body is the scroll container (see popover-scroll.test.mjs),
    // so the header cannot scroll out of view.
    assert.equal(pop.el.style.overflowY, '');
    assert.equal(pop.el.style.top, '60px');
  } finally { closePopover(); dom.window.close(); }
});

test('a queued observer callback from a dismissed card cannot close its replacement', () => {
  const dom = new JSDOM('<span id="anchor">Birds fly.</span>', { url: 'https://localhost', pretendToBeVisual: true });
  const w = dom.window, observers = [];
  globalThis.window = w; globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w);
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.deliver = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  };
  const anchor = document.getElementById('anchor');
  anchor.getClientRects = () => [{ left: 20, right: 180, top: 140, bottom: 165 }];
  anchor.getBoundingClientRect = () => anchor.getClientRects()[0];
  try {
    openPopover({ anchor }).setBody(line('First'));
    const second = openPopover({ anchor }); second.setBody(line('Second'));
    observers[0].deliver([{ isIntersecting: false }]);
    assert.equal(document.querySelector('.popover'), second.el);
    assert.equal(second.body.textContent, 'Second');
    observers[1].deliver([{ isIntersecting: false }]);
    assert.equal(document.querySelector('.popover'), null);
  } finally { closePopover(); dom.window.close(); globalThis.IntersectionObserver = undefined; }
});

test('dismissal cleans the DOM and listeners before notifying a failing subscriber', () => {
  const dom = new JSDOM('<span id="anchor">Birds fly.</span>', { url: 'https://localhost', pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w; globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w); globalThis.IntersectionObserver = undefined;
  const anchor = document.getElementById('anchor');
  anchor.getClientRects = () => [{ left: 20, right: 180, top: 140, bottom: 165 }];
  anchor.getBoundingClientRect = () => anchor.getClientRects()[0];
  try {
    openPopover({ anchor, onClose() { throw new Error('subscriber failed'); } });
    assert.throws(closePopover, /subscriber failed/);
    assert.equal(document.querySelector('.popover'), null);
    assert.equal(anchor.classList.contains('is-anchor'), false);
    const next = openPopover({ anchor }); next.setBody(line('Recovered'));
    assert.equal(document.querySelector('.popover-body').textContent, 'Recovered');
  } finally { closePopover(); dom.window.close(); }
});

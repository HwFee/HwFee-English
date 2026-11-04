import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const value = read();
    if (value) return value;
    await delay(10);
  }
  assert.fail('reader state did not settle');
}

test('word card dismisses on every outside surface; wordbook writes use confirmed membership', async () => {
  const dom = new JSDOM('<button id="shell">Shell</button><iframe id="reader"></iframe>', {
    url: 'https://localhost/', pretendToBeVisual: true,
  });
  const outer = dom.window;
  const inner = outer.document.getElementById('reader').contentWindow;
  inner.document.body.innerHTML = '<article id="article"><div class="para"><p>Dr. Smith paid $3.50. He left.</p></div></article><button id="blank">Blank</button>';
  inner.Element.prototype.getClientRects = () => [{ left: 20, top: 140, right: 160, bottom: 165 }];
  inner.Element.prototype.getBoundingClientRect = () => ({ left: 20, top: 140, right: 160, bottom: 165 });

  globalThis.window = inner;
  globalThis.document = inner.document;
  globalThis.localStorage = outer.localStorage;
  globalThis.CustomEvent = inner.CustomEvent;
  globalThis.getComputedStyle = outer.getComputedStyle.bind(outer);
  globalThis.IntersectionObserver = undefined;

  let inBook = false;
  let checkFails = false;
  const writes = [];
  const translated = [];
  outer.Capacitor = { Plugins: {
    Shanbay: { request: async ({ path, method, body }) => {
      if (path.startsWith('/abc/words/senses')) return { body: JSON.stringify({
        id: 'giwnn', definitions: { cn: [{ pos: 'n.', def: '测试释义' }] }, audios: [],
      }) };
      if (path.startsWith('/wordscollection/words_check')) {
        if (checkFails) throw new Error('查询暂时失败');
        return { body: JSON.stringify({ objects: [{ vocab_id: 'giwnn', exists: inBook }] }) };
      }
      if (path === '/wordscollection/words') {
        writes.push({ method, body });
        inBook = method === 'POST';
        return { body: '{}' };
      }
      if (path.startsWith('/wordscollection/words?')) return { body: JSON.stringify({ total: inBook ? 1 : 0, objects: [] }) };
      if (path === '/wordsapp/user_material_books/current') return { body: JSON.stringify({ materialbook_id: 'fixture' }) };
      if (path.includes('/simple_learned_items?')) return { body: JSON.stringify({ total: 0, objects: [] }) };
      if (path.startsWith('/bay-translate/user_vocabs')) return { body: JSON.stringify({
        total: inBook ? 1 : 0,
        vocabs: inBook ? [{ vocab: 'Smith', categories: 2 }] : [],
      }) };
      throw new Error(`unexpected path: ${path}`);
    } },
    Llm: {
      getConfig: async () => ({ has: true }),
      translate: async ({ text }) => { translated.push(text); return { translation: '测试译文' }; },
    },
  } };

  const { decorate, initGestures, loadHighlightVocab, vocabCounts } =
    await import(`../web/read/gestures.mjs?interaction=${Date.now()}`);
  const root = inner.document.getElementById('article');
  decorate(root);
  initGestures(root);
  await loadHighlightVocab({ force: true });

  const word = (value) => [...root.querySelectorAll('.w')].find((node) => node.textContent === value);
  const event = (view, type) => new view.MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 150,
  });
  const tap = (node) => {
    node.dispatchEvent(event(inner, 'pointerdown'));
    node.dispatchEvent(event(inner, 'pointerup'));
    node.dispatchEvent(event(inner, 'click'));
  };
  const action = () => inner.document.querySelector('.popover .pop-btn');
  const ready = (label) => until(() => action()?.textContent === label && action());

  tap(word('Smith'));
  await ready('加入生词本');
  inner.document.getElementById('blank').dispatchEvent(event(inner, 'pointerdown'));
  assert.equal(inner.document.querySelector('.popover'), null, 'blank area closes the card');

  tap(word('Smith'));
  await ready('加入生词本');
  tap(word('paid'));
  assert.equal(inner.document.querySelector('.popover'), null, 'another word first closes the card');
  tap(word('paid'));
  await ready('加入生词本');
  outer.document.getElementById('shell').dispatchEvent(event(outer, 'pointerdown'));
  assert.equal(inner.document.querySelector('.popover'), null, 'outside the iframe also closes the card');

  checkFails = true;
  tap(word('Smith'));
  await ready('查询失败，点此重试');
  assert.equal(writes.length, 0, 'a failed status check cannot add or delete');
  checkFails = false;
  action().click();
  await ready('加入生词本');

  action().click();
  await ready('移出生词本');
  await until(() => vocabCounts()?.wordbook === 1);
  assert.deepEqual(writes[0], {
    method: 'POST', body: { vocab_id: 'giwnn', business_id: 1 },
  });
  assert.ok(word('Smith').classList.contains('hl-wordbook'));

  action().click();
  await ready('加入生词本');
  await until(() => vocabCounts()?.wordbook === 0);
  assert.deepEqual(writes[1], { method: 'DELETE', body: { vocab_ids: ['giwnn'] } });
  assert.ok(!word('Smith').classList.contains('hl-wordbook'));

  inner.document.getElementById('blank').dispatchEvent(event(inner, 'pointerdown'));
  const target = word('Smith');
  target.dispatchEvent(event(inner, 'pointerdown'));
  await delay(540);
  target.dispatchEvent(event(inner, 'pointerup'));
  const tabs = [...inner.document.querySelectorAll('.pop-seg-btn')];
  assert.equal(tabs.length, 1, 'short sentences open translation without spending analysis quota');
  assert.equal(inner.document.querySelector('.ana-seg'), null, 'a local heuristic must not be presented as real analysis');
  tabs.find((tab) => tab.textContent.includes('翻译')).click();
  await until(() => translated.length === 1);
  assert.deepEqual(translated, ['Dr. Smith paid $3.50.']);
  await until(() => inner.document.querySelector('.pop-translation'));

  inner.document.getElementById('blank').dispatchEvent(event(inner, 'pointerdown'));
  target.dispatchEvent(event(inner, 'pointerdown'));
  const move = new inner.MouseEvent('pointermove', {
    bubbles: true, button: 0, clientX: 70, clientY: 150,
  });
  target.dispatchEvent(move);
  await delay(540);
  target.dispatchEvent(event(inner, 'pointerup'));
  assert.equal(translated.length, 1, 'a real drag cancels long press');

  dom.window.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Shanbay } from '../web/read/lib.mjs';

test('daily loading overlaps independent requests and retains NEW then REVIEW order', async () => {
  const waiting = new Map();
  const called = [];
  const api = new Shanbay('', async (url) => {
    const path = new URL(url).pathname;
    called.push(url);
    if (path.endsWith('/current')) return { ok: true, json: async () => ({ materialbook_id: 7 }) };
    return new Promise(resolve => waiting.set(url, body => resolve({ ok: true, json: async () => body })));
  });
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const pending = api.today();
  await settle();
  const get = part => [...waiting].find(([url]) => url.includes(part))?.[1];
  assert.equal(waiting.size, 2, 'statuses and sync must both start before either completes');
  get('/statuses')({ date: '2026-11-03', is_finished: false });
  get('/items/sync')({ date: '2026-11-03' });
  await settle();
  assert.ok(get('type_of=NEW'));
  assert.ok(get('type_of=REVIEW'), 'review must not wait for the new-word feed');
  get('type_of=REVIEW')({ objects: [{ vocab: { id: 'r', word: 'review' } }], total: 1 });
  get('type_of=NEW')({ objects: [{ vocab: { id: 'n', word: 'new' } }], total: 1 });
  const result = await pending;
  assert.deepEqual(result.words.map(word => word.word), ['new', 'review']);
  assert.equal(called.length, 5);
});

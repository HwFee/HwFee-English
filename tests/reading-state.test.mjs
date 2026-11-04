import test from 'node:test';
import assert from 'node:assert/strict';

class FakeStorage {
  values = new Map();
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.values.set(String(k), String(v)); }
}
globalThis.localStorage = new FakeStorage();
const rs = await import('../web/read/reading-state.mjs');

test('missing entry is 待读; opening sets reading; read is sticky', () => {
  assert.equal(rs.getProgress('2026-11-02'), null);
  rs.setReading('2026-11-02');
  assert.equal(rs.getProgress('2026-11-02').state, 'reading');
  rs.markRead('2026-11-02');
  assert.equal(rs.getProgress('2026-11-02').state, 'read');
  rs.setReading('2026-11-02');
  assert.equal(rs.getProgress('2026-11-02').state, 'read');
});

test('ratio grows only; resume position is stored', () => {
  rs.setReading('2026-11-03');
  rs.setProgress('2026-11-03', { ratio: 0.6, para: 7, offset: 40 });
  rs.setProgress('2026-11-03', { ratio: 0.4, para: 9, offset: 10 });
  const p = rs.getProgress('2026-11-03');
  assert.equal(p.ratio, 0.6);
  assert.equal(p.para, 9);
  assert.equal(p.offset, 10);
});

test('markUnread deletes the entry; old entries are pruned', () => {
  rs.markRead('2026-11-03');
  rs.markUnread('2026-11-03');
  assert.equal(rs.getProgress('2026-11-03'), null);
  localStorage.setItem('hwfee:read:progress', JSON.stringify({
    '2020-01-01': { state: 'read', ratio: 1, para: 0, offset: 0, at: Date.now() - 90 * 86400000 },
    '2026-11-02': { state: 'reading', ratio: 0.2, para: 1, offset: 0, at: Date.now() },
  }));
  assert.equal(rs.getProgress('2020-01-01'), null);
  assert.equal(rs.getProgress('2026-11-02').state, 'reading');
});

test('describe labels the three states and keeps 在读 below 100%', () => {
  assert.deepEqual(rs.describe(null), { state: 'unread', label: '待读', pct: 0 });
  assert.deepEqual(rs.describe({ state: 'reading', ratio: 0.424 }), { state: 'reading', label: '在读 42%', pct: 42 });
  assert.equal(rs.describe({ state: 'reading', ratio: 0.999 }).label, '在读 99%');
  assert.equal(rs.describe({ state: 'reading' }).label, '在读 0%');
  assert.deepEqual(rs.describe({ state: 'read', ratio: 1 }), { state: 'read', label: '已读', pct: 100 });
});

test('home resumes the last article opened, including an older or already read article', () => {
  rs.setReading('2026-11-02');
  rs.setProgress('2026-11-02', { ratio: 0.5, para: 3, offset: 0.2 });
  rs.setReading('2026-11-01');
  assert.equal(rs.lastArticleDate(), '2026-11-01');
  rs.markRead('2026-11-01');
  rs.setReading('2026-11-01');
  assert.equal(rs.lastArticleDate(), '2026-11-01');
  assert.equal(rs.getProgress('2026-11-02').ratio, 0.5);
  assert.equal(rs.getProgress('2026-11-01').state, 'read');
});

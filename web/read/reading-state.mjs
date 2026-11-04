// Reading progress per article date: 待读 (no entry) → 在读 → 已读.
const KEY = 'hwfee:read:progress';
const LAST_KEY = 'hwfee:read:last';
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // matches the article archive window

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function save(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch {}
}

function prune(map, now = Date.now()) {
  let changed = false;
  for (const date of Object.keys(map)) {
    const at = map[date]?.at || 0;
    if (now - at > MAX_AGE_MS) { delete map[date]; changed = true; }
  }
  if (changed) save(map);
  return map;
}

export function getProgress(date) {
  const map = prune(load());
  return map[date] || null; // null = 待读
}

export function setReading(date) {
  const map = prune(load());
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ date, at: Date.now() })); } catch {}
  if (map[date]?.state === 'read') return;
  map[date] = { state: 'reading', ratio: map[date]?.ratio || 0, para: map[date]?.para || 0, offset: map[date]?.offset || 0, at: Date.now() };
  save(map);
}

export function setProgress(date, { ratio, para, offset }) {
  const map = prune(load());
  const prev = map[date];
  if (prev?.state === 'read') return;
  map[date] = {
    state: 'reading',
    ratio: Math.max(prev?.ratio || 0, ratio),
    para, offset, at: Date.now(),
  };
  save(map);
}

/** The home card resolves this date against its available article archive. */
export function lastArticleDate() {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    if (last?.date && Date.now() - last.at <= MAX_AGE_MS) return last.date;
  } catch {}
  return Object.entries(prune(load())).filter(([, p]) => p?.state === 'reading')
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))[0]?.[0] || null;
}

export function markRead(date) {
  const map = prune(load());
  map[date] = { state: 'read', ratio: 1, para: 0, offset: 0, at: Date.now() };
  save(map);
}

export function markUnread(date) {
  const map = prune(load());
  delete map[date];
  save(map);
}

/** What the home cards show for one article: 待读, 在读 N%, or 已读. */
export function describe(progress) {
  if (progress?.state === 'read') return { state: 'read', label: '已读', pct: 100 };
  if (progress?.state === 'reading') {
    const pct = Math.max(0, Math.min(99, Math.round((progress.ratio || 0) * 100)));
    return { state: 'reading', label: `在读 ${pct}%`, pct };
  }
  return { state: 'unread', label: '待读', pct: 0 };
}

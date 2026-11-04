// Read tab: 我的精读 home plus the reader, on the on-device Shanbay bridge.
import { loadState, hasSession, cachedState, cachedArticles, cachedArticle, backfillArticleCovers } from './bridge.mjs';
import { decorate, initGestures, loadHighlightVocab, refreshVocabCounts, vocabCounts, articleLegendCounts } from './gestures.mjs';
import { closePopover, openPopover } from './popover.mjs';
import { prepareTranslation } from './pretranslation.mjs';
import { feedback } from './feedback.mjs';
import { getProgress, setReading, setProgress, markRead, markUnread, describe, lastArticleDate } from './reading-state.mjs';
import { icon, hydrateIcons } from '../icons/icons.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const WORD_RE = /[A-Za-z]+(?:[-’'][A-Za-z]+)*/g;
const SIZE_KEY = 'cijian-reading-size';
const MAX_RECENT = 10;
const LONG_PRESS_MS = 520;
const READER_TOP = 60; // fixed reader controls
const RING_R = 29;

const view = { status: 'loading', connected: false, today: null, article: null, offline: false, error: null };
let fontSize = storedSize() || (matchMedia('(max-width:760px)').matches ? 19 : 21);
let homeScroll = 0;
let progressFrame = 0;
let refreshing = false;
let current = null; // the article open in the reader
let saveTimer = 0;
let pendingRatio = 0;
let readerNavigation = 0;
let readerOpening = false;
let restoring = false;

document.documentElement.style.setProperty('--reading', fontSize + 'px');

function storedSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return Number.isFinite(n) && n >= 16 && n <= 28 ? n : null;
  } catch { return null; }
}

function countWords(paragraphs) {
  return (paragraphs || []).join(' ').match(WORD_RE)?.length || 0;
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

// ---------------------------------------------------------------------- views

function showView(name) {
  const reader = name === 'reader';
  if (!reader) flushProgress();
  $('homeView').hidden = reader;
  $('readerView').hidden = !reader;
  $('chrome').hidden = !reader;
  $('progressBar').hidden = !reader;
  if (!reader) {
    ++readerNavigation;
    readerOpening = false;
    restoring = false;
    window.top?.hwfeeReadView?.(false);
    closePopover();
    current = null;
    renderHome();
  }
  updateProgress();
}

// ----------------------------------------------------------------- home render

function stat(label, value, small, accent) {
  const tile = el('div', undefined, 'stat' + (accent ? ' is-acc' : ''));
  tile.append(el('div', label, 'k'));
  const v = el('div', undefined, 'v');
  v.textContent = value;
  if (small) v.append(el('small', small));
  tile.append(v);
  return tile;
}

function renderTiles() {
  const s = view.today?.status;
  const counts = vocabCounts();
  const stats = $('stats');
  const tiles = [
    { k: '今日新词', d: s?.a_finished_count, t: s?.a_count },
    { k: '复习', d: s?.c_finished_count, t: s?.c_count },
  ];
  const values = tiles.map(tile => {
    const known = Number.isFinite(tile.d) && Number.isFinite(tile.t);
    return [tile.k, known ? tile.d : '—', known ? `/${tile.t}` : ''];
  });
  values.push(['生词本', counts?.wordbook ?? '—', counts?.wordbook != null ? '词' : '', true],
    ['已掌握', counts?.learned ?? '—', counts?.learned != null ? '词' : '']);
  values.forEach(([label, value, suffix, accent], index) => {
    let tile = stats.children[index];
    if (!tile) { stats.append(stat(label, value, suffix, accent)); return; }
    const current = tile.querySelector('.v');
    const next = String(value) + (suffix || '');
    if (current.textContent === next) return;
    current.textContent = String(value);
    if (suffix) current.append(el('small', suffix));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.getAnimations?.().forEach(animation => animation.cancel());
      current.animate?.([{ opacity: .35 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  });
}

function coverFor(article, big) {
  const cover = el('div', undefined, 'cover');
  const letter = () => el('span', (article.title || '?').trim().charAt(0).toUpperCase());
  if (article.cover) {
    const img = document.createElement('img');
    img.src = article.cover;
    img.alt = '';
    img.onerror = () => { img.remove(); cover.append(letter()); };
    cover.append(img);
  } else {
    cover.append(letter());
  }
  return cover;
}

function emptyCard(message, buttonLabel, onClick) {
  const card = el('div', undefined, 'empty');
  card.append(el('p', message));
  if (buttonLabel) {
    const btn = el('button', buttonLabel, 'btn is-primary');
    btn.onclick = onClick;
    card.append(btn);
  }
  return card;
}

function renderHero() {
  const slot = $('heroSlot');
  slot.replaceChildren();

  if (view.status === 'loading') {
    slot.append(emptyCard('正在读取今天的记录…'));
    return;
  }
  if (view.error) {
    slot.append(emptyCard('读取失败：' + view.error, '重试', () => refresh()));
    return;
  }
  if (!view.connected) {
    slot.append(emptyCard(
      '还没有连接扇贝。连接以后，今天的词表和短文会自动取回来。',
      '去设置连接',
      () => window.top?.hwfeeShowTab?.('settings')));
    return;
  }
  const recentDate = lastArticleDate();
  const a = (recentDate === view.article?.date ? view.article : cachedArticle(recentDate)) || view.article;
  if (!a) {
    slot.append(emptyCard('今天还没有文章。'));
    return;
  }

  const words = countWords(a.paragraphs);
  const hero = el('a', undefined, 'hero');
  hero.href = '#a=' + a.date;

  const status = describe(getProgress(a.date));
  const m = el('div', undefined, 'm');
  m.append(el('div', a.title, 'tt'));
  const day = a.date === view.article?.date ? '今天'
    : `${Number(a.date.slice(5, 7))}月${Number(a.date.slice(8))}日`;
  const ss = el('div', undefined, 'ss');
  ss.append(`${words} 词 · 约 ${Math.ceil(words / 60)} 分钟`);
  if (view.offline) ss.append(' ', el('span', '离线缓存', 'chip'));
  m.append(el('div', day, 'ss'), ss);

  const row = el('div', undefined, 'hrow');
  row.append(coverFor(a), m);
  const act = el('div', undefined, 'hact');
  const stText = status.state === 'reading' ? `继续阅读 · ${status.label}` : status.label;
  act.append(el('div', stText, 'st is-' + status.state), goButton(status));
  hero.append(row, act);
  bindCard(hero, a.date, () => openArticle(a));
  slot.append(hero);
}

function renderRecent() {
  const list = cachedArticles().slice(0, MAX_RECENT);
  $('recentHead').hidden = !list.length;
  const box = $('recentList');
  box.replaceChildren();
  const today = view.today?.date || localDate();
  for (const item of list) {
    const row = el('a', undefined, 'rcard');
    row.href = '#a=' + item.date;
    bindCard(row, item.date, () => {
      const article = cachedArticle(item.date);
      if (article) openArticle(article);
    });
    const body = el('div', undefined, 'rbody');
    body.append(el('div', item.title, 'rt'), el('div', `${item.words} 词 · ${item.paragraphs} 段`, 'rp'));
    const isToday = item.date === today;
    const side = el('div', undefined, 'rside');
    side.append(el('span', isToday ? '今天' : item.date.slice(5).replace('-', '/'), 'rd' + (isToday ? ' is-today' : '')),
      statePill(describe(getProgress(item.date))));
    row.append(coverFor(item), body, side);
    box.append(row);
  }
}

function goButton(status) {
  const go = el('span', undefined, 'go' + (status.state === 'read' ? ' is-read' : ''));
  go.append(icon(status.state === 'read' ? 'check' : 'arrow-right', 22));
  if (status.state === 'reading') {
    const length = 2 * Math.PI * RING_R;
    go.insertAdjacentHTML('afterbegin', `<svg class="ring" viewBox="0 0 62 62" aria-hidden="true">`
      + `<circle class="track" cx="31" cy="31" r="${RING_R}"/>`
      + `<circle class="fill" cx="31" cy="31" r="${RING_R}" stroke-dasharray="${(length * status.pct / 100).toFixed(1)} ${length.toFixed(1)}"/></svg>`);
  }
  return go;
}

function statePill(status) {
  const pill = el('span', undefined, 'rpill is-' + status.state);
  if (status.state === 'read') pill.append(icon('check', 12));
  pill.append(status.label);
  return pill;
}

/** Tap opens the article; a long press offers 标为已读 / 标为未读 instead. */
function bindCard(card, date, open) {
  let timer = 0;
  let pressed = false;
  const cancel = () => { clearTimeout(timer); timer = 0; };
  card.addEventListener('pointerdown', () => {
    pressed = false;
    cancel();
    timer = setTimeout(() => { timer = 0; pressed = true; markMenu(card, date); }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove']) card.addEventListener(type, cancel);
  card.addEventListener('contextmenu', (event) => event.preventDefault());
  card.addEventListener('click', (event) => {
    event.preventDefault();
    if (pressed) { pressed = false; return; }
    open();
  });
}

function markMenu(card, date) {
  const read = getProgress(date)?.state === 'read';
  const pop = openPopover({ anchor: card, kind: 'action', label: read ? '标为未读' : '标为已读' });
  if (!pop) return;
  const action = el('button', undefined, 'pop-btn');
  action.append(icon(read ? 'arrow-clockwise' : 'check', 16), read ? '标为未读' : '标为已读');
  action.onclick = () => {
    if (read) markUnread(date);
    else markRead(date);
    closePopover();
    renderHome();
  };
  pop.setBody(action);
}

function renderHome() {
  $('homeDate').textContent = new Date().toLocaleDateString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
  });
  renderTiles();
  // Restore the last totals immediately, then recheck page metadata independently
  // of the six-hour highlight cache.
  void refreshVocabCounts().catch(() => {});
  renderHero();
  renderRecent();
}

// --------------------------------------------------------------- reader render

function renderReader(a) {
  const header = $('articleHeader');
  header.replaceChildren();
  header.append(el('h2', a.title), el('p', a.subtitle, 'subtitle'));
  const words = countWords(a.paragraphs);
  const chips = el('div', undefined, 'chips');
  chips.append(
    el('span', `${words} 词`, 'chip'),
    el('span', `${a.paragraphs.length} 段`, 'chip'),
    el('span', `约 ${Math.ceil(words / 60)} 分钟`, 'chip'));
  const legend = el('div', undefined, 'legend');
  header.append(chips, legend);

  const article = $('article');
  article.replaceChildren();
  a.paragraphs.forEach((text) => {
    const block = el('div', undefined, 'para');
    block.append(el('p', text));
    article.append(block);
  });

  $('endMark').hidden = false;
  decorate(article);
  updateLegend();
  updateProgress();
  document.dispatchEvent(new CustomEvent('hwfee:article', { detail: a }));
}

// One line under the chips: styled samples + distinct-word counts for this
// article. An entry whose count is 0 is skipped; the line hides when both are 0.
function updateLegend() {
  const legend = document.querySelector('.article-header .legend');
  if (!legend) return;
  const { wordbook, today } = articleLegendCounts($('article'));
  legend.replaceChildren();
  if (wordbook) legend.append(el('span', `生词本 ${wordbook}`, 'lg lg-wb'));
  if (today) legend.append(el('span', `今日学习 ${today}`, 'lg lg-today'));
  legend.hidden = !wordbook && !today;
}
document.addEventListener('hwfee:vocab', updateLegend);

async function openArticle(article, { push = true } = {}) {
  const revision = ++readerNavigation;
  readerOpening = true;
  flushProgress();
  if (push && $('readerView').hidden) homeScroll = window.scrollY;
  restoring = true;
  current = article;
  const saved = getProgress(article.date);
  setReading(article.date);
  renderReader(article);
  await window.top?.hwfeeReadView?.(true);
  if (revision !== readerNavigation) return;
  readerOpening = false;
  if (push) history.pushState({ article: article.date }, '', '#a=' + article.date);
  showView('reader');
  resume(saved);
  restoring = false;
  updateProgress();
}

/** Back to where the reader stopped: paragraph index plus the fraction of it already scrolled past. */
function resume(saved) {
  const para = saved?.state === 'reading' ? $('article').children[saved.para] : null;
  if (!para) { window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  const rect = para.getBoundingClientRect();
  const top = window.scrollY + rect.top + rect.height * (saved.offset || 0) - READER_TOP;
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
}

function readingPosition() {
  const paras = $('article').children;
  for (let i = 0; i < paras.length; i++) {
    const rect = paras[i].getBoundingClientRect();
    if (rect.bottom > READER_TOP) {
      return { para: i, offset: Math.max(0, Math.min(1, (READER_TOP - rect.top) / (rect.height || 1))) };
    }
  }
  return { para: Math.max(0, paras.length - 1), offset: 1 };
}

function saveProgress(ratio) {
  if (!current || restoring) return;
  pendingRatio = ratio;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    flushProgress();
  }, 500);
}

function flushProgress() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!current || restoring || $('readerView').hidden) return;
  pendingRatio = readingRatio();
  if (pendingRatio >= 0.98) markRead(current.date);
  else setProgress(current.date, { ratio: pendingRatio, ...readingPosition() });
}

const endObserver = new IntersectionObserver((entries) => {
  if (current && !restoring && !$('readerView').hidden
      && entries.some((entry) => entry.isIntersecting)) markRead(current.date);
});
endObserver.observe($('endMark'));

window.addEventListener('popstate', (event) => {
  const date = event.state?.article || (/^#a=(\d{4}-\d{2}-\d{2})$/.exec(location.hash) || [])[1];
  if (date) {
    const article = view.article?.date === date ? view.article : cachedArticle(date);
    if (article) { openArticle(article, { push: false }); return; }
  }
  showView('home');
  requestAnimationFrame(() => window.scrollTo(0, homeScroll));
});

$('backBtn').addEventListener('click', () => {
  if (history.state?.article) history.back();
  else showView('home');
});
$('endBack').addEventListener('click', () => {
  if (history.state?.article) history.back();
  else showView('home');
});

// -------------------------------------------------------------------- progress

function updateProgress() {
  const bar = $('progress'), article = $('article');
  if (!bar || $('readerView').hidden || !article || !article.children.length) {
    if (bar) bar.style.width = '0%';
    return;
  }
  const ratio = readingRatio();
  bar.style.width = (ratio * 100).toFixed(2) + '%';
  saveProgress(ratio);
}

function readingRatio() {
  const rect = $('article').getBoundingClientRect();
  const start = window.scrollY + rect.top - 160;
  const end = window.scrollY + rect.bottom - window.innerHeight * 0.55;
  return Math.min(1, Math.max(0, end <= start ? 0 : (window.scrollY - start) / (end - start)));
}

function scheduleProgress() {
  if (progressFrame) return;
  progressFrame = requestAnimationFrame(() => { progressFrame = 0; updateProgress(); });
}
window.addEventListener('scroll', scheduleProgress, { passive: true });
window.addEventListener('resize', scheduleProgress);

function size(delta) {
  fontSize = Math.max(16, Math.min(28, fontSize + delta));
  document.documentElement.style.setProperty('--reading', fontSize + 'px');
  try { localStorage.setItem(SIZE_KEY, String(fontSize)); } catch {}
  closePopover();
  updateProgress();
}
$('smaller').onclick = () => size(-1);
$('larger').onclick = () => size(1);

// ------------------------------------------------------------------------ data

function applyState(next) {
  view.status = 'ready';
  view.connected = true;
  view.error = null;
  view.today = next.today;
  view.article = next.article;
  view.offline = Boolean(next.offline);
  if (!view.offline) refreshCovers();
  if (view.article?.date === localDate()) void prepareTranslation(view.article);
}

async function refreshCovers() {
  try {
    if (!await backfillArticleCovers()) return;
    const article = cachedArticle(view.article?.date);
    if (article && article.source === view.article?.source) view.article = article;
    renderHero();
    renderRecent();
  } catch { /* Cover repair must not interrupt reading. */ }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const btn = $('refreshBtn');
  window.top?.hwfeeReadBusy?.(true);
  btn.classList.add('is-busy');
  btn.disabled = true;
  closePopover();
  feedback('正在刷新今日文章', { kind: 'progress', detail: '同时同步今日学习记录和词表' });
  try {
    // A foreground date check may already be loading this article. Finish it before forcing a new fetch.
    if (dailyRequest) await dailyRequest;
    const next = await loadState({ force: true });
    applyState(next);
    if (next.offline) {
      feedback('未能刷新，显示离线缓存', { kind: 'error', detail: next.offlineReason || '无法连接扇贝，请检查网络后重试' });
    } else {
      try {
        await loadHighlightVocab({ force: true });
        await refreshVocabCounts({ force: true });
        feedback('今日文章已刷新', { kind: 'success', detail: next.article.title });
      } catch (error) {
        feedback('文章已更新，词表同步失败', { kind: 'error', detail: error.message + '，可稍后重试刷新' });
      }
    }
  } catch (error) {
    if (!view.article) { view.status = 'error'; view.error = error.message; }
    feedback('刷新失败', { kind: 'error', detail: error.message });
  } finally {
    refreshing = false;
    btn.classList.remove('is-busy');
    btn.disabled = false;
    window.top?.hwfeeReadBusy?.(false);
    renderHome();
  }
}

$('refreshBtn').addEventListener('click', refresh);
window.hwfeeRefreshRead = refresh;
document.addEventListener('hwfee:vocab', renderTiles);

// Re-entering the app is another moment the tile is read after the wordbook moved
// on elsewhere; the call is throttled, and a failure keeps the cached number.
const recheckCounts = () => { void refreshVocabCounts().catch(() => {}); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) recheckCounts(); });
window.addEventListener('focus', recheckCounts);
let initialized = false;
let dailyRequest = null;
let nextDailyAttempt = 0;
let lastDailyError = '';

// The shell also calls this on tab entry and Android resume: hidden iframes do not
// reliably receive visibility events when the native activity returns to the foreground.
async function prepareDaily({ forceTranslation = false } = {}) {
  if (!initialized || refreshing) return;
  recheckCounts();
  if (dailyRequest) return dailyRequest;
  dailyRequest = (async () => {
    if (!view.connected) {
      if (view.status !== 'error' || Date.now() < nextDailyAttempt) return;
      nextDailyAttempt = Date.now() + 2 * 60000;
      try {
        if (!await hasSession()) return;
        view.connected = true;
        nextDailyAttempt = 0;
      } catch { return; }
    }
    if (view.article?.date !== localDate() && Date.now() >= nextDailyAttempt) {
      nextDailyAttempt = Date.now() + 2 * 60000;
      try {
        const next = await loadState();
        applyState(next); renderHome();
        if (next.offline) throw new Error(next.offlineReason || '当前网络不可用');
        lastDailyError = '';
      } catch (error) {
        const identity = localDate() + ':' + error.message;
        if (identity !== lastDailyError) {
          lastDailyError = identity;
          feedback('今日文章暂未更新', { kind: 'error', detail: error.message + '，可点击刷新重试' });
        }
      }
    }
    if (view.article?.date === localDate()) {
      void prepareTranslation(view.article, { force: forceTranslation });
    }
  })().finally(() => { dailyRequest = null; });
  return dailyRequest;
}
window.hwfeePrepareDaily = prepareDaily;
window.addEventListener('focus', () => { void prepareDaily(); });
window.addEventListener('online', () => { void prepareDaily(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void prepareDaily(); });
setInterval(() => { if (!document.hidden) void prepareDaily(); }, 60000);
window.addEventListener('pagehide', flushProgress);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushProgress(); });

async function init() {
  hydrateIcons();
  initGestures($('article'));
  renderHome();

  let session;
  try {
    session = await hasSession();
  } catch (error) {
    view.status = 'error';
    view.error = error.message;
    renderHome();
    return;
  }
  if (!session) {
    view.status = 'ready';
    view.connected = false;
    renderHome();
    return;
  }
  view.connected = true;
  const saved = cachedState();
  if (saved) {
    applyState(saved);
    renderHome();
    void loadHighlightVocab().catch(() => {});
  }
  try {
    applyState(await loadState());
    if (!saved) void loadHighlightVocab().catch(() => {});
  } catch (error) {
    view.status = 'error';
    view.error = error.message;
  }
  renderHome();

  const hashDate = (/^#a=(\d{4}-\d{2}-\d{2})$/.exec(location.hash) || [])[1];
  if (hashDate) {
    const article = view.article?.date === hashDate ? view.article : cachedArticle(hashDate);
    if (article) openArticle(article, { push: false });
  }
}

// Android back delegates to the shell: close an open popover, then leave the
// reader for the home view. Anything else is the shell's job.
window.hwfeeDismissPopover = closePopover;
window.hwfeeReadBack = () => {
  if (readerOpening) { showView('home'); return true; }
  if (document.querySelector('.popover')) { closePopover(); return true; }
  if (!$('readerView').hidden) { history.back(); return true; }
  return false;
};

init().finally(() => { initialized = true; });

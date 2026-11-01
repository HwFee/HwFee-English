// Read tab. Rendering is the original 词间 reader; only the data source changed — it now comes
// from the on-device Shanbay bridge instead of the local Node server.
import { loadState, hasSession } from './bridge.mjs';
import { decorate, initGestures, loadHighlightVocab } from './gestures.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const SIZE_KEY = 'cijian-reading-size';
let state, progressFrame = 0;

function storedSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return Number.isFinite(n) && n >= 16 && n <= 28 ? n : null;
  } catch { return null; }
}
let fontSize = storedSize() || (matchMedia('(max-width:760px)').matches ? 19 : 21);
document.documentElement.style.setProperty('--reading', fontSize + 'px');

function formatDate(value) {
  if (!value) return '今日';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日 · ${WEEK[date.getDay()]}`;
}

function renderToday() {
  const t = state.today, s = t?.status, finished = s?.is_finished === true;
  $('date').textContent = formatDate(t?.date);
  $('greeting').textContent = finished ? '今天已经背完，' : '今天，';
  if (t && s) {
    const parts = [];
    if (Number.isFinite(s.a_finished_count) && Number.isFinite(s.a_count)) parts.push(`新词 ${s.a_finished_count}/${s.a_count}`);
    if (Number.isFinite(s.c_finished_count) && Number.isFinite(s.c_count)) parts.push(`复习 ${s.c_finished_count}/${s.c_count}`);
    parts.push(finished ? '已完成' : '进行中');
    $('todayNote').textContent = `${state.offline ? '离线缓存 · ' : ''}今日学习 · ${parts.join(' · ')}`;
  } else {
    $('todayNote').textContent = '今天的记录还没有读到。';
  }
}

function renderArticle() {
  const a = state.article;
  $('articleHeader').replaceChildren();
  $('article').replaceChildren();
  $('endMark').hidden = true;
  if (!a || !Array.isArray(a.paragraphs) || !a.paragraphs.length) {
    $('article').append(el('p', state.message || '今天还没有文章。', 'read-empty'));
    updateProgress();
    return;
  }
  const count = a.paragraphs.join(' ').match(/[A-Za-z]+(?:[-’'][A-Za-z]+)*/g)?.length || 0;
  $('articleHeader').append(el('h2', a.title), el('p', a.subtitle, 'subtitle'));
  const meta = el('p', undefined, 'meta');
  meta.append(
    el('span', `${count} 词`),
    el('span', `${a.paragraphs.length} 段`),
    el('span', `建议精读 ${Math.ceil(count / 80)}–${Math.ceil(count / 60)} 分钟`),
  );
  $('articleHeader').append(meta);

  const source = $('sourceLink');
  if (a.source) {
    source.href = a.source;
    source.textContent = `来源：${a.sourceName || '扇贝阅读'} · 仅供个人学习 ↗`;
    source.hidden = false;
  } else {
    source.hidden = true;
  }

  a.paragraphs.forEach((text, i) => {
    const block = el('div', undefined, 'para' + (i === 0 ? ' lead' : ''));
    block.append(el('span', String(i + 1).padStart(2, '0'), 'para-number'), el('p', text));
    $('article').append(block);
  });

  $('endMark').hidden = false;
  decorate($('article'));
  updateProgress();
  document.dispatchEvent(new CustomEvent('hwfee:article', { detail: a }));
}

function updateProgress() {
  const bar = $('progress'), article = $('article');
  if (!bar || !article || !article.children.length) { if (bar) bar.style.width = '0%'; return; }
  const rect = article.getBoundingClientRect();
  const start = window.scrollY + rect.top - 160;
  const end = window.scrollY + rect.bottom - window.innerHeight * 0.55;
  const ratio = end <= start ? 0 : (window.scrollY - start) / (end - start);
  bar.style.width = (Math.min(1, Math.max(0, ratio)) * 100).toFixed(2) + '%';
}

function scheduleProgress() { if (progressFrame) return; progressFrame = requestAnimationFrame(() => { progressFrame = 0; updateProgress(); }); }
window.addEventListener('scroll', scheduleProgress, { passive: true });
window.addEventListener('resize', scheduleProgress);

function size(delta) {
  fontSize = Math.max(16, Math.min(28, fontSize + delta));
  document.documentElement.style.setProperty('--reading', fontSize + 'px');
  try { localStorage.setItem(SIZE_KEY, String(fontSize)); } catch {}
  updateProgress();
}
$('smaller').onclick = () => size(-1);
$('larger').onclick = () => size(1);

async function init() {
  initGestures($('article'));
  if (!(await hasSession())) {
    state = { today: null, article: null, message: '还没有连接扇贝。连接以后，今天的词表和短文会自动取回来。' };
    $('todayNote').textContent = '未连接扇贝';
    renderArticle();
    return;
  }
  try {
    state = await loadState();
    renderToday();
    renderArticle();
    loadHighlightVocab().catch(() => {});
  } catch (error) {
    state = { today: null, article: null, message: '读取失败：' + error.message };
    $('todayNote').textContent = '读取失败：' + error.message;
    renderArticle();
  }
  requestAnimationFrame(updateProgress);
}

init();

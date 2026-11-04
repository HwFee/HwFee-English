// The three reading gestures: long-press a sentence for its card (长难句分析/翻译),
// tap a word for its card, and highlight the words you are learning.
import { openPopover, closePopover, consumeDismissedWordTap, line, skeleton } from './popover.mjs';
import { splitSentences } from './sentences.mjs';
import { translateSentence, analyzeSentence } from './llm.mjs';
import { analysisDisplaySegments } from './analysis-display.mjs';
import { feedback } from './feedback.mjs';
import { unpack } from './lib.mjs';
import { icon } from '../icons/icons.mjs';
import { CATEGORY_BITS, fetchVocabularyWithCounts, fetchLiveVocabCounts, validateVocabularyCache, validateVocabularyCounts, countArticleCategories, wordbookMembership } from './vocab.mjs';

const WORD_RE = /[A-Za-z]+(?:[-’'][A-Za-z]+)*/g;
const LONG_PRESS_MS = 520;
const PRESS_SLOP = 12;
const VOCAB_TTL_MS = 6 * 60 * 60 * 1000;
// The feed above is expensive and stays cached. The counts are what the user reads,
// so they are re-read cheaply (page metadata) instead of riding on a six-hour cache.
const COUNT_TTL_MS = 60 * 1000;
const VOCAB_KEY = 'hwfee:vocab';
const COUNTS_VERSION = 2; // Collection total + current book's mastered words, not highlight counts.

const BUSINESS_ID = 1; // /wordscollection/words rejects the POST without it

let vocab = new Map();
let counts = null;
let highlighted = new Set(['today', 'wordbook']);
let articleRoot = null;
let pressTimer = 0;
let justLongPressed = false;
let vocabRevision = 0;
let vocabLoad = 0;
// When all totals were verified (0 = stale or only partially available).
let countsAt = 0;
let countsRestored = false;
let countsRequest = null;
let countsRequestRevision = -1;
let vocabRequest = null;
// Shanbay's vocab feed lags a wordbook write by a request or two. Refetching right after
// 加入/移出 therefore used to erase the tint that had just been applied (and re-applied the
// previous state), so a manual edit outlives the fetch until the server agrees with it.
const OVERRIDE_TTL_MS = 10 * 60 * 1000;
const wordbookOverrides = new Map();

function capacitor() {
  try { return window.top?.Capacitor ?? window.Capacitor ?? null; } catch { return window.Capacitor ?? null; }
}
function shanbay() { return capacitor()?.Plugins?.Shanbay ?? null; }

async function call(path, method, body) {
  const api = shanbay();
  if (!api) throw new Error('bridge 不可用');
  const result = await api.request({ path, method: method || 'GET', body: body ?? null });
  return JSON.parse(result?.body ?? '{}');
}

// ------------------------------------------------------------------ decoration

function buildSentence(text) {
  const span = document.createElement('span');
  span.className = 'sent';
  let last = 0;
  for (const match of text.matchAll(WORD_RE)) {
    if (match.index > last) span.append(document.createTextNode(text.slice(last, match.index)));
    const word = document.createElement('span');
    word.className = 'w';
    word.dataset.w = match[0];
    word.textContent = match[0];
    span.append(word);
    last = match.index + match[0].length;
  }
  if (last < text.length) span.append(document.createTextNode(text.slice(last)));
  return span;
}

function buildParagraph(text) {
  const fragment = document.createDocumentFragment();
  for (const sentence of splitSentences(text)) {
    if (!sentence) continue;
    fragment.append(buildSentence(sentence));
  }
  return fragment;
}

function bitOn(mask, name) {
  return (mask & (CATEGORY_BITS[name] ?? 0)) !== 0;
}

function applyHighlights() {
  if (!articleRoot) return;
  for (const word of articleRoot.querySelectorAll('.w')) {
    word.classList.remove('hl-today', 'hl-wordbook');
    const mask = vocab.get(word.dataset.w.toLowerCase());
    if (!mask) {
      word.classList.remove('is-known');
      continue;
    }
    word.classList.add('is-known');
    if (highlighted.has('wordbook') && bitOn(mask, 'wordbook')) word.classList.add('hl-wordbook');
    if (highlighted.has('today') && bitOn(mask, 'today')) word.classList.add('hl-today');
  }
}

export function decorate(root) {
  if (!root) return;
  articleRoot = root;
  for (const paragraph of root.querySelectorAll('.para p')) {
    const source = paragraph.dataset.src ?? paragraph.textContent;
    if (!source) continue;
    paragraph.dataset.src = source;
    paragraph.replaceChildren(buildParagraph(source));
  }
  applyHighlights();
}

// --------------------------------------------------------------------- vocab

function readVocabCache() {
  try {
    const raw = localStorage.getItem(VOCAB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const entries = validateVocabularyCache(parsed, { ttlMs: VOCAB_TTL_MS });
    const savedCounts = parsed?.countsVersion === COUNTS_VERSION ? validateVocabularyCounts(parsed.counts) : null;
    const verifiedAt = savedCounts && Number.isFinite(parsed.countsAt)
      && parsed.countsAt > 0 && parsed.countsAt <= Date.now() ? parsed.countsAt : 0;
    // Totals remain a useful offline fallback even after the highlight feed expires.
    if (!entries && !savedCounts) return null;
    return { entries, counts: savedCounts, countsAt: verifiedAt };
  } catch { return null; }
}

function writeVocabCache(entries) {
  try { localStorage.setItem(VOCAB_KEY, JSON.stringify({ at: Date.now(), entries, counts, countsAt, countsVersion: COUNTS_VERSION })); } catch {}
}

function saveVocabCounts({ invalidateFeed = false } = {}) {
  try {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VOCAB_KEY) || 'null'); } catch { /* Replace malformed cache data. */ }
    const record = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    if (invalidateFeed) { delete record.at; delete record.entries; }
    // Updating the small counters must not renew the six-hour highlight snapshot.
    localStorage.setItem(VOCAB_KEY, JSON.stringify({ ...record, counts, countsAt, countsVersion: COUNTS_VERSION }));
  } catch { /* Keep the verified in-memory totals if storage is unavailable. */ }
}

function publishVocab() {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('hwfee:vocab', { detail: { counts } }));
  }
}

function restoreVocabCounts() {
  if (countsRestored) return;
  countsRestored = true;
  const saved = readVocabCache();
  if (!counts && saved?.counts) { counts = saved.counts; countsAt = saved.countsAt; }
}

/** Last official totals, restored before the first render; null means never fetched. */
export function vocabCounts() {
  restoreVocabCounts();
  return counts;
}

/** Distinct wordbook/today words inside the rendered article, for the legend. */
export function articleLegendCounts(root) {
  const words = [...(root || articleRoot || document).querySelectorAll('.w')]
    .map((el) => el.dataset.w);
  return countArticleCategories(words, vocab);
}

/** Keep the last totals visible while the confirmed edit triggers a fresh count. */
export function patchWordbook(word, inBook, variants = []) {
  restoreVocabCounts();
  vocabRevision++;
  const bit = CATEGORY_BITS.wordbook;
  const at = Date.now();
  for (const form of [word, ...variants]) {
    const key = String(form).toLowerCase();
    wordbookOverrides.set(key, { inBook, at });
    const mask = vocab.get(key) || 0;
    const next = inBook ? (mask | bit) : (mask & ~bit);
    if (next) vocab.set(key, next);
    else vocab.delete(key);
  }
  countsAt = 0;
  saveVocabCounts({ invalidateFeed: true });
  applyHighlights();
  publishVocab();
  void refreshVocabCounts({ force: true }).catch(() => {});
}

/** Re-apply manual wordbook edits on top of a feed or cache payload. */
function applyWordbookOverrides(map) {
  const bit = CATEGORY_BITS.wordbook;
  const now = Date.now();
  for (const [form, entry] of wordbookOverrides) {
    const current = map.get(form) || 0;
    // The server caught up (or the edit is older than the feed can lag): stop overriding.
    if (Boolean(current & bit) === entry.inBook || now - entry.at > OVERRIDE_TTL_MS) {
      wordbookOverrides.delete(form);
      continue;
    }
    const next = entry.inBook ? (current | bit) : (current & ~bit);
    if (next) map.set(form, next);
    else map.delete(form);
  }
}

/**
 * Cheap, live counts: one `ipp=1` metadata page per category, throttled so a
 * re-render does not hammer the API. A failed or partial answer leaves the
 * cached number in place; it never publishes a zero it did not read.
 */
export async function refreshVocabCounts({ force = false } = {}) {
  restoreVocabCounts();
  if (!force && countsAt && Date.now() - countsAt < COUNT_TTL_MS) return vocabCounts();
  if (countsRequest && countsRequestRevision === vocabRevision) return countsRequest;
  const revision = vocabRevision;
  const request = fetchLiveVocabCounts(async (name) => {
    if (name === 'wordbook') return call('/wordscollection/words?page=1&ipp=1');
    if (name === 'learned') {
      const book = await call('/wordsapp/user_material_books/current');
      const id = book.materialbook_id || book.materialbook?.id;
      if (!id || !/^[\w-]+$/.test(String(id))) throw new Error('未找到当前词书');
      return unpack(await call(`/wordsapp/user_material_books/${id}/learning/words/simple_learned_items?page=1&ipp=1`));
    }
    return call(`/bay-translate/user_vocabs?categories=${name}&page=1&ipp=1`);
  })
    .then((live) => {
      // A wordbook write invalidates totals requested before that edit.
      if (revision !== vocabRevision) return vocabCounts();
      const names = Object.keys(live);
      if (!names.length) return vocabCounts();
      const previous = counts || Object.fromEntries(Object.keys(CATEGORY_BITS).map(name => [name, null]));
      counts = { ...previous, ...live };
      countsAt = names.length === Object.keys(CATEGORY_BITS).length ? Date.now() : 0;
      saveVocabCounts();
      publishVocab();
      return vocabCounts();
    })
    .finally(() => { if (countsRequest === request) countsRequest = null; });
  countsRequestRevision = revision;
  countsRequest = request;
  return request;
}

/** Words you are studying, with their inflections, from every category at once. */
export async function loadHighlightVocab({ force = false } = {}) {
  const revision = vocabRevision;
  const cached = readVocabCache();
  if (!counts && cached?.counts) {
    counts = cached.counts;
    countsAt = cached.countsAt;
    if (force || !cached.entries) publishVocab();
  }
  if (!force && cached?.entries) {
    vocab = new Map(cached.entries);
    applyWordbookOverrides(vocab);
    applyHighlights();
    publishVocab();
    return vocab.size;
  }
  if (vocabRequest?.revision === revision) return vocabRequest.promise;
  const load = ++vocabLoad;
  const request = { revision, promise: null };
  request.promise = (async () => {
    const categories = Object.keys(CATEGORY_BITS).join(',');
    const result = await fetchVocabularyWithCounts((page) =>
      call(`/bay-translate/user_vocabs?categories=${categories}&page=${page}&ipp=1000`));
    if (load !== vocabLoad || revision !== vocabRevision) return vocab.size;
    vocab = new Map(result.entries);
    applyWordbookOverrides(vocab);
    // Highlight membership never supplies dashboard totals.
    writeVocabCache([...vocab.entries()]);
    applyHighlights();
    publishVocab();
    return vocab.size;
  })().finally(() => { if (vocabRequest === request) vocabRequest = null; });
  vocabRequest = request;
  return request.promise;
}

export function setHighlightCategories(names) {
  highlighted = new Set(names);
  applyHighlights();
}

// -------------------------------------------------------------------- word card

/** US pronunciation first, UK as the fallback; only absolute https audio is playable. */
function pronunciation(data) {
  const audio = (data.audios || [])[0] || {};
  const pick = [audio.us, audio.uk].filter(Boolean);
  const ipa = pick.find((entry) => entry.ipa)?.ipa || '';
  const raw = pick.map((entry) => (entry.urls || [])[0]).find(Boolean) || '';
  const url = raw.startsWith('//') ? 'https:' + raw : raw;
  return { ipa, url: /^https:\/\//.test(url) ? url : '' };
}

function wordHeader(word, data) {
  const row = document.createElement('div');
  row.className = 'pop-headrow';
  const block = document.createElement('div');
  const head = document.createElement('p');
  head.className = 'pop-head';
  head.textContent = word;
  const meta = document.createElement('p');
  meta.className = 'pop-meta';
  block.append(head, meta);
  row.append(block);

  const { ipa, url } = data ? pronunciation(data) : {};
  if (url) {
    const speaker = document.createElement('button');
    speaker.className = 'pop-speaker';
    speaker.setAttribute('aria-label', '播放发音');
    speaker.append(icon('speaker-high', 16));
    speaker.onclick = () => { new Audio(url).play().catch(() => {}); };
    row.append(speaker);
  }

  const renderStatus = (membership = null) => {
    meta.replaceChildren();
    if (ipa) meta.append(line(`/${ipa.replace(/^\/|\/$/g, '')}/`, 'pop-ipa'));
    const mask = vocab.get(word.toLowerCase()) || 0;
    if (membership === true) meta.append(line('生词本', 'pop-status is-wb'));
    if (bitOn(mask, 'today')) meta.append(line('今日学习', 'pop-status is-today'));
  };
  renderStatus();
  return { row, renderStatus };
}

/** The first three meanings of a sense, so a long entry stays one line. */
export function briefMeaning(def) {
  const text = String(def || '').trim();
  const parts = text.split(/[；;]/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 3 ? parts.slice(0, 3).join('；') : text;
}

function wordbookButton(button, exists) {
  button.className = 'pop-btn' + (exists ? '' : ' is-primary');
  button.replaceChildren(icon(exists ? 'bookmark-simple-fill' : 'bookmark-simple', 16),
    exists ? '移出生词本' : '加入生词本');
}

async function wordCard(wordEl) {
  const word = wordEl.dataset.w;
  const pop = openPopover({ anchor: wordEl, kind: 'word', label: word });
  if (!pop) return;
  pop.setBody(skeleton());
  try {
    const data = await call(`/abc/words/senses?vocabulary_content=${encodeURIComponent(word)}`);
    const definitions = (data.definitions?.cn || []).slice(0, 6);
    const vocabId = String(data.id || '');

    const body = document.createElement('div');
    const { row, renderStatus } = wordHeader(word, definitions.length ? data : null);
    body.append(row);

    if (!definitions.length || !vocabId) {
      body.append(line('词典里没有这个词，可能是专有名词或变形。', 'pop-muted'));
      pop.setBody(body);
      return;
    }

    const list = document.createElement('dl');
    list.className = 'pop-defs';
    const more = document.createElement('button');
    more.className = 'pop-more';
    let expanded = false;
    const renderDefinitions = () => {
      list.replaceChildren();
      list.classList.toggle('is-expanded', expanded);
      for (const entry of expanded ? definitions : definitions.slice(0, 2)) {
        const pos = document.createElement('dt');
        pos.textContent = entry.pos || '';
        const def = document.createElement('dd');
        def.textContent = expanded ? entry.def || '' : briefMeaning(entry.def);
        list.append(pos, def);
      }
      const hidden = definitions.length > 2 || definitions.some((entry) => briefMeaning(entry.def) !== (entry.def || ''));
      more.hidden = !hidden;
      more.textContent = expanded ? '收起' : (definitions.length > 2 ? `全部 ${definitions.length} 条` : '全部释义');
    };
    more.onclick = () => {
      expanded = !expanded;
      renderDefinitions();
      pop.setBody(body);
    };
    renderDefinitions();
    body.append(list);

    const foot = document.createElement('div');
    foot.className = 'pop-foot';
    const action = document.createElement('button');
    action.className = 'pop-btn';
    action.textContent = '正在核对生词本…';
    action.disabled = true;
    let exists = null;
    const feedback = line('', 'pop-feedback');
    feedback.setAttribute('aria-live', 'polite');
    const checkMembership = async () => {
      action.disabled = true;
      action.textContent = '正在核对生词本…';
      feedback.textContent = '';
      try {
        const check = await call(`/wordscollection/words_check?vocab_ids=${encodeURIComponent(vocabId)}`);
        exists = wordbookMembership(check, vocabId);
        renderStatus(exists);
        wordbookButton(action, exists);
        if (bitOn(vocab.get(word.toLowerCase()) || 0, 'wordbook') !== exists) {
          patchWordbook(word, exists);
          void loadHighlightVocab({ force: true }).catch(() => {});
        }
      } catch (error) {
        exists = null;
        action.textContent = '查询失败，点此重试';
        feedback.textContent = error.message;
      } finally {
        action.disabled = false;
        pop.setBody(body);
      }
    };
    action.onclick = async () => {
      if (exists === null) { await checkMembership(); return; }
      action.disabled = true;
      action.textContent = exists ? '正在移出…' : '正在加入…';
      feedback.textContent = '';
      try {
        if (exists) await call('/wordscollection/words', 'DELETE', { vocab_ids: [vocabId] });
        else await call('/wordscollection/words', 'POST', { vocab_id: vocabId, business_id: BUSINESS_ID });
        exists = !exists;
        patchWordbook(word, exists);
        renderStatus(exists);
        wordbookButton(action, exists);
        void loadHighlightVocab({ force: true }).catch(() => {
          feedback.textContent = '已更新生词本；高亮暂未同步，请在首页刷新。';
          pop.setBody(body);
        });
      } catch (error) {
        wordbookButton(action, exists);
        feedback.textContent = '操作失败：' + error.message;
      } finally {
        action.disabled = false;
        pop.setBody(body);
      }
    };
    foot.append(action, more);
    body.append(foot, feedback);
    pop.setBody(body);
    await checkMembership();
  } catch (error) {
    const body = document.createElement('div');
    body.append(wordHeader(word, null).row, line(error?.code === 'NOT_FOUND'
      ? '词典里没有这个词，可能是专有名词或变形。'
      : '查词失败：' + error.message, 'pop-muted'));
    pop.setBody(body);
  }
}

// --------------------------------------------------------------- sentence card

// Providers normalize whitespace: Shanbay echoes runs of spaces, tabs and non-breaking spaces
// back as one ASCII space, and a model does the same. The rendered card only has to reproduce the
// sentence word for word, so a spacing difference must not reject an otherwise usable answer.
const SPACE_RUN = /[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+/g;
function sameSentence(left, right) {
  const relax = value => String(value ?? '').normalize('NFC').replace(SPACE_RUN, ' ').trim();
  return relax(left) === relax(right);
}

/** Display grammatical phrases without turning punctuation into labelled blocks. */
function analysisBody(analysis, sentence) {
  const box = document.createElement('div');
  const flow = document.createElement('div');
  flow.className = 'ana-flow';
  for (const segment of analysisDisplaySegments(sentence, analysis.segments)) {
    const seg = document.createElement('mark');
    seg.className = `ana-seg is-${segment.type}`;
    seg.append(document.createTextNode(segment.text));
    const tag = document.createElement('i');
    tag.className = 'ana-tag';
    tag.textContent = segment.label;
    seg.append(tag);
    flow.append(seg);
  }
  box.append(flow);
  return box;
}

/** Shanbay first, cached personal API fallback; request subscriptions end with this card. */
export function sentenceCard(sentEl) {
  const sentence = sentEl.textContent.trim();
  const count = sentence.split(/\s+/).filter(word => /[A-Za-z]/.test(word)).length;
  if (count > 300) { feedback(`已选 ${count} 词，上限 300 词`, { kind: 'error', detail: '请缩小选择范围后重试' }); return null; }
  const canAnalyze = count >= 10 && count <= 120;
  let active = canAnalyze ? 'analysis' : 'translate';
  let closed = false;
  const jobs = { analysis: {}, translate: {} };
  const pop = openPopover({
    anchor: sentEl, kind: 'sentence', label: '句子',
    // Estimate the completed card before showing a shorter loading skeleton. The selected
    // side stays fixed even if provider labels or the translation exceed this estimate.
    expectedHeight: width => {
      const usable = Math.max(100, (width || 340) - 28);
      const analysisHeight = canAnalyze ? Math.ceil((sentence.length * 7 + count * 9) / usable) * 28 : 0;
      const translationHeight = Math.ceil(sentence.length * 9 / usable) * 24;
      return 56 + Math.max(72, analysisHeight, translationHeight);
    },
    tabs: [
      ...(canAnalyze ? [{ id: 'analysis', icon: 'tree-structure', label: '长难句分析' }] : []),
      { id: 'translate', icon: 'translate', label: '翻译' },
    ],
    onTab: (id) => {
      active = id;
      show(id);
    },
    onClose: () => {
      closed = true;
      for (const job of Object.values(jobs)) job.controller?.abort();
    },
  });
  if (!pop) return null;
  show(active);
  return pop;

  function show(id) {
    if (closed) return;
    const job = jobs[id];
    if (job.node) { pop.setBody(job.node); return; }
    pop.setBody(skeleton({ head: false, button: false }));
    if (closed) return;
    if (!job.pending) {
      job.controller = new AbortController();
      job.pending = run(id, job);
    }
  }

  async function run(id, job) {
    let node;
    try {
      const answer = await (id === 'analysis' ? analyzeSentence : translateSentence)(sentence, { signal: job.controller.signal });
      if (closed) return;
      node = document.createElement('div');
      if (id === 'analysis') {
        const analysis = answer.analysis;
        if (!Array.isArray(analysis?.segments) || !analysis.segments.length
            || !sameSentence(analysis.segments.map(segment => segment.text).join(''), sentence)) throw new Error('分析结果与原句不匹配，请重试');
        node.append(analysisBody(analysis, sentence));
      } else {
        if (typeof answer.translation !== 'string' || !answer.translation.trim()) throw new Error('翻译结果为空，请重试');
        node.append(line(answer.translation, 'pop-translation'));
      }
    } catch (error) {
      if (closed || error?.code === 'CANCELLED') return;
      node = document.createElement('div');
      if (error?.code === 'NO_BRIDGE') {
        node.append(line('请更新 App 后使用句子分析和翻译。', 'pop-muted'));
      } else {
        node.append(line((id === 'analysis' ? '分析失败：' : '翻译失败：') + error.message, 'pop-muted'));
      }
      if (error?.code === 'FALLBACK_UNAVAILABLE' || error?.code === 'NO_KEY' || error?.message === '还没有配置翻译密钥') {
        const go = document.createElement('button');
        go.className = 'pop-link';
        go.textContent = '去设置';
        go.onclick = () => {
          closePopover();
          window.top?.hwfeeShowTab?.('settings');
        };
        node.append(go);
      }
      const retry = document.createElement('button');
      retry.className = 'pop-btn';
      retry.textContent = id === 'analysis' ? '重试分析' : '重试翻译';
      retry.onclick = () => { job.node = null; job.pending = null; show(id); };
      node.append(retry);
    }
    job.node = node;
    if (!closed && active === id) pop.setBody(node);
  }
}

// --------------------------------------------------------------------- gestures

export function initGestures(root) {
  if (!root || root.dataset.gestures === '1') return;
  root.dataset.gestures = '1';
  articleRoot = root;

  let pointerId = null;
  let startX = 0;
  let startY = 0;

  const cancelPress = (event) => {
    if (event && pointerId !== null && event.pointerId !== pointerId) return;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = 0;
    pointerId = null;
  };

  root.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false) { cancelPress(); return; }
    if (event.button !== 0) return;
    const sentence = nearestSentence(root, event.target, event.clientX, event.clientY);
    if (!sentence) return;
    justLongPressed = false;
    cancelPress();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      justLongPressed = true;
      sentenceCard(sentence);
    }, LONG_PRESS_MS);
  });

  root.addEventListener('pointerup', cancelPress);
  root.addEventListener('pointercancel', cancelPress);
  root.addEventListener('pointermove', (event) => {
    if (pointerId !== null && event.pointerId === pointerId
        && Math.hypot(event.clientX - startX, event.clientY - startY) > PRESS_SLOP) cancelPress(event);
  });
  root.addEventListener('pointerleave', cancelPress);
  window.addEventListener('scroll', () => cancelPress(), { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPress(); });
  root.addEventListener('contextmenu', (event) => {
    if (event.target.closest?.('.sent')) event.preventDefault();
  });

  root.addEventListener('click', (event) => {
    const dismissed = consumeDismissedWordTap(event.target);
    if (justLongPressed) { justLongPressed = false; return; }
    if (dismissed) { event.preventDefault(); return; }
    const word = event.target.closest?.('.w');
    if (!word) return;
    event.preventDefault();
    wordCard(word);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopover();
  });
}

/** Select the closest rendered sentence fragment when a press lands in paragraph whitespace. */
function nearestSentence(root, target, x, y) {
  const direct = target.closest?.('.sent');
  if (direct && root.contains(direct)) return direct;
  const paragraph = target.closest?.('.para');
  if (!paragraph || !root.contains(paragraph)) return null;
  let nearest = null;
  let best = 28 * 28;
  for (const sentence of paragraph.querySelectorAll('.sent')) {
    for (const rect of sentence.getClientRects()) {
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const distance = dx * dx + dy * dy;
      if (distance <= best) { best = distance; nearest = sentence; }
    }
  }
  return nearest;
}

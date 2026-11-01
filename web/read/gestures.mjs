// The three reading gestures: long-press a sentence to translate, tap a word for its card,
// and highlight the words you are learning.
import { openSheet, closeSheet, line, spinner } from './sheet.mjs';
import { fetchVocabulary, validateVocabularyCache } from './vocab.mjs';

const WORD_RE = /[A-Za-z]+(?:[-’'][A-Za-z]+)*/g;
const SENTENCE_RE = /[^.!?…]+[.!?…]+["'”’)\]]?\s*|[^.!?…]+$/g;
const LONG_PRESS_MS = 520;
const VOCAB_TTL_MS = 6 * 60 * 60 * 1000;
const VOCAB_KEY = 'hwfee:vocab';

const CATEGORY_BITS = { today: 1, wordbook: 2, learned: 4, unlearned: 8 };
const BUSINESS_ID = 1; // /wordscollection/words rejects the POST without it

let vocab = new Map();
let highlighted = new Set(['today', 'wordbook']);
let articleRoot = null;
let pressTimer = 0;
let justLongPressed = false;

function capacitor() {
  try { return window.top?.Capacitor ?? window.Capacitor ?? null; } catch { return window.Capacitor ?? null; }
}
function shanbay() { return capacitor()?.Plugins?.Shanbay ?? null; }
function llm() { return capacitor()?.Plugins?.Llm ?? null; }

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
  for (const match of text.matchAll(SENTENCE_RE)) {
    const sentence = match[0];
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
    else if (highlighted.has('today') && bitOn(mask, 'today')) word.classList.add('hl-today');
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
    return validateVocabularyCache(parsed, { ttlMs: VOCAB_TTL_MS });
  } catch { return null; }
}

function writeVocabCache(entries) {
  try { localStorage.setItem(VOCAB_KEY, JSON.stringify({ at: Date.now(), entries })); } catch {}
}

/** Words you are studying, with their inflections, from every category at once. */
export async function loadHighlightVocab({ force = false } = {}) {
  const cached = force ? null : readVocabCache();
  if (cached) {
    vocab = new Map(cached);
    applyHighlights();
    return vocab.size;
  }
  const categories = Object.keys(CATEGORY_BITS).join(',');
  const entries = await fetchVocabulary((page) =>
    call(`/bay-translate/user_vocabs?categories=${categories}&page=${page}&ipp=1000`));
  const complete = new Map(entries);
  vocab = complete;
  writeVocabCache(entries);
  applyHighlights();
  return vocab.size;
}

export function setHighlightCategories(names) {
  highlighted = new Set(names);
  applyHighlights();
}

// -------------------------------------------------------------------- word card

async function wordCard(word) {
  const sheet = openSheet({ kicker: 'WORD', title: word });
  sheet.setBody(spinner('正在查词…'));
  try {
    const data = await call(`/abc/words/senses?vocabulary_content=${encodeURIComponent(word)}`);
    const definitions = (data.definitions?.cn || []).slice(0, 3);
    const vocabId = String(data.id || '');

    const body = document.createElement('div');
    if (!definitions.length) {
      body.append(line('词典里没有这个词，可能是专有名词或变形。', 'sheet-muted'));
    }
    for (const entry of definitions) {
      const row = document.createElement('p');
      row.className = 'sheet-def';
      const pos = document.createElement('i');
      pos.textContent = entry.pos || '';
      const def = document.createElement('span');
      def.textContent = entry.def || '';
      row.append(pos, def);
      body.append(row);
    }

    let exists = false;
    if (vocabId) {
      try {
        const check = await call(`/wordscollection/words_check?vocab_ids=${encodeURIComponent(vocabId)}`);
        exists = Boolean((check.objects || [])[0]?.exists);
      } catch {}
    }

    const action = document.createElement('button');
    action.className = 'sheet-btn' + (exists ? '' : ' is-primary') + ' is-wide';
    action.textContent = exists ? '已在生词本 · 移除' : '加入生词本';
    action.onclick = async () => {
      if (!vocabId) return;
      action.disabled = true;
      action.textContent = exists ? '正在移除…' : '正在加入…';
      try {
        if (exists) await call('/wordscollection/words', 'DELETE', { vocab_ids: [vocabId] });
        else await call('/wordscollection/words', 'POST', { vocab_id: vocabId, business_id: BUSINESS_ID });
        exists = !exists;
        action.className = 'sheet-btn' + (exists ? '' : ' is-primary') + ' is-wide';
        action.textContent = exists ? '已在生词本 · 移除' : '加入生词本';
        loadHighlightVocab({ force: true }).catch(() => {});
      } catch (error) {
        action.textContent = '操作失败：' + error.message;
      } finally {
        action.disabled = false;
      }
    };

    body.append(action);
    sheet.setBody(body);
  } catch (error) {
    sheet.setBody(line('查词失败：' + error.message, 'sheet-muted'));
  }
}

// ------------------------------------------------------------------ translation

async function translateSentence(sentence) {
  const sheet = openSheet({ kicker: 'LONG PRESS · 翻译', title: sentence });
  const api = llm();
  if (!api) {
    sheet.setBody(line('翻译需要 app 里的 bridge。', 'sheet-muted'));
    return;
  }
  const config = await api.getConfig().catch(() => null);
  if (!config?.has) {
    sheet.setBody(line('还没有配置翻译密钥。到设置里填入 DeepSeek（或任意 OpenAI 兼容）的 key 之后就能用了。', 'sheet-muted'));
    return;
  }
  sheet.setBody(spinner('正在翻译…'));
  try {
    const result = await api.translate({ text: sentence });
    const box = document.createElement('div');
    box.append(line(result.translation, 'sheet-translation'));
    sheet.setBody(box);
  } catch (error) {
    sheet.setBody(line('翻译失败：' + error.message, 'sheet-muted'));
  }
}

// --------------------------------------------------------------------- gestures

export function initGestures(root) {
  if (!root || root.dataset.gestures === '1') return;
  root.dataset.gestures = '1';
  articleRoot = root;

  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = 0;
  };

  root.addEventListener('pointerdown', (event) => {
    const sentence = event.target.closest?.('.sent');
    if (!sentence) return;
    justLongPressed = false;
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      justLongPressed = true;
      translateSentence(sentence.textContent.trim());
    }, LONG_PRESS_MS);
  });

  root.addEventListener('pointerup', cancelPress);
  root.addEventListener('pointercancel', cancelPress);
  root.addEventListener('pointermove', cancelPress);
  root.addEventListener('pointerleave', cancelPress);

  root.addEventListener('click', (event) => {
    if (justLongPressed) { justLongPressed = false; return; }
    const word = event.target.closest?.('.w');
    if (!word) return;
    event.preventDefault();
    wordCard(word.dataset.w);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSheet();
  });
}

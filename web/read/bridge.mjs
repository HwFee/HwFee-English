// Read tab state, built on device.
//
// The Shanbay *transport* is native (a browser cannot set a Cookie header, and these calls are
// cross-origin). Everything else — the defensive word-list decoder, the article markup parser,
// the article-source priority — is the existing JavaScript, reused as-is.
import { Shanbay } from './lib.mjs';
import { sourcePlan, crossLearningArticleId, associationWords, matchedTodayWords } from './article-source.mjs';

const CACHE_PREFIX = 'hwfee:article:';
const CALL_TIMEOUT_MS = 45000;

// Both tabs are iframes on the app origin. An iframe receives its own injected Capacitor, but
// calls made through it never resolve; the top window owns the working bridge.
function capacitor() {
  try {
    return window.top?.Capacitor ?? window.Capacitor ?? null;
  } catch {
    return window.Capacitor ?? null;
  }
}

function plugin() {
  return capacitor()?.Plugins?.Shanbay ?? null;
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' 超时')), CALL_TIMEOUT_MS)),
  ]);
}

/** fetch-shaped adapter around the native request method. */
async function bridgeTransport(url, init = {}) {
  const api = plugin();
  if (!api) throw new Error('bridge 不可用');
  const path = String(url).replace('https://apiv3.shanbay.com', '');
  const body = init.body ? JSON.parse(init.body) : null;
  const result = await withTimeout(api.request({ path, method: init.method || 'GET', body }), '扇贝请求');
  const text = result?.body ?? '{}';
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

function client() {
  return new Shanbay('', bridgeTransport);
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** Article body arrives as <para><sent> markup, sometimes CDATA-wrapped. */
function parseContent(xml) {
  const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [...String(xml || '').matchAll(/<para\b[^>]*>([\s\S]*?)<\/para>/g)]
    .map((match) => {
      const sentences = [...match[1].matchAll(/<sent\b[^>]*>([\s\S]*?)<\/sent>/g)].map((sentence) => {
        const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(sentence[1]);
        return decode(cdata ? cdata[1] : sentence[1].replace(/<[^>]+>/g, ' '));
      });
      return sentences.join(' ').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

function cacheKey(date) {
  return CACHE_PREFIX + date;
}

function readCache(date) {
  try {
    const raw = localStorage.getItem(cacheKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.paragraphs) && parsed.paragraphs.length ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(article) {
  try {
    localStorage.setItem(cacheKey(article.date), JSON.stringify(article));
    pruneCache();
  } catch {}
}

/** Keeps the local archive bounded: articles older than this are dropped. */
function pruneCache(keepDays = 60) {
  const cutoff = Date.now() - keepDays * 86400000;
  const stale = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    const stamp = Date.parse(key.slice(CACHE_PREFIX.length) + 'T00:00:00+08:00');
    if (Number.isFinite(stamp) && stamp < cutoff) stale.push(key);
  }
  for (const key of stale) {
    try { localStorage.removeItem(key); } catch {}
  }
}

/** Today's article: 词文串学 match first, then the newest one — same rule as import-daily. */
async function fetchArticle(api, today) {
  const plan = sourcePlan({});
  let id = null;
  let matched = null;

  if (plan.mode === 'cross-learning') {
    try {
      matched = await api.request('/abc/applets/cross_learning/article');
      id = crossLearningArticleId(matched);
    } catch {
      id = null;
    }
  }
  if (!id) {
    const latest = await api.request('/news/retrieve/articles?ipp=10&page=1');
    const picked = (latest.objects || [])[0];
    if (!picked) throw new Error('没有找到可用短文');
    id = picked.id;
  }

  const data = await api.request(`/news/articles/${id}?source=1`);
  const paragraphs = parseContent(data.content);
  if (!paragraphs.length) throw new Error('文章正文为空');

  const article = {
    title: String(data.title_en || '').trim(),
    subtitle: String(data.title_cn || '').trim(),
    date: today.status?.date || localDate(),
    source: `https://web.shanbay.com/reading/web-news/articles/${data.id}`,
    sourceName: '扇贝阅读',
    originalSource: data.source?.name_cn || '',
    sourceDate: data.date || '',
    paragraphs,
  };

  if (matched) {
    const pairing = associationWords(matched.association_learning_sentences);
    const hits = matchedTodayWords(today.words, matched.matched_vocab_ids);
    if (pairing.length) article.associationWords = pairing;
    if (hits.length) article.matchedTodayWords = hits;
  }
  return article;
}

function shapeToday(today) {
  const status = today.status ?? null;
  return {
    date: status?.date ?? today.date ?? null,
    status,
    book: today.book || '',
  };
}

export async function hasSession() {
  const api = plugin();
  if (!api) return false;
  try {
    return Boolean((await withTimeout(api.hasCookie(), '读取登录态'))?.has);
  } catch {
    return false;
  }
}

export async function loadState({ force = false } = {}) {
  const api = plugin();
  if (!api) throw new Error('bridge 不可用，请在 app 里打开');
  const clientApi = client();
  const today = await clientApi.today();
  const shaped = shapeToday(today);

  let article = force ? null : readCache(shaped.date);
  if (!article) {
    article = await fetchArticle(clientApi, today);
    writeCache(article);
  }
  return { today: shaped, article };
}

/** Cached articles, newest first — used by the history view. */
export function cachedArticles() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    try {
      const article = JSON.parse(localStorage.getItem(key));
      if (article?.date) out.push({ date: article.date, title: article.title });
    } catch {}
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

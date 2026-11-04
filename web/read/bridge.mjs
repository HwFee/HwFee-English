// Read tab state, built on device.
//
// The Shanbay *transport* is native (a browser cannot set a Cookie header, and these calls are
// cross-origin). Everything else — the defensive word-list decoder, the article markup parser,
// the article-source priority — is the existing JavaScript, reused as-is.
import { Shanbay } from './lib.mjs';
import { sourcePlan, crossLearningArticleId, associationWords, matchedTodayWords } from './article-source.mjs';

const CACHE_PREFIX = 'hwfee:article:';
const LAST_STATE_KEY = 'hwfee:reader:last-successful';
const STATE_SCOPE_KEY = 'hwfee:reader:session-scope';
const CACHE_MAX_AGE_DAYS = 60;
const CALL_TIMEOUT_MS = 45000;
let coverBackfill = null;
let stateRequest = null;
let sessionScope = null;

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
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(label + ' 超时');
      error.code = 'NETWORK_ERROR';
      reject(error);
    }, CALL_TIMEOUT_MS);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timeout));
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

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function dateAgeDays(date) {
  if (!validDate(date)) return Infinity;
  return (Date.parse(localDate() + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000;
}

function freshDate(date) {
  const age = dateAgeDays(date);
  return age >= 0 && age <= CACHE_MAX_AGE_DAYS;
}

function httpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validArticle(article, date = article?.date) {
  return Boolean(article && typeof article === 'object'
    && article.date === date && freshDate(date)
    && typeof article.title === 'string' && typeof article.subtitle === 'string'
    && Array.isArray(article.paragraphs) && article.paragraphs.length > 0
    && article.paragraphs.every((paragraph) => typeof paragraph === 'string' && paragraph.trim())
    && (article.cover === undefined || httpsUrl(article.cover)));
}

function validState(state) {
  return Boolean(state && typeof state === 'object'
    && state.today && typeof state.today === 'object'
    && freshDate(state.today.date)
    && typeof state.today.book === 'string'
    && state.today.status && typeof state.today.status === 'object'
    && validArticle(state.article, state.today.date));
}

function readCache(date) {
  if (!freshDate(date)) return null;
  try {
    const raw = localStorage.getItem(cacheKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validArticle(parsed, date) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(article) {
  try {
    pruneCache();
    localStorage.setItem(cacheKey(article.date), JSON.stringify(article));
  } catch {}
}

function sameSession() {
  if (!sessionScope) return true;
  try { return localStorage.getItem(STATE_SCOPE_KEY) === sessionScope; }
  catch { return false; }
}

function readLastState() {
  try {
    if (!sameSession()) return null;
    const parsed = JSON.parse(localStorage.getItem(LAST_STATE_KEY) || 'null');
    return validState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastState(state) {
  try {
    localStorage.setItem(LAST_STATE_KEY, JSON.stringify(state));
    if (sessionScope) localStorage.setItem(STATE_SCOPE_KEY, sessionScope);
  } catch {}
}

/** Render the last saved day immediately while today's study records synchronize. */
export function cachedState() {
  const state = readLastState();
  if (!state) return null;
  return { ...state, article: readCache(state.today.date) || state.article };
}

/** Keeps the local archive bounded: articles older than this are dropped. */
function pruneCache(keepDays = 60) {
  const stale = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    const date = key.slice(CACHE_PREFIX.length);
    const age = dateAgeDays(date);
    if (!Number.isFinite(age) || age < 0 || age > keepDays) stale.push(key);
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
    } catch (error) {
      if (error?.code && !['NETWORK_ERROR', 'NOT_READY', 'HTTP_ERROR', 'REDIRECT_BLOCKED'].includes(error.code)) throw error;
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
    date: today.status?.date || today.date || localDate(),
    source: `https://web.shanbay.com/reading/web-news/articles/${data.id}`,
    sourceName: '扇贝阅读',
    originalSource: data.source?.name_cn || '',
    sourceDate: data.date || '',
    paragraphs,
  };

  const cover = data.thumbnail_urls?.[0];
  if (httpsUrl(cover)) article.cover = cover;

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
  // A missing bridge or a timeout is not "no session" — retry until the plugin
  // answers; only a real has:false means not connected.
  for (let attempt = 0; ; attempt++) {
    const api = plugin();
    if (api) {
      try {
        const session = await withTimeout(api.hasCookie(), '读取登录态');
        sessionScope = typeof session?.sessionScope === 'string' ? session.sessionScope : null;
        return Boolean(session?.has);
      } catch (error) {
        if (attempt >= 4) throw error;
      }
    } else if (attempt >= 40) {
      throw new Error('bridge 不可用，请重试');
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

export function loadState({ force = false } = {}) {
  if (stateRequest) {
    if (!force || stateRequest.force) return stateRequest.promise;
    return stateRequest.promise.catch(() => null).then(() => loadState({ force: true }));
  }
  const request = { force, promise: null };
  request.promise = fetchState({ force }).finally(() => { if (stateRequest === request) stateRequest = null; });
  stateRequest = request;
  return request.promise;
}

async function fetchState({ force }) {
  const api = plugin();
  if (!api) throw new Error('bridge 不可用，请在 app 里打开');
  const clientApi = client();
  try {
    const today = await clientApi.today();
    const shaped = shapeToday(today);
    if (!freshDate(shaped.date) || !shaped.status || typeof shaped.status !== 'object') {
      throw new Error('今日学习数据格式无效');
    }

    const sameAccount = sameSession();
    let article = force || !sameAccount ? null : readCache(shaped.date);
    if (!article) article = await fetchArticle(clientApi, today);
    if (!validArticle(article, shaped.date)) throw new Error('文章缓存格式无效');

    const state = { today: shaped, article };
    writeCache(article);
    writeLastState(state);
    return { ...state, offline: false };
  } catch (error) {
    const cached = readLastState();
    if (error?.code === 'NETWORK_ERROR' && cached) return { ...cached, offline: true, offlineReason: error.message };
    throw error;
  }
}

function countWords(paragraphs) {
  return paragraphs.join(' ').match(/[A-Za-z]+(?:[-’'][A-Za-z]+)*/g)?.length || 0;
}

/** Cached articles, newest first — the 近几篇 list. */
export function cachedArticles() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    try {
      const article = JSON.parse(localStorage.getItem(key));
      if (validArticle(article)) {
        out.push({
          date: article.date,
          title: article.title,
          words: countWords(article.paragraphs),
          paragraphs: article.paragraphs.length,
          cover: article.cover,
        });
      }
    } catch {}
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** One validated cached article, for opening an old read. */
export function cachedArticle(date) {
  return readCache(date);
}

/** Older cached articles predate cover metadata. Repair the visible archive without replacing text. */
export function backfillArticleCovers() {
  if (!coverBackfill) {
    coverBackfill = repairArticleCovers().finally(() => { coverBackfill = null; });
  }
  return coverBackfill;
}

async function repairArticleCovers() {
  if (!plugin()) return 0;
  const api = client();
  let updated = 0;
  for (const { date } of cachedArticles().slice(0, 10)) {
    const article = readCache(date);
    if (!article || article.cover) continue;
    let id;
    try {
      const source = new URL(article.source);
      if (source.origin !== 'https://web.shanbay.com') continue;
      id = /^\/reading\/web-news\/articles\/([\w-]+)\/?$/.exec(source.pathname)?.[1];
    } catch { continue; }
    if (!id) continue;

    try {
      const data = await api.request(`/news/articles/${id}?source=1`);
      const cover = data.thumbnail_urls?.[0];
      if (!httpsUrl(cover)) continue;
      // A refresh or cache clear may have changed this entry while the request was pending.
      const current = readCache(date);
      if (!current || current.source !== article.source || current.cover) continue;
      localStorage.setItem(cacheKey(date), JSON.stringify({ ...current, cover }));
      const last = readLastState();
      if (last?.article.date === date && last.article.source === current.source && !last.article.cover) {
        writeLastState({ ...last, article: { ...last.article, cover } });
      }
      updated++;
    } catch (error) {
      // Covers are optional; leave the article readable and retry on a later refresh.
      if (['NETWORK_ERROR', 'UNAUTHORIZED'].includes(error?.code)) break;
    }
  }
  return updated;
}

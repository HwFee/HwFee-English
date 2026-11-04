import { nativeLlm, getLlmConfig } from './llm.mjs';
import { splitSentences } from './sentences.mjs';

const RETRY_MS = 2 * 60000;
let running = null;
let attempted = { id: '', at: 0 };
let completed = { id: '', expiresAt: 0 };
let runningArticle = '';
let queued = null;
const FAILURE_KEY = 'hwfee:pretranslation-failure';
const COMPLETED_KEY = 'hwfee:pretranslation-completed';
let failed = null;
try { failed = JSON.parse(globalThis.localStorage?.getItem(FAILURE_KEY) || 'null'); } catch {}
try {
  const saved = JSON.parse(globalThis.localStorage?.getItem(COMPLETED_KEY) || 'null');
  if (typeof saved?.id === 'string' && Number.isFinite(saved.expiresAt)) completed = saved;
} catch {}

function rememberCompleted(value) {
  completed = value;
  try { globalThis.localStorage?.setItem(COMPLETED_KEY, JSON.stringify(value)); } catch {}
}

function preparationId(config, article, sentences) {
  return JSON.stringify(['translation-analysis-v3', config.cacheVersion, config.routing, config.sessionScope,
    config.baseUrl, config.model, article.date, article.source, sentences]);
}
function rememberFailure(value) {
  failed = value;
  try {
    if (value) globalThis.localStorage?.setItem(FAILURE_KEY, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(FAILURE_KEY);
  } catch { /* The in-memory pause still prevents repeated requests. */ }
}


export function articleSentences(article) {
  return [...new Set((article?.paragraphs || []).flatMap(paragraph => splitSentences(paragraph))
    .map(text => text.trim()).filter(Boolean))];
}

/** Reading never waits for pretranslation; successful sentence results remain in the native cache. */
export function prepareTranslation(article, { force = false, now = Date.now() } = {}) {
  const api = nativeLlm();
  if (!api?.pretranslate || !article?.paragraphs?.length) return Promise.resolve(null);
  const articleId = JSON.stringify([article.date, article.source, article.paragraphs]);
  if (running) {
    if (force || articleId !== runningArticle) {
      queued = { article, force };
      if (articleId !== runningArticle) api.cancelPretranslation?.().catch(() => {});
    }
    return running;
  }
  runningArticle = articleId;
  running = (async () => {
    const config = await getLlmConfig();
    if (!config.autoTranslate) {
      window.top?.hwfeePretranslationStatus?.('已关闭自动预加载');
      return null;
    }
    if (!(config?.canTranslate ?? config?.has)) return null;
    const sentences = articleSentences(article);
    const analysisTotal = sentences.filter(text => {
      const words = text.split(/\s+/).filter(word => /[A-Za-z]/.test(word)).length;
      return words >= 10 && words <= 120;
    }).length;
    if (!sentences.length) return null;
    const id = preparationId(config, article, sentences);
    if (!force && completed.id === id && now < completed.expiresAt) {
      window.top?.hwfeePretranslationStatus?.('今日文章已就绪');
      return null;
    }
    if (!force && failed?.id === id) {
      window.top?.hwfeePretranslationStatus?.('预加载未完成', { error: failed.detail });
      return null;
    }
    if (force) {
      rememberFailure(null);
      rememberCompleted({ id: '', expiresAt: 0 });
    }
    if (!force && attempted.id === id && now - attempted.at < RETRY_MS) return null;
    attempted = { id, at: now };
    try {
      window.top?.hwfeePretranslationStatus?.('正在预加载…');
      const result = await api.pretranslate({ sentences, includeAnalysis: true });
      // An old request must not restore a stale success/failure after preferences or login changed.
      const current = await getLlmConfig();
      if (!current.autoTranslate || preparationId(current, article, sentences) !== id) return null;
      const analysisReady = analysisTotal === 0 || (result?.analysis?.total === analysisTotal && result.analysis.completed === analysisTotal);
      const stopped = result?.stopped || !analysisReady;
      const ready = result && !stopped && result.total === sentences.length && result.completed === sentences.length;
      if (ready) {
        const expiresAt = Number.isFinite(result.expiresAt) && result.expiresAt > now
          ? result.expiresAt : now + RETRY_MS;
        rememberCompleted({ id, expiresAt });
      }
      const detail = result?.analysis?.error || result?.fallbackReason || '部分内容尚未完成，已完成的结果已保留。';
      if (ready) rememberFailure(null);
      else rememberFailure({ id, detail });
      window.top?.hwfeePretranslationStatus?.(ready ? '今日文章已就绪' : '预加载未完成',
        ready ? {} : { error: detail, notify: force });
      return result;
    } catch (error) {
      const current = await getLlmConfig().catch(() => null);
      if (current && (!current.autoTranslate || preparationId(current, article, sentences) !== id)) return null;
      const reset = error.quotaResetAt || error.data?.quotaResetAt;
      const detail = error.message + (reset ? ' · 额度恢复：' + reset : '');
      rememberFailure({ id, detail });
      window.top?.hwfeePretranslationStatus?.('预译未完成：' + detail,
        { error: detail, notify: force });
      return null;
    }
  })().catch(error => {
    window.top?.hwfeePretranslationStatus?.('预译设置读取失败：' + error.message,
      { error: error.message, notify: force });
    return null;
  }).finally(() => {
    running = null;
    const next = queued;
    queued = null;
    if (next) void prepareTranslation(next.article, { force: next.force });
  });
  return running;
}

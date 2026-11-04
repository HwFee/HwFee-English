// Both frames use the top window's bridge. Persistent caching and request sharing are native.
export function nativeLlm() {
  try { return (window.top?.Capacitor ?? window.Capacitor)?.Plugins?.Llm ?? null; }
  catch { return window.Capacitor?.Plugins?.Llm ?? null; }
}

function requireApi(method) {
  const api = nativeLlm();
  if (typeof api?.[method] !== 'function') {
    throw Object.assign(new Error('此功能需要安装支持它的 App。'), { code: 'NO_BRIDGE' });
  }
  return api;
}

export async function translateSentence(text, options = {}) {
  return sentenceRequest('translate', text, options);
}

/** Returns { analysis: { schemaVersion: 2, sentence, segments: [{type, text, label}] }, provider, model, cached, ...metadata }. */
export async function analyzeSentence(text, options = {}) {
  return sentenceRequest('analyze', text, options);
}

function sentenceRequest(method, text, { signal } = {}) {
  const api = requireApi(method);
  const requestId = signal ? (globalThis.crypto?.randomUUID?.()
    || `sentence-${Date.now()}-${Math.random().toString(36).slice(2)}`) : undefined;
  const cancel = () => {
    if (!requestId || typeof api.cancelSentence !== 'function') return;
    try { Promise.resolve(api.cancelSentence({ requestId })).catch(() => {}); } catch { /* Older bridge. */ }
  };
  if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { code: 'CANCELLED' });
  return timed(api[method](requestId ? { text, requestId } : { text }), 180000, signal, cancel);
}

export async function getLlmConfig() {
  return timed(requireApi('getConfig').getConfig(), 15000);
}

/** Local read only; missing token/remaining values are null, not zero. */
export async function getUsage({ days = 30 } = {}) {
  return timed(requireApi('getUsage').getUsage({ days }), 15000);
}

/** Independent account quota query; works at zero and never requests a translation. */
export async function getShanbayQuota({ forceRefresh = false } = {}) {
  return timed(requireApi('getShanbayQuota').getShanbayQuota({ forceRefresh }), 60000,
    undefined, undefined, '扇贝额度查询超时，请重试');
}

/** Official DeepSeek account read; amounts are decimal strings, with a 60-second native cache. */
export async function getDeepSeekBalance({ forceRefresh = false } = {}) {
  return timed(requireApi('getDeepSeekBalance').getDeepSeekBalance({ forceRefresh }), 20000,
    undefined, undefined, 'DeepSeek 余额查询超时，请重试');
}

function timed(promise, ms = 180000, signal, cancel = () => {},
  timeoutMessage = '请求等待超时，请重试；已完成的结果会保留在缓存中') {
  let timer;
  let onAbort;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      cancel();
      reject(Object.assign(new Error(timeoutMessage), { code: 'TIMEOUT' }));
    }, ms);
  });
  const aborted = new Promise((_, reject) => {
    onAbort = () => { cancel(); reject(Object.assign(new Error('请求已取消'), { code: 'CANCELLED' })); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  return Promise.race([promise, timeout, aborted]).finally(() => {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
  });
}

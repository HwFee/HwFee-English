/** Fetches every page before returning entries, so callers can publish only complete vocab sets. */
export async function fetchVocabulary(fetchPage, { pageSize = 1000, maxPages = 100 } = {}) {
  const masks = new Map();
  const pageSignatures = new Set();
  let total = null;
  let fetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const payload = await fetchPage(page);
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.vocabs)
        || !Number.isSafeInteger(payload.total) || payload.total < 0
        || payload.vocabs.length > pageSize) {
      throw new Error('扇贝生词分页格式无效');
    }
    if (total === null) total = payload.total;
    else if (payload.total !== total) throw new Error('扇贝生词总数在分页中发生变化');

    const list = payload.vocabs;
    const signature = JSON.stringify(list);
    if (list.length && pageSignatures.has(signature)) throw new Error('扇贝生词分页没有前进');
    if (list.length) pageSignatures.add(signature);
    if (list.length === 0 && fetched < total) throw new Error('扇贝生词分页提前结束');

    for (const item of list) {
      if (!item || typeof item !== 'object') throw new Error('扇贝生词条目格式无效');
      const mask = Number(item.categories);
      if (!Number.isSafeInteger(mask) || mask < 0) throw new Error('扇贝生词分类格式无效');
      if (!Array.isArray(item.variants ?? [])) throw new Error('扇贝生词变形格式无效');
      const words = [item.vocab, ...(item.variants ?? [])];
      for (const value of words) {
        if (typeof value !== 'string' || !value.trim()) throw new Error('扇贝生词词条为空');
        const word = value.trim().toLowerCase();
        masks.set(word, (masks.get(word) || 0) | mask);
      }
    }

    if (fetched + list.length > total) throw new Error('扇贝生词分页数量超过总数');
    fetched += list.length;
    if (fetched >= total) return [...masks.entries()];
  }

  throw new Error('扇贝生词超过分页上限或未读取完整');
}

/** Returns a validated, duplicate-merged cache or null without allowing Map construction to throw. */
export function validateVocabularyCache(record, { now = Date.now(), ttlMs } = {}) {
  if (!record || typeof record !== 'object'
      || !Number.isFinite(record.at) || record.at <= 0
      || record.at > now || !Number.isFinite(ttlMs) || ttlMs < 0
      || now - record.at > ttlMs || !Array.isArray(record.entries)) return null;

  const masks = new Map();
  for (const entry of record.entries) {
    if (!Array.isArray(entry) || entry.length !== 2
        || typeof entry[0] !== 'string' || !entry[0].trim()
        || !Number.isSafeInteger(entry[1]) || entry[1] < 0) return null;
    const word = entry[0].trim().toLowerCase();
    masks.set(word, (masks.get(word) || 0) | entry[1]);
  }
  return [...masks.entries()];
}

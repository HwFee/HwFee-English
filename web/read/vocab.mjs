export const CATEGORY_BITS = { today: 1, wordbook: 2, learned: 4, unlearned: 8 };

/** Normalize typography, not morphology: provider-supplied inflections remain authoritative. */
export function vocabularyKey(word) {
  return String(word ?? '').normalize('NFC').trim().toLowerCase()
    .replace(/[’‘ʼ]/g, "'").replace(/[‐‑]/g, '-');
}

export function vocabularyMask(word, masks) {
  const key = vocabularyKey(word);
  return masks.get(key) || (/\S's$/.test(key) ? masks.get(key.slice(0, -2)) : 0) || 0;
}

/** A missing or malformed check must never be treated as "not in the wordbook". */
export function wordbookMembership(payload, vocabId) {
  if (!Array.isArray(payload?.objects)) throw new Error('生词本状态格式无效');
  const item = payload.objects.find((entry) => String(entry?.vocab_id) === String(vocabId));
  if (!item || typeof item.exists !== 'boolean') throw new Error('生词本没有返回这个词的状态');
  return item.exists;
}

/**
 * Fetches every page before returning, so callers can publish only complete vocab sets.
 * counts[category] is the number of distinct headwords carrying that category's bit;
 * variants count toward highlight masks but not toward headword counts.
 */
export async function fetchVocabularyWithCounts(fetchPage, { pageSize = 1000, maxPages = 100 } = {}) {
  const masks = new Map();
  const headwords = new Map();
  const families = [];
  let coveredCategories = 15, syncDate = '', degraded = false;
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

    if (payload.covered_categories !== undefined) {
      if (!Number.isSafeInteger(payload.covered_categories) || payload.covered_categories < 0) throw new Error('扇贝高亮覆盖分类格式无效');
      coveredCategories &= payload.covered_categories;
    }
    degraded ||= payload.degraded === true;
    if (typeof payload.date === 'string') {
      if (syncDate && syncDate !== payload.date) throw new Error('扇贝高亮日期在分页中发生变化');
      syncDate = payload.date;
    }
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
      families.push(words.map(vocabularyKey));
      for (const value of words) {
        if (typeof value !== 'string' || !value.trim()) throw new Error('扇贝生词词条为空');
        const word = vocabularyKey(value);
        masks.set(word, (masks.get(word) || 0) | mask);
      }
      const headword = vocabularyKey(item.vocab);
      headwords.set(headword, (headwords.get(headword) || 0) | mask);
    }

    if (fetched + list.length > total) throw new Error('扇贝生词分页数量超过总数');
    fetched += list.length;
    if (fetched >= total) break;
  }

  if (fetched < (total ?? Infinity)) throw new Error('扇贝生词超过分页上限或未读取完整');

  const counts = {};
  for (const name of Object.keys(CATEGORY_BITS)) {
    counts[name] = 0;
    for (const mask of headwords.values()) {
      if (mask & CATEGORY_BITS[name]) counts[name] += 1;
    }
  }
  return { entries: [...masks.entries()], counts, families, coveredCategories, syncDate, degraded };
}

export async function fetchVocabulary(fetchPage, opts) {
  return (await fetchVocabularyWithCounts(fetchPage, opts)).entries;
}

/**
 * Dashboard totals use the collection API and the current book's simple-learned
 * list. Highlight-feed totals describe a different subset of the user's words.
 * A category whose answer is malformed, or whose entries do not carry the
 * requested bit (the filter was ignored), is left out of the result, so the
 * caller keeps the number it already shows instead of printing a wrong one.
 */
export async function fetchLiveVocabCounts(fetchCategory, { categories = Object.keys(CATEGORY_BITS) } = {}) {
  const answers = await Promise.all(categories.map(async (name) => {
    try {
      return [name, categoryTotal(await fetchCategory(name), name)];
    } catch {
      return null;
    }
  }));
  const counts = {};
  for (const answer of answers) if (answer) counts[answer[0]] = answer[1];
  return counts;
}

/** Validated page total; failures let the caller retain the last known number. */
function categoryTotal(payload, name) {
  const official = name === 'wordbook' || name === 'learned';
  const rows = official ? payload?.objects : payload?.vocabs;
  if (!payload || typeof payload !== 'object' || !Array.isArray(rows)
      || !Number.isSafeInteger(payload.total) || payload.total < 0) {
    throw new Error('扇贝生词计数格式无效');
  }
  if (official) return payload.total;
  const bit = CATEGORY_BITS[name] ?? 0;
  for (const item of payload.vocabs) {
    const mask = Number(item?.categories);
    if (!Number.isSafeInteger(mask) || bit === 0 || (mask & bit) === 0) throw new Error('扇贝生词分类筛选未生效');
  }
  return payload.total;
}

/**
 * Count distinct words present in a text against the mask map. Each unique
 * word counts once per category bit its mask carries; variants count through
 * the mask of the entry they belong to, and a word in both categories counts
 * in both.
 */
export function countArticleCategories(words, masks) {
  const counts = { wordbook: 0, today: 0 };
  const seen = new Set();
  for (const word of words) {
    const key = vocabularyKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const mask = vocabularyMask(key, masks);
    if (mask & CATEGORY_BITS.wordbook) counts.wordbook += 1;
    if (mask & CATEGORY_BITS.today) counts.today += 1;
  }
  return counts;
}

/** Four totals, each a non-negative safe integer or null when still unknown. */
export function validateVocabularyCounts(counts) {
  if (!counts || typeof counts !== 'object') return null;
  const out = {};
  for (const name of Object.keys(CATEGORY_BITS)) {
    const value = counts[name];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) return null;
    out[name] = value;
  }
  return out;
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
    const word = vocabularyKey(entry[0]);
    masks.set(word, (masks.get(word) || 0) | entry[1]);
  }
  return [...masks.entries()];
}

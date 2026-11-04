// Preserve paragraph text while identifying sentence boundaries for long press.
// Intl.Segmenter handles decimals and punctuation; ICU still splits common titles
// such as "Dr." from their following name, so join those fragments back together.
const TITLE = /(?:^|[\s([{“‘])(?:Mr|Mrs|Ms|Mx|Dr|Prof|Capt|Col|Lt|Gen|Rep|Sen|Gov|Pres|Rev|Hon|Sgt|No)\.\s*$/i;
const INTERNAL_ABBREVIATION = /(?:^|[\s([{“‘])(?:e\.g|i\.e|vs)\.\s*$/i;
const DOTTED_ACRONYM = /(?:^|[\s([{“‘])(?:[A-Za-z]\.){2,}\s*$/;
const DEFAULT_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;

function fallbackSegments(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!'.!?…'.includes(text[i])) continue;
    if (text[i] === '.' && /\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')) continue;
    let end = i + 1;
    while (end < text.length && '.!?…'.includes(text[end])) end++;
    while (end < text.length && `"'”’)]`.includes(text[end])) end++;
    if (end < text.length && !/\s/.test(text[end])) continue;
    const candidate = text.slice(start, end);
    const next = text.slice(end).trimStart();
    if (next && (TITLE.test(candidate) || INTERNAL_ABBREVIATION.test(candidate)
        || (DOTTED_ACRONYM.test(candidate) && /^[a-z]/.test(next)))) continue;
    while (end < text.length && /\s/.test(text[end])) end++;
    out.push(text.slice(start, end));
    start = end;
    i = end - 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

export function splitSentences(text, segmenter = DEFAULT_SEGMENTER) {
  if (!text) return [];
  const fragments = segmenter
    ? Array.from(segmenter.segment(text), part => part.segment)
    : fallbackSegments(text);
  const sentences = [];
  for (const part of fragments) {
    const last = sentences.length - 1;
    if (last >= 0 && TITLE.test(sentences[last])) sentences[last] += part;
    else sentences.push(part);
  }
  return sentences;
}

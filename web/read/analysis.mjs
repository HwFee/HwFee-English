// Local clause breakdown for a long-pressed sentence: cuts at punctuation and
// clause markers, then tags each segment. Deliberately conservative — this is
// the frontend stand-in until a model takes over the 长难句分析 tab.
const RELATIVE = new Set(['that', 'which', 'who', 'whom', 'whose', 'why', 'how']);
// when/where are read as adverbial here: relative uses are rarer at a clause break
// than "become active when …" style adverbials.
const ADVERBIAL = new Set([
  'because', 'since', 'although', 'though', 'while', 'as', 'until', 'unless',
  'after', 'before', 'if', 'whether', 'once', 'when', 'whenever', 'where',
  'wherever', 'whereas', 'so',
]);
const COORD = new Set(['and', 'but', 'or']);
const MARKER = new Set([...RELATIVE, ...ADVERBIAL, ...COORD]);
const TOKEN = /[A-Za-z]+(?:[-’'][A-Za-z]+)*|[,;:—–()]/g;
const MIN_CLAUSE = 12; // characters before a new cut is worth making
const MAX_SEGMENTS = 8;

// Grammar-role types, named after Shanbay's own sentence_analysis component blocks
// (subj/pred/obj/clause/prep/nonpred/appos/other) so a model feed can drop in later.
function tagFor(mark) {
  switch (mark.kind) {
    case 'main': return { label: '主干', type: 'pred' };
    case 'insert': return { label: '插入语', type: 'appos' };
    case 'punct': return { label: '分句', type: 'other' };
    default:
      if (COORD.has(mark.marker)) return { label: '并列', type: 'coord' };
      if (ADVERBIAL.has(mark.marker)) return { label: '状语从句', type: 'prep' };
      return { label: '从句', type: 'clause' };
  }
}

/**
 * Split a sentence into tagged segments: [{ label, type, text }].
 * type keys the palette; label is the grammar role shown above the chunk.
 */
export function clauseSplit(sentence) {
  const text = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const marks = [{ at: 0, kind: 'main' }];
  const lastMark = () => marks[marks.length - 1];
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const at = match.index;
    if (/^[A-Za-z]/.test(token)) {
      // After a punctuation cut a leading clause word still earns its own chip
      // ("..., which ..."), otherwise a marker needs a real chunk before it.
      const min = lastMark().kind === 'punct' || lastMark().kind === 'insert' ? 1 : MIN_CLAUSE;
      if (MARKER.has(token.toLowerCase()) && at - lastMark().at >= min) {
        marks.push({ at, kind: 'word', marker: token.toLowerCase() });
      }
    } else if (token === '(') {
      if (at - lastMark().at >= 4) marks.push({ at, kind: 'insert' });
    } else if (token !== ')') {
      const after = at + 1;
      if (at - lastMark().at >= MIN_CLAUSE && after < text.length && /[\w’'”)]/.test(text[after] ?? '')) {
        marks.push({ at: after, kind: 'punct' });
      }
    }
  }

  const segments = [];
  for (let i = 0; i < marks.length && segments.length < MAX_SEGMENTS; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    const segment = text.slice(marks[i].at, end).replace(/^[,\s]+/, '').trim();
    if (!segment) continue;
    if (segments.length === MAX_SEGMENTS - 1 && i + 1 < marks.length) {
      segments[segments.length - 1].text += ' ' + segment;
      continue;
    }
    segments.push({ ...tagFor(marks[i]), text: segment });
  }
  return segments;
}

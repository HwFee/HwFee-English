const HAS_WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;
const GENERIC_LABEL = /^(?:其他|其它|标点(?:符号)?|分隔符|未知|未分析|未解析|未识别|待分析|未标注|other|unknown|unanalysed|unanalyzed|punctuation)$/i;

/** Keep source text intact while removing provider-only fragments from the reading layout. */
export function analysisDisplaySegments(source, segments) {
  const result = [];
  let cursor = 0, leading = '';
  for (const segment of segments) {
    const start = cursor;
    for (const character of segment.text) {
      if (SPACE.test(character)) continue;
      while (cursor < source.length && SPACE.test(source[cursor])) cursor++;
      if (!source.startsWith(character, cursor)) throw new Error('分析结果与原句不匹配，请重试');
      cursor += character.length;
    }
    while (cursor < source.length && SPACE.test(source[cursor])) cursor++;
    const text = source.slice(start, cursor);
    if (!HAS_WORD.test(text)) {
      // Opening punctuation belongs with what follows; closing punctuation with what precedes it.
      if (result.length && !leading && !/^[\s([{“‘«]+$/u.test(text)) result.at(-1).text += text;
      else leading += text;
      continue;
    }
    const label = String(segment.label ?? '').trim();
    if (!label || GENERIC_LABEL.test(label)) throw new Error('整句分析尚未完成，请重试');
    const next = { type: segment.type, label, text: leading + text };
    leading = '';
    const previous = result.at(-1);
    // A provider may emit a single phrase word by word. Preserve boundaries at punctuation.
    if (previous && previous.type === next.type && previous.label === next.label
        && /[\p{L}\p{N}]\s+$/u.test(previous.text) && /^[\p{L}\p{N}]/u.test(next.text)) {
      previous.text += next.text;
    } else result.push(next);
  }
  if (cursor !== source.length) throw new Error('分析结果与原句不匹配，请重试');
  if (leading && result.length) result.at(-1).text += leading;
  return result;
}

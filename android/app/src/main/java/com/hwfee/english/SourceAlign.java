package com.hwfee.english;

/**
 * Align provider segment text to the exact source sentence.
 *
 * <p>Providers normalize whitespace: Shanbay echoes runs of spaces, tabs and non-breaking
 * spaces back as a single ASCII space, and trailing whitespace is dropped; a language model
 * does the same when it re-emits a sentence. The renderer needs the <em>source</em> text, so
 * every answer is rebuilt from source slices instead of trusting the provider's copy. Only
 * whitespace length may differ; every non-whitespace character must still match, which is what
 * keeps a rewritten or hallucinated segment from being accepted.
 */
final class SourceAlign {
    private SourceAlign() { }

    static boolean space(char value) {
        if (value <= ' ') return true;
        return value == '\u00a0' || value == '\u1680' || (value >= '\u2000' && value <= '\u200a')
                || value == '\u2028' || value == '\u2029' || value == '\u202f' || value == '\u205f'
                || value == '\u3000' || value == '\ufeff';
    }

    /**
     * Match {@code part} against {@code source} starting exactly at {@code cursor}.
     *
     * @return the exclusive end offset in {@code source} (including whitespace that follows the
     *         matched text), or -1 when the part cannot be matched there.
     */
    static int matchAt(String source, int cursor, String part) {
        if (source == null || part == null || cursor < 0 || cursor > source.length()) return -1;
        int index = cursor, offset = 0;
        while (offset < part.length()) {
            boolean partSpace = space(part.charAt(offset));
            boolean sourceSpace = index < source.length() && space(source.charAt(index));
            if (sourceSpace) {
                // A run of any whitespace in the source matches a run in the part, whatever its length.
                while (index < source.length() && space(source.charAt(index))) index++;
                while (offset < part.length() && space(part.charAt(offset))) offset++;
                continue;
            }
            if (partSpace) {
                // The provider normalized away whitespace the source still has (or vice versa).
                while (offset < part.length() && space(part.charAt(offset))) offset++;
                continue;
            }
            if (index >= source.length()) return -1;
            if (source.charAt(index) != part.charAt(offset)) return -1;
            index++; offset++;
        }
        while (index < source.length() && space(source.charAt(index))) index++;
        return index;
    }

    /** Start offset of the first place at or after {@code cursor} where {@code part} matches, else -1. */
    static int startOf(String source, int cursor, String part) {
        if (source == null || part == null || part.isEmpty()) return -1;
        for (int at = Math.max(0, cursor); at <= source.length(); at++) {
            int end = matchAt(source, at, part);
            if (end >= 0) {
                while (at < source.length() && space(source.charAt(at))) at++;
                return at;
            }
        }
        return -1;
    }

    static boolean blank(String value) {
        if (value == null) return true;
        for (int i = 0; i < value.length(); i++) if (!space(value.charAt(i))) return false;
        return true;
    }

    /** Chinese label used when a provider omits one; same names the Shanbay capture shows. */
    static String labelFor(String type) {
        switch (type == null ? "" : type) {
            case "subj": return "主语";
            case "pred": return "谓语";
            case "obj": return "宾语";
            case "clause": return "从句";
            case "prep": return "介词短语";
            case "nonpred": return "非谓语";
            case "appos": return "同位语";
            case "coord": return "并列";
            default: return "其他";
        }
    }

    /** True when the text carries something a reader would notice (a letter or a digit). */
    static boolean hasWord(String value) {
        if (value == null) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isLetterOrDigit(c)) return true;
        }
        return false;
    }

    static boolean meaningfulLabel(String label) {
        if (label == null || label.trim().isEmpty()) return false;
        return !label.trim().matches("(?i)其他|其它|未知|未分析|未解析|未识别|待分析|未标注|标点(?:符号)?|分隔符|other|unknown|unanalysed|unanalyzed|punctuation");
    }
}

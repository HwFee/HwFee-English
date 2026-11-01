package com.hwfee.english;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;

/** Filesystem and protocol helpers for the local lesson server. */
final class LessonRequestSupport {
    private LessonRequestSupport() {}

    /** Resolves a decoded URL path beneath root, preserving literal plus and percent characters. */
    static File resolveLessonFile(File root, String relativePath) {
        if (root == null || relativePath == null || relativePath.isEmpty()) return null;
        try {
            File canonicalRoot = root.getCanonicalFile();
            File canonicalFile = new File(canonicalRoot, relativePath).getCanonicalFile();
            if (canonicalFile.isDirectory()) {
                canonicalFile = new File(canonicalFile, "player.html").getCanonicalFile();
            }
            String rootPath = canonicalRoot.getPath();
            String filePath = canonicalFile.getPath();
            if (!filePath.startsWith(rootPath + File.separator)) return null;
            return canonicalFile;
        } catch (IOException error) {
            return null;
        }
    }

    /** Escapes markup-significant less-than characters in JSON embedded in an HTML script node. */
    static String escapeJsonForHtmlScript(String json) {
        return json.replace("<", "\\u003c");
    }

    static boolean isMultiRange(String range) {
        return range != null && range.startsWith("bytes=")
                && range.substring("bytes=".length()).indexOf(',') >= 0;
    }

    /** Parses one bytes range into inclusive bounds, returning null when it is unsatisfiable. */
    static long[] parseRange(String range, long total) {
        if (range == null || !range.startsWith("bytes=") || total <= 0 || isMultiRange(range)) return null;
        try {
            String spec = range.substring("bytes=".length()).trim();
            int dash = spec.indexOf('-');
            if (dash < 0) return null;
            String head = spec.substring(0, dash).trim();
            String tail = spec.substring(dash + 1).trim();
            long start;
            long end;
            if (head.isEmpty()) {
                long suffix = Long.parseLong(tail);
                if (suffix <= 0) return null;
                start = Math.max(0, total - suffix);
                end = total - 1;
            } else {
                start = Long.parseLong(head);
                end = tail.isEmpty() ? total - 1 : Math.min(Long.parseLong(tail), total - 1);
            }
            if (start < 0 || start > end || start >= total) return null;
            return new long[]{start, end};
        } catch (NumberFormatException error) {
            return null;
        }
    }

    /** Bounded read over a RandomAccessFile for a single byte-range response. */
    static final class RangeStream extends InputStream {
        private final RandomAccessFile file;
        private long remaining;

        RangeStream(RandomAccessFile file, long length) {
            this.file = file;
            this.remaining = length;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int value = file.read();
            if (value >= 0) remaining--;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (buffer == null) throw new NullPointerException();
            if (offset < 0 || length < 0 || length > buffer.length - offset) {
                throw new IndexOutOfBoundsException();
            }
            if (length == 0) return 0;
            if (remaining <= 0) return -1;
            int read = file.read(buffer, offset, (int) Math.min(length, remaining));
            if (read > 0) remaining -= read;
            return read;
        }

        @Override
        public void close() throws IOException {
            file.close();
        }
    }
}

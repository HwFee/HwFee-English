package com.hwfee.english;

import android.content.Context;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Serves imported lessons on the app's own origin, so every lesson shares one localStorage.
 * The player seeks audio constantly for line-by-line playback, so byte ranges are honoured
 * here rather than left to a plain asset loader.
 */
public final class LessonServer {

    private LessonServer() {
    }

    public static WebResourceResponse serveLesson(LessonStore store, WebResourceRequest request) throws IOException {
        String rawPath = request.getUrl().getPath();
        if (rawPath == null) return notFound();
        String relative = URLDecoder.decode(rawPath.substring("/lessons/".length()), "UTF-8");
        if (relative.isEmpty() || relative.contains("..")) return notFound();

        File file = new File(store.root(), relative);
        if (file.isDirectory()) file = new File(file, "player.html");
        if (!file.isFile()) return notFound();

        String mime = mimeFor(file.getName());
        long total = file.length();
        String range = header(request.getRequestHeaders(), "Range");

        // The player page is the one file that gets help: the background-playback shim goes in on
        // the way out, so the lesson HTML on disk stays exactly as cherina-pod generated it.
        if (file.getName().equals("player.html")) {
            return servePlayerWithShim(file);
        }

        if (range != null && range.startsWith("bytes=") && total > 0) {
            long[] bounds = parseRange(range, total);
            if (bounds == null) {
                Map<String, String> headers = new LinkedHashMap<>();
                headers.put("Content-Range", "bytes */" + total);
                return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers,
                        new ByteArrayInputStream(new byte[0]));
            }
            long start = bounds[0];
            long end = bounds[1];
            long length = end - start + 1;
            RandomAccessFile raf = new RandomAccessFile(file, "r");
            raf.seek(start);
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", String.valueOf(length));
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime, null, 206, "Partial Content", headers, new RangeStream(raf, length));
        }

        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(total));
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, null, 200, "OK", headers, rangeStream(file));
    }

    /**
     * The library page is a build-time template: __DATA__ is replaced by the live lesson index
     * on every load, so the page's own code never has to change.
     */
    public static WebResourceResponse serveLibrary(Context context, LessonStore store) throws IOException {
        String html;
        try (InputStream in = context.getAssets().open("public/listen/library.html")) {
            html = new String(readAll(in), StandardCharsets.UTF_8);
        }
        String data = store.libraryData().toString();
        html = html.replace("__DATA__", data);

        // The vendored page tells the reader to run a Python command; here there is a button.
        if (data.contains("\"lessons\":[]")) {
            html = html.replaceAll("还没有课。运行 python3[^\"]*",
                    "还没有课。点右下角的导入按钮，选一个 cherina-pod 课程 zip。");
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Type", "text/html; charset=utf-8");
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    /** player.html plus the background-playback shim, injected on the way out. */
    private static WebResourceResponse servePlayerWithShim(File file) throws IOException {
        String html;
        try (InputStream in = new java.io.FileInputStream(file)) {
            html = new String(readAll(in), StandardCharsets.UTF_8);
        }
        if (!html.contains("player-shim.js")) {
            String tag = "<script src=\"/listen/player-shim.js\"></script>";
            int body = html.lastIndexOf("</body>");
            html = body >= 0
                    ? html.substring(0, body) + tag + html.substring(body)
                    : html + tag;
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Type", "text/html; charset=utf-8");
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    public static WebResourceResponse error(String mime, String message) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, "utf-8", 500, "Internal Error", headers,
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    public static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new LinkedHashMap<>(),
                new ByteArrayInputStream(new byte[0]));
    }

    // ---------------------------------------------------------------- helpers

    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return null;
    }

    /** Parses "bytes=start-end" (both open-ended forms included) into an inclusive pair. */
    private static long[] parseRange(String range, long total) {
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
            if (start > end || start >= total) return null;
            return new long[]{start, end};
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static InputStream rangeStream(File file) throws IOException {
        return new RangeStream(new RandomAccessFile(file, "r"), file.length());
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        return out.toByteArray();
    }

    private static String mimeFor(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** Bounded read over a RandomAccessFile: what WebView gets for a 206 response. */
    private static final class RangeStream extends InputStream {
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

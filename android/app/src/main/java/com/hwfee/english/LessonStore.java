package com.hwfee.english;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Owns imported lessons: extraction from a cherina-pod zip, the on-disk layout, and the
 * metadata the library page needs.
 *
 * Layout: filesDir/lessons/&lt;id&gt;/player.html + meta.json (+ audio/, handout.html, notes.md)
 *
 * Accepts both shapes cherina-pod ships:
 *  - folder form   cet4/&lt;slug&gt;/{player.html, audio/episode.mp4, ...}
 *  - single file   &lt;slug&gt;.html with the audio and lesson data inlined
 */
public class LessonStore {

    private static final String DATA_MARKER = "id=\"data\"";
    // Single-file lessons inline the audio as base64 inside the same JSON, so the payload can run
    // to several megabytes. The data URLs are stripped before parsing; only the rest is needed.
    private static final long META_SCAN_BYTES = 16L * 1024 * 1024;
    private static final int DATA_URL_MIN = 512;
    private static final String[] NOT_A_LESSON = {
            "index.html", "handout.html", "使用教程.html", "如何打开.html", "tutorial.html"
    };

    private static LessonStore instance;

    private final File root;

    private LessonStore(Context context) {
        root = new File(context.getFilesDir(), "lessons");
    }

    public static synchronized LessonStore get(Context context) {
        if (instance == null) {
            instance = new LessonStore(context.getApplicationContext());
            //noinspection ResultOfMethodCallIgnored
            instance.root.mkdirs();
        }
        return instance;
    }

    public File root() {
        return root;
    }

    /** Payload consumed by the cherina-pod index page, in exactly its own shape. */
    public JSONObject libraryData() {
        JSONArray lessons = new JSONArray();
        File[] entries = root.listFiles();
        List<File> ordered = new ArrayList<>();
        if (entries != null) ordered.addAll(Arrays.asList(entries));
        ordered.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (File dir : ordered) {
            File meta = new File(dir, "meta.json");
            if (!meta.isFile()) continue;
            try {
                lessons.put(new JSONObject(readText(meta, 1 << 20)));
            } catch (Exception ignored) {
                // a half-written import must not take the whole library down
            }
        }
        JSONObject data = new JSONObject();
        try {
            data.put("ui", "zh");
            data.put("lessons", lessons);
        } catch (Exception ignored) {
        }
        return data;
    }

    public static class Report {
        public final List<String> imported = new ArrayList<>();
        public final List<String> failed = new ArrayList<>();
    }

    public synchronized Report importZip(Uri uri, Context context) throws IOException {
        Report report = new Report();
        File staging = new File(root.getParentFile(), ".import-" + System.currentTimeMillis());
        try {
            unzip(uri, context, staging);
            collectLessons(staging, report);
        } finally {
            deleteTree(staging);
        }
        return report;
    }

    public boolean remove(String id) {
        if (id == null || id.isEmpty()) return false;
        return deleteTree(new File(root, id));
    }

    // ---------------------------------------------------------------- unzip

    private void unzip(Uri uri, Context context, File dest) throws IOException {
        InputStream raw = context.getContentResolver().openInputStream(uri);
        if (raw == null) throw new IOException("无法读取所选文件");
        String destPrefix = dest.getCanonicalPath() + File.separator;
        byte[] buffer = new byte[64 * 1024];
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(raw))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName().replace('\\', '/');
                if (name.startsWith("__MACOSX/")) continue;
                if (name.endsWith(".DS_Store")) continue;
                File out = new File(dest, name);
                if (!out.getCanonicalPath().startsWith(destPrefix)) continue; // zip-slip
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    throw new IOException("无法创建目录：" + parent.getName());
                }
                try (OutputStream os = new BufferedOutputStream(new FileOutputStream(out))) {
                    int read;
                    while ((read = zip.read(buffer)) > 0) os.write(buffer, 0, read);
                }
            }
        }
    }

    // ------------------------------------------------------- lesson discovery

    private void collectLessons(File staging, Report report) {
        List<File> players = new ArrayList<>();
        List<File> singles = new ArrayList<>();
        walk(staging, players, singles);

        for (File player : players) {
            File lessonDir = player.getParentFile();
            if (lessonDir == null) continue;
            try {
                adoptFolderLesson(lessonDir, staging, report);
            } catch (Exception error) {
                report.failed.add(lessonDir.getName() + "：" + error.getMessage());
            }
        }
        for (File single : singles) {
            try {
                adoptSingleFileLesson(single, staging, report);
            } catch (Exception error) {
                report.failed.add(single.getName() + "：" + error.getMessage());
            }
        }
    }

    private void walk(File dir, List<File> players, List<File> singles) {
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.isDirectory()) {
                walk(child, players, singles);
                continue;
            }
            String name = child.getName();
            if (name.equals("player.html")) {
                players.add(child);
            } else if (name.endsWith(".html") && !isNotALesson(name) && looksLikeLesson(child)) {
                singles.add(child);
            }
        }
    }

    private boolean isNotALesson(String name) {
        for (String skip : NOT_A_LESSON) if (skip.equals(name)) return true;
        return false;
    }

    /** Single-file lessons carry the inlined lesson payload near the top of the document. */
    private boolean looksLikeLesson(File file) {
        try {
            String head = readText(file, 64 * 1024);
            return head.contains(DATA_MARKER) && head.contains("application/json");
        } catch (IOException error) {
            return false;
        }
    }

    /**
     * The same episode ships twice (cet4/ and cet6/) with an identical id in its payload, so the
     * id has to come from the path, not from the lesson data. The level goes in the title instead.
     */
    private void adoptFolderLesson(File lessonDir, File staging, Report report) throws Exception {
        File player = new File(lessonDir, "player.html");
        JSONObject data = lessonData(player);
        String relative = staging.toPath().relativize(lessonDir.toPath()).toString().replace('\\', '/');
        String id = sanitize(relative.replace('/', '-'));
        File target = new File(root, id);
        deleteTree(target);
        if (!lessonDir.renameTo(target)) {
            copyTree(lessonDir, target);
            deleteTree(lessonDir);
        }
        writeMeta(new File(target, "meta.json"), id, data, levelLabel(relative));
        report.imported.add(id);
    }

    private void adoptSingleFileLesson(File file, File staging, Report report) throws Exception {
        String baseName = file.getName().substring(0, file.getName().length() - ".html".length());
        JSONObject data = lessonData(file);
        String relative = staging.toPath().relativize(file.toPath()).toString().replace('\\', '/');
        String id = sanitize(relative.replace('/', '-').replaceAll("\\.html$", ""));
        if (id.isEmpty()) id = sanitize(baseName);
        File target = new File(root, id);
        deleteTree(target);
        if (!target.mkdirs()) throw new IOException("无法创建课程目录");
        File player = new File(target, "player.html");
        if (!file.renameTo(player)) {
            copyFile(file, player);
        }
        writeMeta(new File(target, "meta.json"), id, data, levelLabel(relative));
        report.imported.add(id);
    }

    /** cet4/cet6 folders carry two versions of one lesson; the label tells them apart in the list. */
    private static String levelLabel(String relative) {
        for (String part : relative.split("/")) {
            String lower = part.toLowerCase();
            if (lower.equals("cet4")) return "四级";
            if (lower.equals("cet6")) return "六级";
            if (part.equals("四级")) return "四级";
            if (part.equals("六级")) return "六级";
        }
        return null;
    }

    private static String sanitize(String raw) {
        String safe = raw == null ? "" : raw.replaceAll("[^A-Za-z0-9._-]", "-");
        return safe.isEmpty() ? "lesson-" + System.currentTimeMillis() : safe;
    }

    // -------------------------------------------------------------- metadata

    /** Library entry: whatever cherina-pod's index page expects, nothing more. */
    private void writeMeta(File metaFile, String id, JSONObject data, String levelSuffix) throws Exception {
        JSONObject meta = new JSONObject();
        meta.put("id", id);
        meta.put("dir", "/lessons/" + id);
        String title = data == null ? id : data.optString("title", id);
        meta.put("title", levelSuffix == null ? title : title + " · " + levelSuffix);
        meta.put("podcast", data == null ? "" : data.optString("podcast", ""));
        meta.put("image", data == null ? "" : data.optString("image", ""));

        JSONArray segments = data == null ? null : data.optJSONArray("segments");
        meta.put("segments", segments == null ? 0 : segments.length());

        double duration = data == null ? 0 : data.optDouble("duration", 0);
        meta.put("duration", duration);

        double rateSum = 0;
        int rateCount = 0;
        if (segments != null) {
            for (int i = 0; i < segments.length(); i++) {
                JSONObject segment = segments.optJSONObject(i);
                if (segment == null) continue;
                double rate = segment.optDouble("rate", 0);
                if (rate > 0) {
                    rateSum += rate;
                    rateCount++;
                }
            }
        }
        meta.put("rate", rateCount == 0 ? 0 : Math.round(rateSum / rateCount));
        meta.put("rate_unit", "wpm");
        meta.put("importedAt", System.currentTimeMillis());

        try (OutputStream os = new FileOutputStream(metaFile)) {
            os.write(meta.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    private JSONObject lessonData(File playerHtml) {
        try {
            String head = readText(playerHtml, META_SCAN_BYTES);
            int script = head.indexOf("application/json");
            if (script < 0) return null;
            int open = head.indexOf('>', script);
            if (open < 0) return null;
            int close = head.indexOf("</script>", open);
            if (close < 0) return null;
            String payload = head.substring(open + 1, close).trim();
            // Drop inlined base64 blobs (data URLs) before parsing: they are the whole size.
            payload = payload.replaceAll("\"data:[^\"]{" + DATA_URL_MIN + ",}\"", "\"\"");
            return new JSONObject(payload);
        } catch (Exception error) {
            return null;
        }
    }

    // ------------------------------------------------------------------- io

    private static String readText(File file, long limit) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            long total = 0;
            int read;
            while (total < limit && (read = in.read(chunk)) > 0) {
                buffer.write(chunk, 0, read);
                total += read;
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void copyFile(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from);
             OutputStream out = new BufferedOutputStream(new FileOutputStream(to))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        }
    }

    private static void copyTree(File from, File to) throws IOException {
        if (from.isDirectory()) {
            if (!to.isDirectory() && !to.mkdirs()) throw new IOException("无法创建目录");
            File[] children = from.listFiles();
            if (children == null) return;
            for (File child : children) copyTree(child, new File(to, child.getName()));
        } else {
            File parent = to.getParentFile();
            if (parent != null) parent.mkdirs();
            copyFile(from, to);
        }
    }

    static boolean deleteTree(File file) {
        if (!file.exists()) return true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        return file.delete();
    }
}

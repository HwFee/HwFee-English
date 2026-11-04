package com.hwfee.english;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class LessonStoreTest {
    private Context context;
    private LessonStore store;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        store = LessonStore.get(context);
    }

    @After public void cleanup() {
        File[] lessons = store.root().listFiles();
        if (lessons != null) for (File lesson : lessons) store.remove(lesson.getName());
    }

    private String player(String title) throws Exception {
        JSONObject data = new JSONObject().put("id", "shared-payload-id").put("title", title)
                .put("duration", 515.178).put("segments", new JSONArray().put(new JSONObject().put("rate", 120)))
                .put("audio", "data:audio/mp4;base64," + "A".repeat(800));
        return "<html><script id=\"data\" type=\"application/json\">" + data + "</script><body></body></html>";
    }

    private String read(File file) throws Exception {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    private LessonStore.Report importFiles(String... entries) throws Exception {
        File archive = File.createTempFile("lesson-", ".zip", context.getCacheDir());
        try {
            try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(archive))) {
                for (int i = 0; i < entries.length; i += 2) {
                    zip.putNextEntry(new ZipEntry(entries[i]));
                    zip.write(entries[i + 1].getBytes(StandardCharsets.UTF_8));
                    zip.closeEntry();
                }
            }
            return store.importZip(Uri.fromFile(archive), context);
        } finally {
            archive.delete();
        }
    }

    @Test public void importsBothLevelsWithoutChangingPlayerBytes() throws Exception {
        String html = player("Original title");
        LessonStore.Report report = importFiles("cet4/slug/player.html", html,
                "cet4/slug/audio/track+clean.mp4", "audio bytes", "cet6/slug/player.html", html);
        assertEquals(2, report.imported.size());
        assertTrue(report.failed.isEmpty());
        assertTrue(report.imported.contains("cet4-slug"));
        assertTrue(report.imported.contains("cet6-slug"));
        assertEquals(html, read(new File(store.root(), "cet4-slug/player.html")));
        assertEquals("audio bytes", read(new File(store.root(), "cet4-slug/audio/track+clean.mp4")));
        JSONArray lessons = store.libraryData().getJSONArray("lessons");
        assertEquals(2, lessons.length());
        assertEquals(1, lessons.getJSONObject(0).getInt("segments"));
        assertTrue(lessons.toString().contains("四级"));
        assertTrue(lessons.toString().contains("六级"));
    }

    @Test public void importsSingleFilesWithDotNamesWithoutDeletingAppData() throws Exception {
        File sentinel = new File(context.getFilesDir(), "sentinel.txt");
        Files.write(sentinel.toPath(), "keep app data".getBytes(StandardCharsets.UTF_8));
        LessonStore.Report report = importFiles("solo.html", player("Solo"),
                "..html", player("Dot"), "...html", player("Parent"));
        assertEquals(3, report.imported.size());
        assertTrue(report.failed.toString(), report.failed.isEmpty());
        assertTrue(report.imported.contains("solo"));
        for (String id : report.imported) {
            assertNotEquals(".", id);
            assertNotEquals("..", id);
            assertTrue(new File(store.root(), id + "/meta.json").isFile());
        }
        assertEquals("keep app data", read(sentinel));
        assertTrue(sentinel.delete());
    }

    @Test public void malformedReplacementLeavesExistingLessonIntact() throws Exception {
        String original = player("Working lesson");
        importFiles("cet4/kept/player.html", original);
        LessonStore.Report failed = importFiles("cet4/kept/player.html", "broken HTML without lesson data");
        assertTrue(failed.imported.isEmpty());
        assertEquals(1, failed.failed.size());
        assertEquals(original, read(new File(store.root(), "cet4-kept/player.html")));
        LessonStore.Report replaced = importFiles("cet4/kept/player.html", player("Replacement"));
        assertEquals(1, replaced.imported.size());
        assertEquals("Replacement · 四级", store.libraryData().getJSONArray("lessons").getJSONObject(0).getString("title"));
    }

    @Test public void serveLibraryInjectsFixesOnceAndLeavesAssetUntouched() throws Exception {
        String template = "<html><head><title>x</title></head><body>__DATA__</body></html>";
        String html = LessonServer.injectLibraryFixes(template);
        assertEquals(1, html.split("hwfee-library-fixes", -1).length - 1);
        assertTrue(html.contains(".cover>*{grid-area:1/1}"));
        assertTrue(html.contains("font-size:0!important"));
        assertEquals("<html><head><title>x</title></head><body>__DATA__</body></html>", template);
        File asset = new File("src/main/assets/public/listen/library.html");
        assertTrue(asset.isFile());
        String onDisk = new String(Files.readAllBytes(asset.toPath()), StandardCharsets.UTF_8);
        assertFalse(onDisk.contains("hwfee-library-fixes"));
        assertTrue(onDisk.contains("__DATA__"));
    }

    @Test public void relativeZipCoverResolvesInsideItsOwnImportedLesson() throws Exception {
        String html = player("Offline cover").replace("\"audio\":", "\"image\":\"images/cover.jpg\",\"audio\":");
        LessonStore.Report report = importFiles("cet6/offline/player.html", html,
                "cet6/offline/images/cover.jpg", "image fixture");
        assertEquals(1, report.imported.size());
        JSONObject lesson = store.libraryData().getJSONArray("lessons").getJSONObject(0);
        assertEquals("/lessons/cet6-offline/images/cover.jpg", lesson.getString("image"));
        assertEquals(html, read(new File(store.root(), "cet6-offline/player.html")));
    }

    @Test public void unifiedPackReplacesByStableIdAndHidesEarlierVariantsWithoutDeletingTheirFiles() throws Exception {
        String original = player("Lesson");
        importFiles("cet4/episode/player.html", original, "cet6/episode/player.html", original);
        String unified = original.replace("\"id\":\"shared-payload-id\"", "\"id\":\"episode\"");
        JSONObject course = new JSONObject().put("schema", 2).put("id", "episode");
        // The payload field order must not affect recognition of the stable course id.
        unified = unified.replace("\"title\":", "\"hwfeeCourse\":" + course + ",\"title\":");
        LessonStore.Report report = importFiles("unified/episode/player.html", unified);
        assertTrue(report.failed.toString(), report.failed.isEmpty());
        assertEquals("episode", report.imported.get(0));
        JSONArray library = store.libraryData().getJSONArray("lessons");
        assertEquals(1, library.length());
        assertEquals("Lesson", library.getJSONObject(0).getString("title"));
        assertEquals(2, library.getJSONObject(0).getJSONArray("legacyIds").length());
        assertEquals(original, read(new File(store.root(), "cet6-episode/player.html")));
        assertEquals(original, read(new File(store.root(), "cet4-episode/player.html")));
        report = importFiles("different-wrapper/episode/player.html", unified.replace("Lesson", "Revised"));
        assertEquals("episode", report.imported.get(0));
        assertEquals(1, store.libraryData().getJSONArray("lessons").length());
        assertEquals("Revised", store.libraryData().getJSONArray("lessons").getJSONObject(0).getString("title"));
    }

    @Test public void malformedCanonicalIdCannotReplaceAnotherCourse() throws Exception {
        String html = player("Invalid").replace("\"title\":", "\"hwfeeCourse\":{\"schema\":2,\"id\":\"../other\"},\"title\":");
        LessonStore.Report report = importFiles("unified/bad/player.html", html);
        assertTrue(report.imported.isEmpty());
        assertEquals(1, report.failed.size());
    }
}

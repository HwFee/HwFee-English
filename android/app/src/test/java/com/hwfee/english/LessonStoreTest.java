package com.hwfee.english;

import android.content.Context;
import android.net.Uri;

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
}

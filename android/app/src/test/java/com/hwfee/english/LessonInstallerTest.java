package com.hwfee.english;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class LessonInstallerTest {
    @Rule public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test public void publishesNewAndReplacementLessonsWithoutTouchingSibling() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File sibling = lesson(root, "sibling", "sibling-old");
        LessonInstaller installer = new LessonInstaller(root);

        File first = prepared("new-content");
        installer.install(first, "new-lesson");
        assertBytes(new File(root, "new-lesson/player.html"), "new-content");
        assertTrue(new File(root, "new-lesson/meta.json").isFile());
        assertBytes(new File(sibling, "player.html"), "sibling-old");

        lesson(root, "replace-me", "old-content");
        File replacement = prepared("replacement-content");
        installer.install(replacement, "replace-me");
        assertBytes(new File(root, "replace-me/player.html"), "replacement-content");
        assertBytes(new File(sibling, "player.html"), "sibling-old");
        assertTrue(new File(root, "sibling").isDirectory());
        assertFalse(new File(temporaryFolder.getRoot(), ".lesson-backups/replace-me").exists());
    }

    @Test public void incompleteOrInvalidIdInputPreservesExistingLesson() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        lesson(root, "kept", "original");
        LessonInstaller installer = new LessonInstaller(root);

        File incomplete = temporaryFolder.newFolder("incomplete");
        write(new File(incomplete, "player.html"), "new-but-incomplete");
        assertIOException(() -> installer.install(incomplete, "kept"));
        assertBytes(new File(root, "kept/player.html"), "original");

        File complete = prepared("unsafe-id");
        assertIOException(() -> installer.install(complete, "../kept"));
        assertBytes(new File(root, "kept/player.html"), "original");
    }

    @Test public void failedPublishAfterMovingTargetRollsOldLessonBack() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File target = lesson(root, "lesson", "old-content");
        File prepared = new File(target, "prepared");
        populateLesson(prepared, "new-content");

        assertIOException(() -> new LessonInstaller(root).install(prepared, "lesson"));

        assertBytes(new File(target, "player.html"), "old-content");
        assertTrue(new File(target, "meta.json").isFile());
        assertFalse(new File(temporaryFolder.getRoot(), ".lesson-backups/lesson").exists());
    }

    @Test public void startupRecoveryRestoresAbsentTargetAndCleansBackupBesideCompleteTarget() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File backups = new File(temporaryFolder.getRoot(), ".lesson-backups");
        assertTrue(backups.mkdir());
        File restore = lesson(backups, "restore-me", "restored-content");
        File completeTarget = lesson(root, "already-published", "new-complete-content");
        File staleBackup = lesson(backups, "already-published", "old-backup-content");

        new LessonInstaller(root).recover();

        assertBytes(new File(root, "restore-me/player.html"), "restored-content");
        assertFalse(restore.exists());
        assertBytes(new File(completeTarget, "player.html"), "new-complete-content");
        assertFalse(staleBackup.exists());
    }

    private File prepared(String playerContent) throws IOException {
        File dir = temporaryFolder.newFolder("prepared-" + System.nanoTime());
        populateLesson(dir, playerContent);
        return dir;
    }

    private static File lesson(File parent, String id, String playerContent) throws IOException {
        File dir = new File(parent, id);
        assertTrue("create " + dir, dir.mkdirs());
        populateLesson(dir, playerContent);
        return dir;
    }

    private static void populateLesson(File dir, String playerContent) throws IOException {
        assertTrue(dir.isDirectory() || dir.mkdirs());
        write(new File(dir, "player.html"), playerContent);
        write(new File(dir, "meta.json"), "{}");
    }

    private static void write(File file, String value) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.isDirectory()) assertTrue(parent.mkdirs());
        Files.write(file.toPath(), value.getBytes(StandardCharsets.UTF_8));
    }

    private static void assertBytes(File file, String expected) throws IOException {
        assertArrayEquals(expected.getBytes(StandardCharsets.UTF_8), Files.readAllBytes(file.toPath()));
    }

    private static void assertIOException(ThrowingRunnable action) throws Exception {
        try {
            action.run();
            fail("Expected IOException");
        } catch (IOException expected) {
            // expected
        }
    }

    private interface ThrowingRunnable { void run() throws Exception; }
}

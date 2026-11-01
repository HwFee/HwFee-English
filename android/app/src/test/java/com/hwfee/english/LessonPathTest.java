package com.hwfee.english;

import org.junit.Rule;
import org.junit.Test;
import org.junit.Assume;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class LessonPathTest {
    @Rule public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test public void acceptsSanitizedDirectLessonIds() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        for (String id : new String[]{"cet4-lesson_01", "lesson.with.dots", "slug--level"}) {
            assertEquals(new File(root, id).getCanonicalFile(), LessonPath.directLessonDirectory(root, id));
        }
    }

    @Test public void rejectsInvalidIdsAndSeparators() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        for (String id : new String[]{null, "", ".", "..", "../outside", "a/b", "a\\b", "/tmp/other", "bad id"}) {
            assertNull("id=" + id, LessonPath.directLessonDirectory(root, id));
        }
    }

    @Test public void rejectsSymlinksThatEscapeOrRedirectWithinRoot() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File outside = temporaryFolder.newFolder("outside");
        createSymlinkOrSkip(new File(root, "escape").toPath(), outside.toPath());
        assertNull(LessonPath.directLessonDirectory(root, "escape"));

        File actualLesson = new File(root, "actual");
        assertTrue(actualLesson.mkdir());
        createSymlinkOrSkip(new File(root, "alias").toPath(), actualLesson.toPath());
        assertNull(LessonPath.directLessonDirectory(root, "alias"));
    }

    @Test public void deletesRegularLessonTree() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File lesson = new File(root, "lesson");
        assertTrue(lesson.mkdir());
        assertTrue(new File(lesson, "player.html").createNewFile());

        assertTrue(LessonPath.deleteLessonTree(lesson));
        assertTrue(!lesson.exists());
    }

    @Test public void deletesNestedSymlinkWithoutDeletingTarget() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File lesson = new File(root, "lesson");
        File nested = new File(lesson, "audio");
        assertTrue(nested.mkdirs());
        File outside = temporaryFolder.newFolder("outside");
        File sentinel = new File(outside, "keep.txt");
        assertTrue(sentinel.createNewFile());
        createSymlinkOrSkip(new File(nested, "redirect").toPath(), outside.toPath());

        assertTrue(LessonPath.deleteLessonTree(lesson));
        assertTrue(!lesson.exists());
        assertTrue(sentinel.isFile());
    }

    private static void createSymlinkOrSkip(Path link, Path target) throws IOException {
        try {
            Files.createSymbolicLink(link, target);
        } catch (IOException | UnsupportedOperationException | SecurityException error) {
            Assume.assumeNoException("Symbolic links unavailable on this host", error);
        }
    }
}

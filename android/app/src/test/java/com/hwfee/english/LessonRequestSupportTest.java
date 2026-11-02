package com.hwfee.english;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.file.Files;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class LessonRequestSupportTest {
    @Rule public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test public void resolvesDecodedPathsAndPreservesPlusAndPercentNames() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File lesson = new File(root, "lesson..id");
        assertTrue(lesson.mkdir());
        File asset = new File(lesson, "track+100%.mp4");
        assertTrue(asset.createNewFile());

        assertEquals(asset.getCanonicalFile(), LessonRequestSupport.resolveLessonFile(
                root, "lesson..id/track+100%.mp4"));
        assertNull(LessonRequestSupport.resolveLessonFile(root, "../outside"));
        assertNull(LessonRequestSupport.resolveLessonFile(root, ""));
    }

    @Test public void rejectsCanonicalPathsThatEscapeThroughSymlinks() throws Exception {
        File root = temporaryFolder.newFolder("lessons");
        File outside = temporaryFolder.newFolder("outside");
        SymlinkSupport.createOrSkip(new File(root, "linked").toPath(), outside.toPath());
        assertNull(LessonRequestSupport.resolveLessonFile(root, "linked/secret.txt"));
        File realLesson = new File(root, "real-lesson");
        assertTrue(realLesson.mkdir());
        assertTrue(new File(outside, "secret.html").createNewFile());
        SymlinkSupport.createOrSkip(new File(realLesson, "player.html").toPath(),
                new File(outside, "secret.html").toPath());
        assertNull(LessonRequestSupport.resolveLessonFile(root, "real-lesson"));
    }

    @Test public void escapesLessThanBeforeEmbeddingJsonInScript() {
        String escaped = LessonRequestSupport.escapeJsonForHtmlScript(
                "{\"title\":\"</script><script>alert(1)</script>\"}");
        assertEquals("{\"title\":\"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>\"}", escaped);
        assertFalse(escaped.contains("<"));
    }

    @Test public void parsesSingleRangesAndRejectsUnsatisfiableOrMultipleRanges() {
        assertArrayEquals(new long[]{0, 3}, LessonRequestSupport.parseRange("bytes=0-3", 10));
        assertArrayEquals(new long[]{6, 9}, LessonRequestSupport.parseRange("bytes=-4", 10));
        assertArrayEquals(new long[]{0, 9}, LessonRequestSupport.parseRange("bytes=-40", 10));
        assertNull(LessonRequestSupport.parseRange("bytes=10-11", 10));
        assertNull(LessonRequestSupport.parseRange("bytes=--1", 10));
        assertTrue(LessonRequestSupport.isMultiRange("bytes=0-0,1-1"));
        assertNull(LessonRequestSupport.parseRange("bytes=0-0,1-1", 10));
    }

    @Test public void rangeStreamReturnsZeroForZeroLengthReadsEvenAtEnd() throws Exception {
        File file = temporaryFolder.newFile("range.bin");
        Files.write(file.toPath(), new byte[]{1});
        try (LessonRequestSupport.RangeStream stream = new LessonRequestSupport.RangeStream(
                new RandomAccessFile(file, "r"), 0)) {
            assertEquals(0, stream.read(new byte[0], 0, 0));
            assertEquals(-1, stream.read(new byte[1], 0, 1));
        }
    }
}

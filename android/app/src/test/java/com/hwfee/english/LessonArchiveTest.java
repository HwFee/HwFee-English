package com.hwfee.english;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class LessonArchiveTest {
    @Rule public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test public void extractsFolderAndSingleFileLessonBytesExactly() throws Exception {
        byte[] player = "<html>原样 player</html>".getBytes(StandardCharsets.UTF_8);
        byte[] audio = new byte[]{0, 1, 2, (byte) 0xff, 10};
        byte[] standalone = "single-file lesson".getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream archive = zip(
                "cet4/slug/player.html", player,
                "cet4/slug/audio/episode.mp4", audio,
                "single.html", standalone);
        File output = temporaryFolder.newFolder("extracted");

        LessonArchive.extract(new ByteArrayInputStream(archive.toByteArray()), output, 1024);

        assertArrayEquals(player, Files.readAllBytes(new File(output, "cet4/slug/player.html").toPath()));
        assertArrayEquals(audio, Files.readAllBytes(new File(output, "cet4/slug/audio/episode.mp4").toPath()));
        assertArrayEquals(standalone, Files.readAllBytes(new File(output, "single.html").toPath()));
    }

    @Test public void rejectsForwardAndBackslashTraversal() throws Exception {
        for (String name : new String[]{"../escape.txt", "..\\escape.txt"}) {
            File output = temporaryFolder.newFolder("out" + Math.abs(name.hashCode()));
            assertIOException(() -> LessonArchive.extract(
                    new ByteArrayInputStream(zip(name, bytes("escape")).toByteArray()), output, 1024));
            assertFalse(new File(temporaryFolder.getRoot(), "escape.txt").exists());
        }
    }

    @Test public void acceptsRootDirectoryEntryAndCountsDirectoryPayload() throws Exception {
        File output = temporaryFolder.newFolder("root-dir");
        LessonArchive.extract(new ByteArrayInputStream(zip("./", new byte[0], "./player.html", bytes("player")).toByteArray()),
                output, 1024);
        assertArrayEquals(bytes("player"), Files.readAllBytes(new File(output, "player.html").toPath()));
        assertIOException(() -> LessonArchive.extract(
                new ByteArrayInputStream(zip("directory/", new byte[100]).toByteArray()), output, 10));
    }

    @Test public void enforcesBudgetForEntryWithUnknownZipSize() throws Exception {
        ByteArrayOutputStream archive = zip("payload.bin", new byte[100]);
        try (ZipInputStream input = new ZipInputStream(new ByteArrayInputStream(archive.toByteArray()))) {
            assertTrue("deflated ZIP entry should have unknown size before extraction", input.getNextEntry().getSize() < 0);
        }

        File output = temporaryFolder.newFolder("budget");
        assertIOException(() -> LessonArchive.extract(
                new ByteArrayInputStream(archive.toByteArray()), output, 10));
    }

    @Test public void skipsMacMetadataButChargesItsBytesToBudget() throws Exception {
        ByteArrayOutputStream archive = zip(
                "__MACOSX/._lesson", bytes("12345"),
                "lesson/.DS_Store", bytes("67890"),
                "lesson/player.html", bytes("x"));
        File output = temporaryFolder.newFolder("mac-metadata");

        assertIOException(() -> LessonArchive.extract(new ByteArrayInputStream(archive.toByteArray()), output, 10));
        assertFalse(new File(output, "__MACOSX/._lesson").exists());
        assertFalse(new File(output, "lesson/.DS_Store").exists());
    }

    @Test public void rejectsInvalidZipAndEmptyZip() throws Exception {
        File invalidOutput = temporaryFolder.newFolder("invalid");
        assertIOException(() -> LessonArchive.extract(
                new ByteArrayInputStream(bytes("not a zip")), invalidOutput, 1024));

        ByteArrayOutputStream empty = new ByteArrayOutputStream();
        try (ZipOutputStream ignored = new ZipOutputStream(empty)) { }
        File emptyOutput = temporaryFolder.newFolder("empty");
        assertIOException(() -> LessonArchive.extract(
                new ByteArrayInputStream(empty.toByteArray()), emptyOutput, 1024));
    }

    private static ByteArrayOutputStream zip(Object... entries) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream output = new ZipOutputStream(bytes)) {
            for (int i = 0; i < entries.length; i += 2) {
                output.putNextEntry(new ZipEntry((String) entries[i]));
                output.write((byte[]) entries[i + 1]);
                output.closeEntry();
            }
        }
        return bytes;
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
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

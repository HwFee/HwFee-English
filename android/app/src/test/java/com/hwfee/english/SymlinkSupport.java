package com.hwfee.english;

import org.junit.Assume;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Symbolic links are a two-part capability when exercising them from tests.
 *
 * On Windows without Developer Mode the link cannot be created at all. With it, the link is
 * created but {@code java.io} canonicalisation still reports the link path rather than its target —
 * and the lesson guards compare canonical paths, so a test that expects the link to be resolved
 * would fail against correct code. Android resolves links (libcore realpath) exactly like Linux,
 * so the guards are meaningful there; these helpers keep the tests honest on other hosts instead
 * of silently asserting nothing.
 */
final class SymlinkSupport {
    private SymlinkSupport() {}

    static void createOrSkip(Path link, Path target) throws IOException {
        try {
            Files.createSymbolicLink(link, target);
        } catch (IOException | UnsupportedOperationException | SecurityException error) {
            Assume.assumeNoException("Symbolic links unavailable on this host", error);
            return;
        }
        File asFile = link.toFile();
        try {
            if (asFile.getCanonicalFile().equals(asFile.getAbsoluteFile())) {
                Assume.assumeTrue("Symbolic links are created but not resolved on this host", false);
            }
        } catch (IOException error) {
            Assume.assumeNoException("Symbolic links are created but not resolved on this host", error);
        }
    }
}

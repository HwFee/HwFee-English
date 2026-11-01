package com.hwfee.english;

import java.io.File;
import java.io.IOException;

/** Pure filesystem validation for lesson IDs used by operations that remove a lesson. */
final class LessonPath {
    private LessonPath() {}

    /**
     * Returns the direct lesson child for a safe ID, or {@code null} when the ID or path is
     * invalid. Imported IDs are sanitized to this alphabet by LessonStore.
     */
    static File directLessonDirectory(File root, String id) {
        if (root == null || id == null || id.isEmpty()
                || id.equals(".") || id.equals("..")
                || !id.matches("[A-Za-z0-9._-]+")) {
            return null;
        }
        try {
            File canonicalRoot = root.getCanonicalFile();
            File expected = new File(canonicalRoot, id);
            File canonicalTarget = expected.getCanonicalFile();
            // Also rejects symlinked lesson entries, including links to another path inside root.
            if (!canonicalTarget.equals(expected) || !canonicalRoot.equals(canonicalTarget.getParentFile())) {
                return null;
            }
            return canonicalTarget;
        } catch (IOException error) {
            return null;
        }
    }

    /** Deletes links as entries instead of following them into content outside the lesson. */
    static boolean deleteLessonTree(File file) {
        try {
            // This also detects symlinks when they point to an existing path. Delete the link
            // itself, never the target. If canonicalization fails, fail closed.
            if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) return file.delete();
        } catch (IOException error) {
            return false;
        }
        if (!file.exists()) return file.delete();
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) return false;
            boolean deleted = true;
            for (File child : children) deleted &= deleteLessonTree(child);
            if (!deleted) return false;
        }
        return file.delete();
    }
}

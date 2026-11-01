package com.hwfee.english;

import java.io.File;
import java.io.IOException;

/** Publishes complete staged lessons, retaining the previous version until a replacement succeeds. */
final class LessonInstaller {
    private final File root;
    private final File backups;

    LessonInstaller(File root) throws IOException {
        this.root = root.getCanonicalFile();
        this.backups = new File(this.root.getParentFile(), ".lesson-backups");
    }

    void recover() throws IOException {
        File[] entries = backups.listFiles();
        if (entries == null) return;
        for (File backup : entries) {
            File target = LessonPath.directLessonDirectory(root, backup.getName());
            if (target == null || !backup.isDirectory()) continue;
            if (target.exists()) {
                if (!LessonPath.deleteLessonTree(backup)) throw new IOException("无法清理旧课程备份");
            } else if (!backup.renameTo(target)) {
                throw new IOException("无法恢复中断导入的课程");
            }
        }
    }

    void install(File prepared, String id) throws IOException {
        File target = LessonPath.directLessonDirectory(root, id);
        if (target == null || !prepared.isDirectory()) throw new IOException("课程目录无效");
        if (!new File(prepared, "player.html").isFile() || !new File(prepared, "meta.json").isFile()) {
            throw new IOException("课程文件不完整");
        }
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("无法创建课程库");
        if (!backups.isDirectory() && !backups.mkdirs()) throw new IOException("无法创建课程备份目录");
        File backup = new File(backups, id);
        if (backup.exists()) throw new IOException("旧课程备份尚未恢复，请重试导入");
        boolean replacing = target.exists();
        if (replacing && (!target.isDirectory() || !target.renameTo(backup))) {
            throw new IOException("无法备份已有课程，原课程已保留");
        }
        if (!prepared.renameTo(target)) {
            if (replacing && !backup.renameTo(target)) {
                throw new IOException("导入中断，原课程已保留在备份中，将在下次启动时恢复");
            }
            throw new IOException("无法保存新课程，原课程已保留");
        }
        // A failed cleanup leaves a recoverable backup; the new lesson is already complete.
        if (replacing) LessonPath.deleteLessonTree(backup);
    }
}

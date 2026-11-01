package com.hwfee.english;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Streaming extraction with a disk budget, including entries whose ZIP sizes are unknown. */
final class LessonArchive {
    static final long MAX_BYTES = 2L * 1024 * 1024 * 1024;
    static final long MAX_ENTRY_BYTES = 512L * 1024 * 1024;
    static final long RESERVED_BYTES = 32L * 1024 * 1024;
    private static final int MAX_ENTRIES = 20000;
    private static final int MAX_DEPTH = 32;

    private LessonArchive() {}

    static void extract(InputStream raw, File dest, long byteBudget) throws IOException {
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(raw))) {
            if (byteBudget <= 0) throw new IOException("存储空间不足，请清理后重试");
            if (!dest.isDirectory() && !dest.mkdirs()) throw new IOException("无法创建导入目录");
            File canonicalDest = dest.getCanonicalFile();
            String prefix = canonicalDest.getPath() + File.separator;
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int count = 0;
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++count > MAX_ENTRIES) throw new IOException("压缩包内文件过多");
                String name = entry.getName().replace('\\', '/');
                if (name.startsWith("/") || name.matches("^[A-Za-z]:.*")
                        || name.split("/", -1).length > MAX_DEPTH) {
                    throw new IOException("压缩包内路径无效或过深");
                }
                File out = new File(dest, name).getCanonicalFile();
                if (!out.getPath().startsWith(prefix) && !(entry.isDirectory() && out.equals(canonicalDest))) {
                    throw new IOException("压缩包内包含越界路径");
                }
                boolean skip = entry.isDirectory() || name.startsWith("__MACOSX/") || name.endsWith(".DS_Store");
                if (entry.isDirectory()) {
                    if (!out.isDirectory() && !out.mkdirs()) throw new IOException("无法创建课程目录");
                }
                long remaining = Math.min(byteBudget, MAX_BYTES) - total;
                if (entry.getSize() > Math.min(MAX_ENTRY_BYTES, remaining)) {
                    throw new IOException("课程文件过大或存储空间不足");
                }
                if (!skip) {
                    File parent = out.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("无法创建课程目录");
                    }
                }
                try (OutputStream os = skip ? null : new BufferedOutputStream(new FileOutputStream(out))) {
                    long entryBytes = 0;
                    int read;
                    while ((read = zip.read(buffer)) != -1) {
                        entryBytes += read;
                        total += read;
                        if (entryBytes > MAX_ENTRY_BYTES || total > Math.min(byteBudget, MAX_BYTES)) {
                            throw new IOException("课程文件过大或存储空间不足");
                        }
                        if (os != null) os.write(buffer, 0, read);
                    }
                }
            }
            if (count == 0) throw new IOException("压缩包为空或不是有效的 ZIP 文件");
        }
    }
}

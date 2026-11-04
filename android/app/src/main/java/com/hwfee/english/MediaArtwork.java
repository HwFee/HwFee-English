package com.hwfee.english;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/** Bounded album-art loading, with a small disk cache for offline playback. */
final class MediaArtwork {
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private static final int MAX_EDGE = 512;

    static Bitmap load(Context context, String source) throws Exception {
        if (source == null || source.isEmpty()) return null;
        Uri uri = Uri.parse(source);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null) return null;
        if ("localhost".equalsIgnoreCase(uri.getHost())) {
            String path = uri.getPath();
            if (path == null || !path.startsWith("/lessons/")) return null;
            File file = LessonRequestSupport.resolveLessonFile(new File(context.getFilesDir(), "lessons"),
                    path.substring("/lessons/".length()));
            if (file == null || !file.isFile() || file.length() > MAX_BYTES) return null;
            try (InputStream in = new FileInputStream(file)) { return decode(read(in)); }
        }
        File cache = new File(context.getCacheDir(), "media-artwork");
        if (!cache.isDirectory()) cache.mkdirs();
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (byte b : digest) key.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        File cached = new File(cache, key + ".jpg");
        if (cached.isFile()) {
            try (InputStream in = new FileInputStream(cached)) {
                Bitmap image = decode(read(in));
                if (image != null) return image;
            }
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setInstanceFollowRedirects(false);
        Bitmap image;
        try {
            if (connection.getResponseCode() != 200 || connection.getContentLength() > MAX_BYTES) return null;
            try (InputStream in = connection.getInputStream()) { image = decode(read(in)); }
        } finally { connection.disconnect(); }
        if (image != null) {
            try (FileOutputStream out = new FileOutputStream(cached)) {
                image.compress(Bitmap.CompressFormat.JPEG, 90, out);
            } catch (Exception ignored) { /* The session can use the decoded image without caching. */ }
            File[] entries = cache.listFiles();
            if (entries != null && entries.length > 32) {
                Arrays.sort(entries, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
                for (int i = 0; i < entries.length - 32; i++) entries[i].delete();
            }
        }
        return image;
    }

    private static byte[] read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int size;
        while ((size = in.read(buffer)) >= 0) {
            if (out.size() + size > MAX_BYTES) return new byte[0];
            out.write(buffer, 0, size);
        }
        return out.toByteArray();
    }

    private static Bitmap decode(byte[] bytes) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0) return null;
        options.inJustDecodeBounds = false;
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > MAX_EDGE) options.inSampleSize *= 2;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }
}

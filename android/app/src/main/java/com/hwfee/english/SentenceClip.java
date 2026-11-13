package com.hwfee.english;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.SystemClock;
import android.os.Build;
import java.io.File;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/** Decode a sentence to a bounded cache file; no following samples reach the player. */
final class SentenceClip {
    private static final long CACHE_BYTES = 48L * 1024 * 1024;
    private SentenceClip() {}

    static File create(File cache, File source, long startMillis, long endMillis) throws Exception {
        if (startMillis < 0 || endMillis <= startMillis || endMillis - startMillis > 10 * 60 * 1000)
            throw new IOException("句子音频范围无效");
        File directory = new File(cache, "sentence-audio-v1");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建句子音频缓存");
        String identity = source.getCanonicalPath() + ":" + source.length() + ":" + source.lastModified()
                + ":" + startMillis + ":" + endMillis;
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(identity.getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder();
        for (byte b : digest) key.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        File clip = new File(directory, key + ".wav");
        if (clip.length() > 44) {
            touch(clip);
            return clip;
        }
        File pending = File.createTempFile("decode-", ".tmp", directory);
        try {
            decode(source, pending, startMillis * 1000, endMillis * 1000);
            checkCancelled();
            if (!pending.renameTo(clip)) throw new IOException("无法保存句子音频");
            prune(directory, clip);
            return clip;
        } finally {
            if (pending.exists() && !pending.delete()) pending.deleteOnExit();
        }
    }

    private static void decode(File source, File target, long startUs, long endUs) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        PcmSentence pcm = null;
        try {
            extractor.setDataSource(source.getAbsolutePath());
            MediaFormat inputFormat = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat candidate = extractor.getTrackFormat(i);
                if (candidate.getString(MediaFormat.KEY_MIME).startsWith("audio/")) {
                    inputFormat = candidate; extractor.selectTrack(i); break;
                }
            }
            if (inputFormat == null) throw new IOException("课程没有音轨");
            // Decode a little preceding context so a compressed frame at the start is complete.
            extractor.seekTo(Math.max(0, startUs - 250_000), MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
            int sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            boolean raw = "audio/raw".equals(inputFormat.getString(MediaFormat.KEY_MIME));
            if (raw) {
                pcm = new PcmSentence(target, sampleRate, channels, startUs, endUs);
                ByteBuffer buffer = ByteBuffer.allocate(256 * 1024);
                while (extractor.getSampleTime() >= 0 && extractor.getSampleTime() < endUs) {
                    checkCancelled();
                    buffer.clear();
                    int size = extractor.readSampleData(buffer, 0);
                    if (size < 0) break;
                    buffer.position(0).limit(size);
                    pcm.append(buffer, extractor.getSampleTime());
                    extractor.advance();
                }
            } else {
                codec = MediaCodec.createDecoderByType(inputFormat.getString(MediaFormat.KEY_MIME));
                // PCM 16 bit is the mandatory default; reject a different negotiated format below.
                if (Build.VERSION.SDK_INT >= 24)
                    inputFormat.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
                codec.configure(inputFormat, null, null, 0);
                codec.start();
                boolean inputEnded = false, outputEnded = false;
                long deadline = SystemClock.elapsedRealtime() + 30_000;
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                while (!outputEnded) {
                    checkCancelled();
                    if (SystemClock.elapsedRealtime() > deadline) throw new IOException("句子音频解码超时");
                    boolean queued = false;
                    while (!inputEnded) {
                        int index = codec.dequeueInputBuffer(0);
                        if (index < 0) break;
                        ByteBuffer buffer = codec.getInputBuffer(index);
                        long time = extractor.getSampleTime();
                        int size = time < 0 || time >= endUs ? -1 : extractor.readSampleData(buffer, 0);
                        if (size < 0) {
                            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        } else {
                            codec.queueInputBuffer(index, 0, size, time, 0);
                            extractor.advance();
                        }
                        queued = true;
                    }
                    // Feed every available input buffer before waiting. Waiting after
                    // each AAC packet can turn a short sentence into seconds of setup.
                    int index = codec.dequeueOutputBuffer(info, queued ? 0 : 10_000);
                    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        MediaFormat format = codec.getOutputFormat();
                        if (Build.VERSION.SDK_INT >= 24 && format.containsKey(MediaFormat.KEY_PCM_ENCODING)
                                && format.getInteger(MediaFormat.KEY_PCM_ENCODING) != AudioFormat.ENCODING_PCM_16BIT)
                            throw new IOException("不支持的句子音频格式");
                        if (pcm != null) throw new IOException("句子音频格式发生变化");
                        pcm = new PcmSentence(target, format.getInteger(MediaFormat.KEY_SAMPLE_RATE),
                                format.getInteger(MediaFormat.KEY_CHANNEL_COUNT), startUs, endUs);
                    } else if (index >= 0) {
                        try {
                            if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                                if (pcm == null) throw new IOException("句子音频格式缺失");
                                ByteBuffer buffer = codec.getOutputBuffer(index);
                                buffer.position(info.offset).limit(info.offset + info.size);
                                pcm.append(buffer, info.presentationTimeUs);
                            }
                            outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                                    || info.presentationTimeUs >= endUs;
                        } finally { codec.releaseOutputBuffer(index, false); }
                    }
                }
            }
            if (pcm == null || pcm.frames() == 0) throw new IOException("句子音频为空");
        } finally {
            try { if (pcm != null) pcm.close(); }
            finally {
                try { if (codec != null) codec.release(); }
                finally { extractor.release(); }
            }
        }
    }

    private static void checkCancelled() throws InterruptedIOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("课程已切换");
    }

    @SuppressWarnings("ResultOfMethodCallIgnored")
    private static void touch(File clip) { clip.setLastModified(System.currentTimeMillis()); }

    @SuppressWarnings("ResultOfMethodCallIgnored")
    private static void prune(File directory, File keep) {
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".wav"));
        if (files == null) return;
        Arrays.sort(files, (left, right) -> Long.compare(left.lastModified(), right.lastModified()));
        long bytes = 0;
        for (File file : files) bytes += file.length();
        for (File file : files) {
            if (bytes <= CACHE_BYTES) break;
            if (!file.equals(keep)) { long length = file.length(); if (file.delete()) bytes -= length; }
        }
    }
}

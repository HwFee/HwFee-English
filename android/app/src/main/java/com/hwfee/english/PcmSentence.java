package com.hwfee.english;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/** A WAV containing only complete PCM frames inside [startUs, endUs). */
final class PcmSentence implements Closeable {
    private final RandomAccessFile output;
    private final int sampleRate, channels, frameBytes;
    private final long startUs, endUs;
    private long bytes;

    PcmSentence(File file, int sampleRate, int channels, long startUs, long endUs) throws IOException {
        if (sampleRate <= 0 || channels < 1 || channels > 8 || startUs < 0 || endUs <= startUs)
            throw new IOException("句子音频范围无效");
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.frameBytes = channels * 2;
        this.startUs = startUs;
        this.endUs = endUs;
        output = new RandomAccessFile(file, "rw");
        output.setLength(0);
        output.write(new byte[44]);
    }

    void append(ByteBuffer pcm, long presentationUs) throws IOException {
        int frames = pcm.remaining() / frameBytes;
        long first = Math.max(0, ceilFrames(startUs - presentationUs));
        long last = Math.min(frames, Math.floorDiv((endUs - presentationUs) * sampleRate, 1_000_000));
        if (last <= first) return;
        ByteBuffer selected = pcm.duplicate();
        selected.position(pcm.position() + (int) first * frameBytes);
        selected.limit(pcm.position() + (int) last * frameBytes);
        byte[] block = new byte[Math.min(16 * 1024, selected.remaining())];
        while (selected.hasRemaining()) {
            int count = Math.min(block.length, selected.remaining());
            selected.get(block, 0, count);
            output.write(block, 0, count);
            bytes += count;
        }
    }

    private long ceilFrames(long micros) {
        return -Math.floorDiv(-micros * sampleRate, 1_000_000);
    }

    long frames() { return bytes / frameBytes; }

    @Override public void close() throws IOException {
        try {
            ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
            header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt((int) bytes + 36);
            header.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16);
            header.putShort((short) 1).putShort((short) channels).putInt(sampleRate);
            header.putInt(sampleRate * frameBytes).putShort((short) frameBytes).putShort((short) 16);
            header.put("data".getBytes(StandardCharsets.US_ASCII)).putInt((int) bytes);
            output.seek(0);
            output.write(header.array());
        } finally { output.close(); }
    }
}

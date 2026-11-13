package com.hwfee.english;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class PcmSentenceTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private static ByteBuffer frames(int from, int to, int channels) {
        ByteBuffer buffer = ByteBuffer.allocate((to - from) * channels * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (int frame = from; frame < to; frame++)
            for (int channel = 0; channel < channels; channel++) buffer.putShort((short) (frame * 10 + channel));
        buffer.flip();
        return buffer;
    }

    private static ByteBuffer data(File file, int rate, int channels, int frames) throws Exception {
        ByteBuffer wav = ByteBuffer.wrap(Files.readAllBytes(file.toPath())).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(44 + frames * channels * 2, wav.remaining());
        assertEquals(channels, wav.getShort(22));
        assertEquals(rate, wav.getInt(24));
        assertEquals(frames * channels * 2, wav.getInt(40));
        wav.position(44);
        return wav.slice().order(ByteOrder.LITTLE_ENDIAN);
    }

    @Test public void aDecodedPacketStraddlingTheEndCannotIncludeTheFollowingSentence() throws Exception {
        File clip = temporary.newFile();
        try (PcmSentence pcm = new PcmSentence(clip, 1000, 2, 10_000, 20_000)) {
            ByteBuffer packet = frames(0, 30, 2);
            pcm.append(packet, 0);
            assertEquals(0, packet.position());
            assertEquals(10, pcm.frames());
        }
        ByteBuffer audio = data(clip, 1000, 2, 10);
        for (int i = 10; i < 20; i++) {
            assertEquals(i * 10, audio.getShort());
            assertEquals(i * 10 + 1, audio.getShort());
        }
        assertFalse(audio.hasRemaining());
    }

    @Test public void clippingAcrossPacketsKeepsTheNextSentenceStartAndAllInteriorFrames() throws Exception {
        File clip = temporary.newFile();
        try (PcmSentence pcm = new PcmSentence(clip, 1000, 1, 5_000, 15_000)) {
            pcm.append(frames(0, 10, 1), 0);
            pcm.append(frames(10, 20, 1), 10_000);
            pcm.append(frames(20, 30, 1), 20_000);
        }
        ByteBuffer audio = data(clip, 1000, 1, 10);
        for (int i = 5; i < 15; i++) assertEquals(i * 10, audio.getShort());
    }

    @Test public void nonAlignedTimestampsNeverAddAFramePastTheEnd() throws Exception {
        File clip = temporary.newFile();
        try (PcmSentence pcm = new PcmSentence(clip, 48000, 1, 1_020, 2_010)) {
            ByteBuffer packet = frames(0, 200, 1);
            packet.position(4); // Codec output buffers can have a nonzero byte offset.
            pcm.append(packet, 0);
        }
        ByteBuffer audio = data(clip, 48000, 1, 47);
        for (int i = 51; i < 98; i++) assertEquals(i * 10, audio.getShort());
    }
}

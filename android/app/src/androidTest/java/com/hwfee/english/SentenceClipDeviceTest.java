package com.hwfee.english;

import android.content.Context;
import android.media.MediaPlayer;
import android.os.SystemClock;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Android codecs, not a mocked MediaPlayer position or a clamped UI checkpoint. */
@RunWith(AndroidJUnit4.class)
public class SentenceClipDeviceTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    private File source() throws Exception {
        File source = new File(context.getCacheDir(), "sentence-test-tones.m4a");
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets()
                .open("sentence-tones.m4a"); FileOutputStream output = new FileOutputStream(source)) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
        }
        return source;
    }

    private byte[] read(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    private void assertRange(File clip, long millis, double frequency) throws Exception {
        byte[] bytes = read(clip);
        ByteBuffer wav = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int rate = wav.getInt(24), channels = wav.getShort(22), size = wav.getInt(40);
        assertEquals(48000, rate); assertEquals(1, channels); assertEquals(size + 44, bytes.length);
        long frames = size / 2;
        assertTrue("PCM must end within two frames of the requested boundary: " + frames,
                Math.abs(frames - millis * rate / 1000.0) <= 2);
        double wanted = 0, other = 0;
        double otherFrequency = frequency == 440 ? 1760 : 440;
        for (int i = 1000; i < 6000; i++) {
            double sample = wav.getShort(44 + i * 2);
            wanted += sample * Math.sin(2 * Math.PI * frequency * i / rate);
            other += sample * Math.sin(2 * Math.PI * otherFrequency * i / rate);
        }
        // The codec may shift sine phase slightly; compare spectral magnitude below instead.
        double cosineWanted = 0, cosineOther = 0;
        for (int i = 1000; i < 6000; i++) {
            double sample = wav.getShort(44 + i * 2);
            cosineWanted += sample * Math.cos(2 * Math.PI * frequency * i / rate);
            cosineOther += sample * Math.cos(2 * Math.PI * otherFrequency * i / rate);
        }
        assertTrue("clip must contain the selected sentence's tone",
                Math.hypot(wanted, cosineWanted) > 10 * Math.hypot(other, cosineOther));
    }

    @Test public void aacPacketsAreTrimmedToPcmFramesAndTheFollowingStartIsPreserved() throws Exception {
        File source = source(); byte[] before = read(source);
        long started = SystemClock.elapsedRealtime();
        File first = SentenceClip.create(context.getCacheDir(), source, 150, 973);
        long firstMillis = SystemClock.elapsedRealtime() - started;
        File next = SentenceClip.create(context.getCacheDir(), source, 1023, 1600);
        assertRange(first, 823, 440);
        assertRange(next, 577, 1760);
        assertArrayEquals(before, read(source));
        assertEquals(first, SentenceClip.create(context.getCacheDir(), source, 150, 973));
        Log.i("SentenceClipTest", "AAC clip " + firstMillis + " ms; PCM bytes " + first.length() + ", " + next.length());
    }

    @Test public void theBoundedFileReachesNativeCompletionWithoutAPauseTimer() throws Exception {
        File clip = SentenceClip.create(context.getCacheDir(), source(), 150, 973);
        CountDownLatch ended = new CountDownLatch(1);
        AtomicReference<String> error = new AtomicReference<>();
        AtomicReference<MediaPlayer> decoder = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            MediaPlayer player = new MediaPlayer(); decoder.set(player);
            try {
                player.setDataSource(clip.getAbsolutePath());
                player.setOnPreparedListener(MediaPlayer::start);
                player.setOnCompletionListener(ready -> ended.countDown());
                player.setOnErrorListener((failed, what, extra) -> {
                    error.set(what + "/" + extra); ended.countDown(); return true;
                });
                player.prepareAsync();
            } catch (Exception failure) { error.set(failure.toString()); ended.countDown(); }
        });
        try {
            assertTrue("native playback did not complete", ended.await(5, TimeUnit.SECONDS));
            assertNull(error.get());
        } finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> decoder.get().release()); }
    }
}

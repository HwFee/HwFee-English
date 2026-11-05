package com.hwfee.english;

import android.content.Context;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.MediaTimestamp;
import android.media.PlaybackParams;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class NativeAudioResumeTest {
    private NativeAudioEngine engine;
    private Decoder decoder;

    private static final class Preparation extends PluginCall {
        final CountDownLatch done = new CountDownLatch(1);
        JSObject result;
        Preparation() { super(null, "Audio", "test", "nativePrepare", new JSObject()); }
        @Override public void resolve(JSObject data) { result = data; done.countDown(); }
    }

    private static final class Decoder extends MediaPlayer {
        volatile int starts, pauses, speedChanges;
        volatile long seekPosition = -1;
        volatile MediaTimestamp timestamp;
        volatile int timestampReads;
        volatile boolean blockStart;
        final CountDownLatch entered = new CountDownLatch(1), unblock = new CountDownLatch(1);
        private void workerOnly() { assertNotSame("decoder work must not block the UI", Looper.getMainLooper(), Looper.myLooper()); }
        @Override public void start() {
            workerOnly(); starts++; entered.countDown();
            if (blockStart) try { assertTrue(unblock.await(3, TimeUnit.SECONDS)); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new AssertionError(error); }
        }
        @Override public void pause() { workerOnly(); pauses++; }
        @Override public void seekTo(long position, int mode) { workerOnly(); seekPosition = position; }
        @Override public void release() { workerOnly(); }
        @Override public int getCurrentPosition() { workerOnly(); return 42000; }
        @Override public MediaTimestamp getTimestamp() { workerOnly(); timestampReads++; return timestamp; }
        @Override public void setPlaybackParams(PlaybackParams params) { workerOnly(); speedChanges++; }
        @Override public boolean isPlaying() { workerOnly(); return starts > pauses; }
    }

    private void drain() throws Exception {
        CountDownLatch drained = new CountDownLatch(1); engine.execute(drained::countDown);
        assertTrue("audio queue did not finish", drained.await(3, TimeUnit.SECONDS));
    }

    @Before public void preparePausedDecoder() throws Exception {
        Context app = RuntimeEnvironment.getApplication();
        shadowOf((AudioManager) app.getSystemService(Context.AUDIO_SERVICE))
                .setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        engine = ReflectionHelpers.callConstructor(NativeAudioEngine.class, ReflectionHelpers.ClassParameter.from(Context.class, app));
        engine.execute(() -> {
            decoder = new Decoder();
            ReflectionHelpers.setField(engine, "player", decoder);
            ReflectionHelpers.setField(engine, "prepared", true);
            ReflectionHelpers.setField(engine, "source", "imported-course");
            ReflectionHelpers.setField(engine, "sourceId", "current-document");
            ReflectionHelpers.setField(engine, "position", 42000L);
            ReflectionHelpers.setField(engine, "duration", 120000L);
        });
        drain();
    }

    @After public void release() throws Exception {
        if (decoder != null) decoder.unblock.countDown();
        if (engine == null) return;
        engine.execute(() -> ReflectionHelpers.callInstanceMethod(engine, "releaseDecoder")); drain();
        ((Handler) ReflectionHelpers.getField(engine, "handler")).getLooper().quitSafely();
        shadowOf(Looper.getMainLooper()).idle();
    }

    @Test public void aColdResumeDoesNotBlockTheUiOrStateQueries() throws Exception {
        decoder.blockStart = true;
        engine.play();
        assertTrue(decoder.entered.await(3, TimeUnit.SECONDS));
        JSObject state = engine.snapshot();
        assertEquals(42, state.optDouble("position"), 0);
        assertTrue(state.optBoolean("prepared"));
        engine.pause(); // Queues without waiting for the blocked codec.
        decoder.unblock.countDown(); drain();
        assertFalse(engine.playing()); assertEquals(1, decoder.pauses);
    }

    @Test public void resumingAtTheSameSpeedDoesNotReconfigureTheDecoder() throws Exception {
        engine.play(); drain(); engine.pause(); drain(); engine.play(); drain();
        assertEquals(2, decoder.starts); assertEquals(0, decoder.speedChanges);
        engine.pause(); drain(); engine.rate(1.25); drain(); engine.play(); drain();
        assertEquals(1, decoder.speedChanges);
        engine.pause(); drain(); engine.play(); drain(); assertEquals(1, decoder.speedChanges);
        assertEquals(42, engine.snapshot().optDouble("position"), 0);
    }

    @Test public void pauseCancelsADelayedServicePlayAndAnOldPauseCannotCancelANewerPlay() throws Exception {
        long oldPlay = engine.reserveTransport(); engine.pause(); drain();
        engine.playRequest(oldPlay, "current-document", null); drain(); assertEquals(0, decoder.starts);
        long oldPause = engine.reserveTransport(), latestPlay = engine.reserveTransport();
        engine.pauseRequest(oldPause);
        engine.playRequest(latestPlay, "current-document", new JSObject().put("start", 30).put("end", 60).put("loop", false));
        drain(); assertTrue(engine.playing()); assertEquals(1, decoder.starts);
        assertEquals(30000L, (long) ReflectionHelpers.getField(engine, "rangeStart"));
        assertEquals(60000L, (long) ReflectionHelpers.getField(engine, "rangeEnd"));
    }

    @Test public void obsoleteDocumentsCannotStartTheCurrentDecoderAndReuseRemainsVisibleInEverySnapshot() throws Exception {
        engine.playRequest(engine.reserveTransport(), "previous-document", null); drain(); assertEquals(0, decoder.starts);
        engine.play(); drain(); shadowOf(Looper.getMainLooper()).idle();
        AtomicReference<JSObject> delivered = new AtomicReference<>(); engine.pageListener = delivered::set;
        Preparation preparation = new Preparation();
        engine.prepare(new JSObject().put("source", "imported-course").put("sourceId", "new-document"), preparation);
        assertTrue(preparation.done.await(3, TimeUnit.SECONDS)); drain(); shadowOf(Looper.getMainLooper()).idle();
        assertTrue(preparation.result.optBoolean("reused")); assertTrue(preparation.result.optBoolean("playing"));
        assertEquals(42, preparation.result.optDouble("position"), 0);
        assertTrue(delivered.get().optBoolean("reused"));
        assertSame(decoder, ReflectionHelpers.getField(engine, "player"));
    }

    @Test public void aUserPauseWinsOverAPendingAudioFocusResume() throws Exception {
        AudioManager.OnAudioFocusChangeListener focus = ReflectionHelpers.getField(engine, "focus");
        engine.play(); drain(); focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT); drain();
        assertFalse(engine.playing());
        CountDownLatch held = new CountDownLatch(1), release = new CountDownLatch(1);
        engine.execute(() -> {
            held.countDown();
            try { assertTrue(release.await(3, TimeUnit.SECONDS)); }
            catch (InterruptedException error) { throw new AssertionError(error); }
        });
        assertTrue(held.await(3, TimeUnit.SECONDS));
        try { focus.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN); engine.pause(); }
        finally { release.countDown(); }
        drain(); assertFalse(engine.playing()); assertEquals(1, decoder.starts);
    }

    @Test public void changingSentenceSilencesTheOldAudioUntilTheAsyncSeekCompletes() throws Exception {
        engine.play(); drain();
        engine.seek(60); drain();
        assertEquals(1, decoder.pauses);
        assertFalse(engine.playing());
        assertTrue(engine.snapshot().optBoolean("seeking"));
        assertTrue((boolean) ReflectionHelpers.getField(engine, "wanted"));
        assertEquals(60000, decoder.seekPosition);
        engine.pause(); drain();
        assertFalse((boolean) ReflectionHelpers.getField(engine, "wanted"));
    }

    @Test public void loopingPausesBeforeSeekingBackAndRetainsActualBoundaryOverrun() throws Exception {
        engine.range(30, 41.9, true); drain();
        engine.play(); drain();
        engine.execute(() -> ((Runnable) ReflectionHelpers.getField(engine, "ticker")).run()); drain();
        assertFalse(engine.playing());
        assertEquals(1, decoder.pauses);
        assertEquals(30000, decoder.seekPosition);
        assertEquals(42, engine.snapshot().optDouble("boundaryPosition"), 0);
        assertEquals(100, engine.snapshot().optLong("boundaryOvershootMs"));
    }

    @Test public void aNormalSentenceStopDoesNotHideAReportedLateBoundary() throws Exception {
        engine.range(30, 41.9, false); drain();
        // Drive one sample deterministically; play() would also enqueue a ticker.
        engine.execute(() -> {
            ReflectionHelpers.setField(engine, "running", true);
            ReflectionHelpers.setField(engine, "wanted", true);
            ((Runnable) ReflectionHelpers.getField(engine, "ticker")).run();
        }); drain();
        JSObject state = engine.snapshot();
        assertFalse(engine.playing());
        assertEquals(1, decoder.pauses);
        assertEquals(42, state.optDouble("boundaryPosition"), 0);
        assertEquals(100, state.optLong("boundaryOvershootMs"));
        assertEquals(41.89, state.optDouble("position"), .001); // Legacy UI checkpoint is separate.
    }

    @Test public void secondStageStopsFromThePresentationClockWhenCoarseProgressLags() throws Exception {
        engine.range(30, 42.04, false, true); drain();
        engine.execute(() -> {
            decoder.timestamp = SentenceClockTest.timestamp(42_050_000L, System.nanoTime(), 1f);
            ReflectionHelpers.setField(engine, "running", true);
            ReflectionHelpers.setField(engine, "wanted", true);
            ((Runnable) ReflectionHelpers.getField(engine, "ticker")).run();
        }); drain();
        assertFalse(engine.playing());
        assertEquals(1, decoder.pauses);
        assertEquals(1, decoder.timestampReads);
        assertTrue(engine.snapshot().optDouble("boundaryPosition") >= 42.05);
    }

    @Test public void continuousStagesDoNotUseTheDrillClock() throws Exception {
        engine.range(30, 60, false, false); drain();
        engine.play(); drain();
        assertTrue(engine.playing());
        assertEquals(0, decoder.timestampReads);
    }

    @Test public void normalOpeningAfterReviewStopsTheReusedDecoderSoMetadataCanRestoreTheCheckpoint() throws Exception {
        engine.play(); drain();
        Preparation preparation = new Preparation();
        engine.prepare(new JSObject().put("source", "imported-course").put("sourceId", "normal-document")
                .put("restoreCheckpoint", true), preparation);
        assertTrue(preparation.done.await(3, TimeUnit.SECONDS)); drain();
        assertFalse(preparation.result.optBoolean("playing"));
        assertTrue(preparation.result.optBoolean("reused"));
        assertFalse((boolean) ReflectionHelpers.getField(engine, "wanted"));
        assertEquals(1, decoder.pauses);
    }
}

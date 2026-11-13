package com.hwfee.english;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
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
public class NativeSentencePlaybackTest {
    private NativeAudioEngine engine;
    private final List<Decoder> decoders = new ArrayList<>();
    private CountDownLatch unblock;
    private Handler audioHandler;

    private final class Decoder extends MediaPlayer {
        OnPreparedListener prepared;
        OnSeekCompleteListener seeked;
        OnCompletionListener completed;
        String file;
        int starts, pauses, at;
        boolean looping;
        @Override public void setAudioAttributes(AudioAttributes attributes) {}
        @Override public void setWakeMode(Context context, int mode) {}
        @Override public void setDataSource(String path) { file = path; }
        @Override public void setLooping(boolean loop) { looping = loop; }
        @Override public void setOnPreparedListener(OnPreparedListener listener) { prepared = listener; }
        @Override public void setOnSeekCompleteListener(OnSeekCompleteListener listener) { seeked = listener; }
        @Override public void setOnCompletionListener(OnCompletionListener listener) { completed = listener; }
        @Override public void setOnErrorListener(OnErrorListener listener) {}
        @Override public void prepareAsync() { audioHandler.post(() -> prepared.onPrepared(this)); }
        @Override public void start() { starts++; }
        @Override public void pause() { pauses++; }
        @Override public void release() {}
        @Override public void setPlaybackParams(PlaybackParams params) {}
        @Override public int getDuration() { return file.endsWith(".wav") ? 1000 : 120000; }
        @Override public int getCurrentPosition() { return at; }
        @Override public void seekTo(long position, int mode) {
            at = (int) position;
            audioHandler.post(() -> seeked.onSeekComplete(this));
        }
    }

    private void drain() throws Exception {
        for (int i = 0; i < 3; i++) {
            CountDownLatch drained = new CountDownLatch(1);
            engine.execute(drained::countDown);
            assertTrue(drained.await(3, TimeUnit.SECONDS));
        }
    }

    private void finishClip() throws Exception {
        ExecutorService worker = ReflectionHelpers.getField(engine, "clipWorker");
        worker.submit(() -> {}).get(3, TimeUnit.SECONDS);
        drain();
    }

    private void playRange(double start, double end, boolean drill, boolean loop) throws Exception {
        engine.playRequest(engine.reserveTransport(), "current", new JSObject().put("start", start)
                .put("end", end).put("drill", drill).put("loop", loop));
        drain();
    }

    @Before public void prepare() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        shadowOf((AudioManager) context.getSystemService(Context.AUDIO_SERVICE))
                .setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        engine = ReflectionHelpers.callConstructor(NativeAudioEngine.class,
                ReflectionHelpers.ClassParameter.from(Context.class, context));
        audioHandler = ReflectionHelpers.getField(engine, "handler");
        ReflectionHelpers.setField(engine, "source", "course");
        ReflectionHelpers.setField(engine, "sourceId", "current");
        ReflectionHelpers.setField(engine, "sourceFile", new File(context.getCacheDir(), "course.m4a"));
        ReflectionHelpers.setField(engine, "duration", 120000L);
        ReflectionHelpers.setField(engine, "prepared", true);
        ReflectionHelpers.setField(engine, "decoderFactory", (NativeAudioEngine.DecoderFactory) () -> {
            Decoder decoder = new Decoder(); decoders.add(decoder); return decoder;
        });
        ReflectionHelpers.setField(engine, "clipFactory", (NativeAudioEngine.ClipFactory) (cache, file, start, end) ->
                new File(cache, start + "-" + end + ".wav"));
        engine.execute(() -> ReflectionHelpers.callInstanceMethod(engine, "openDecoder",
                ReflectionHelpers.ClassParameter.from(File.class, new File(context.getCacheDir(), "course.m4a"))));
        drain();
    }

    @After public void release() throws Exception {
        if (unblock != null) unblock.countDown();
        if (engine == null) return;
        engine.execute(() -> ReflectionHelpers.callInstanceMethod(engine, "releaseDecoder"));
        drain();
        ((ExecutorService) ReflectionHelpers.getField(engine, "clipWorker")).shutdownNow();
        audioHandler.getLooper().quitSafely();
        shadowOf(Looper.getMainLooper()).idle();
    }

    @Test public void drillPlaysOnlyTheBoundedSourceAndCompletionKeepsTheLessonTimeline() throws Exception {
        playRange(30, 31, true, false); finishClip();
        Decoder clip = decoders.get(decoders.size() - 1);
        assertTrue(clip.file.endsWith("30000-31000.wav"));
        assertEquals(0, decoders.get(0).starts);
        assertEquals(1, clip.starts);
        assertTrue(engine.snapshot().optBoolean("bounded"));
        assertEquals(120, engine.snapshot().optDouble("duration"), 0);
        assertEquals(30, engine.snapshot().optDouble("position"), 0);
        List<JSObject> delivered = new ArrayList<>(); engine.pageListener = delivered::add;
        engine.execute(() -> clip.completed.onCompletion(clip)); drain();
        shadowOf(Looper.getMainLooper()).idle();
        assertFalse(engine.playing());
        assertFalse(engine.snapshot().optBoolean("ended"));
        assertEquals(31, engine.snapshot().optDouble("position"), 0);
        assertEquals(0, engine.snapshot().optLong("boundaryOvershootMs"));
        assertTrue(delivered.stream().anyMatch(state -> "boundary".equals(state.optString("event"))));
        assertEquals("the clip ends without a timed pause call", 0, clip.pauses);
    }

    @Test public void pauseDuringClipPreparationCannotStartTheDecoderLater() throws Exception {
        CountDownLatch entered = new CountDownLatch(1); unblock = new CountDownLatch(1);
        ReflectionHelpers.setField(engine, "clipFactory", (NativeAudioEngine.ClipFactory) (cache, file, start, end) -> {
            entered.countDown(); assertTrue(unblock.await(3, TimeUnit.SECONDS)); return new File(cache, "clip.wav");
        });
        playRange(30, 31, true, false);
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        engine.pause(); drain();
        unblock.countDown(); finishClip();
        assertFalse(engine.playing());
        assertEquals(0, decoders.get(decoders.size() - 1).starts);
    }

    @Test public void aSupersededSentenceCannotStartAfterTheNextSentenceIsSelected() throws Exception {
        CountDownLatch entered = new CountDownLatch(1); unblock = new CountDownLatch(1);
        ReflectionHelpers.setField(engine, "clipFactory", (NativeAudioEngine.ClipFactory) (cache, file, start, end) -> {
            if (start == 30000) { entered.countDown(); unblock.await(3, TimeUnit.SECONDS); }
            return new File(cache, start + "-" + end + ".wav");
        });
        playRange(30, 31, true, false);
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        engine.seek(31); drain();
        playRange(31, 32, true, false); finishClip();
        assertEquals(2, decoders.size());
        assertTrue(decoders.get(1).file.endsWith("31000-32000.wav"));
        assertEquals(1, decoders.get(1).starts);
        assertEquals("", engine.snapshot().optString("error"));
    }

    @Test public void failedSentencePreparationCannotFallBackToUnboundedPlayback() throws Exception {
        ReflectionHelpers.setField(engine, "clipFactory", (NativeAudioEngine.ClipFactory) (cache, file, start, end) -> {
            throw new java.io.IOException("test decode failure");
        });
        playRange(30, 31, true, false); finishClip();
        assertFalse(engine.playing());
        assertEquals(0, decoders.get(0).starts);
        assertTrue(engine.snapshot().optString("error").contains("test decode failure"));
    }

    @Test public void movingToTheNextSentenceKeepsItsOriginalStartAndResumingKeepsItsOffset() throws Exception {
        playRange(30, 31, true, false); finishClip();
        engine.seek(30.4); drain(); engine.pause(); drain();
        assertEquals(30.4, engine.snapshot().optDouble("position"), .001);
        playRange(30, 31, true, false); finishClip();
        assertEquals(2, decoders.size());
        assertEquals(400, decoders.get(1).at);
        engine.seek(31); drain();
        playRange(31, 32, true, false); finishClip();
        Decoder next = decoders.get(decoders.size() - 1);
        assertTrue(next.file.endsWith("31000-32000.wav"));
        assertEquals(31, engine.snapshot().optDouble("position"), 0);
        assertEquals(0, next.at);
        assertTrue(engine.playing());
    }

    @Test public void continuousPlaybackRestoresTheWholeSourceAtTheSameLessonTime() throws Exception {
        playRange(30, 31, true, false); finishClip();
        engine.seek(30.4); drain();
        engine.range(30, 60, false, false); drain();
        Decoder continuous = decoders.get(decoders.size() - 1);
        assertTrue(continuous.file.endsWith("course.m4a"));
        assertFalse(engine.snapshot().optBoolean("bounded"));
        assertEquals(30400, continuous.at);
        assertTrue(engine.playing());
    }

    @Test public void sleepReplacesADrillLoopWithTheWholeLessonAtTheSameSecond() throws Exception {
        ReflectionHelpers.setField(engine, "continuousLesson", true);
        playRange(30, 31, true, true); finishClip();
        Decoder clip = decoders.get(decoders.size() - 1); clip.at = 400;
        engine.setSleep(900); drain();
        Decoder whole = decoders.get(decoders.size() - 1);
        assertTrue(whole.file.endsWith("course.m4a"));
        assertEquals(30400, whole.at);
        assertFalse(whole.looping);
        assertFalse(engine.snapshot().optBoolean("bounded"));
        assertTrue(engine.snapshot().optBoolean("sleepContinuous"));
        assertEquals(900, engine.snapshot().optInt("sleepSeconds"));
        engine.execute(() -> clip.completed.onCompletion(clip)); drain();
        assertTrue("late clip completion cannot stop the whole lesson", engine.playing());
        whole.at = 65000;
        engine.execute(() -> ((Runnable) ReflectionHelpers.getField(engine, "ticker")).run()); drain();
        assertTrue("old sentence and segment ends are ignored", engine.playing());
        assertEquals(0, whole.pauses);
    }

    @Test public void choosingSleepFromAnAutomaticPauseStartsOnceAndManualPauseStillWins() throws Exception {
        ReflectionHelpers.setField(engine, "continuousLesson", true);
        playRange(30, 31, true, false); finishClip();
        Decoder clip = decoders.get(decoders.size() - 1);
        engine.execute(() -> clip.completed.onCompletion(clip)); drain();
        assertFalse(engine.playing());
        engine.setSleep(900); drain();
        assertTrue(engine.playing());
        Decoder whole = decoders.get(decoders.size() - 1);
        engine.pause(); drain();
        int starts = whole.starts;
        engine.range(31, 32, true, true); drain();
        engine.execute(() -> ((Runnable) ReflectionHelpers.getField(engine, "ticker")).run()); drain();
        assertFalse(engine.playing());
        assertEquals(starts, whole.starts);
        assertEquals(900, engine.snapshot().optInt("sleepSeconds"));
        engine.setSleep(1800); drain();
        assertFalse("editing the timer cannot override a manual pause", engine.playing());
        assertEquals(starts, whole.starts);
        assertEquals(1800, engine.snapshot().optInt("sleepSeconds"));
        playRange(31, 32, true, true); drain();
        assertTrue(engine.playing());
        assertSame(whole, decoders.get(decoders.size() - 1));
        assertFalse(whole.looping);
    }

    @Test public void expiryStopsOnceAndAUserCanResumeNormalBoundedPracticeAfterwards() throws Exception {
        ReflectionHelpers.setField(engine, "continuousLesson", true);
        engine.setSleep(900); drain();
        Decoder whole = decoders.get(decoders.size() - 1);
        assertTrue(engine.playing());
        engine.finishSleep(); drain();
        assertFalse(engine.playing());
        assertEquals(0, engine.snapshot().optInt("sleepSeconds"));
        assertFalse(engine.snapshot().optBoolean("sleepContinuous"));
        assertEquals(1, whole.pauses);
        engine.seek(30.4); drain();
        playRange(30, 31, true, false); finishClip();
        Decoder clip = decoders.get(decoders.size() - 1);
        assertTrue(clip.file.endsWith("30000-31000.wav"));
        assertEquals(400, clip.at);
        assertTrue(engine.playing());
        engine.finishSleep(); drain();
        assertTrue("the expired timer cannot repeatedly pause a later play", engine.playing());
        assertEquals(0, clip.pauses);
    }

    @Test public void libraryBookmarkClipsKeepTheirBoundsEvenWithASleepTimer() throws Exception {
        // Only the full player sends continuousLesson=true; bookmark/review clips do not.
        playRange(30, 31, true, false); finishClip();
        Decoder clip = decoders.get(decoders.size() - 1);
        engine.setSleep(900); drain();
        assertSame(clip, decoders.get(decoders.size() - 1));
        assertTrue(engine.snapshot().optBoolean("bounded"));
        assertFalse(engine.snapshot().optBoolean("sleepContinuous"));
        assertEquals(900, engine.snapshot().optInt("sleepSeconds"));
        engine.execute(() -> clip.completed.onCompletion(clip)); drain();
        assertFalse(engine.playing());
        assertEquals(31, engine.snapshot().optDouble("position"), 0);
    }

    @Test public void manualPauseDuringSleepDecoderPreparationCannotAutoResumeLater() throws Exception {
        ReflectionHelpers.setField(engine, "continuousLesson", true);
        playRange(30, 31, true, false); finishClip();
        engine.setSleep(900); engine.pause(); drain();
        assertFalse(engine.playing());
        assertEquals(900, engine.snapshot().optInt("sleepSeconds"));
    }

    @Test public void cancellingAQueuedSleepEntryCannotStartItLater() throws Exception {
        ReflectionHelpers.setField(engine, "continuousLesson", true);
        CountDownLatch entered = new CountDownLatch(1); unblock = new CountDownLatch(1);
        engine.execute(() -> {
            entered.countDown();
            try { unblock.await(3, TimeUnit.SECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        });
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        engine.setSleep(900); engine.setSleep(0);
        unblock.countDown(); drain();
        assertFalse(engine.playing());
        assertEquals(0, decoders.get(0).starts);
        assertEquals(0, engine.snapshot().optInt("sleepSeconds"));
    }

    @Test public void duplicateExpiryBeforeTheAudioWorkerRunsStillPausesExactlyOnce() throws Exception {
        ReflectionHelpers.setField(engine, "continuousLesson", true);
        engine.setSleep(900); drain();
        Decoder whole = decoders.get(decoders.size() - 1);
        CountDownLatch entered = new CountDownLatch(1); unblock = new CountDownLatch(1);
        engine.execute(() -> {
            entered.countDown();
            try { unblock.await(3, TimeUnit.SECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        });
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        engine.finishSleep(); engine.finishSleep();
        unblock.countDown(); drain();
        assertFalse(engine.playing());
        assertEquals(1, whole.pauses);
        assertEquals(0, engine.snapshot().optInt("sleepSeconds"));
    }

    @Test public void anOldQueuedExpiryCannotClearAReplacementSleepTimer() throws Exception {
        ReflectionHelpers.setField(engine, "continuousLesson", true);
        engine.setSleep(900); drain();
        CountDownLatch entered = new CountDownLatch(1); unblock = new CountDownLatch(1);
        engine.execute(() -> {
            entered.countDown();
            try { unblock.await(3, TimeUnit.SECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        });
        assertTrue(entered.await(3, TimeUnit.SECONDS));
        engine.finishSleep(); engine.setSleep(1800);
        unblock.countDown(); drain();
        assertTrue(engine.playing());
        assertEquals(1800, engine.snapshot().optInt("sleepSeconds"));
        assertTrue(engine.snapshot().optBoolean("sleepContinuous"));
        assertEquals(0, decoders.get(decoders.size() - 1).pauses);
    }

    @Test public void loopingUsesTheBoundedSourceWithoutSeekingTheWholeLesson() throws Exception {
        playRange(30, 31, true, true); finishClip();
        Decoder clip = decoders.get(decoders.size() - 1);
        assertTrue(clip.looping);
        clip.at = 1000;
        engine.execute(() -> ((Runnable) ReflectionHelpers.getField(engine, "ticker")).run()); drain();
        assertTrue(engine.playing());
        assertEquals(0, clip.pauses);
        assertEquals(2, decoders.size());
    }
}

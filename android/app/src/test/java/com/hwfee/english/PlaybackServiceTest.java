package com.hwfee.english;

import android.app.Service;
import android.content.Intent;
import android.os.Looper;
import android.os.PowerManager;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.shadows.ShadowPowerManager;

import java.time.Duration;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.Future;
import android.graphics.Bitmap;
import org.robolectric.util.ReflectionHelpers;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class PlaybackServiceTest {
    private ServiceController<PlaybackService> controller;
    private PlaybackService service;

    @Before public void createService() {
        controller = Robolectric.buildService(PlaybackService.class).create();
        service = controller.get();
    }

    @After public void destroyService() throws Exception {
        controller.destroy();
        drainNative();
        shadowOf(Looper.getMainLooper()).idle();
    }

    private NativeAudioEngine engine() { return ReflectionHelpers.getField(service, "nativeEngine"); }

    private void drainNative() throws Exception {
        java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        engine().execute(done::countDown);
        assertTrue(done.await(3, java.util.concurrent.TimeUnit.SECONDS));
    }

    private int send(String action) {
        return service.onStartCommand(new Intent(service, PlaybackService.class).setAction(action), 0, 1);
    }

    @Test public void loadingAPausedLessonDoesNotCreatePlaybackNotification() {
        assertEquals(Service.START_NOT_STICKY, send(PlaybackService.ACTION_STATE));
        assertFalse(PlaybackService.hasSession());
        assertNull(shadowOf(service).getLastForegroundNotification());
        assertTrue(shadowOf(service).isStoppedBySelf());
    }

    @Test public void idleSleepCommandCannotCreateAPlaybackSession() {
        send(PlaybackService.ACTION_SLEEP);
        assertFalse(PlaybackService.hasSession());
        assertNull(shadowOf(service).getLastForegroundNotification());
        assertTrue(shadowOf(service).isStoppedBySelf());
    }

    @Test public void playingStateCanRestoreServiceAfterAnExplicitStop() {
        service.onStartCommand(new Intent(service, PlaybackService.class).setAction(PlaybackService.ACTION_STATE)
                .putExtra("playing", true).putExtra("title", "Lesson"), 0, 1);
        assertTrue(PlaybackService.hasSession());
        assertEquals("Lesson", shadowOf(service).getLastForegroundNotification().extras.getString("android.title"));
        send(PlaybackService.ACTION_STOP);
        assertFalse(PlaybackService.hasSession());
    }

    @Test public void timerIsRemovedFromNotificationWhenItExpires() {
        send(PlaybackService.ACTION_START);
        service.onStartCommand(new Intent(service, PlaybackService.class).setAction(PlaybackService.ACTION_SLEEP)
                .putExtra("seconds", 9), 0, 2);
        assertNotNull(shadowOf(service).getLastForegroundNotification().extras.getString("android.subText"));
        PowerManager.WakeLock lock = ShadowPowerManager.getLatestWakeLock();
        assertTrue(lock.isHeld());
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(9));
        assertFalse(lock.isHeld());
        android.app.NotificationManager manager = service.getSystemService(android.app.NotificationManager.class);
        assertNull(shadowOf(manager).getNotification(4211).extras.getString("android.subText"));
    }

    @Test public void cancellingTimerReleasesItsWakeLock() {
        send(PlaybackService.ACTION_START);
        service.onStartCommand(new Intent(service, PlaybackService.class).setAction(PlaybackService.ACTION_SLEEP)
                .putExtra("seconds", 30), 0, 2);
        PowerManager.WakeLock lock = ShadowPowerManager.getLatestWakeLock();
        assertTrue(lock.isHeld());
        send(PlaybackService.ACTION_SLEEP);
        assertFalse(lock.isHeld());
        assertNull(shadowOf(service).getLastForegroundNotification().extras.getString("android.subText"));
    }

    @Test public void sleepExpiryClearsContinuousModeAndAnOldTaskCannotExpireAReplacement() throws Exception {
        send(PlaybackService.ACTION_START);
        service.onStartCommand(new Intent(service, PlaybackService.class).setAction(PlaybackService.ACTION_SLEEP)
                .putExtra("seconds", 9), 0, 2);
        drainNative();
        Runnable old = ReflectionHelpers.getField(service, "sleepTask");
        service.onStartCommand(new Intent(service, PlaybackService.class).setAction(PlaybackService.ACTION_SLEEP)
                .putExtra("seconds", 30), 0, 3);
        drainNative();
        old.run(); drainNative();
        assertEquals(30, engine().snapshot().optInt("sleepSeconds"));
        assertNotNull(ReflectionHelpers.getField(service, "sleepTask"));
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30)); drainNative();
        assertEquals(0, engine().snapshot().optInt("sleepSeconds"));
        assertNull(ReflectionHelpers.getField(service, "sleepTask"));
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld());
    }

    @Test public void manualPauseDoesNotCancelTheWallClockDeadline() throws Exception {
        send(PlaybackService.ACTION_START);
        service.onStartCommand(new Intent(service, PlaybackService.class).setAction(PlaybackService.ACTION_SLEEP)
                .putExtra("seconds", 9), 0, 2);
        drainNative();
        send(PlaybackService.ACTION_PAUSE); drainNative();
        assertEquals(9, engine().snapshot().optInt("sleepSeconds"));
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(9)); drainNative();
        assertEquals(0, engine().snapshot().optInt("sleepSeconds"));
        assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld());
    }

    @Test @Config(sdk = 23) public void playbackSupportsDevicesBeforeNotificationChannels() {
        send(PlaybackService.ACTION_START);
        assertTrue(PlaybackService.hasSession());
        assertNotNull(shadowOf(service).getLastForegroundNotification());
    }

    private String cover() throws Exception {
        File dir = new File(service.getFilesDir(), "lessons/artwork-test");
        assertTrue(dir.isDirectory() || dir.mkdirs());
        try (FileOutputStream out = new FileOutputStream(new File(dir, "cover.png"))) {
            Bitmap.createBitmap(1024, 768, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, out);
        }
        return "https://localhost/lessons/artwork-test/cover.png";
    }

    private void playWithArtwork(String title, String source) {
        service.onStartCommand(new Intent(service, PlaybackService.class).setAction(PlaybackService.ACTION_STATE)
                .putExtra("playing", true).putExtra("title", title).putExtra("artist", "Podcast")
                .putExtra("lesson", title).putExtra("artwork", source).putExtra("duration", 600000L), 0, 1);
    }

    @Test public void coverReachesNotificationAndClearsWhenLessonChanges() throws Exception {
        playWithArtwork("First", cover());
        ((Future<?>) ReflectionHelpers.getField(service, "artworkTask")).get();
        shadowOf(Looper.getMainLooper()).idle();
        Bitmap image = ReflectionHelpers.getField(service, "artwork");
        assertNotNull(image);
        assertTrue(image.getWidth() <= 512);
        android.app.NotificationManager manager = service.getSystemService(android.app.NotificationManager.class);
        assertNotNull(shadowOf(manager).getNotification(4211).getLargeIcon());
        playWithArtwork("Second", "");
        assertNull(ReflectionHelpers.getField(service, "artwork"));
        assertEquals("Second", shadowOf(service).getLastForegroundNotification().extras.getString("android.title"));
        assertNull(shadowOf(service).getLastForegroundNotification().getLargeIcon());
    }

    @Test public void lateArtworkCannotOverwriteANewerLesson() throws Exception {
        playWithArtwork("First", cover());
        ((Future<?>) ReflectionHelpers.getField(service, "artworkTask")).get();
        playWithArtwork("Second", "");
        shadowOf(Looper.getMainLooper()).idle();
        assertNull(ReflectionHelpers.getField(service, "artwork"));
    }

    @Test public void ordinaryProgressReusesTheNotificationAndPauseStillUpdatesItImmediately() {
        send(PlaybackService.ACTION_START);
        com.getcapacitor.JSObject state = new com.getcapacitor.JSObject().put("title", "Lesson")
                .put("artist", "Podcast").put("lesson", "current").put("duration", 120).put("position", 1)
                .put("playing", true).put("rate", 1);
        ReflectionHelpers.callInstanceMethod(service, "onNativeState",
                ReflectionHelpers.ClassParameter.from(com.getcapacitor.JSObject.class, state));
        android.app.NotificationManager manager = service.getSystemService(android.app.NotificationManager.class);
        android.app.Notification first = shadowOf(manager).getNotification(4211);
        assertNotNull(first);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));
        state.put("position", 3);
        ReflectionHelpers.callInstanceMethod(service, "onNativeState",
                ReflectionHelpers.ClassParameter.from(com.getcapacitor.JSObject.class, state));
        assertSame(first, shadowOf(manager).getNotification(4211));
        state.put("playing", false);
        ReflectionHelpers.callInstanceMethod(service, "onNativeState",
                ReflectionHelpers.ClassParameter.from(com.getcapacitor.JSObject.class, state));
        assertNotSame(first, shadowOf(manager).getNotification(4211));
        assertEquals("播放", shadowOf(manager).getNotification(4211).actions[0].title);
    }
}

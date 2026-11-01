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

    @After public void destroyService() {
        controller.destroy();
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

    @Test @Config(sdk = 23) public void playbackSupportsDevicesBeforeNotificationChannels() {
        send(PlaybackService.ACTION_START);
        assertTrue(PlaybackService.hasSession());
        assertNotNull(shadowOf(service).getLastForegroundNotification());
    }
}

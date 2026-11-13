package com.hwfee.english;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Build;
import android.os.SystemClock;
import android.os.PowerManager;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Keeps lesson audio alive with the screen off, and puts it on the lock screen.
 *
 * NativeAudioEngine owns imported audio. This service owns its foreground lifetime and MediaSession;
 * the WebView receives progress and controls the lesson stages. AudioBridge supports legacy pages.
 */
public class PlaybackService extends Service {

    public static final String ACTION_START = "com.hwfee.english.action.START";
    public static final String ACTION_STATE = "com.hwfee.english.action.STATE";
    public static final String ACTION_PLAY = "com.hwfee.english.action.PLAY";
    public static final String ACTION_PAUSE = "com.hwfee.english.action.PAUSE";
    public static final String ACTION_STOP = "com.hwfee.english.action.STOP";
    public static final String ACTION_SLEEP = "com.hwfee.english.action.SLEEP";
    public static final String ACTION_NATIVE_PLAY = "com.hwfee.english.action.NATIVE_PLAY";

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 4211;
    private static volatile boolean active;

    static boolean hasSession() {
        return active;
    }

    private MediaSession session;
    private Handler handler;
    private Runnable sleepTask;
    private long sleepEndsAt = 0;
    private PowerManager.WakeLock sleepWakeLock;

    private boolean playing;
    private long position;
    private long duration;
    private String title = "";
    private String artist = "";
    private String lesson = "";
    private String artworkSource = "";
    private Bitmap artwork;
    private float rate = 1f;
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private Future<?> artworkTask;
    private boolean destroyed;
    private NativeAudioEngine nativeEngine;
    private long lastNativeUpdate;
    private java.util.List<Object> metadataIdentity;
    private java.util.List<Object> notificationIdentity;
    private Notification cachedNotification;

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        nativeEngine = NativeAudioEngine.get(this);
        nativeEngine.serviceListener = this::onNativeState;
        session = new MediaSession(this, "HwFeeEnglish");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { playAudio(); }
            @Override public void onPause() { pauseAudio(); }
            @Override public void onStop() { active = false; pauseAudio(); stopSelf(); }
            @Override public void onSeekTo(long pos) {
                if (nativeEngine.hasSource()) nativeEngine.seek(pos / 1000.0);
                else AudioBridge.evalSeekTo(pos / 1000.0);
            }
        });
        session.setActive(true);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "播放", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_NATIVE_PLAY.equals(action)) {
            active = true;
            applyNativeState(nativeEngine.snapshot());
            startForeground(NOTIFICATION_ID, buildNotification());
            com.getcapacitor.JSObject range = null;
            if (intent.hasExtra("start") && intent.hasExtra("end")) range = new com.getcapacitor.JSObject()
                    .put("start", intent.getDoubleExtra("start", 0)).put("end", intent.getDoubleExtra("end", 0))
                    .put("loop", intent.getBooleanExtra("loop", false))
                    .put("drill", intent.getBooleanExtra("drill", false));
            long transport = intent.hasExtra("transport") ? intent.getLongExtra("transport", 0) : nativeEngine.reserveTransport();
            nativeEngine.playRequest(transport, intent.getStringExtra("sourceId"), range);
        } else if (ACTION_START.equals(action) || ACTION_STATE.equals(action)) {
            if (ACTION_STATE.equals(action) && !active && !intent.getBooleanExtra("playing", false)) {
                stopSelf();
                return START_NOT_STICKY;
            }
            active = true;
            if (intent != null) {
                playing = intent.getBooleanExtra("playing", playing);
                position = intent.getLongExtra("position", position);
                long reported = intent.getLongExtra("duration", duration);
                if (reported > 0) duration = reported;
                String nextTitle = intent.getStringExtra("title");
                if (nextTitle != null && !nextTitle.isEmpty()) title = nextTitle;
                String nextArtist = intent.getStringExtra("artist");
                if (nextArtist != null) artist = nextArtist;
                String nextLesson = intent.getStringExtra("lesson");
                if (nextLesson != null && !nextLesson.equals(lesson)) {
                    lesson = nextLesson;
                    duration = Math.max(0, reported);
                    position = intent.getLongExtra("position", 0);
                }
                rate = intent.getFloatExtra("rate", rate);
                if (Float.isNaN(rate) || Float.isInfinite(rate) || rate <= 0) rate = 1f;
                String nextArtwork = intent.getStringExtra("artwork");
                if (nextArtwork != null) updateArtwork(nextArtwork);
            }
            pushSessionState();
            startForeground(NOTIFICATION_ID, buildNotification());
        } else if (ACTION_PLAY.equals(action)) {
            if (nativeEngine.hasSource()) playAudio(); else AudioBridge.evalToggle();
        } else if (ACTION_PAUSE.equals(action)) {
            pauseAudio();
        } else if (ACTION_STOP.equals(action)) {
            active = false;
            pauseAudio();
            stopSelf();
            return START_NOT_STICKY;
        } else if (ACTION_SLEEP.equals(action)) {
            if (!active) {
                stopSelf();
                return START_NOT_STICKY;
            }
            scheduleSleep(intent == null ? 0 : intent.getIntExtra("seconds", 0));
            startForeground(NOTIFICATION_ID, buildNotification());
        } else {
            stopSelf(); // A WebView player cannot be restored by restarting an empty service.
        }
        return START_NOT_STICKY;
    }

    private void scheduleSleep(int seconds) {
        clearSleep();
        nativeEngine.setSleep(seconds);
        if (seconds <= 0) return;
        if (!nativeEngine.hasSource()) AudioBridge.evalPlay();
        sleepEndsAt = SystemClock.elapsedRealtime() + seconds * 1000L;
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        sleepWakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HwFeeEnglish:sleep");
        sleepWakeLock.setReferenceCounted(false);
        // Handler uses uptime. Keep the CPU awake only while a requested timer is pending,
        // so screen-off/deep sleep cannot delay the pause; the timeout also bounds this lock.
        sleepWakeLock.acquire(seconds * 1000L + 5000);
        sleepTask = new Runnable() {
            @Override public void run() {
                if (sleepTask != this) return;
                clearSleep();
                nativeEngine.finishSleep();
                if (!nativeEngine.hasSource()) AudioBridge.evalPause();
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                manager.notify(NOTIFICATION_ID, buildNotification());
            }
        };
        handler.postDelayed(sleepTask, seconds * 1000L);
    }

    private void clearSleep() {
        if (sleepTask != null) handler.removeCallbacks(sleepTask);
        sleepTask = null;
        sleepEndsAt = 0;
        if (sleepWakeLock != null && sleepWakeLock.isHeld()) sleepWakeLock.release();
        sleepWakeLock = null;
    }

    private void playAudio() {
        if (nativeEngine.hasSource()) nativeEngine.play(); else AudioBridge.evalPlay();
    }

    private void pauseAudio() {
        if (nativeEngine.hasSource()) nativeEngine.pause(); else AudioBridge.evalPause();
    }

    private void applyNativeState(com.getcapacitor.JSObject state) {
        playing = state.optBoolean("playing", false);
        position = Math.round(state.optDouble("position", 0) * 1000);
        duration = Math.round(state.optDouble("duration", 0) * 1000);
        title = state.optString("title", "精听"); artist = state.optString("artist", "");
        lesson = state.optString("lesson", ""); rate = (float) state.optDouble("rate", 1);
        updateArtwork(state.optString("artwork", ""));
    }

    private void onNativeState(com.getcapacitor.JSObject state) {
        if (!active || destroyed) return;
        boolean changed = playing != state.optBoolean("playing", false)
                || !lesson.equals(state.optString("lesson", ""))
                || rate != (float) state.optDouble("rate", 1)
                || !state.optString("event", "").isEmpty();
        applyNativeState(state);
        long now = SystemClock.elapsedRealtime();
        if (!changed && now - lastNativeUpdate < 900) return;
        lastNativeUpdate = now;
        pushSessionState();
        Notification previous = cachedNotification;
        Notification next = buildNotification();
        if (next != previous) getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, next);
    }

    private void pushSessionState() {
        if (session == null) return;
        java.util.List<Object> identity = java.util.Arrays.asList(title, artist, duration, lesson, artwork);
        if (!identity.equals(metadataIdentity)) {
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "精听" : title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
                    .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, lesson);
            if (artwork != null) {
                metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork)
                        .putBitmap(MediaMetadata.METADATA_KEY_ART, artwork)
                        .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork);
            }
            session.setMetadata(metadata.build());
            metadataIdentity = identity;
        }
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY
                        | PlaybackState.ACTION_PAUSE
                        | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SEEK_TO
                        | PlaybackState.ACTION_STOP)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        position, playing ? rate : 0f)
                .build());
    }

    private Notification buildNotification() {
        String timer = null;
        if (sleepTask != null) {
            long minutesLeft = Math.max(0, (sleepEndsAt - SystemClock.elapsedRealtime()) / 60_000L);
            timer = minutesLeft < 1 ? "睡眠定时 · 不到 1 分钟" : "睡眠定时 · 还有 " + minutesLeft + " 分钟";
        }
        java.util.List<Object> identity = java.util.Arrays.asList(playing, title, artist, artwork, timer);
        if (identity.equals(notificationIdentity) && cachedNotification != null) return cachedNotification;
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title.isEmpty() ? "精听" : title)
                .setContentText(artist)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1));

        if (artwork != null) builder.setLargeIcon(artwork);
        builder.addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "暂停" : "播放", command(playing ? ACTION_PAUSE : ACTION_PLAY)).build());
        builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "停止", command(ACTION_STOP)).build());

        if (timer != null) builder.setSubText(timer);

        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.setContentIntent(open);
        notificationIdentity = identity;
        cachedNotification = builder.build();
        return cachedNotification;
    }

    private PendingIntent command(String action) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void updateArtwork(String source) {
        if (source.equals(artworkSource)) return;
        artworkSource = source;
        artwork = null; // Changing lessons must never keep the previous lesson's cover.
        if (artworkTask != null) artworkTask.cancel(true);
        if (source.isEmpty()) return;
        artworkTask = artworkExecutor.submit(() -> {
            Bitmap loaded;
            try { loaded = MediaArtwork.load(getApplicationContext(), source); }
            catch (Exception ignored) { return; }
            if (loaded == null || Thread.currentThread().isInterrupted()) return;
            handler.post(() -> {
                if (destroyed || !active || !source.equals(artworkSource)) return;
                artwork = loaded;
                pushSessionState();
                getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
            });
        });
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        if (nativeEngine != null) nativeEngine.serviceListener = null;
        if (artworkTask != null) artworkTask.cancel(true);
        artworkExecutor.shutdownNow();
        active = false;
        clearSleep();
        if (nativeEngine != null) nativeEngine.setSleep(0);
        stopForeground(true);
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

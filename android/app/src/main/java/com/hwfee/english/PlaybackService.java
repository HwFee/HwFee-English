package com.hwfee.english;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Keeps lesson audio alive with the screen off, and puts it on the lock screen.
 *
 * The sound itself belongs to the WebView player; this service holds the process in the foreground
 * and owns the MediaSession. Transport controls come back to the player through AudioBridge.
 */
public class PlaybackService extends Service {

    public static final String ACTION_START = "com.hwfee.english.action.START";
    public static final String ACTION_STATE = "com.hwfee.english.action.STATE";
    public static final String ACTION_PLAY = "com.hwfee.english.action.PLAY";
    public static final String ACTION_PAUSE = "com.hwfee.english.action.PAUSE";
    public static final String ACTION_STOP = "com.hwfee.english.action.STOP";
    public static final String ACTION_SLEEP = "com.hwfee.english.action.SLEEP";

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 4211;

    private MediaSession session;
    private Handler handler;
    private Runnable sleepTask;
    private long sleepEndsAt = 0;

    private boolean playing;
    private long position;
    private long duration;
    private String title = "";
    private String artist = "";

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        session = new MediaSession(this, "HwFeeEnglish");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { AudioBridge.evalToggle(); }
            @Override public void onPause() { AudioBridge.evalPause(); }
            @Override public void onStop() { AudioBridge.evalPause(); stopSelf(); }
            @Override public void onSeekTo(long pos) { AudioBridge.evalSeekTo(pos / 1000.0); }
        });
        session.setActive(true);

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "播放", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_START.equals(action) || ACTION_STATE.equals(action)) {
            if (intent != null) {
                playing = intent.getBooleanExtra("playing", playing);
                position = intent.getLongExtra("position", position);
                long reported = intent.getLongExtra("duration", duration);
                if (reported > 0) duration = reported;
                String nextTitle = intent.getStringExtra("title");
                if (nextTitle != null && !nextTitle.isEmpty()) title = nextTitle;
                String nextArtist = intent.getStringExtra("artist");
                if (nextArtist != null) artist = nextArtist;
            }
            pushSessionState();
            startForeground(NOTIFICATION_ID, buildNotification());
        } else if (ACTION_PLAY.equals(action)) {
            AudioBridge.evalToggle();
        } else if (ACTION_PAUSE.equals(action)) {
            AudioBridge.evalPause();
        } else if (ACTION_STOP.equals(action)) {
            AudioBridge.evalPause();
            stopSelf();
            return START_NOT_STICKY;
        } else if (ACTION_SLEEP.equals(action)) {
            scheduleSleep(intent == null ? 0 : intent.getIntExtra("seconds", 0));
            startForeground(NOTIFICATION_ID, buildNotification());
        }
        return START_STICKY;
    }

    private void scheduleSleep(int seconds) {
        if (sleepTask != null) handler.removeCallbacks(sleepTask);
        if (seconds <= 0) {
            sleepEndsAt = 0;
            sleepTask = null;
            return;
        }
        sleepEndsAt = System.currentTimeMillis() + seconds * 1000L;
        sleepTask = () -> {
            AudioBridge.evalPause();
            sleepEndsAt = 0;
            sleepTask = null;
        };
        handler.postDelayed(sleepTask, seconds * 1000L);
    }

    private void pushSessionState() {
        if (session == null) return;
        MediaMetadata metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "精听" : title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
                .build();
        session.setMetadata(metadata);
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY
                        | PlaybackState.ACTION_PAUSE
                        | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SEEK_TO
                        | PlaybackState.ACTION_STOP)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        position, playing ? 1f : 0f)
                .build());
    }

    private Notification buildNotification() {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title.isEmpty() ? "精听" : title)
                .setContentText(artist)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1));

        builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_previous, "播放/暂停", command(ACTION_PLAY)).build());
        builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "停止", command(ACTION_STOP)).build());

        if (sleepTask != null) {
            long minutesLeft = Math.max(0, (sleepEndsAt - System.currentTimeMillis()) / 60_000L);
            builder.setSubText(minutesLeft < 1
                    ? "睡眠定时 · 不到 1 分钟"
                    : "睡眠定时 · 还有 " + minutesLeft + " 分钟");
        }

        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.setContentIntent(open);
        return builder.build();
    }

    private PendingIntent command(String action) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onDestroy() {
        if (sleepTask != null) handler.removeCallbacks(sleepTask);
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

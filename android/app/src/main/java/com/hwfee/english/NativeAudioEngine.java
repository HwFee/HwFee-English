package com.hwfee.english;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** One native decoder, owned independently of WebView documents and their visibility. */
final class NativeAudioEngine {
    interface Listener { void onState(JSObject state); }
    private static NativeAudioEngine instance;
    static synchronized NativeAudioEngine get(Context context) {
        if (instance == null) instance = new NativeAudioEngine(context.getApplicationContext());
        return instance;
    }
    private final Context context;
    private final Handler handler;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioManager audioManager;
    private final AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private MediaPlayer player;
    private AudioFocusRequest focusRequest;
    private long focusResumeTransport;
    private PluginCall preparing;
    Listener pageListener;
    Listener serviceListener;
    private volatile String source = "", sourceId = "", lesson = "", title = "", artist = "", artwork = "", error = "";
    private volatile boolean prepared, wanted, seeking, ended, resumeOnFocus, atBoundary, running, reusedSource;
    private volatile long sequence;
    private final java.util.concurrent.atomic.AtomicLong transport = new java.util.concurrent.atomic.AtomicLong();
    private long lastPageUpdate;
    private volatile long position, duration;
    private long rangeStart, rangeEnd;
    private boolean loop;
    private volatile float rate = 1f;
    private float decoderRate = 1f;
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (!prepared || player == null) return;
            try {
                if (!seeking) position = player.getCurrentPosition();
                if (!seeking && playing() && rangeEnd > rangeStart && position >= rangeEnd - 10) {
                    if (loop) { seek(rangeStart / 1000.0); }
                    else {
                        player.pause(); running = false; wanted = false; atBoundary = true;
                        position = Math.max(rangeStart, rangeEnd - 10); emit("boundary"); return;
                    }
                }
                long now = android.os.SystemClock.elapsedRealtime();
                if (now - lastPageUpdate >= 200) { lastPageUpdate = now; emit(""); }
                if (playing() || seeking) {
                    long delay = 25;
                    if (!seeking && rangeEnd > rangeStart) {
                        // Poll more closely at the boundary, including faster playback.
                        // A fixed 25 ms tick could already be inside the next word.
                        delay = Math.max(1, Math.min(25, (long) Math.ceil((rangeEnd - position) / (double) rate) - 10));
                    }
                    handler.postDelayed(this, delay);
                }
            } catch (IllegalStateException failure) { fail("原生音频状态已失效，请重新播放"); }
        }
    };
    private final AudioManager.OnAudioFocusChangeListener focus = change -> execute(() -> {
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
            if (resumeOnFocus) {
                resumeOnFocus = false;
                if (focusResumeTransport == transport.get()) playInternal();
            }
        } else {
            boolean resume = change != AudioManager.AUDIOFOCUS_LOSS && playing();
            focusResumeTransport = transport.get();
            pauseInternal(); resumeOnFocus = resume;
        }
    });

    private NativeAudioEngine(Context context) {
        this.context = context;
        audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        HandlerThread thread = new HandlerThread("hwfee-audio");
        thread.start(); handler = new Handler(thread.getLooper());
    }
    void execute(Runnable action) {
        if (Looper.myLooper() == handler.getLooper()) action.run(); else handler.post(action);
    }
    long reserveTransport() { return transport.incrementAndGet(); }
    void playRequest(long request, String token, JSObject data) {
        execute(() -> {
            if (request != transport.get() || !accepts(token)) return;
            if (data != null && data.has("start") && data.has("end"))
                range(data.optDouble("start", 0), data.optDouble("end", 0), data.optBoolean("loop", false));
            playInternal();
        });
    }
    boolean hasSource() { return !source.isEmpty(); }
    boolean accepts(String token) { return token == null || token.isEmpty() || token.equals(sourceId); }
    boolean playing() {
        return running;
    }
    JSObject snapshot() {
        // Queries must stay responsive even when a cold decoder's Binder call is blocked.
        // An embedded lesson can contain megabytes of base64. Never echo it on every progress tick.
        return new JSObject().put("source", source.startsWith("data:") ? "" : source).put("sourceId", sourceId)
                .put("lesson", lesson).put("title", title)
                .put("artist", artist).put("artwork", artwork).put("playing", playing())
                .put("prepared", prepared).put("seeking", seeking).put("ended", ended)
                .put("position", position / 1000.0).put("duration", duration / 1000.0)
                .put("rate", rate).put("error", error).put("sequence", sequence).put("reused", reusedSource);
    }
    private void emit(String event) {
        sequence++;
        JSObject state = snapshot().put("event", event);
        main.post(() -> {
            if (pageListener != null) pageListener.onState(state);
            if (serviceListener != null) serviceListener.onState(state);
        });
    }

    void prepare(JSObject data, PluginCall call) {
        if (Looper.myLooper() != handler.getLooper()) { reserveTransport(); execute(() -> prepare(data, call)); return; }
        String next = data.optString("source", "");
        if (next.equals(source) && prepared && error.isEmpty()) {
            reusedSource = true; metadata(data);
            emit("");
            call.resolve(snapshot().put("reused", true)); return;
        }
        releaseDecoder();
        reusedSource = false;
        source = next; metadata(data);
        position = 0; duration = 0; wanted = false; ended = false; atBoundary = false; error = "";
        rate = 1f;
        rangeEnd = 0; rangeStart = 0;
        preparing = call;
        emit("loading");
        prepareDecoder();
    }
    private void metadata(JSObject data) {
        sourceId = data.optString("sourceId", "");
        lesson = data.optString("lesson", ""); title = data.optString("title", "精听");
        artist = data.optString("artist", ""); artwork = data.optString("artwork", "");
    }
    private File audioFile() throws Exception {
        if (source.startsWith("data:audio/")) {
            int comma = source.indexOf(',');
            if (comma < 0 || !source.substring(0, comma).endsWith(";base64") || source.length() > 64 * 1024 * 1024)
                throw new IllegalArgumentException("内嵌音频无效");
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
            StringBuilder key = new StringBuilder();
            for (byte b : digest) key.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            File file = new File(context.getCacheDir(), "native-audio-" + key + ".mp4");
            if (!file.isFile()) try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(source.substring(comma + 1), Base64.DEFAULT));
            }
            return file;
        }
        Uri uri = Uri.parse(source);
        if (!LessonWebViewClient.isAppOrigin(uri) || uri.getPath() == null || !uri.getPath().startsWith("/lessons/"))
            throw new IllegalArgumentException("音频必须来自已导入的课程");
        File file = LessonRequestSupport.resolveLessonFile(LessonStore.get(context).root(), uri.getPath().substring(9));
        if (file == null || !file.isFile()) throw new IllegalArgumentException("课程音频不可读取");
        return file;
    }
    private void prepareDecoder() {
        try {
            final MediaPlayer decoder = new MediaPlayer();
            decoderRate = 1f;
            player = decoder;
            decoder.setAudioAttributes(attributes);
            decoder.setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK);
            decoder.setDataSource(audioFile().getAbsolutePath());
            decoder.setOnPreparedListener(ready -> {
                if (player != ready) return;
                prepared = true; duration = ready.getDuration();
                if (position > 0) seek(position / 1000.0);
                JSObject state = snapshot();
                if (preparing != null) { preparing.resolve(state); preparing = null; }
                emit("prepared");
                if (wanted && !seeking) startPrepared();
            });
            decoder.setOnSeekCompleteListener(ready -> {
                if (player != ready) return;
                seeking = false; position = ready.getCurrentPosition();
                emit("seeked");
                if (wanted && !playing()) startPrepared();
            });
            decoder.setOnCompletionListener(ready -> {
                if (player != ready) return;
                wanted = false; running = false; ended = true; position = duration;
                handler.removeCallbacks(ticker); emit("ended");
            });
            decoder.setOnErrorListener((failed, what, extra) -> {
                if (player == failed) fail("原生音频播放失败（" + what + "/" + extra + "）");
                return true;
            });
            decoder.prepareAsync();
        } catch (Exception failure) { fail(String.valueOf(failure.getMessage())); }
    }
    private boolean requestFocus() {
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attributes).setWillPauseWhenDucked(true)
                    .setOnAudioFocusChangeListener(focus, handler).build();
            return audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        return audioManager.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }
    void play() {
        playRequest(reserveTransport(), null, null);
    }
    private void playInternal() {
        if (!hasSource()) return;
        if (running) { emit(""); return; }
        wanted = true; ended = false; resumeOnFocus = false;
        if (!error.isEmpty()) { error = ""; releaseDecoder(); wanted = true; prepareDecoder(); return; }
        if (prepared && !seeking) startPrepared();
    }
    private void startPrepared() {
        if (!requestFocus()) { wanted = false; emit(""); return; }
        try {
            if (rate != decoderRate) {
                player.setPlaybackParams(new PlaybackParams().setSpeed(rate)); decoderRate = rate;
            }
            player.start();
            running = true;
            emit(""); handler.removeCallbacks(ticker); handler.post(ticker);
        } catch (Exception failure) { fail(String.valueOf(failure.getMessage())); }
    }
    void pause() {
        pauseRequest(reserveTransport());
    }
    void pauseRequest(long request) {
        execute(() -> { if (request == transport.get()) pauseInternal(); });
    }
    private void pauseInternal() {
        wanted = false; resumeOnFocus = false;
        try { if (playing()) { position = player.getCurrentPosition(); player.pause(); } }
        catch (IllegalStateException failure) { fail("原生音频状态已失效，请重新播放"); return; }
        running = false; handler.removeCallbacks(ticker); emit("");
    }
    void seek(double seconds) {
        if (Looper.myLooper() != handler.getLooper()) { execute(() -> seek(seconds)); return; }
        if (Double.isNaN(seconds) || Double.isInfinite(seconds)) return;
        position = Math.max(0, Math.round(seconds * 1000)); ended = false; atBoundary = false;
        if (!prepared || player == null) return;
        position = Math.min(position, duration); seeking = true;
        try {
            if (Build.VERSION.SDK_INT >= 26) player.seekTo(position, MediaPlayer.SEEK_CLOSEST);
            else player.seekTo((int) Math.min(Integer.MAX_VALUE, position));
        } catch (IllegalStateException failure) { fail("无法定位到该播放位置"); }
    }
    void rate(double value) {
        if (Looper.myLooper() != handler.getLooper()) { execute(() -> rate(value)); return; }
        if (Double.isNaN(value) || Double.isInfinite(value) || value < .5 || value > 3) return;
        rate = (float) value;
        try { if (playing() && rate != decoderRate) { player.setPlaybackParams(new PlaybackParams().setSpeed(rate)); decoderRate = rate; } }
        catch (IllegalStateException failure) { fail("无法调整播放速度"); return; }
        emit("");
    }
    void range(double start, double end, boolean repeat) {
        if (Looper.myLooper() != handler.getLooper()) { execute(() -> range(start, end, repeat)); return; }
        if (!Double.isFinite(start) || !Double.isFinite(end)) return;
        rangeStart = Math.max(0, Math.round(start * 1000)); rangeEnd = Math.max(0, Math.round(end * 1000)); loop = repeat;
    }
    private void fail(String message) {
        error = message; wanted = false; prepared = false; seeking = false; running = false;
        handler.removeCallbacks(ticker);
        if (player != null) { player.release(); player = null; }
        if (preparing != null) { preparing.reject(message); preparing = null; }
        emit("error"); // A user-initiated retry is allowed; no reload/retry loop runs here.
    }
    private void releaseDecoder() {
        handler.removeCallbacks(ticker);
        if (preparing != null) { preparing.reject("课程已切换"); preparing = null; }
        if (player != null) { player.release(); player = null; }
        prepared = false; seeking = false; running = false;
    }
}

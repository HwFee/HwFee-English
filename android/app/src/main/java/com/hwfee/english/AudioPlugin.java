package com.hwfee.english;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Control surface for playback that has to survive the screen turning off. */
@CapacitorPlugin(name = "Audio")
public class AudioPlugin extends Plugin {
    private NativeAudioEngine nativeEngine;
    private NativeAudioEngine.Listener nativeListener;

    @Override
    public void load() {
        AudioBridge.attach(getBridge().getWebView());
        nativeEngine = NativeAudioEngine.get(getContext());
        nativeListener = state -> notifyListeners("nativeAudioState", state);
        getActivity().runOnUiThread(() -> nativeEngine.pageListener = nativeListener);
    }

    @PluginMethod
    public void nativePrepare(PluginCall call) {
        nativeEngine.prepare(call.getData(), call);
    }

    @PluginMethod
    public void nativeControl(PluginCall call) {
        String action = call.getString("action", "state");
        if (!nativeEngine.accepts(call.getString("sourceId"))) { call.reject("课程已切换"); return; }
        if ("play".equals(action)) {
            long request = nativeEngine.reserveTransport();
            getActivity().runOnUiThread(() -> {
                if (!nativeEngine.accepts(call.getString("sourceId"))) { call.reject("课程已切换"); return; }
                try {
                    maybeAskForNotifications();
                    Intent intent = new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_NATIVE_PLAY)
                            .putExtra("transport", request).putExtra("sourceId", call.getString("sourceId"));
                    if (call.getData().has("start") && call.getData().has("end")) intent
                            .putExtra("start", call.getData().optDouble("start", 0)).putExtra("end", call.getData().optDouble("end", 0))
                            .putExtra("loop", call.getData().optBoolean("loop", false));
                    ContextCompat.startForegroundService(getContext(), intent);
                    call.resolve(nativeEngine.snapshot());
                } catch (Exception error) { call.reject("无法恢复后台播放，请重试"); }
            });
            return;
        }
        // Reserve pause immediately, before a delayed service-start callback can resume playback.
        long pauseRequest = "pause".equals(action) ? nativeEngine.reserveTransport() : 0;
        nativeEngine.execute(() -> {
            if (!nativeEngine.accepts(call.getString("sourceId"))) { call.reject("课程已切换"); return; }
            try {
                switch (action) {
                    case "pause": nativeEngine.pauseRequest(pauseRequest); break;
                    case "seek": nativeEngine.seek(call.getData().optDouble("position", 0)); break;
                    case "rate": nativeEngine.rate(call.getData().optDouble("rate", 1)); break;
                    case "range": nativeEngine.range(call.getData().optDouble("start", 0),
                            call.getData().optDouble("end", 0), call.getData().optBoolean("loop", false)); break;
                    default: break;
                }
                call.resolve(nativeEngine.snapshot());
            } catch (Exception error) { call.reject("原生播放操作失败：" + error.getMessage()); }
        });
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(() -> {
            if (nativeEngine.pageListener == nativeListener) nativeEngine.pageListener = null;
        });
    }

    @Override
    protected void handleOnResume() {
        AudioBridge.evalForeground();
    }

    @PluginMethod
    public void start(PluginCall call) {
        JSObject data = call.getData();
        maybeAskForNotifications();
        Intent intent = new Intent(getContext(), PlaybackService.class)
                .setAction(PlaybackService.ACTION_START)
                .putExtra("playing", true)
                .putExtra("title", data.optString("title", "精听"))
                .putExtra("artist", data.optString("artist", ""))
                .putExtra("artwork", data.optString("artwork", ""))
                .putExtra("lesson", data.optString("lesson", ""))
                .putExtra("duration", secondsToMillis(data.optDouble("duration", 0)));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法启动后台播放，请回到应用后重试");
        }
    }

    @PluginMethod
    public void state(PluginCall call) {
        JSObject data = call.getData();
        boolean playing = data.optBoolean("playing", false);
        if (!playing && !PlaybackService.hasSession()) {
            call.resolve(); // Loading an idle lesson must not create a playback service.
            return;
        }
        Intent intent = new Intent(getContext(), PlaybackService.class)
                .setAction(PlaybackService.ACTION_STATE)
                .putExtra("playing", playing)
                .putExtra("position", secondsToMillis(data.optDouble("position", 0)))
                .putExtra("duration", secondsToMillis(data.optDouble("duration", 0)))
                .putExtra("title", data.optString("title", ""))
                .putExtra("artist", data.optString("artist", ""));
        intent.putExtra("artwork", data.optString("artwork", ""))
                .putExtra("lesson", data.optString("lesson", ""))
                .putExtra("rate", (float) data.optDouble("rate", 1));
        try {
            if (playing && !PlaybackService.hasSession()) {
                ContextCompat.startForegroundService(getContext(), intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法更新后台播放状态，请回到应用后重试");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (nativeEngine.hasSource()) nativeEngine.pause();
        AudioBridge.evalPause();
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    @PluginMethod
    public void sleep(PluginCall call) {
        // Minutes may be fractional; the service works in whole seconds.
        double minutes = call.getData().optDouble("minutes", 0);
        if (!Double.isFinite(minutes) || minutes < 0 || minutes > Integer.MAX_VALUE / 60.0) {
            call.reject("睡眠定时时间无效");
            return;
        }
        int seconds = (int) Math.round(minutes * 60);
        if (!PlaybackService.hasSession()) {
            if (seconds > 0) {
                call.reject("睡眠定时需要先开始播放");
            } else {
                JSObject out = new JSObject();
                out.put("seconds", 0);
                call.resolve(out);
            }
            return;
        }
        Intent intent = new Intent(getContext(), PlaybackService.class)
                .setAction(PlaybackService.ACTION_SLEEP)
                .putExtra("seconds", seconds);
        try {
            getContext().startService(intent);
        } catch (Exception error) {
            call.reject("睡眠定时需要先开始播放");
            return;
        }
        JSObject out = new JSObject();
        out.put("seconds", seconds);
        call.resolve(out);
    }

    private long secondsToMillis(double seconds) {
        return Double.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
    }

    private void maybeAskForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        Context context = getContext();
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (getActivity() == null) return;
        ActivityCompat.requestPermissions(getActivity(),
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, 913);
    }
}

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

    @Override
    public void load() {
        AudioBridge.attach(getBridge().getWebView());
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
                .putExtra("duration", secondsToMillis(data.optDouble("duration", 0)));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void state(PluginCall call) {
        JSObject data = call.getData();
        Intent intent = new Intent(getContext(), PlaybackService.class)
                .setAction(PlaybackService.ACTION_STATE)
                .putExtra("playing", data.optBoolean("playing", false))
                .putExtra("position", secondsToMillis(data.optDouble("position", 0)))
                .putExtra("duration", secondsToMillis(data.optDouble("duration", 0)))
                .putExtra("title", data.optString("title", ""))
                .putExtra("artist", data.optString("artist", ""));
        try {
            getContext().startService(intent);
        } catch (Exception ignored) {
            // service not running (never started, or stopped by the system): nothing to update
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    @PluginMethod
    public void sleep(PluginCall call) {
        // Minutes may be fractional; the service works in whole seconds.
        double minutes = call.getData().optDouble("minutes", 0);
        int seconds = (int) Math.round(minutes * 60);
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
        return Math.round(seconds * 1000);
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

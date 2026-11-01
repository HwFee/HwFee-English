package com.hwfee.english;

import android.webkit.WebView;
import java.lang.ref.WeakReference;

/**
 * The one line between the playback service and the player living in the WebView.
 *
 * Transport controls arrive from the lock screen and are handed to the shim injected into
 * player.html; the shim reports back what the audio element is doing.
 */
public final class AudioBridge {

    private static volatile WeakReference<WebView> webView = new WeakReference<>(null);

    private AudioBridge() {
    }

    public static void attach(WebView view) {
        webView = new WeakReference<>(view);
    }

    static void eval(String script) {
        WebView view = webView.get();
        if (view == null) return;
        view.post(() -> {
            try {
                view.evaluateJavascript(script, null);
            } catch (Exception ignored) {
                // the page may be gone; nothing to control
            }
        });
    }

    /** The player lives in the listen tab's iframe, so every command goes through that window. */
    private static String shim(String call) {
        return "(function(){try{var f=document.getElementById('listenFrame');"
                + "var a=f&&f.contentWindow&&f.contentWindow.__hwfeeAudio;"
                + "if(a)" + call + ";}catch(e){}})()";
    }

    public static void evalToggle() {
        eval(shim("a.toggle()"));
    }

    public static void evalPlay() {
        eval(shim("a.play()"));
    }

    public static void evalPause() {
        eval(shim("a.pause()"));
    }

    public static void evalSeekTo(double seconds) {
        eval(shim("a.seekTo(" + seconds + ")"));
    }
}

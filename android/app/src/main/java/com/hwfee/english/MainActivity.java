package com.hwfee.english;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** A zip handed over by another app, waiting for the web layer to pick it up. */
    private static Uri pendingShare;

    public static Uri takePendingShare() {
        Uri uri = pendingShare;
        pendingShare = null;
        return uri;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LessonsPlugin.class);
        registerPlugin(ShanbayPlugin.class);
        registerPlugin(LlmPlugin.class);
        registerPlugin(AudioPlugin.class);
        super.onCreate(savedInstanceState);

        // Swap in the client that also serves imported lessons on the app origin.
        LessonStore store = LessonStore.get(this);
        bridge.getWebView().setWebViewClient(new LessonWebViewClient(bridge, store));

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Share sheet or "open with": the file arrives as a granted content URI. */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return;

        pendingShare = uri;
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('hwfee:shared'))", null));
        }
    }
}

package com.hwfee.english;

import android.content.Intent;
import android.content.ContentResolver;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.hwfee.english.glass.GlassHost;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.IntentCompat;
import androidx.core.view.WindowCompat;
import androidx.core.splashscreen.SplashScreen;

import android.content.res.Configuration;
import java.util.concurrent.atomic.AtomicReference;

public class MainActivity extends BridgeActivity {

    /** A zip handed over by another app, waiting for the web layer to pick it up. */
    private static final AtomicReference<Uri> pendingShare = new AtomicReference<>();

    public static Uri takePendingShare() {
        return pendingShare.getAndSet(null);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        Appearance.apply(this);
        SplashScreen.installSplashScreen(this);
        registerPlugin(LessonsPlugin.class);
        registerPlugin(ShanbayPlugin.class);
        registerPlugin(LlmPlugin.class);
        registerPlugin(AudioPlugin.class);
        registerPlugin(com.hwfee.english.glass.TabBarPlugin.class);
        super.onCreate(savedInstanceState);

        // Swap in the client that also serves imported lessons on the app origin.
        LessonStore store = LessonStore.get(this);
        bridge.getWebView().setWebViewClient(new LessonWebViewClient(bridge, store));
        bridge.getWebView().getSettings().setAllowFileAccess(false);
        bridge.getWebView().getSettings().setAllowContentAccess(false);

        GlassHost.installGlassHost(this, bridge.getWebView());

        // Let the web layer handle back first; otherwise background the task so
        // audio keeps playing instead of finishing the activity.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge.getWebView() == null) {
                    moveTaskToBack(true);
                    return;
                }
                bridge.getWebView().evaluateJavascript(
                        "window.hwfeeBack ? window.hwfeeBack() : false",
                        value -> {
                            if (!"true".equals(value)) moveTaskToBack(true);
                        });
            }
        });

        applyBarAppearance();

        handleIntent(getIntent());
    }

    /** Refresh date-sensitive reader data when Android returns to this activity. */
    @Override
    public void onResume() {
        super.onResume();
        if (bridge != null && bridge.getWebView() != null) bridge.getWebView().post(() ->
                bridge.getWebView().evaluateJavascript("window.hwfeeAppResumed?.()", null));
    }

    /** Light icons on the app chrome only make sense on a dark ground. */
    private void applyBarAppearance() {
        boolean dark = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(!dark);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightNavigationBars(!dark);
        // The status bar is translucent over the decor background — recolor it
        // directly so live uiMode flips follow immediately, not just cold starts.
        getWindow().getDecorView().setBackgroundColor(dark ? 0xFF000000 : 0xFFF5F5F7);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setBackgroundColor(dark ? 0xFF000000 : 0xFFF5F5F7);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyBarAppearance();
        if (bridge != null && bridge.getWebView() != null) bridge.getWebView().post(() ->
                bridge.getWebView().evaluateJavascript("window.hwfeeAppearanceChanged?.()", null));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Share sheet or "open with": the file arrives as a granted content URI. */
    void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        }
        // Exported activities can receive explicit intents that bypass manifest filters.
        // Only a provider-backed URI may cross this boundary; file: would read with
        // our own private-storage permissions. Debug importPath remains separate.
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())
                || uri.getAuthority() == null || uri.getAuthority().isEmpty()) return;

        pendingShare.set(uri);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('hwfee:shared'))", null));
        }
    }
}

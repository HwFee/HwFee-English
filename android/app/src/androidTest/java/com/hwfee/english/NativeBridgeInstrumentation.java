package com.hwfee.english;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Platform-only runner: tests the shipped APK without requiring unshrunk Kotlin/AndroidX APIs. */
public class NativeBridgeInstrumentation extends Instrumentation {
    private static final String ACTIVITY = "com.hwfee.english.MainActivity";

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        start();
    }

    private void require(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int i = 0; i < parent.getChildCount(); i++) {
                WebView found = findWebView(parent.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private String evaluate(Activity activity, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        runOnMainSync(() -> {
            WebView view = findWebView(activity.getWindow().getDecorView());
            require(view != null, "MainActivity must contain its WebView");
            view.evaluateJavascript(script, value -> { result.set(value); done.countDown(); });
        });
        require(done.await(10, TimeUnit.SECONDS), "JavaScript evaluation timed out");
        return result.get();
    }

    private void awaitTrue(Activity activity, String script) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000;
        do {
            if ("true".equals(evaluate(activity, script))) return;
            SystemClock.sleep(100);
        } while (SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Timed out waiting for " + script);
    }

    private void assertBridge(Activity activity) throws Exception {
        awaitTrue(activity, "document.readyState === 'complete' && !!window.Capacitor?.Plugins?.TabBar");
        evaluate(activity, """
                window.__hwfeeBridgeTest = {done:false};
                (() => {
                  const p = window.Capacitor.Plugins;
                  Promise.all([p.Lessons.list(), p.Shanbay.hasCookie(), p.Llm.getConfig(),
                    p.Audio.nativeControl({action:'state'}), p.TabBar.getMetrics(),
                    p.TabBar.setState({tab:'listen',hidden:false})])
                    .then(([library, session, config, audio, metrics]) => {
                      window.__hwfeeBridgeTest = {done:true,
                        library: typeof library.data === 'string', session: typeof session.has === 'boolean',
                        config: !!config, audio: typeof audio.position === 'number',
                        available: metrics.available, reserve: metrics.reserve, navInset: metrics.navInset};
                    }).catch(error => { window.__hwfeeBridgeTest = {done:true,error:String(error)}; });
                })();
                """);
        awaitTrue(activity, "window.__hwfeeBridgeTest?.done === true");
        String encoded = evaluate(activity, "JSON.stringify(window.__hwfeeBridgeTest)");
        JSONObject result = new JSONObject(new JSONTokener(encoded).nextValue().toString());
        require(!result.has("error"), result.toString());
        for (String key : new String[]{"library", "session", "config", "audio", "available"})
            require(result.getBoolean(key), key + ": " + result);
        require(result.getDouble("reserve") >= 80, "Invalid bottom-bar clearance: " + result);
        require(result.getDouble("navInset") >= 0, "Invalid navigation inset: " + result);
    }

    @Override public void onStart() {
        Bundle test = new Bundle();
        test.putString("class", getClass().getName());
        test.putString("test", "nativeBridgeSurvivesShrinkingAndRecreation");
        test.putInt("numtests", 1);
        test.putInt("current", 1);
        test.putString("id", "InstrumentationTestRunner");
        sendStatus(1, test);
        Activity activity = null;
        Bundle result = new Bundle();
        int code = Activity.RESULT_OK;
        try {
            Intent intent = new Intent().setClassName(getTargetContext(), ACTIVITY)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            activity = startActivitySync(intent);
            assertBridge(activity);
            ActivityMonitor monitor = addMonitor(ACTIVITY, null, false);
            try {
                Activity first = activity;
                runOnMainSync(first::recreate);
                activity = waitForMonitorWithTimeout(monitor, 10_000);
                require(activity != null && activity != first, "Activity recreation timed out");
            } finally { removeMonitor(monitor); }
            assertBridge(activity);
            sendStatus(0, test);
            result.putString("stream", "\nOK (1 test)\n");
        } catch (Throwable error) {
            String stack = Log.getStackTraceString(error);
            test.putString("stack", stack);
            sendStatus(-2, test);
            result.putString("stream", stack);
            code = Activity.RESULT_CANCELED;
        } finally {
            if (activity != null) {
                Activity last = activity;
                runOnMainSync(last::finish);
                waitForIdleSync();
            }
        }
        finish(code, result);
    }
}

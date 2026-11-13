package com.hwfee.english;

import androidx.activity.result.ActivityResult;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.os.SystemClock;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.hwfee.english.glass.GlassState;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Runs against debug or the signed, R8-optimized release APK without enabling CDP. */
@RunWith(AndroidJUnit4.class)
public class NativeBridgeDeviceTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            done.countDown();
        }));
        assertTrue("WebView did not answer JavaScript", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitTrue(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000;
        do {
            if ("true".equals(evaluate(scenario, expression))) return;
            SystemClock.sleep(100);
        } while (SystemClock.elapsedRealtime() < deadline);
        fail("Timed out waiting for " + expression);
    }

    private void assertBridge(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitTrue(scenario, "document.readyState === 'complete' && !!window.Capacitor?.Plugins?.TabBar");
        evaluate(scenario, """
                window.__hwfeeBridgeTest = {done:false};
                (() => {
                  const p = window.Capacitor.Plugins;
                  Promise.all([p.Lessons.list(), p.Shanbay.hasCookie(), p.Llm.getConfig(),
                    p.Audio.nativeControl({action:'state'}), p.TabBar.getMetrics(),
                    p.TabBar.setState({tab:'listen',hidden:false})])
                    .then(([library, session, config, audio, metrics]) => {
                      window.__hwfeeBridgeTest = {done:true,
                        library: typeof library.data === 'string',
                        session: typeof session.has === 'boolean',
                        config: !!config, audio: typeof audio.position === 'number',
                        available: metrics.available, reserve: metrics.reserve,
                        navInset: metrics.navInset,
                        metricsListener: typeof p.TabBar.addListener === 'function'};
                    }).catch(error => { window.__hwfeeBridgeTest = {done:true,error:String(error)}; });
                })();
                """);
        awaitTrue(scenario, "window.__hwfeeBridgeTest?.done === true");
        // evaluateJavascript JSON-encodes a returned string a second time.
        String encoded = evaluate(scenario, "JSON.stringify(window.__hwfeeBridgeTest)");
        JSONObject result = new JSONObject(new org.json.JSONTokener(encoded).nextValue().toString());
        assertFalse(result.toString(), result.has("error"));
        for (String key : new String[]{"library", "session", "config", "audio", "available", "metricsListener"})
            assertTrue(key + ": " + result, result.getBoolean(key));
        assertTrue(result.getDouble("reserve") >= 80);
        assertTrue(result.getDouble("navInset") >= 0);
    }

    @Test public void bridgeAndPickerCallbackSurviveShrinkingAndActivityRecreation() throws Exception {
        Method picker = LessonsPlugin.class.getDeclaredMethod("zipPicked", PluginCall.class, ActivityResult.class);
        assertNotNull(picker.getAnnotation(ActivityCallback.class));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            assertBridge(scenario);
            Object first = GlassState.INSTANCE.getPlugin();
            assertNotNull(first);
            scenario.recreate();
            assertBridge(scenario);
            assertNotSame(first, GlassState.INSTANCE.getPlugin());
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        assertNull("Destroyed Activity must release the tab plugin", GlassState.INSTANCE.getPlugin());
    }
}

package com.hwfee.english;

import com.getcapacitor.JSObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class NativeAudioStateTest {
    @Test public void embeddedAudioNeverTravelsBackInProgressPacketsAndCommandsUseTheCurrentLease() {
        NativeAudioEngine engine = NativeAudioEngine.get(RuntimeEnvironment.getApplication());
        try {
            ReflectionHelpers.setField(engine, "source", "data:audio/mp4;base64," + "A".repeat(2 * 1024 * 1024));
            ReflectionHelpers.setField(engine, "sourceId", "current-document");
            JSObject state = engine.snapshot();
            assertEquals("", state.getString("source"));
            assertEquals("current-document", state.getString("sourceId"));
            assertTrue(state.toString().length() < 2048);
            assertTrue(engine.accepts("current-document"));
            assertFalse(engine.accepts("obsolete-document"));
            assertTrue(engine.accepts(null)); // System and legacy controls still target the active lesson.
        } finally {
            ReflectionHelpers.setField(engine, "source", "");
            ReflectionHelpers.setField(engine, "sourceId", "");
        }
    }
}

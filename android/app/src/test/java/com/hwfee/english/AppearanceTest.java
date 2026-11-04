package com.hwfee.english;

import android.content.Context;
import android.content.res.Configuration;
import androidx.appcompat.app.AppCompatDelegate;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class AppearanceTest {
    private final Context context = RuntimeEnvironment.getApplication();

    @After public void reset() { Appearance.setMode(context, "system"); }

    @Test public void manualAppearancePersistsAndAppliesTheNativeDayNightMode() {
        Appearance.setMode(context, "dark");
        assertEquals("dark", Appearance.getMode(context));
        assertEquals(AppCompatDelegate.MODE_NIGHT_YES, AppCompatDelegate.getDefaultNightMode());
        assertTrue(Appearance.isDark(context, Appearance.getMode(context)));
        Appearance.setMode(context, "light");
        assertEquals("light", Appearance.getMode(context));
        assertEquals(AppCompatDelegate.MODE_NIGHT_NO, AppCompatDelegate.getDefaultNightMode());
        assertFalse(Appearance.isDark(context, Appearance.getMode(context)));
    }

    @Test public void systemAppearanceReadsTheCurrentConfiguration() {
        Appearance.setMode(context, "system");
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | Configuration.UI_MODE_NIGHT_YES;
        assertTrue(Appearance.isDark(context.createConfigurationContext(config), "system"));
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | Configuration.UI_MODE_NIGHT_NO;
        assertFalse(Appearance.isDark(context.createConfigurationContext(config), "system"));
    }

    @Test public void invalidModeCannotOverwriteTheSavedChoice() {
        Appearance.setMode(context, "dark");
        try { Appearance.setMode(context, "invalid"); fail("invalid mode must fail"); }
        catch (IllegalArgumentException expected) { }
        assertEquals("dark", Appearance.getMode(context));
    }
}

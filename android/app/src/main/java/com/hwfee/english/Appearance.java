package com.hwfee.english;

import android.content.Context;
import android.content.res.Configuration;

import androidx.appcompat.app.AppCompatDelegate;

/** Persistent app appearance. DayNight also drives WebView prefers-color-scheme and Compose. */
public final class Appearance {
    private static final String PREFS = "hwfee-appearance";
    private static final String KEY = "mode";

    private Appearance() {}

    public static String getMode(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, "system");
    }

    public static void apply(Context context) {
        AppCompatDelegate.setDefaultNightMode(nightMode(getMode(context)));
    }

    public static void setMode(Context context, String mode) {
        int nightMode = nightMode(mode); // validate before persisting
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, mode).apply();
        AppCompatDelegate.setDefaultNightMode(nightMode);
    }

    public static boolean isDark(Context context, String mode) {
        if ("dark".equals(mode)) return true;
        if ("light".equals(mode)) return false;
        return (context.getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    static int nightMode(String mode) {
        if ("system".equals(mode)) return AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
        if ("light".equals(mode)) return AppCompatDelegate.MODE_NIGHT_NO;
        if ("dark".equals(mode)) return AppCompatDelegate.MODE_NIGHT_YES;
        throw new IllegalArgumentException("Unknown appearance mode");
    }
}

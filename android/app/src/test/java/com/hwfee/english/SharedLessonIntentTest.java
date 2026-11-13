package com.hwfee.english;

import android.content.Intent;
import android.net.Uri;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class SharedLessonIntentTest {
    private MainActivity activity;
    private final Uri lesson = Uri.parse("content://documents.example/lesson.zip");

    @Before public void setup() {
        MainActivity.takePendingShare();
        // Only exercise incoming intents; constructing a bridge would load the UI.
        activity = Robolectric.buildActivity(MainActivity.class).get();
    }

    @After public void cleanup() { MainActivity.takePendingShare(); }

    @Test public void openWithAndShareAcceptProviderUrisExactlyOnce() {
        activity.handleIntent(new Intent(Intent.ACTION_VIEW, lesson));
        assertEquals(lesson, MainActivity.takePendingShare());
        assertNull(MainActivity.takePendingShare());
        activity.handleIntent(new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, lesson));
        assertEquals(lesson, MainActivity.takePendingShare());
        assertNull(MainActivity.takePendingShare());
    }

    @Test public void explicitIntentsCannotImportPrivateFilesOrOtherSchemes() {
        String[] unsafe = {"file:///data/user/0/com.hwfee.english/files/private.zip",
                "file:///sdcard/Download/lesson.zip", "https://example.com/lesson.zip",
                "content:/lesson.zip", "data:application/zip;base64,AA=="};
        for (String value : unsafe) {
            Uri uri = Uri.parse(value);
            activity.handleIntent(new Intent(Intent.ACTION_VIEW, uri));
            assertNull(value, MainActivity.takePendingShare());
            activity.handleIntent(new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri));
            assertNull(value, MainActivity.takePendingShare());
        }
    }

    @Test public void invalidOrUnrelatedIntentsDoNotEraseAnUnconsumedImport() {
        activity.handleIntent(new Intent(Intent.ACTION_VIEW, lesson));
        activity.handleIntent(null);
        activity.handleIntent(new Intent(Intent.ACTION_MAIN, Uri.parse("content://other/lesson.zip")));
        activity.handleIntent(new Intent(Intent.ACTION_SEND));
        activity.handleIntent(new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, new Intent()));
        activity.handleIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("file:///private.zip")));
        assertEquals(lesson, MainActivity.takePendingShare());
    }
}

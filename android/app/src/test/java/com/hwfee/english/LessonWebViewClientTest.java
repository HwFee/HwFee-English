package com.hwfee.english;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.Collections;
import java.util.Map;

import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class LessonWebViewClientTest {
    private final LessonWebViewClient client = new LessonWebViewClient(null, null);

    private WebResourceRequest request(String url) {
        return new WebResourceRequest() {
            public Uri getUrl() { return Uri.parse(url); }
            public boolean isForMainFrame() { return false; }
            public boolean isRedirect() { return false; }
            public boolean hasGesture() { return false; }
            public String getMethod() { return "GET"; }
            public Map<String, String> getRequestHeaders() { return Collections.emptyMap(); }
        };
    }

    @Test public void remoteOriginsCannotReadLocalLessonsOrLibrary() {
        for (String url : new String[]{"https://attacker.invalid/lessons/course/player.html",
                "https://attacker.invalid/listen/library.html", "http://localhost/lessons/course/player.html",
                "https://localhost:8443/lessons/course/player.html"}) {
            WebResourceResponse response = client.shouldInterceptRequest(null, request(url));
            assertEquals(url, 404, response.getStatusCode());
        }
    }

    @Test public void appPagesCannotUseCapacitorToReadPrivateFilesOrContentProviders() {
        for (String url : new String[]{"https://localhost/_capacitor_file_/data/data/com.hwfee.english/app_webview/Cookies",
                "https://localhost/_capacitor_content_/content/provider/private",
                "https://localhost/_capacitor_file_%2Fdata%2Fprivate",
                "file:///data/data/com.hwfee.english/shared_prefs/hwfee-vault.xml",
                "content://com.hwfee.english.fileprovider/private"}) {
            assertEquals(url, 404, client.shouldInterceptRequest(null, request(url)).getStatusCode());
        }
    }

    @Test public void validatesSchemeAuthorityAndPortTogether() {
        assertTrue(LessonWebViewClient.isAppOrigin(Uri.parse("https://localhost/lessons/example/player.html")));
        assertTrue(LessonWebViewClient.isAppOrigin(Uri.parse("https://localhost:443/listen/library.html")));
        for (String url : new String[]{"http://localhost", "https://localhost.attacker.invalid",
                "https://attacker@localhost", "https://localhost:8443", "file://localhost/lessons/example"}) {
            assertFalse(url, LessonWebViewClient.isAppOrigin(Uri.parse(url)));
        }
    }
}

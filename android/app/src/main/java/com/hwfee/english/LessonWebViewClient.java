package com.hwfee.english;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Adds two routes to Capacitor's own asset server:
 *   /lessons/&lt;id&gt;/...   imported lesson files, with byte ranges honoured
 *   /listen/library.html  the library template with the live lesson index injected
 * Everything else falls through to Capacitor untouched.
 */
public class LessonWebViewClient extends BridgeWebViewClient {

    private final LessonStore store;

    public LessonWebViewClient(Bridge bridge, LessonStore store) {
        super(bridge);
        this.store = store;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        // This app never uses Capacitor's generic filesystem/content proxy. In a
        // shared-origin lesson, that proxy could expose WebView cookies and app files.
        if ("file".equalsIgnoreCase(url.getScheme()) || "content".equalsIgnoreCase(url.getScheme())
                || (isAppOrigin(url) && path != null && (path.startsWith("/_capacitor_file_")
                || path.startsWith("/_capacitor_content_")))) {
            return LessonServer.notFound();
        }
        if (path != null) {
            try {
                if (path.startsWith("/lessons/")) {
                    if (!isAppOrigin(url)) return LessonServer.notFound();
                    return LessonServer.serveLesson(store, request);
                }
                if (path.equals("/listen/library.html")) {
                    if (!isAppOrigin(url)) return LessonServer.notFound();
                    return LessonServer.serveLibrary(view.getContext(), store);
                }
            } catch (Exception error) {
                return LessonServer.error("text/plain", "读取失败：" + error.getMessage());
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    static boolean isAppOrigin(Uri url) {
        return "https".equalsIgnoreCase(url.getScheme())
                && "localhost".equalsIgnoreCase(url.getHost())
                && (url.getPort() == -1 || url.getPort() == 443)
                && url.getUserInfo() == null;
    }
}

package com.hwfee.english;

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
        String path = request.getUrl().getPath();
        if (path != null) {
            try {
                if (path.startsWith("/lessons/")) {
                    return LessonServer.serveLesson(store, request);
                }
                if (path.equals("/listen/library.html")) {
                    return LessonServer.serveLibrary(view.getContext(), store);
                }
            } catch (Exception error) {
                return LessonServer.error("text/plain", "读取失败：" + error.getMessage());
            }
        }
        return super.shouldInterceptRequest(view, request);
    }
}

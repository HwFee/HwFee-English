package com.hwfee.english;

import android.app.Activity;
import android.content.Context;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.Bundle;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.PluginCall;

/** Gives the system PDF saver a dedicated full handout, preserving the selected print range. */
final class HandoutPdfExporter {
    private final Activity activity;
    private final Bridge bridge;
    private final Runnable onClose;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView view;
    private PluginCall pending;
    private boolean started;
    private boolean closed;
    private final Runnable timeout = () -> fail("讲义准备超时，请重试");

    HandoutPdfExporter(Activity activity, Bridge bridge, Runnable onClose) {
        this.activity = activity;
        this.bridge = bridge;
        this.onClose = onClose;
    }

    void open(String html, String baseUrl, String title, PluginCall call) {
        pending = call;
        view = new WebView(activity);
        view.getSettings().setJavaScriptEnabled(false);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.setWebViewClient(new LessonWebViewClient(bridge, LessonStore.get(activity)) {
            @Override public void onPageFinished(WebView loaded, String url) {
                if (started || closed) return;
                started = true;
                handler.removeCallbacks(timeout);
                try {
                    PrintManager manager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    if (manager == null) { fail("系统 PDF 保存服务不可用"); return; }
                    PrintDocumentAdapter document = loaded.createPrintDocumentAdapter(title);
                    // The framework owns layout/write callbacks; onFinish releases this WebView.
                    PrintDocumentAdapter lifecycle = new PrintDocumentAdapter() {
                        @Override public void onStart() { document.onStart(); }
                        @Override public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                CancellationSignal signal, LayoutResultCallback callback, Bundle extras) {
                            document.onLayout(oldAttributes, newAttributes, signal, callback, extras);
                        }
                        @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                CancellationSignal signal, WriteResultCallback callback) {
                            document.onWrite(pages, destination, signal, callback);
                        }
                        @Override public void onFinish() {
                            try { document.onFinish(); } finally { close(); }
                        }
                    };
                    manager.print(title, lifecycle, new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build());
                    if (pending != null) { pending.resolve(); pending = null; }
                } catch (Exception error) { fail("无法打开系统 PDF 保存界面：" + error.getMessage()); }
            }
        });
        handler.postDelayed(timeout, 20000);
        view.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null);
    }

    private void fail(String message) {
        if (pending != null) { pending.reject(message); pending = null; }
        close();
    }

    void close() {
        if (closed) return;
        closed = true;
        handler.removeCallbacks(timeout);
        if (view != null) { view.stopLoading(); view.destroy(); view = null; }
        onClose.run();
    }
}

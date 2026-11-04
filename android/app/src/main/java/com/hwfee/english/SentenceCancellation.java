package com.hwfee.english;

import java.net.HttpURLConnection;

/** Cancels a shared sentence operation only after its last subscriber leaves. */
final class SentenceCancellation {
    private boolean cancelled;
    private HttpURLConnection connection;

    synchronized boolean cancelled() { return cancelled; }

    synchronized void bind(HttpURLConnection next) throws ShanbaySseClient.Failure {
        if (cancelled) { next.disconnect(); throw new ShanbaySseClient.Failure("CANCELLED", "请求已取消"); }
        connection = next;
    }

    synchronized void unbind(HttpURLConnection previous) { if (connection == previous) connection = null; }

    void cancel() {
        HttpURLConnection active;
        synchronized (this) { cancelled = true; active = connection; }
        if (active != null) active.disconnect();
    }
}

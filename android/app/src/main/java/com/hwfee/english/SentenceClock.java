package com.hwfee.english;

import android.media.MediaTimestamp;

/** Read the audio presentation clock without extrapolating across seeks or buffering. */
final class SentenceClock {
    private SentenceClock() {}

    @SuppressWarnings("deprecation") // Misspelled getter is the API 23-compatible name.
    static long position(long coarseMillis, MediaTimestamp timestamp, long nowNanos) {
        if (timestamp == null) return coarseMillis;
        long mediaMicros = timestamp.getAnchorMediaTimeUs();
        long age = nowNanos - timestamp.getAnchorSytemNanoTime();
        float speed = timestamp.getMediaClockRate();
        // Reject unknown, future, stale or stopped clocks. The MediaPlayer position
        // remains the fallback on devices that cannot provide a presentation timestamp.
        if (mediaMicros < 0 || age < 0 || age > 1_000_000_000L
                || !Float.isFinite(speed) || speed <= 0 || speed > 3) return coarseMillis;
        double millis = mediaMicros / 1000.0 + age / 1_000_000.0 * speed;
        return Double.isFinite(millis) ? Math.max(0, Math.round(millis)) : coarseMillis;
    }
}

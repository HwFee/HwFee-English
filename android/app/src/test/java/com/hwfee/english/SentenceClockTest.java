package com.hwfee.english;

import android.media.MediaTimestamp;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import static org.junit.Assert.assertEquals;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class SentenceClockTest {
    // This constructor was package-private on older Android releases; only the
    // test manufactures timestamps. Production receives them from MediaPlayer.
    static MediaTimestamp timestamp(long mediaMicros, long systemNanos, float rate) {
        return ReflectionHelpers.callConstructor(MediaTimestamp.class,
                ReflectionHelpers.ClassParameter.from(long.class, mediaMicros),
                ReflectionHelpers.ClassParameter.from(long.class, systemNanos),
                ReflectionHelpers.ClassParameter.from(float.class, rate));
    }

    @Test public void usesPresentationTimeAndActualPlaybackSpeed() {
        MediaTimestamp timestamp = timestamp(10_000_000, 1_000_000_000, 1.5f);
        assertEquals(10150, SentenceClock.position(10000, timestamp, 1_100_000_000));
    }

    @Test public void bufferingUnknownFutureAndStaleClocksNeverInventPlayback() {
        assertEquals(9000, SentenceClock.position(9000, null, 1_100_000_000));
        assertEquals(9000, SentenceClock.position(9000, timestamp(10_000_000, 1_000_000_000, 0), 1_100_000_000));
        assertEquals(9000, SentenceClock.position(9000, timestamp(10_000_000, 2_000_000_000, 1), 1_100_000_000));
        assertEquals(9000, SentenceClock.position(9000, timestamp(10_000_000, 0, 1), 2_000_000_000));
        assertEquals(9000, SentenceClock.position(9000, MediaTimestamp.TIMESTAMP_UNKNOWN, 1_100_000_000));
    }
}

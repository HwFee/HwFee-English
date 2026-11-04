package com.hwfee.english;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;
import static org.junit.Assert.*;

public class DeepSeekBalanceClientTest {
    private static final String KEY = "test-only-balance-key";
    private static final String BALANCE = "{\"is_available\":true,\"balance_infos\":[{\"currency\":\"CNY\","
            + "\"total_balance\":\"1234567890.123456789012345678\",\"granted_balance\":\"0.00\",\"topped_up_balance\":\"1234567890.123456789012345678\"}]}";
    private MockWebServer server;
    private final LlmClient.Config official = new LlmClient.Config(null, null);
    private final AtomicLong now = new AtomicLong(1793685804000L);
    private DeepSeekBalanceClient client;

    @Before public void start() throws Exception {
        server = new MockWebServer(); server.start();
        client = new DeepSeekBalanceClient(server.url("").toString(), 1000, 1000, 3000, now::get);
    }

    @After public void stop() throws Exception { server.shutdown(); }

    @Test public void readsAccountWithoutSendingModelOrConsumingCompletionUsageAndKeepsExactAmounts() throws Exception {
        server.enqueue(new MockResponse().setBody(BALANCE));
        JSONObject result = client.get(" " + KEY + " ", new LlmClient.Config("https://api.deepseek.com/v1", "any-model"), false);
        assertEquals(1, result.getInt("schemaVersion"));
        assertEquals("deepseek", result.getString("provider"));
        assertTrue(result.getBoolean("isAvailable")); assertFalse(result.getBoolean("cached"));
        JSONObject money = result.getJSONArray("balanceInfos").getJSONObject(0);
        assertEquals("CNY", money.getString("currency"));
        assertEquals("1234567890.123456789012345678", money.getString("totalBalance"));
        assertEquals("0.00", money.getString("grantedBalance"));
        assertEquals(now.get(), result.getLong("observedAt"));
        assertEquals(now.get() + 60000, result.getLong("expiresAt"));
        assertFalse(result.toString().contains(KEY));
        RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
        assertNotNull(request); assertEquals("GET", request.getMethod()); assertEquals("/user/balance", request.getPath());
        assertEquals("Bearer " + KEY, request.getHeader("Authorization")); assertEquals(0, request.getBodySize());
        assertNull(request.getHeader("Cookie"));
    }

    @Test public void cacheExpiresAfterSixtySecondsAndRefreshInvalidationAndKeyChangesAvoidStaleBalances() throws Exception {
        server.enqueue(new MockResponse().setBody(BALANCE));
        client.get(KEY, official, false);
        JSONObject shared = client.get(KEY, official, false); assertTrue(shared.getBoolean("cached"));
        shared.getJSONArray("balanceInfos").getJSONObject(0).put("totalBalance", "wrong");
        assertEquals("1234567890.123456789012345678", client.get(KEY, official, false)
                .getJSONArray("balanceInfos").getJSONObject(0).getString("totalBalance"));
        assertEquals(1, server.getRequestCount());
        now.addAndGet(60000);
        server.enqueue(new MockResponse().setBody(BALANCE)); assertFalse(client.get(KEY, official, false).getBoolean("cached"));
        server.enqueue(new MockResponse().setBody(BALANCE)); assertFalse(client.get(KEY, official, true).getBoolean("cached"));
        client.invalidate();
        server.enqueue(new MockResponse().setBody(BALANCE)); assertFalse(client.get(KEY, official, false).getBoolean("cached"));
        server.enqueue(new MockResponse().setBody(BALANCE)); assertFalse(client.get("different-account-key", official, false).getBoolean("cached"));
        assertEquals(5, server.getRequestCount());
    }

    @Test public void simultaneousForcedRefreshesShareTheSameHttpRequest() throws Exception {
        server.enqueue(new MockResponse().setBody(BALANCE).setBodyDelay(500, TimeUnit.MILLISECONDS));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<JSONObject> first = pool.submit(() -> client.get(KEY, official, true));
            assertNotNull(server.takeRequest(1, TimeUnit.SECONDS));
            Future<JSONObject> second = pool.submit(() -> client.get(KEY, official, true));
            assertFalse(first.get(3, TimeUnit.SECONDS).getBoolean("cached"));
            assertFalse(second.get(3, TimeUnit.SECONDS).getBoolean("cached"));
            assertEquals(1, server.getRequestCount());
        } finally { pool.shutdownNow(); }
    }

    @Test public void invalidationDuringARequestPreventsItFromRestoringAClearedCache() throws Exception {
        server.enqueue(new MockResponse().setBody(BALANCE).setBodyDelay(200, TimeUnit.MILLISECONDS));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<JSONObject> old = pool.submit(() -> client.get(KEY, official, false));
            assertNotNull(server.takeRequest(1, TimeUnit.SECONDS)); client.invalidate(); old.get(3, TimeUnit.SECONDS);
            server.enqueue(new MockResponse().setBody(BALANCE));
            assertFalse(client.get(KEY, official, false).getBoolean("cached")); assertEquals(2, server.getRequestCount());
        } finally { pool.shutdownNow(); }
    }

    @Test public void missingInvalidAndNonDeepSeekKeysFailBeforeAnyNetworkRequest() {
        assertEquals("NO_API_KEY", assertThrows(DeepSeekBalanceClient.Failure.class, () -> client.get(null, official, false)).code);
        assertEquals("INVALID_API_KEY", assertThrows(DeepSeekBalanceClient.Failure.class, () -> client.get(KEY + "\n", official, false)).code);
        for (String base : new String[]{"https://provider.invalid/v1", "http://api.deepseek.com", "https://api.deepseek.com.attacker.invalid", "https://api.deepseek.com:8443"}) {
            assertEquals("UNSUPPORTED_PROVIDER", assertThrows(DeepSeekBalanceClient.Failure.class,
                    () -> client.get(KEY, new LlmClient.Config(base, null), false)).code);
        }
        assertEquals(0, server.getRequestCount());
    }

    @Test public void refusesRedirectsSanitizesAllHttpErrorsAndDoesNotCacheFailures() throws Exception {
        int[] statuses = {307, 401, 403, 429, 500};
        String[] codes = {"REDIRECT_REFUSED", "UNAUTHORIZED", "FORBIDDEN", "RATE_LIMITED", "HTTP_ERROR"};
        for (int i = 0; i < statuses.length; i++) {
            server.enqueue(new MockResponse().setResponseCode(statuses[i]).addHeader("Location", server.url("/other"))
                    .setBody("provider echoed " + KEY));
            DeepSeekBalanceClient.Failure failure = assertThrows(DeepSeekBalanceClient.Failure.class, () -> client.get(KEY, official, false));
            assertEquals(codes[i], failure.code); assertFalse(failure.getMessage().contains(KEY));
        }
        assertEquals(statuses.length, server.getRequestCount());
        server.enqueue(new MockResponse().setBody(BALANCE)); assertFalse(client.get(KEY, official, false).getBoolean("cached"));
    }

    @Test public void rejectsMalformedOrOversizedMoneyAndPreservesUnavailableAndMultiCurrencyResults() throws Exception {
        for (String body : new String[]{"not JSON " + KEY, "{}", BALANCE.replace("true", "\"true\""),
                BALANCE.replace("\"0.00\"", "0.0"), BALANCE.replace("\"0.00\"", "\"NaN\""),
                BALANCE.replace("\"0.00\"", "\"1e1000\""), BALANCE.replace("\"CNY\"", "\"BTC\""),
                "x".repeat(DeepSeekBalanceClient.MAX_BYTES + 1)}) {
            server.enqueue(new MockResponse().setBody(body));
            DeepSeekBalanceClient.Failure failure = assertThrows(DeepSeekBalanceClient.Failure.class, () -> client.get(KEY, official, false));
            assertEquals("INVALID_RESPONSE", failure.code); assertFalse(failure.getMessage().contains(KEY));
        }
        JSONObject multi = new JSONObject(BALANCE);
        multi.put("is_available", false);
        multi.getJSONArray("balance_infos").getJSONObject(0).put("total_balance", "-0.01");
        multi.getJSONArray("balance_infos").put(new JSONObject().put("currency", "USD").put("total_balance", "0.00")
                .put("granted_balance", "0").put("topped_up_balance", "0.00"));
        server.enqueue(new MockResponse().setBody(multi.toString()));
        JSONObject result = client.get(KEY, official, false); assertFalse(result.getBoolean("isAvailable"));
        assertEquals(2, result.getJSONArray("balanceInfos").length());
        assertEquals("-0.01", result.getJSONArray("balanceInfos").getJSONObject(0).getString("totalBalance"));
        assertEquals(0, DeepSeekBalanceClient.parse("{\"is_available\":false,\"balance_infos\":[]}").getJSONArray("balanceInfos").length());
    }

    @Test public void timeoutsBoundBothInactivityAndSlowTrickleResponses() {
        DeepSeekBalanceClient shortRead = new DeepSeekBalanceClient(server.url("").toString(), 500, 80, 1500);
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
        assertEquals("TIMEOUT", assertThrows(DeepSeekBalanceClient.Failure.class, () -> shortRead.get(KEY, official, false)).code);
        DeepSeekBalanceClient deadline = new DeepSeekBalanceClient(server.url("").toString(), 500, 1000, 150);
        server.enqueue(new MockResponse().setBody(BALANCE).throttleBody(1, 25, TimeUnit.MILLISECONDS));
        long started = System.nanoTime();
        assertEquals("TIMEOUT", assertThrows(DeepSeekBalanceClient.Failure.class, () -> deadline.get(KEY, official, false)).code);
        assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started) < 1500);
    }
}

package com.hwfee.english;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 23, manifest = Config.NONE)
public class UsageStoreTest {
    private Context context;
    private MockWebServer bay, api;
    private LlmCache cache;
    private UsageStore usage;
    private SentenceService service;
    private SentenceService.Settings settings;

    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication(); context.deleteDatabase("llm-cache.db");
        bay = new MockWebServer(); bay.start(); api = new MockWebServer(); api.start();
        open();
    }
    private void open() {
        cache = new LlmCache(context); usage = new UsageStore(cache);
        LlmRepository fallback = new LlmRepository(cache, new LlmClient(1000, 1000, usage.observer()));
        service = new SentenceService(cache, fallback, new ShanbaySseClient(bay.url("").toString().replaceAll("/$", ""), 1000, 1000, 2000), usage);
        settings = new SentenceService.Settings(null, "fixture-secret-key", new LlmClient.Config(api.url("/v1").toString(), "fixture-model"));
    }
    @After public void close() throws Exception { cache.close(); bay.shutdown(); api.shutdown(); }
    private MockResponse response(String content, JSONObject tokens) throws Exception {
        JSONObject body = new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("finish_reason", "stop")
                .put("message", new JSONObject().put("content", content))));
        if (tokens != null) body.put("usage", tokens);
        return new MockResponse().setBody(body.toString());
    }
    private JSONObject tokenUsage() throws Exception {
        return new JSONObject().put("prompt_tokens", 123).put("completion_tokens", 45).put("total_tokens", 168)
                .put("prompt_cache_hit_tokens", 20).put("completion_tokens_details", new JSONObject().put("reasoning_tokens", 4));
    }
    private MockResponse bayResponse() {
        return new MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "event: token\ndata: {\"t\":\"你好。\"}\n\nevent: usage\ndata: {\"remaining_percent\":84}\n\n"
                        + "event: done\ndata: {\"t\":\"你好。\"}\n\n");
    }

    @Test public void emptyUsageIsLocalAndUnknownValuesAreNotFabricatedAsZero() throws Exception {
        JSONObject snapshot = service.usage(settings, 30);
        assertTrue(snapshot.getJSONObject("shanbay").isNull("remainingPercent"));
        assertTrue(snapshot.getJSONObject("shanbay").isNull("accountUsedPercent"));
        assertTrue(snapshot.getJSONObject("llm").getJSONObject("stats").isNull("totalTokens"));
        assertEquals(0, snapshot.getJSONObject("llm").getJSONObject("stats").getInt("requests"));
        assertEquals(0, bay.getRequestCount()); assertEquals(0, api.getRequestCount());
        assertEquals("Asia/Shanghai", snapshot.getJSONObject("period").getString("timeZone"));
        assertThrows(IllegalArgumentException.class, () -> service.usage(settings, 0));
        assertThrows(IllegalArgumentException.class, () -> service.usage(settings, 3651));
    }

    @Test public void actualDeepSeekUsageShapeProducesTheObservedLocalTotalsWithoutAnotherNetworkRequest() throws Exception {
        // Numeric-only shapes captured from the authorized 2026-11-03 live verification.
        int[] inputs = {72, 280, 158}, outputs = {26, 430, 69};
        String[] tasks = {"translation", "analysis", "pretranslation"};
        LlmClient.Config config = new LlmClient.Config(null, null);
        for (int i = 0; i < tasks.length; i++) usage.llm(config, tasks[i], true,
                new JSONObject().put("prompt_tokens", inputs[i]).put("completion_tokens", outputs[i])
                        .put("total_tokens", inputs[i] + outputs[i]).put("prompt_cache_hit_tokens", 0)
                        .put("prompt_cache_miss_tokens", inputs[i])
                        .put("prompt_tokens_details", new JSONObject().put("cached_tokens", 0)), 100);
        JSONObject snapshot = service.usage(settings, 30), stats = snapshot.getJSONObject("llm").getJSONObject("stats");
        assertEquals(3, stats.getInt("requests")); assertEquals(3, stats.getInt("usageReports"));
        assertEquals(510, stats.getInt("inputTokens")); assertEquals(525, stats.getInt("outputTokens"));
        assertEquals(1035, stats.getInt("totalTokens")); assertEquals(0, stats.getInt("cachedInputTokens"));
        assertTrue(stats.getBoolean("tokenStatsComplete"));
        assertEquals(0, api.getRequestCount()); assertEquals(0, bay.getRequestCount());
    }

    @Test public void oneApiRequestAndACacheHitPersistWithoutDoubleCountingItsTokens() throws Exception {
        api.enqueue(response("你好。", tokenUsage()));
        service.request(settings, "translation", "Hello.", "first");
        service.request(settings, "translation", "Hello.", "cached");
        JSONObject snapshot = service.usage(settings, 1);
        JSONObject stats = snapshot.getJSONObject("llm").getJSONObject("stats");
        assertEquals(1, stats.getInt("requests")); assertEquals(1, stats.getInt("cacheHits"));
        assertEquals(123, stats.getInt("inputTokens")); assertEquals(45, stats.getInt("outputTokens"));
        assertEquals(168, stats.getInt("totalTokens")); assertEquals(20, stats.getInt("cachedInputTokens"));
        assertEquals(4, stats.getInt("reasoningTokens")); assertTrue(stats.getBoolean("tokenStatsComplete"));
        assertEquals(0, stats.getInt("missingUsageRequests"));
        assertEquals(1, snapshot.getJSONObject("llm").getJSONArray("byModel").length());
        assertEquals(1, snapshot.getJSONArray("daily").length());
        assertFalse(snapshot.toString().contains("fixture-secret-key")); assertFalse(snapshot.toString().contains("Hello."));
        cache.close(); open();
        assertEquals(168, service.usage(settings, 30).getJSONObject("llm").getJSONObject("stats").getInt("totalTokens"));
        assertEquals(1, api.getRequestCount());
    }

    @Test public void providersWithoutUsageAndInvalidTokenCountsStayExplicitlyIncomplete() throws Exception {
        api.enqueue(response("甲", null));
        api.enqueue(response("乙", new JSONObject().put("prompt_tokens", -1).put("completion_tokens", "five").put("total_tokens", 1.5)));
        service.request(settings, "translation", "First.", "first");
        service.request(settings, "translation", "Second.", "second");
        JSONObject stats = service.usage(settings, 30).getJSONObject("llm").getJSONObject("stats");
        assertEquals(2, stats.getInt("requests")); assertEquals(2, stats.getInt("missingUsageRequests"));
        assertTrue(stats.isNull("inputTokens")); assertTrue(stats.isNull("outputTokens")); assertTrue(stats.isNull("totalTokens"));
        assertFalse(stats.getBoolean("tokenStatsComplete"));
    }

    @Test public void failedProviderCallsAreCountedButDoNotInventBillableTokens() throws Exception {
        api.enqueue(new MockResponse().setResponseCode(402));
        assertThrows(ShanbaySseClient.Failure.class, () -> service.request(settings, "translation", "Hello.", "failed"));
        JSONObject stats = service.usage(settings, 30).getJSONObject("llm").getJSONObject("stats");
        assertEquals(1, stats.getInt("requests")); assertEquals(1, stats.getInt("failures"));
        assertTrue(stats.isNull("totalTokens")); assertEquals(0, service.usage(settings, 30).getJSONObject("llm").getInt("inFlight"));
    }

    @Test public void batchesCountOneApiCallWhileJobAndCachedSentenceCountersRemainSeparate() throws Exception {
        JSONArray translations = new JSONArray();
        for (int i = 0; i < 3; i++) translations.put(new JSONObject().put("id", i).put("translation", "译文" + i));
        api.enqueue(response(new JSONObject().put("translations", translations).toString(), tokenUsage()));
        service.pretranslate(settings, Arrays.asList("One.", "Two.", "Three."), () -> true);
        service.pretranslate(settings, Arrays.asList("One.", "Two.", "Three."), () -> true);
        JSONObject snapshot = service.usage(settings, 30);
        JSONObject stats = snapshot.getJSONObject("llm").getJSONObject("stats"), jobs = snapshot.getJSONObject("pretranslation");
        assertEquals(1, stats.getInt("requests")); assertEquals(168, stats.getInt("totalTokens"));
        assertEquals(3, stats.getInt("cacheHits")); assertEquals(2, jobs.getInt("runs"));
        assertEquals(6, jobs.getInt("completedSentences")); assertEquals(3, jobs.getInt("cachedSentences"));
        assertEquals(6, jobs.getInt("llmSentences")); assertEquals(0, jobs.getInt("failedRuns"));
        assertEquals(1, api.getRequestCount()); assertEquals(0, bay.getRequestCount());
    }

    @Test public void currentQuotaAndInFlightCountsCanBeReadWithoutAnotherMeteredRequest() throws Exception {
        settings = new SentenceService.Settings("auth_token=usage-fixture; csrftoken=csrf", null, settings.config);
        bay.enqueue(bayResponse().setBodyDelay(250, TimeUnit.MILLISECONDS));
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<SentenceService.Answer> pending = worker.submit(() -> service.request(settings, "translation", "Hello.", "live"));
            assertNotNull(bay.takeRequest(1, TimeUnit.SECONDS));
            assertEquals(1, service.usage(settings, 30).getJSONObject("shanbay").getInt("inFlight"));
            pending.get(2, TimeUnit.SECONDS);
            JSONObject account = service.usage(settings, 30).getJSONObject("shanbay");
            assertEquals(84, account.getInt("remainingPercent")); assertEquals(16, account.getInt("accountUsedPercent"));
            assertFalse(account.isNull("usageAt")); assertEquals(0, account.getInt("inFlight"));
            assertEquals(1, account.getJSONObject("stats").getInt("requests"));
            assertEquals(1, bay.getRequestCount()); assertEquals(0, api.getRequestCount());
        } finally { worker.shutdownNow(); }
    }

    @Test public void quotaFailureExposesTheResetAndAvailabilityWithoutProbingAgain() throws Exception {
        settings = new SentenceService.Settings("auth_token=quota-fixture; csrftoken=csrf", null, settings.config);
        bay.enqueue(new MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "event: quota_exceeded\ndata: {\"reset_at\":\"2026-11-04T00:00:00+08:00\"}\n\n"));
        assertThrows(ShanbaySseClient.Failure.class, () -> service.request(settings, "translation", "Hello.", "quota"));
        JSONObject account = service.usage(settings, 30).getJSONObject("shanbay");
        assertEquals(0, account.getInt("remainingPercent")); assertEquals("2026-11-04T00:00:00+08:00", account.getString("resetAt"));
        assertFalse(account.getJSONObject("availability").getJSONObject("translation").getBoolean("canRequest"));
        assertEquals("QUOTA_EXCEEDED", account.getJSONObject("availability").getJSONObject("analysis").getString("code"));
        assertEquals(1, bay.getRequestCount());
    }

    @Test public void databaseUpgradePreservesExistingTranslationsAndCreatesTheNumericLedger() throws Exception {
        cache.close(); context.deleteDatabase("llm-cache.db");
        SQLiteDatabase old = context.openOrCreateDatabase("llm-cache.db", Context.MODE_PRIVATE, null);
        old.execSQL("CREATE TABLE answers(id TEXT PRIMARY KEY,value TEXT NOT NULL,created INTEGER NOT NULL)");
        old.execSQL("INSERT INTO answers VALUES('old-cache','old translation',?)", new Object[]{System.currentTimeMillis()});
        old.setVersion(1); old.close();
        open();
        assertEquals("old translation", cache.get("old-cache", System.currentTimeMillis()));
        assertEquals(0, service.usage(settings, 30).getJSONObject("llm").getJSONObject("stats").getInt("requests"));
    }

    @Test public void timezoneAndSessionStatisticsKeepTheirMeaningAcrossAccountChanges() throws Exception {
        java.util.Calendar utc = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        utc.clear(); utc.set(2026, java.util.Calendar.NOVEMBER, 2, 16, 0, 0);
        assertEquals("2026-11-03", UsageStore.day(utc.getTimeInMillis()));
        usage.request("shanbay", "account-a", "扇贝", "analysis", true, false, 20, null);
        usage.request("shanbay", "account-b", "扇贝", "translation", true, false, 40, null);
        JSONObject result = usage.snapshot(30, "account-a");
        assertEquals(2, result.getJSONObject("shanbay").getJSONObject("stats").getInt("requests"));
        assertEquals(1, result.getJSONObject("shanbay").getJSONObject("currentSessionStats").getInt("requests"));
        assertEquals("this_install_all_sessions", result.getString("statsScope"));
    }
}

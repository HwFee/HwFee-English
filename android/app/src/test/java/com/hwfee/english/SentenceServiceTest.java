package com.hwfee.english;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 23, manifest = Config.NONE)
public class SentenceServiceTest {
    private MockWebServer bay, llm;
    private LlmCache cache;
    private SentenceService service;
    private LlmRepository fallback;
    private ShanbaySseClient primary;
    private SentenceService.Settings settings;
    private static final String TEXT = "While the rain fell, the children stayed inside and read.";
    private static final String COOKIE = "auth_token=fixture-token; csrftoken=fixture-csrf";

    @Before public void setup() throws Exception {
        Context context = RuntimeEnvironment.getApplication(); context.deleteDatabase("llm-cache.db");
        cache = new LlmCache(context);
        bay = new MockWebServer(); bay.start(); llm = new MockWebServer(); llm.start();
        primary = new ShanbaySseClient(bay.url("").toString().replaceAll("/$", ""), 1000, 1000, 2500);
        fallback = new LlmRepository(cache, new LlmClient(1000, 1000));
        service = new SentenceService(cache, fallback, primary);
        settings = new SentenceService.Settings(COOKIE, "test-key", new LlmClient.Config(llm.url("/v1").toString(), "fixture-model"));
    }
    @After public void close() throws Exception { cache.close(); bay.shutdown(); llm.shutdown(); }

    private MockResponse stream(String events) { return new MockResponse().setHeader("Content-Type", "text/event-stream").setBody(events); }
    private MockResponse translation(String text) throws Exception {
        return stream("event: token\ndata: " + new JSONObject().put("t", text) + "\n\nevent: usage\ndata: {\"remaining_percent\":90}\n\n"
                + "event: done\ndata: " + new JSONObject().put("t", text) + "\n\n");
    }
    private MockResponse analysis(String text) throws Exception {
        return stream("event: component\ndata: " + new JSONObject().put("type", "clause").put("text", text).put("label", "让步状语从句")
                + "\n\nevent: usage\ndata: {\"remaining_percent\":98}\n\nevent: done\ndata: {\"status\":\"ok\"}\n\n");
    }
    private MockResponse api(String content) throws Exception {
        return new MockResponse().setBody(new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("finish_reason", "stop")
                .put("message", new JSONObject().put("content", content)))).toString());
    }
    private JSONObject richAnalysis(String text) throws Exception {
        return new JSONObject().put("translation", "孩子们留在室内阅读。").put("summary", "状语从句修饰主句。")
                .put("structure", new JSONObject().put("subject", "the children").put("predicate", "stayed").put("object", "").put("complement", ""))
                .put("segments", new JSONArray().put(new JSONObject().put("type", "clause").put("text", text)
                        .put("label", "状语从句与主干").put("explanation", "交代背景与主要行为")))
                .put("grammar", new JSONArray());
    }

    @Test public void shanbayWorksWithoutAnApiKeyAndItsThirtyDayCacheSurvivesRecreation() throws Exception {
        settings = new SentenceService.Settings(COOKIE, null, settings.config);
        bay.enqueue(analysis(TEXT));
        SentenceService.Answer first = service.request(settings, "analysis", TEXT, "a");
        assertEquals("shanbay", first.provider); assertFalse(first.cached);
        assertEquals("让步状语从句", first.analysis.getJSONArray("segments").getJSONObject(0).getString("label"));
        cache.close(); cache = new LlmCache(RuntimeEnvironment.getApplication());
        fallback = new LlmRepository(cache, new LlmClient(1000, 1000));
        service = new SentenceService(cache, fallback, primary);
        assertTrue(service.request(settings, "analysis", TEXT, "b").cached);
        assertEquals(1, bay.getRequestCount()); assertEquals(0, llm.getRequestCount());
        cache.getWritableDatabase().execSQL("UPDATE answers SET created = ? WHERE id LIKE 'shanbay:%'",
                new Object[]{System.currentTimeMillis() - LlmCache.RETENTION_MS - 100});
        bay.enqueue(analysis(TEXT));
        assertFalse(service.request(settings, "analysis", TEXT, "c").cached);
        assertEquals(2, bay.getRequestCount());
    }

    @Test public void quotaExhaustionFallsBackOnceAndLaterSentencesUseBatchedApiFallback() throws Exception {
        bay.enqueue(stream("event: quota_exceeded\ndata: {\"reset_at\":\"2026-11-04T00:00:00+08:00\"}\n\n"));
        llm.enqueue(api("第一句。"));
        llm.enqueue(api("{\"translations\":[{\"id\":0,\"translation\":\"第二句。\"},{\"id\":1,\"translation\":\"第三句。\"}]}"));
        JSONObject progress = service.pretranslate(settings, Arrays.asList("First sentence.", "Second sentence.", "Third sentence."), () -> true);
        assertEquals(3, progress.getInt("completed")); assertEquals(3, progress.getInt("llm"));
        assertEquals(0, progress.getInt("remainingPercent")); assertEquals(1, bay.getRequestCount()); assertEquals(2, llm.getRequestCount());
        SentenceService.Answer cached = service.request(settings, "translation", "Second sentence.", "manual");
        assertEquals("llm", cached.provider); assertTrue(cached.cached);
        assertEquals("第二句。", cached.translation); assertEquals(1, bay.getRequestCount()); assertEquals(2, llm.getRequestCount());
    }

    @Test public void quotaReadRecoversZeroWithoutSpendingSentenceQuotaAndPersistsAcrossRestart() throws Exception {
        long now = System.currentTimeMillis();
        cache.put("shanbay-state:" + settings.scope, new JSONObject().put("remainingPercent", 0)
                .put("usageAt", now - 1000).put("blockedUntil", now + 86400000)
                .put("code", "QUOTA_EXCEEDED").put("reason", "扇贝额度已用完").toString(), now);
        ShanbayClient account = new ShanbayClient(bay.url("").toString());
        bay.enqueue(new MockResponse().setBody("{\"remaining_percent\":100,\"reset_at\":\"2026-11-05T04:00:00+08:00\"}"));
        JSONObject result = service.refreshQuota(settings, account, true);
        assertEquals(100, result.getInt("remainingPercent"));
        assertTrue(result.getJSONObject("availability").getJSONObject("translation").getBoolean("canRequest"));
        assertEquals(0, result.getJSONObject("stats").getInt("requests"));
        okhttp3.mockwebserver.RecordedRequest request = bay.takeRequest(1, TimeUnit.SECONDS);
        assertEquals("GET", request.getMethod()); assertEquals("/bay-translate/quota", request.getPath());
        assertEquals(0, request.getBodySize()); assertEquals(COOKIE, request.getHeader("Cookie"));
        assertEquals(0, llm.getRequestCount());
        cache.close(); cache = new LlmCache(RuntimeEnvironment.getApplication());
        service = new SentenceService(cache, fallback, primary);
        assertEquals(100, service.refreshQuota(settings, account, false).getInt("remainingPercent"));
        assertEquals(1, bay.getRequestCount());
        bay.enqueue(translation("可以翻译"));
        assertEquals("shanbay", service.request(settings, "translation", "Recovered sentence.", null).provider);
    }

    @Test public void quotaRefreshCanReadZeroRepeatedlyAndErrorsKeepTheLastObservation() throws Exception {
        ShanbayClient account = new ShanbayClient(bay.url("").toString());
        bay.enqueue(new MockResponse().setBody("{\"remaining_percent\":0,\"reset_at\":null}"));
        JSONObject first = service.refreshQuota(settings, account, true);
        assertEquals(0, first.getInt("remainingPercent"));
        assertFalse(first.getJSONObject("availability").getJSONObject("analysis").getBoolean("canRequest"));
        bay.enqueue(new MockResponse().setBody("{\"remaining_percent\":80}"));
        assertEquals(80, service.refreshQuota(settings, account, true).getInt("remainingPercent"));
        long observed = service.quota(settings).getLong("usageAt");
        for (String body : new String[]{"{}", "{\"remaining_percent\":null}", "{\"remaining_percent\":101}",
                "{\"remaining_percent\":0.5}", "{\"remaining_percent\":\"0\"}"}) {
            bay.enqueue(new MockResponse().setBody(body));
            assertEquals("INVALID_RESPONSE", assertThrows(ShanbayClient.ShanbayException.class,
                    () -> service.refreshQuota(settings, account, true)).code);
            assertEquals(80, service.quota(settings).getInt("remainingPercent"));
            assertEquals(observed, service.quota(settings).getLong("usageAt"));
        }
        bay.enqueue(new MockResponse().setResponseCode(401));
        assertEquals("UNAUTHORIZED", assertThrows(ShanbayClient.ShanbayException.class,
                () -> service.refreshQuota(settings, account, true)).code);
        assertEquals(observed, service.quota(settings).getLong("usageAt"));
        assertEquals(0, llm.getRequestCount());
    }

    @Test public void quotaReadsDoNotClearPermissionBlocksOrCrossAccountState() throws Exception {
        long now = System.currentTimeMillis();
        cache.put("shanbay-task-state:" + settings.scope + ":analysis", new JSONObject()
                .put("blockedUntil", now + 600000).put("code", "FORBIDDEN").toString(), now);
        ShanbayClient account = new ShanbayClient(bay.url("").toString());
        bay.enqueue(new MockResponse().setBody("{\"remaining_percent\":100}"));
        JSONObject result = service.refreshQuota(settings, account, true);
        assertFalse(result.getJSONObject("availability").getJSONObject("analysis").getBoolean("canRequest"));
        SentenceService.Settings other = new SentenceService.Settings("auth_token=other", null, settings.config);
        bay.enqueue(new MockResponse().setBody("{\"remaining_percent\":42}"));
        assertEquals(42, service.refreshQuota(other, account, false).getInt("remainingPercent"));
        assertEquals(100, service.quota(settings).getInt("remainingPercent"));
        SentenceService.Settings disconnected = new SentenceService.Settings(null, null, settings.config);
        assertFalse(service.refreshQuota(disconnected, account, true).getBoolean("connected"));
        assertEquals(2, bay.getRequestCount());
    }

    @Test public void anIncompleteAnalysisNeverGetsCachedAndTheFallbackUsesTheSameComponentSchema() throws Exception {
        bay.enqueue(stream("event: component\ndata: {\"type\":\"subj\",\"text\":\"Wrong\",\"label\":\"主语\"}\n\n"));
        llm.enqueue(api(richAnalysis(TEXT).toString()));
        SentenceService.Answer answer = service.request(settings, "analysis", TEXT, "analysis");
        assertEquals("llm", answer.provider); assertFalse(answer.fallbackReason.isEmpty());
        assertEquals(2, answer.analysis.getInt("schemaVersion"));
        assertEquals(TEXT, answer.analysis.getJSONArray("segments").getJSONObject(0).getString("text"));
        assertTrue(service.request(settings, "analysis", TEXT, "again").cached);
        assertEquals(1, bay.getRequestCount()); assertEquals(1, llm.getRequestCount());
        assertEquals("llm", service.request(settings, "translation", TEXT, "translate").provider);
        assertEquals("analysis already supplied this translation", 1, llm.getRequestCount());
    }

    @Test public void omittedWordsTriggerFullFallbackWithoutBlockingOtherSentencesOrReusingOldAnalysis() throws Exception {
        String oldId = "shanbay:" + LlmRepository.hash(new JSONArray().put("v2").put(settings.scope).put("analysis").put(TEXT).toString());
        cache.put(oldId, new JSONObject().put("analysis", new JSONObject().put("segments", new JSONArray()
                .put(new JSONObject().put("text", TEXT).put("label", "未分析")))).toString(), System.currentTimeMillis());
        String oldFallbackId = LlmRepository.hash(new JSONArray().put("v2").put("analysis").put(settings.config.baseUrl)
                .put(settings.config.model).put(LlmRepository.sentence(TEXT)).toString());
        cache.put(oldFallbackId, "{}", System.currentTimeMillis());
        bay.enqueue(stream("event: component\ndata: {\"text\":\"While the rain fell,\",\"type\":\"clause\",\"label\":\"状语从句\"}\n\n"
                + "event: done\ndata: {}\n\n"));
        llm.enqueue(api(richAnalysis(TEXT).toString()));
        SentenceService.Answer answer = service.request(settings, "analysis", TEXT, null);
        assertEquals("llm", answer.provider);
        assertEquals(TEXT, answer.analysis.getJSONArray("segments").getJSONObject(0).getString("text"));
        assertFalse(answer.analysis.toString().contains("未分析"));
        assertTrue(service.request(settings, "analysis", TEXT, null).cached);
        assertEquals(1, bay.getRequestCount()); assertEquals(1, llm.getRequestCount());
        String other = "The children stayed inside the house while the rain fell.";
        bay.enqueue(analysis(other));
        assertEquals("shanbay", service.request(settings, "analysis", other, null).provider);
    }

    @Test public void fallbackAndPrimaryCacheNamespacesDoNotDependOnAnotherAccountsQuota() throws Exception {
        bay.enqueue(translation("甲"));
        assertEquals("甲", service.request(settings, "translation", "Hello.", "first").translation);
        SentenceService.Settings other = new SentenceService.Settings("auth_token=other-account; csrftoken=other", null, settings.config);
        bay.enqueue(translation("乙"));
        assertEquals("乙", service.request(other, "translation", "Hello.", "second").translation);
        assertEquals(2, bay.getRequestCount());
    }

    @Test public void multipleManualRequestsAndPretranslationShareOneShanbayRequest() throws Exception {
        bay.enqueue(translation("共享译文").setBodyDelay(250, TimeUnit.MILLISECONDS));
        ExecutorService workers = Executors.newFixedThreadPool(3);
        try {
            Future<JSONObject> auto = workers.submit(() -> service.pretranslate(settings, Arrays.asList("Hello."), () -> true));
            assertNotNull(bay.takeRequest(1, TimeUnit.SECONDS));
            Future<SentenceService.Answer> manual = workers.submit(() -> service.request(settings, "translation", "Hello.", "manual"));
            assertEquals("共享译文", manual.get(3, TimeUnit.SECONDS).translation);
            assertEquals(1, auto.get(3, TimeUnit.SECONDS).getInt("completed"));
            assertEquals(1, bay.getRequestCount()); assertEquals(0, llm.getRequestCount());
        } finally { workers.shutdownNow(); }
    }

    @Test public void cancellingOneCardDoesNotCancelAnotherSubscriberOrSpendTheFallbackKey() throws Exception {
        bay.enqueue(translation("仍能完成").setBodyDelay(400, TimeUnit.MILLISECONDS));
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            Future<SentenceService.Answer> first = workers.submit(() -> service.request(settings, "translation", "Hello.", "first"));
            assertNotNull(bay.takeRequest(1, TimeUnit.SECONDS));
            Future<SentenceService.Answer> second = workers.submit(() -> service.request(settings, "translation", "Hello.", "second"));
            Map<?, ?> active = ReflectionHelpers.getField(service, "subscribers");
            for (int i = 0; i < 100 && active.size() < 2; i++) Thread.sleep(5);
            assertEquals(2, active.size());
            service.cancel("first");
            assertEquals("仍能完成", second.get(3, TimeUnit.SECONDS).translation);
            ExecutionException failure = assertThrows(ExecutionException.class, () -> first.get(3, TimeUnit.SECONDS));
            assertEquals("CANCELLED", ((ShanbaySseClient.Failure) failure.getCause()).code);
            assertEquals(1, bay.getRequestCount()); assertEquals(0, llm.getRequestCount());
            assertTrue(service.request(settings, "translation", "Hello.", "later").cached);
        } finally { workers.shutdownNow(); }
    }

    @Test public void cancellationBeforeDispatchPreventsAnyProviderRequest() {
        service.cancel("cancel-before-dispatch");
        ShanbaySseClient.Failure failure = assertThrows(ShanbaySseClient.Failure.class,
                () -> service.request(settings, "translation", "Hello.", "cancel-before-dispatch"));
        assertEquals("CANCELLED", failure.code); assertEquals(0, bay.getRequestCount()); assertEquals(0, llm.getRequestCount());
    }

    @Test public void failedPrimaryWithNoApiKeyHasAnActionableErrorAndResetTime() throws Exception {
        settings = new SentenceService.Settings(COOKIE, null, settings.config);
        bay.enqueue(stream("event: quota_exceeded\ndata: {\"reset_at\":\"2026-11-04T00:00:00+08:00\"}\n\n"));
        ShanbaySseClient.Failure failure = assertThrows(ShanbaySseClient.Failure.class,
                () -> service.request(settings, "translation", "Hello.", "no-api"));
        assertEquals("FALLBACK_UNAVAILABLE", failure.code); assertTrue(failure.getMessage().contains("回退 API"));
        assertEquals("2026-11-04T00:00:00+08:00", failure.resetAt); assertEquals(0, llm.getRequestCount());
    }

    @Test public void analysisAdaptersPreserveWhitespaceAndWordLimitsAreCheckedBeforeRequests() throws Exception {
        String raw = "  While  the rain fell,\n the children stayed inside and read.\t";
        String normal = LlmRepository.sentence(raw);
        JSONObject original = richAnalysis(normal).put("sentence", normal);
        JSONObject adapted = SentenceService.adaptAnalysis(raw, original);
        assertEquals(raw, adapted.getJSONArray("segments").getJSONObject(0).getString("text"));
        assertThrows(IllegalArgumentException.class, () -> service.request(settings, "analysis", "Too short.", "short"));
        assertThrows(IllegalArgumentException.class, () -> service.request(settings, "translation", "word ".repeat(301), "long"));
        assertEquals(0, bay.getRequestCount());
        long now = System.currentTimeMillis();
        assertEquals(now + 15000, SentenceService.resetTime(Long.toString((now + 15000)), now));
        assertEquals(now + 15 * 60000, SentenceService.resetTime("invalid reset", now));
    }

    @Test public void anAnalysisPermissionFailureDoesNotDisableShanbayTranslationForOtherSentences() throws Exception {
        bay.enqueue(new MockResponse().setResponseCode(403));
        llm.enqueue(api(richAnalysis(TEXT).toString()));
        assertEquals("llm", service.request(settings, "analysis", TEXT, "analysis-denied").provider);
        bay.enqueue(translation("翻译仍可用"));
        assertEquals("shanbay", service.request(settings, "translation", "Another sentence.", "translation-allowed").provider);
        assertEquals(2, bay.getRequestCount()); assertEquals(1, llm.getRequestCount());
    }

    @Test public void articlePreparationCachesBothTasksAcrossRecreationAndKeepsExactAnalysisWhitespace() throws Exception {
        String exact = TEXT.replace("the rain", "the  rain");
        String tooLongForAnalysis = "word ".repeat(121).trim() + ".";
        bay.enqueue(translation("长句译文")); bay.enqueue(translation("短句译文")); bay.enqueue(translation("超出分析范围的译文"));
        bay.enqueue(analysis(exact));
        JSONObject result = service.pretranslate(settings, Arrays.asList(exact, "Birds fly.", exact, tooLongForAnalysis), () -> true);
        assertFalse(result.getBoolean("stopped")); assertEquals(3, result.getInt("completed"));
        assertEquals(1, result.getJSONObject("analysis").getInt("total"));
        assertEquals(1, result.getJSONObject("analysis").getInt("completed"));
        assertEquals(4, bay.getRequestCount());
        cache.close(); cache = new LlmCache(RuntimeEnvironment.getApplication());
        fallback = new LlmRepository(cache, new LlmClient(1000, 1000)); service = new SentenceService(cache, fallback, primary);
        SentenceService.Answer saved = service.request(settings, "analysis", exact, "manual-analysis");
        assertTrue(saved.cached); assertEquals(exact, saved.analysis.getString("sentence"));
        assertTrue(service.request(settings, "translation", exact, "manual-translation").cached);
        assertEquals(4, bay.getRequestCount()); assertEquals(0, llm.getRequestCount());
    }

    @Test public void fallbackPreparationReusesTheTranslationProducedByItsAnalysis() throws Exception {
        settings = new SentenceService.Settings(null, "test-key", settings.config);
        llm.enqueue(api(richAnalysis(TEXT).toString()));
        llm.enqueue(api("{\"translations\":[{\"id\":0,\"translation\":\"鸟会飞。\"}]}"));
        JSONObject result = service.pretranslate(settings, Arrays.asList(TEXT, "Birds fly."), () -> true);
        assertFalse(result.getBoolean("stopped")); assertEquals(2, result.getInt("completed"));
        assertEquals(1, result.getInt("cached")); assertEquals(1, result.getJSONObject("analysis").getInt("completed"));
        assertEquals(2, llm.getRequestCount()); assertEquals(0, bay.getRequestCount());
        JSONObject again = service.pretranslate(settings, Arrays.asList(TEXT, "Birds fly."), () -> true);
        assertEquals(2, again.getInt("cached")); assertEquals(1, again.getJSONObject("analysis").getInt("cached"));
        assertEquals(2, llm.getRequestCount());
        JSONObject jobs = service.usage(settings, 30).getJSONObject("pretranslation");
        assertEquals(2, jobs.getInt("analyzedSentences")); assertEquals(1, jobs.getInt("cachedAnalyses"));
    }

    @Test public void anAnalysisPreparationFailureDoesNotDiscardAvailableTranslations() throws Exception {
        settings = new SentenceService.Settings(COOKIE, null, settings.config);
        bay.enqueue(translation("译文已准备")); bay.enqueue(new MockResponse().setResponseCode(403));
        JSONObject result = service.pretranslate(settings, Arrays.asList(TEXT), () -> true);
        assertTrue(result.getBoolean("stopped")); assertEquals(1, result.getInt("completed"));
        assertEquals(0, result.getJSONObject("analysis").getInt("completed"));
        assertEquals("FALLBACK_UNAVAILABLE", result.getJSONObject("analysis").getString("errorCode"));
        assertFalse(result.getJSONObject("analysis").getString("error").isEmpty());
        assertTrue(service.request(settings, "translation", TEXT, "translation").cached);
        assertEquals(2, bay.getRequestCount()); assertEquals(0, llm.getRequestCount());
    }

    @Test public void manualAnalysisJoinsArticleAnalysisPreparation() throws Exception {
        bay.enqueue(translation("已翻译")); bay.enqueue(analysis(TEXT).setBodyDelay(300, TimeUnit.MILLISECONDS));
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            Future<JSONObject> preparation = workers.submit(() -> service.pretranslate(settings, Arrays.asList(TEXT), () -> true));
            assertNotNull(bay.takeRequest(1, TimeUnit.SECONDS)); assertNotNull(bay.takeRequest(1, TimeUnit.SECONDS));
            Future<SentenceService.Answer> manual = workers.submit(() -> service.request(settings, "analysis", TEXT, "manual"));
            assertEquals("shanbay", manual.get(3, TimeUnit.SECONDS).provider);
            assertEquals(1, preparation.get(3, TimeUnit.SECONDS).getJSONObject("analysis").getInt("completed"));
            assertEquals(2, bay.getRequestCount()); assertEquals(0, llm.getRequestCount());
        } finally { workers.shutdownNow(); }
    }

    @Test public void disablingPreparationStopsTheNextAnalysisAndCompletedWorkCanBeReused() throws Exception {
        java.util.concurrent.atomic.AtomicBoolean enabled = new java.util.concurrent.atomic.AtomicBoolean(true);
        bay.enqueue(translation("已完成译文").setBodyDelay(200, TimeUnit.MILLISECONDS));
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<JSONObject> preparation = worker.submit(() -> service.pretranslate(settings, Arrays.asList(TEXT), enabled::get));
            assertNotNull(bay.takeRequest(1, TimeUnit.SECONDS)); enabled.set(false);
            JSONObject stopped = preparation.get(3, TimeUnit.SECONDS);
            assertTrue(stopped.getBoolean("stopped")); assertEquals(1, stopped.getInt("completed"));
            assertEquals(0, stopped.getJSONObject("analysis").getInt("completed")); assertEquals(1, bay.getRequestCount());
            bay.enqueue(analysis(TEXT));
            JSONObject resumed = service.pretranslate(settings, Arrays.asList(TEXT), () -> true);
            assertFalse(resumed.getBoolean("stopped")); assertEquals(1, resumed.getInt("cached"));
            assertEquals(1, resumed.getJSONObject("analysis").getInt("completed")); assertEquals(2, bay.getRequestCount());
        } finally { worker.shutdownNow(); }
    }
}

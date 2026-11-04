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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 23, manifest = Config.NONE)
public class LlmRepositoryTest {
    private MockWebServer server;
    private LlmCache cache;
    private LlmRepository repository;
    private LlmClient.Config config;
    private Context context;

    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("llm-cache.db");
        cache = new LlmCache(context);
        server = new MockWebServer();
        server.start();
        config = new LlmClient.Config(server.url("/v1").toString(), "test-model");
        repository = new LlmRepository(cache, new LlmClient(1000, 3000));
    }

    @After public void teardown() throws Exception { cache.close(); server.shutdown(); }

    private MockResponse answer(String content) throws Exception {
        return new MockResponse().setBody(new JSONObject().put("choices", new JSONArray().put(
                new JSONObject().put("finish_reason", "stop").put("message", new JSONObject().put("content", content)))).toString());
    }

    private String batch(int count, String prefix) throws Exception {
        JSONArray rows = new JSONArray();
        for (int i = 0; i < count; i++) rows.put(new JSONObject().put("id", i).put("translation", prefix + i));
        return new JSONObject().put("translations", rows).toString();
    }

    @Test public void normalizesWhitespaceAndPersistsAcrossRepositoryRecreationWithoutNeedingAKey() throws Exception {
        server.enqueue(answer("你好。"));
        assertFalse(repository.request("translation", "test-key", config, "  Hello.\n").cached);
        cache.close();
        cache = new LlmCache(context);
        repository = new LlmRepository(cache, new LlmClient(1000, 1000));
        LlmRepository.Result result = repository.request("translation", null, config, "Hello.");
        assertTrue(result.cached);
        assertEquals("你好。", result.value);
        assertEquals(1, server.getRequestCount());
    }

    @Test public void cacheSeparatesProviderModelTaskAndCase() {
        String id = LlmRepository.cacheId("translation", config, "Hello.");
        assertEquals(id, LlmRepository.cacheId("translation", config, "  Hello.\n"));
        assertEquals(LlmRepository.cacheId("translation", config, "Two words."),
                LlmRepository.cacheId("translation", config, "\ufeffTwo\u2009words.\u3000"));
        assertNotEquals(id, LlmRepository.cacheId("analysis", config, "Hello."));
        assertNotEquals(id, LlmRepository.cacheId("translation", config, "hello."));
        assertNotEquals(id, LlmRepository.cacheId("translation", new LlmClient.Config("https://other.invalid", "test-model"), "Hello."));
        assertNotEquals(id, LlmRepository.cacheId("translation", new LlmClient.Config(config.baseUrl, "other-model"), "Hello."));
    }

    @Test public void expiresAfterThirtyDaysAndDoesNotExtendLifeWhenRead() {
        long now = System.currentTimeMillis();
        cache.put("old", "过期", now - LlmCache.RETENTION_MS - 1);
        cache.put("edge", "边界", now - LlmCache.RETENTION_MS);
        assertNull(cache.get("old", now));
        assertEquals("边界", cache.get("edge", now));
        assertNull(cache.get("edge", now + 1));
        cache.prune(now + 2 * 60 * 60 * 1000);
        assertEquals(0, cache.expiresAt("old"));
        assertEquals(0, cache.expiresAt("edge"));
    }

    @Test public void failuresAreNotCachedAndCanBeRetried() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(429));
        server.enqueue(answer("成功"));
        assertThrows(LlmClient.TranslationException.class, () -> repository.request("translation", "key", config, "Hello."));
        assertEquals("成功", repository.request("translation", "key", config, "Hello.").value);
        assertEquals(2, server.getRequestCount());
    }

    @Test public void simultaneousManualRequestsShareOneProviderCall() throws Exception {
        server.enqueue(answer("共享译文").setBodyDelay(300, TimeUnit.MILLISECONDS));
        ExecutorService workers = Executors.newFixedThreadPool(5);
        try {
            List<Future<LlmRepository.Result>> results = new ArrayList<>();
            for (int i = 0; i < 5; i++) results.add(workers.submit(() -> repository.request("translation", "key", config, "Hello.")));
            for (Future<LlmRepository.Result> result : results) assertEquals("共享译文", result.get(4, TimeUnit.SECONDS).value);
            assertEquals(1, server.getRequestCount());
        } finally { workers.shutdownNow(); }
    }

    @Test public void manualTapJoinsArticleBatchAndLaterTapsUseItsPersistentCache() throws Exception {
        server.enqueue(answer(batch(1, "译文")).setBodyDelay(300, TimeUnit.MILLISECONDS));
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<JSONObject> pretranslation = worker.submit(() -> repository.pretranslate("key", config, Arrays.asList("Hello."), () -> true));
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS));
            assertEquals("译文0", repository.request("translation", "key", config, "Hello.").value);
            assertEquals(1, pretranslation.get(4, TimeUnit.SECONDS).getInt("translated"));
            assertTrue(repository.request("translation", null, config, "Hello.").cached);
            assertEquals(1, server.getRequestCount());
        } finally { worker.shutdownNow(); }
    }

    @Test public void batchesOnlyMissingUniqueSentencesAndReportsTheirEarliestExpiry() throws Exception {
        long created = System.currentTimeMillis() - 10000;
        cache.put(LlmRepository.cacheId("translation", config, "Sentence 0."), "已有译文", created);
        server.enqueue(answer(batch(8, "第一批")));
        server.enqueue(answer(batch(1, "第二批")));
        List<String> texts = new ArrayList<>();
        for (int i = 0; i < 10; i++) texts.add("Sentence " + i + ".");
        texts.add("Sentence 0.");
        JSONObject result = repository.pretranslate("key", config, texts, () -> true);
        assertEquals(10, result.getInt("total"));
        assertEquals(10, result.getInt("completed"));
        assertEquals(9, result.getInt("translated"));
        assertEquals(1, result.getInt("cached"));
        assertEquals(created + LlmCache.RETENTION_MS, result.getLong("expiresAt"));
        assertFalse(result.getBoolean("stopped"));
        assertEquals(2, server.getRequestCount());
        assertTrue(repository.request("translation", null, config, "Sentence 9.").cached);
    }

    @Test public void turningOffPretranslationStopsBeforeTheNextBatch() throws Exception {
        server.enqueue(answer(batch(8, "已翻译")));
        List<String> texts = new ArrayList<>();
        for (int i = 0; i < 9; i++) texts.add("Sentence " + i + ".");
        AtomicInteger checks = new AtomicInteger();
        JSONObject result = repository.pretranslate("key", config, texts, () -> checks.incrementAndGet() == 1);
        assertTrue(result.getBoolean("stopped"));
        assertEquals(8, result.getInt("completed"));
        assertEquals(1, server.getRequestCount());
        assertTrue(repository.request("translation", null, config, "Sentence 0.").cached);
    }

    @Test public void disabledPretranslationNeverCallsTheProvider() throws Exception {
        JSONObject result = repository.pretranslate("key", config, Arrays.asList("Hello."), () -> false);
        assertTrue(result.getBoolean("stopped"));
        assertEquals(0, result.getInt("completed"));
        assertEquals(0, server.getRequestCount());
    }

    @Test public void invalidBatchDoesNotPoisonManualTranslation() throws Exception {
        server.enqueue(answer("{\"translations\":[{\"id\":0,\"translation\":\"a\"},{\"id\":0,\"translation\":\"b\"}]}"));
        assertThrows(LlmClient.TranslationException.class, () -> repository.pretranslate("key", config, Arrays.asList("Hello.", "Bye."), () -> true));
        server.enqueue(answer("你好。"));
        assertFalse(repository.request("translation", "key", config, "Hello.").cached);
        assertEquals(2, server.getRequestCount());
    }

    @Test public void anAnalysisAlsoSuppliesTheTranslationCache() throws Exception {
        JSONObject analysis = new JSONObject().put("translation", "鸟会飞。").put("summary", "主谓结构")
                .put("structure", new JSONObject().put("subject", "Birds").put("predicate", "fly")
                        .put("object", "").put("complement", ""))
                .put("segments", new JSONArray().put(new JSONObject().put("text", "Birds fly.")
                        .put("type", "pred").put("label", "主干").put("explanation", "主语和不及物动词")))
                .put("grammar", new JSONArray());
        server.enqueue(answer(analysis.toString()));
        assertFalse(repository.request("analysis", "key", config, "Birds fly.").cached);
        LlmRepository.Result translation = repository.request("translation", null, config, "Birds fly.");
        assertTrue(translation.cached);
        assertEquals("鸟会飞。", translation.value);
        assertTrue(repository.request("analysis", null, config, "Birds fly.").cached);
        assertEquals(1, server.getRequestCount());
    }

    @Test public void pretranslationJoinsAnEarlierManualRequestWithoutSendingAnotherBatch() throws Exception {
        server.enqueue(answer("手动译文").setBodyDelay(300, TimeUnit.MILLISECONDS));
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<LlmRepository.Result> manual = worker.submit(() -> repository.request("translation", "key", config, "Hello."));
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS));
            JSONObject progress = repository.pretranslate("key", config, Arrays.asList("Hello."), () -> true);
            assertEquals("手动译文", manual.get(4, TimeUnit.SECONDS).value);
            assertEquals(1, progress.getInt("completed"));
            assertEquals(1, server.getRequestCount());
        } finally { worker.shutdownNow(); }
    }
}

package com.hwfee.english;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.util.concurrent.TimeUnit;
import java.util.List;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;

import static org.junit.Assert.*;

public class LlmClientTest {
    private MockWebServer server;
    private final LlmClient client = new LlmClient(1000, 1000);
    private static final String KEY = "test-only-api-key";

    @Before public void startServer() throws Exception {
        server = new MockWebServer();
        server.start();
    }

    @After public void stopServer() throws Exception {
        server.shutdown();
    }

    private LlmClient.Config config() {
        return new LlmClient.Config(server.url("/v1/").toString(), null);
    }

    private JSONObject validAnalysis() throws Exception {
        return new JSONObject().put("translation", "鸟会飞。").put("summary", "主语加不及物动词。")
                .put("structure", new JSONObject().put("subject", "Birds").put("predicate", "fly")
                        .put("object", "").put("complement", ""))
                .put("segments", new org.json.JSONArray()
                        .put(new JSONObject().put("text", "Birds").put("type", "subj").put("label", "主语").put("explanation", "名词作主语"))
                        .put(new JSONObject().put("text", "fly.").put("type", "pred").put("label", "谓语").put("explanation", "一般现在时")))
                .put("grammar", new org.json.JSONArray());
    }

    private void enqueueAnswer(String content) throws Exception {
        server.enqueue(new MockResponse().setBody(new JSONObject().put("choices", new org.json.JSONArray().put(
                new JSONObject().put("finish_reason", "stop").put("message", new JSONObject().put("content", content)))).toString()));
    }

    @Test public void analysisReturnsValidatedRolesAndUtf16OffsetsWithTheConfiguredProvider() throws Exception {
        enqueueAnswer("```json\n" + validAnalysis() + "\n```");
        JSONObject result = client.analyze(KEY, config(), "  Birds\nfly.  ");
        assertEquals(1, result.getInt("schemaVersion"));
        assertEquals("Birds fly.", result.getString("sentence"));
        assertEquals(6, result.getJSONArray("segments").getJSONObject(1).getInt("start"));
        assertEquals(10, result.getJSONArray("segments").getJSONObject(1).getInt("end"));
        JSONObject payload = new JSONObject(server.takeRequest().getBody().readUtf8());
        assertEquals("json_object", payload.getJSONObject("response_format").getString("type"));
        assertEquals("Birds fly.", payload.getJSONArray("messages").getJSONObject(1).getString("content"));
    }

    @Test public void analysisRejectsMissingWordsButAcceptsSpecificLabelsForUnknownRoleTypes() throws Exception {
        JSONObject unknownRole = validAnalysis();
        unknownRole.getJSONArray("segments").getJSONObject(0).put("type", "html");
        JSONObject rewritten = validAnalysis();
        rewritten.getJSONArray("segments").getJSONObject(0).put("text", "Cats");
        JSONObject missing = validAnalysis();
        missing.getJSONArray("segments").remove(1);
        for (JSONObject incomplete : new JSONObject[]{rewritten, missing}) {
            enqueueAnswer(incomplete.toString());
            assertThrows(LlmClient.TranslationException.class, () -> client.analyze(KEY, config(), "Birds fly."));
        }
        // An unrecognized role keeps its span but degrades to the neutral role.
        enqueueAnswer(unknownRole.toString());
        assertEquals("other", client.analyze(KEY, config(), "Birds fly.")
                .getJSONArray("segments").getJSONObject(0).getString("type"));
    }

    @Test public void missingSubjectDoesNotBecomePartOfThePredicate() throws Exception {
        JSONObject raw = validAnalysis();
        raw.getJSONArray("segments").remove(0);
        enqueueAnswer(raw.toString());
        assertThrows(LlmClient.TranslationException.class, () -> client.analyze(KEY, config(), "Birds fly."));
    }

    @Test public void analysisRequiresMeaningfulRolesForAllWords() throws Exception {
        for (String label : new String[]{"未分析", "其他", "未知"}) {
            JSONObject raw = validAnalysis();
            raw.getJSONArray("segments").getJSONObject(0).put("label", label);
            enqueueAnswer(raw.toString());
            assertThrows(LlmClient.TranslationException.class, () -> client.analyze(KEY, config(), "Birds fly."));
        }
    }

    @Test public void analysisRejectsAnAnswerWithoutASinglePlaceableSpan() throws Exception {
        JSONObject nothing = validAnalysis();
        nothing.put("segments", new JSONArray().put(new JSONObject().put("text", "Cats").put("type", "subj")));
        enqueueAnswer(nothing.toString());
        LlmClient.TranslationException error = assertThrows(LlmClient.TranslationException.class,
                () -> client.analyze(KEY, config(), "Birds fly."));
        assertEquals("长难句分析结果格式无效，请重试", error.getMessage());
    }

    @Test public void analysisToleratesFencesProseNormalizedWhitespaceAndMissingOptionalFields() throws Exception {
        String source = "Bogs  are rich in storied horror, and the wetlands\u00a0of eastern England are no exception.";
        JSONObject minimal = new JSONObject().put("segments", new JSONArray()
                .put(new JSONObject().put("type", "subj").put("text", "Bogs are rich in storied horror, "))
                .put(new JSONObject().put("type", "coord").put("text", "and the wetlands of eastern England"))
                .put(new JSONObject().put("type", "pred").put("text", "are no exception")));

        // Prose, a capitalized fence, normalized spaces and a dropped final period.
        enqueueAnswer("Here is the analysis:\n```JSON\n" + minimal + "\n```\nHope this helps.");
        JSONObject result = client.analyze(KEY, config(), source);
        String normalized = LlmRepository.sentence(source);
        JSONArray segments = result.getJSONArray("segments");
        StringBuilder rebuilt = new StringBuilder();
        for (int i = 0; i < segments.length(); i++) rebuilt.append(segments.getJSONObject(i).getString("text"));
        assertEquals(normalized, rebuilt.toString());
        assertEquals(3, segments.length());
        assertEquals("主语", segments.getJSONObject(0).getString("label"));
        assertEquals("", result.getString("translation"));
        assertEquals("", result.getString("summary"));
        assertEquals(0, result.getJSONArray("grammar").length());

        // A bare fenced answer with no optional fields still parses.
        enqueueAnswer("```json\n" + minimal + "\n```");
        assertEquals(normalized, joined(client.analyze(KEY, config(), source)));
    }

    private static String joined(JSONObject analysis) throws Exception {
        StringBuilder rebuilt = new StringBuilder();
        JSONArray segments = analysis.getJSONArray("segments");
        for (int i = 0; i < segments.length(); i++) rebuilt.append(segments.getJSONObject(i).getString("text"));
        return rebuilt.toString();
    }

    @Test public void batchTranslationRestoresInputOrderAndRejectsMissingIds() throws Exception {
        enqueueAnswer("{\"translations\":[{\"id\":1,\"translation\":\"再见\"},{\"id\":0,\"translation\":\"你好\"}]}");
        assertEquals(java.util.Arrays.asList("你好", "再见"), client.translateBatch(KEY, config(), java.util.Arrays.asList("Hello.", "Bye.")));
        enqueueAnswer("{\"translations\":[{\"id\":0,\"translation\":\"你好\"}]}");
        assertThrows(LlmClient.TranslationException.class,
                () -> client.translateBatch(KEY, config(), java.util.Arrays.asList("Hello.", "Bye.")));
    }

    private void assertFailure(String message) {
        LlmClient.TranslationException error = assertThrows(LlmClient.TranslationException.class,
                () -> client.translate(KEY, config(), "This is a sentence."));
        assertEquals(message, error.getMessage());
        assertFalse(error.getMessage().contains(KEY));
    }

    @Test public void sendsNativeChatRequestAndReturnsChineseTranslation() throws Exception {
        server.enqueue(new MockResponse().setBody(
                "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"  这是一个句子。  \",\"refusal\":null}}]}"));

        assertEquals("这是一个句子。", client.translate(KEY, config(), "  This is a sentence.  "));
        RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
        assertNotNull(request);
        assertEquals("POST", request.getMethod());
        assertEquals("/v1/chat/completions", request.getPath());
        assertEquals("Bearer " + KEY, request.getHeader("Authorization"));
        JSONObject payload = new JSONObject(request.getBody().readUtf8());
        assertEquals(LlmClient.DEFAULT_MODEL, payload.getString("model"));
        assertFalse(payload.getBoolean("stream"));
        assertEquals("system", payload.getJSONArray("messages").getJSONObject(0).getString("role"));
        assertEquals("This is a sentence.", payload.getJSONArray("messages").getJSONObject(1).getString("content"));
    }

    @Test public void defaultsAndTrimsConfiguration() {
        LlmClient.Config defaults = new LlmClient.Config(null, "  ");
        assertEquals(LlmClient.DEFAULT_BASE, defaults.baseUrl);
        assertEquals(LlmClient.DEFAULT_MODEL, defaults.model);
        LlmClient.Config custom = new LlmClient.Config(" https://example.com/openai/v1/// ", " custom-model ");
        assertEquals("https://example.com/openai/v1", custom.baseUrl);
        assertEquals("custom-model", custom.model);
    }

    @Test public void migratesOnlyOfficialRetiredDeepSeekDefaults() {
        LlmClient.Config old = new LlmClient.Config("https://api.deepseek.com/v1/", "deepseek-chat");
        assertEquals("https://api.deepseek.com", old.baseUrl);
        assertEquals("deepseek-flash", old.model);
        old.requireKeyForEndpointChange("https://api.deepseek.com/v1", KEY, null);
        assertEquals("deepseek-flash", new LlmClient.Config(null, "deepseek-v4-flash").model);
        assertEquals("deepseek-v4-pro", new LlmClient.Config(null, "deepseek-v4-pro").model);
        assertEquals("deepseek-chat", new LlmClient.Config("https://other.invalid/v1", "deepseek-chat").model);
        assertEquals("deepseek-chat", new LlmClient.Config("https://api.deepseek.com.attacker.invalid", "deepseek-chat").model);
        assertEquals("https://api.deepseek.com/custom", new LlmClient.Config("https://api.deepseek.com/custom", null).baseUrl);
    }

    @Test public void sentenceTranslationDisablesThinkingOnlyForOfficialDeepSeekModels() throws Exception {
        for (String model : new String[]{"deepseek-flash", "deepseek-v4-pro"}) {
            JSONObject payload = LlmClient.translationPayload(new LlmClient.Config(null, model), "Hello.");
            assertEquals("disabled", payload.getJSONObject("thinking").getString("type"));
        }
        JSONObject other = LlmClient.translationPayload(
                new LlmClient.Config("https://other.invalid/v1", "deepseek-flash"), "Hello.");
        assertFalse(other.has("thinking"));
    }

    @Test public void retrievesModelsUsingConfiguredEndpointAndBearerKey() throws Exception {
        server.enqueue(new MockResponse().setBody("{\"data\":["
                + "{\"id\":\"deepseek-flash\",\"name\":\"DeepSeek V4.1 Flash\"},"
                + "{\"id\":\"deepseek-v4-pro\"},{\"id\":\"deepseek-flash\"},null,{\"id\":\"\"}]}"));
        List<LlmClient.Model> models = client.listModels(KEY, config());
        assertEquals(2, models.size());
        assertEquals("deepseek-flash", models.get(0).id);
        assertEquals("DeepSeek V4.1 Flash", models.get(0).name);
        assertEquals("deepseek-v4-pro", models.get(1).id);
        assertEquals("deepseek-v4-pro", models.get(1).name);
        RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
        assertNotNull(request);
        assertEquals("GET", request.getMethod());
        assertEquals("/v1/models", request.getPath());
        assertEquals("Bearer " + KEY, request.getHeader("Authorization"));
    }

    @Test public void modelListRefusesRedirectsAndDoesNotExposeProviderBodies() {
        server.enqueue(new MockResponse().setResponseCode(307).addHeader("Location", server.url("/other")));
        LlmClient.TranslationException redirect = assertThrows(LlmClient.TranslationException.class,
                () -> client.listModels(KEY, config()));
        assertTrue(redirect.getMessage().contains("重定向"));
        assertEquals(1, server.getRequestCount());
        server.enqueue(new MockResponse().setResponseCode(401).setBody("provider echoed " + KEY));
        LlmClient.TranslationException unauthorized = assertThrows(LlmClient.TranslationException.class,
                () -> client.listModels(KEY, config()));
        assertFalse(unauthorized.getMessage().contains(KEY));
    }

    @Test public void modelListRejectsMalformedAndOversizedResults() {
        for (String body : new String[]{"not JSON", "{}", "{\"data\":[{\"id\":42}]}",
                "x".repeat(LlmClient.MAX_RESPONSE_BYTES + 1)}) {
            server.enqueue(new MockResponse().setBody(body));
            LlmClient.TranslationException error = assertThrows(LlmClient.TranslationException.class,
                    () -> client.listModels(KEY, config()));
            assertFalse(error.getMessage().contains(KEY));
        }
    }

    @Test public void androidConfigurationRequiresHttpsForApiKeys() {
        assertEquals(LlmClient.DEFAULT_BASE, new LlmClient.Config(null, null).requireHttps().baseUrl);
        assertThrows(IllegalArgumentException.class,
                () -> new LlmClient.Config("http://example.com/v1", null).requireHttps());
    }

    @Test public void changingProviderCannotForwardAnExistingKeyWithoutReentry() {
        LlmClient.Config other = new LlmClient.Config("https://other-provider.invalid/v1", null);
        for (String supplied : new String[]{null, "", "  "}) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                    () -> other.requireKeyForEndpointChange(null, KEY, supplied));
            assertFalse(error.getMessage().contains(KEY));
        }
        other.requireKeyForEndpointChange(null, KEY, "replacement-test-key");
        other.requireKeyForEndpointChange(null, null, null);
    }

    @Test public void unchangedProviderPreservesKeyForModelChanges() {
        new LlmClient.Config(null, "another-model").requireKeyForEndpointChange(null, KEY, null);
        new LlmClient.Config("https://provider.invalid/v1/", null)
                .requireKeyForEndpointChange("https://provider.invalid/v1", KEY, null);
    }

    @Test public void rejectsInvalidBaseUrlsWithoutEchoingInput() {
        for (String url : new String[]{"not-a-url", "file:///tmp/model", "https:///v1", "https://host:99999/v1",
                "https://" + KEY + "@example.com/v1", "https://example.com/v1?key=" + KEY,
                "https://example.com/v1#" + KEY}) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                    () -> new LlmClient.Config(url, null));
            assertFalse(error.getMessage().contains(KEY));
            assertFalse(error.getMessage().contains(url));
        }
    }

    @Test public void rejectsEmptyTextAndHeaderInjectionBeforeSending() {
        assertThrows(IllegalArgumentException.class, () -> client.translate(KEY, config(), "  "));
        assertThrows(IllegalArgumentException.class, () -> client.translate(" \n ", config(), "Hello."));
        assertThrows(IllegalArgumentException.class, () -> client.translate(KEY + "\r\nX-Key: bad", config(), "Hello."));
        assertEquals(0, server.getRequestCount());
    }

    @Test public void mapsProviderFailuresWithoutExposingTheirBodies() {
        int[] statuses = {401, 403, 402, 429, 500};
        String[] messages = {
                "翻译密钥无效或无权访问，请在设置里检查密钥和模型",
                "翻译密钥无效或无权访问，请在设置里检查密钥和模型",
                "翻译账户余额不足", "请求太频繁，请稍后再试", "翻译接口返回 HTTP 500"};
        for (int i = 0; i < statuses.length; i++) {
            server.enqueue(new MockResponse().setResponseCode(statuses[i]).setBody("Provider echoed " + KEY));
            assertFailure(messages[i]);
        }
    }

    @Test public void refusesRedirectsInsteadOfResendingTheKey() {
        server.enqueue(new MockResponse().setResponseCode(307).addHeader("Location", server.url("/other")));
        assertFailure("翻译接口发生重定向，请在设置里填写最终接口地址");
        assertEquals(1, server.getRequestCount());
    }

    @Test public void handlesMalformedSuccessResponses() {
        for (String body : new String[]{"not JSON", "{}", "{\"choices\":[]}", "{\"choices\":[null]}",
                "{\"choices\":[{\"message\":null}]}",
                "{\"choices\":[{\"message\":{\"content\":{\"text\":\"wrong type\"}}}]}"}) {
            server.enqueue(new MockResponse().setBody(body));
            assertFailure("翻译接口返回格式无效");
        }
    }

    @Test public void handlesEmptyResults() {
        for (String body : new String[]{"", "{\"choices\":[{\"message\":{\"content\":null}}]}",
                "{\"choices\":[{\"message\":{\"content\":\"  \"}}]}"}) {
            server.enqueue(new MockResponse().setBody(body));
            assertFailure("翻译结果为空");
        }
    }

    @Test public void reportsTruncationAndRefusalInsteadOfDisplayingPartialText() {
        server.enqueue(new MockResponse().setBody(
                "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"partial\"}}]}"));
        assertFailure("翻译结果不完整，请重试");
        server.enqueue(new MockResponse().setBody(
                "{\"choices\":[{\"message\":{\"content\":null,\"refusal\":\"private provider reason\"}}]}"));
        assertFailure("翻译请求被接口拒绝，请重试或检查模型设置");
    }

    @Test public void boundsResponseSize() {
        server.enqueue(new MockResponse().setBody("x".repeat(LlmClient.MAX_RESPONSE_BYTES + 1)));
        assertFailure("翻译接口返回内容过大，请检查接口设置");
    }

    @Test public void reportsReadTimeoutWithoutExposingConnectionDetails() {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
        LlmClient.TranslationException error = assertThrows(LlmClient.TranslationException.class,
                () -> new LlmClient(1000, 100).translate(KEY, config(), "Hello."));
        assertEquals("翻译请求超时，请稍后重试", error.getMessage());
    }
}

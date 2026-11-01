package com.hwfee.english;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.util.concurrent.TimeUnit;

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

    @Test public void androidConfigurationRequiresHttpsForApiKeys() {
        assertEquals(LlmClient.DEFAULT_BASE, new LlmClient.Config(null, null).requireHttps().baseUrl);
        assertThrows(IllegalArgumentException.class,
                () -> new LlmClient.Config("http://example.com/v1", null).requireHttps());
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

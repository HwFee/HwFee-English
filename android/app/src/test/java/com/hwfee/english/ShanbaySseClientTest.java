package com.hwfee.english;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import static org.junit.Assert.*;

public class ShanbaySseClientTest {
    private MockWebServer server;
    private ShanbaySseClient client;
    private static final String COOKIE = "auth_token=test-only-token; csrftoken=test-only-csrf";
    @Before public void setup() throws Exception {
        server = new MockWebServer(); server.start();
        client = new ShanbaySseClient(server.url("").toString().replaceAll("/$", ""), 1000, 1000, 2000);
    }
    @After public void close() throws Exception { server.shutdown(); }
    private MockResponse stream(String body) { return new MockResponse().setHeader("Content-Type", "text/event-stream; charset=utf-8").setBody(body); }
    private ShanbaySseClient.Result request(String task, String text) throws Exception {
        return client.request(task, text, COOKIE, new SentenceCancellation());
    }
    private ShanbaySseClient.Result parse(String task, String text, String stream) throws Exception {
        return ShanbaySseClient.parse(task, text, new ByteArrayInputStream(stream.getBytes(StandardCharsets.UTF_8)), new SentenceCancellation());
    }

    @Test public void sendsOnlyTheDocumentedBodyAndCookieHeadersAndPreservesEverySourceCharacter() throws Exception {
        String text = "Birds  fly. 你好。";
        server.enqueue(stream("\ufeff: keepalive\r\nevent: component\r\ndata: {\"type\":\"subj\",\"text\":\"Birds  \",\"label\":\"主语\"}\r\n\r\n"
                + "event: component\r\ndata: {\"type\":\"pred\",\"text\":\"fly. 你好。\",\"label\":\"谓语\"}\r\n\r\n"
                + "event: usage\r\ndata: {\"remaining_percent\":98}\r\n\r\nevent: done\r\ndata: {\"status\":\"ok\"}\r\n\r\n")
                .throttleBody(7, 1, TimeUnit.MILLISECONDS));
        ShanbaySseClient.Result result = request("analysis", text);
        assertEquals(text, result.analysis.getString("sentence"));
        assertEquals("Birds  ", result.analysis.getJSONArray("segments").getJSONObject(0).getString("text"));
        assertEquals(Integer.valueOf(98), result.remainingPercent);
        RecordedRequest sent = server.takeRequest();
        assertEquals("/bay-translate/sse/sentence_analysis", sent.getPath());
        assertEquals(COOKIE, sent.getHeader("Cookie"));
        assertEquals("test-only-csrf", sent.getHeader("X-CSRFToken"));
        assertEquals("https://web.shanbay.com", sent.getHeader("Origin"));
        assertEquals("text/event-stream", sent.getHeader("Accept"));
        JSONObject body = new JSONObject(sent.getBody().readUtf8());
        assertEquals(2, body.length()); assertEquals(text, body.getString("text"));
        assertNotNull(java.util.UUID.fromString(body.getString("request_id")));
    }

    @Test public void translationUsesTheAuthoritativeDoneTextAndItsOwnPath() throws Exception {
        server.enqueue(stream("event: token\ndata: {\"t\":\"部分译文\"}\n\nevent: usage\ndata: {\"remaining_percent\":91}\n\n"
                + "event: done\ndata: {\"t\":\"完整译文\"}\n\n"));
        assertEquals("完整译文", request("translation", "Hello.").translation);
        RecordedRequest sent = server.takeRequest();
        assertEquals("/bay-translate/sse/translate_sentence", sent.getPath());
        JSONObject body = new JSONObject(sent.getBody().readUtf8());
        assertEquals(3, body.length()); assertEquals("zh-CN", body.getString("target_lang"));
    }

    @Test public void multilineDataCommentsAndFutureTypesHaveABoundedSafeFallback() throws Exception {
        ShanbaySseClient.Result result = parse("analysis", "Hello.", ": comment\nevent: future\ndata: not-json\n\n"
                + "event: component\ndata: {\"type\":\"new-role\",\ndata: \"text\":\"Hello.\",\"label\":\"服务端标签\"}\n\n"
                + "event: done\ndata: {\"status\":\"ok\"}\n\n");
        assertEquals("other", result.analysis.getJSONArray("segments").getJSONObject(0).getString("type"));
        assertEquals("服务端标签", result.analysis.getJSONArray("segments").getJSONObject(0).getString("label"));
    }

    @Test public void providerWhitespaceNormalizationIsRealignedToTheExactSource() throws Exception {
        // Shanbay collapses runs of spaces, rewrites tabs/NBSP as one ASCII space and drops a
        // trailing space. Every span is rebuilt from the source, so the answer still tiles exactly.
        String text = "Bogs  are rich in storied horror,\tand the wetlands\u00a0of eastern England are no exception. ";
        ShanbaySseClient.Result result = parse("analysis", text,
                "event: component\ndata: {\"type\":\"subj\",\"text\":\"Bogs are rich in storied horror,\",\"label\":\"主语\"}\n\n"
                + "event: component\ndata: {\"type\":\"pred\",\"text\":\" and the wetlands of eastern England are no exception.\",\"label\":\"谓语\"}\n\n"
                + "event: usage\ndata: {\"remaining_percent\":40}\n\nevent: done\ndata: {\"status\":\"ok\"}\n\n");
        assertEquals(text, joined(result));
        assertEquals(Integer.valueOf(40), result.remainingPercent);
    }

    @Test public void missingWordsRejectTheAnalysisInsteadOfInventingAnUnanalysedSpan() throws Exception {
        String text = "While the rain fell, the children stayed inside and read.";
        ShanbaySseClient.Failure error = assertThrows(ShanbaySseClient.Failure.class, () -> parse("analysis", text,
                "event: component\ndata: {\"type\":\"clause\",\"text\":\"While the rain fell,\",\"label\":\"状语从句\"}\n\n"
                + "event: component\ndata: {\"type\":\"pred\",\"text\":\"stayed inside and read.\",\"label\":\"谓语\"}\n\n"
                + "event: done\ndata: {\"status\":\"ok\"}\n\n"));
        assertEquals("INCOMPLETE_ANALYSIS", error.code);
    }

    @Test public void missingTailAndPlaceholderLabelsCannotPassAsCompleteAnalysis() throws Exception {
        for (String component : new String[]{
                "{\"type\":\"subj\",\"text\":\"Birds\",\"label\":\"主语\"}",
                "{\"type\":\"other\",\"text\":\"Birds fly.\",\"label\":\"未分析\"}",
                "{\"type\":\"other\",\"text\":\"Birds fly.\",\"label\":\"其他\"}"}) {
            assertEquals("INCOMPLETE_ANALYSIS", assertThrows(ShanbaySseClient.Failure.class,
                    () -> parse("analysis", "Birds fly.", "event: component\ndata: " + component
                            + "\n\nevent: done\ndata: {}\n\n")).code);
        }
    }

    private static String joined(ShanbaySseClient.Result result) throws Exception {
        StringBuilder rebuilt = new StringBuilder();
        for (int i = 0; i < result.analysis.getJSONArray("segments").length(); i++) {
            rebuilt.append(result.analysis.getJSONArray("segments").getJSONObject(i).getString("text"));
        }
        return rebuilt.toString();
    }

    @Test public void incompleteMismatchedAndMalformedAnswersCannotSucceed() throws Exception {
        for (String body : new String[]{
                "event: component\ndata: {\"type\":\"subj\",\"text\":\"Hello.\",\"label\":\"主语\"}\n\n",
                "event: component\ndata: {\"type\":\"subj\",\"text\":\"Wrong.\",\"label\":\"主语\"}\n\nevent: done\ndata: {}\n\n",
                "event: done\ndata: {\"status\":\"ok\"}\n\n", "event: component\ndata: {broken}\n\n"}) {
            assertThrows(ShanbaySseClient.Failure.class, () -> parse("analysis", "Hello.", body));
        }
        assertThrows(ShanbaySseClient.Failure.class, () -> parse("translation", "Hello.", "event: token\ndata: {\"t\":\"部分\"}\n\n"));
        assertThrows(ShanbaySseClient.Failure.class, () -> parse("translation", "Hello.", "event: done\ndata: {\"t\":\"完整\"}"));
    }

    @Test public void quotaAndAuthenticationFailuresRetainActionableCodesWithoutEchoingSecrets() throws Exception {
        ShanbaySseClient.Failure quota = assertThrows(ShanbaySseClient.Failure.class, () -> parse("analysis", "Hello.",
                "event: quota_exceeded\ndata: {\"reset_at\":\"2026-11-04T00:00:00+08:00\"}\n\n"));
        assertEquals("QUOTA_EXCEEDED", quota.code); assertEquals("2026-11-04T00:00:00+08:00", quota.resetAt);
        for (int status : new int[]{401, 403, 302}) {
            server.enqueue(new MockResponse().setResponseCode(status).setHeader("Location", "https://attacker.invalid/secret").setBody(COOKIE));
            ShanbaySseClient.Failure failure = assertThrows(ShanbaySseClient.Failure.class, () -> request("analysis", "Hello."));
            assertFalse(failure.getMessage().contains("test-only"));
            assertEquals(status == 401 ? "UNAUTHORIZED" : status == 403 ? "FORBIDDEN" : "HTTP_ERROR", failure.code);
        }
    }

    @Test public void inactivityAndTotalDeadlinesBothTerminateTheStream() throws Exception {
        client = new ShanbaySseClient(server.url("").toString().replaceAll("/$", ""), 1000, 100, 1000);
        server.enqueue(stream("event: done\ndata: {}\n\n").setBodyDelay(300, TimeUnit.MILLISECONDS));
        assertEquals("TIMEOUT", assertThrows(ShanbaySseClient.Failure.class, () -> request("analysis", "Hello.")).code);
        client = new ShanbaySseClient(server.url("").toString().replaceAll("/$", ""), 1000, 1000, 150);
        server.enqueue(stream(": keepalive\n\n".repeat(200)).throttleBody(5, 20, TimeUnit.MILLISECONDS));
        long start = System.nanoTime();
        assertEquals("TIMEOUT", assertThrows(ShanbaySseClient.Failure.class, () -> request("analysis", "Hello.")).code);
        assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 2000);
    }

    @Test public void cancellationDisconnectsAnActiveStream() throws Exception {
        server.enqueue(stream("event: done\ndata: {}\n\n").setBodyDelay(2, TimeUnit.SECONDS));
        SentenceCancellation cancellation = new SentenceCancellation();
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<?> running = worker.submit(() -> client.request("analysis", "Hello.", COOKIE, cancellation));
            assertNotNull(server.takeRequest(1, TimeUnit.SECONDS));
            cancellation.cancel();
            ExecutionException failure = assertThrows(ExecutionException.class, () -> running.get(2, TimeUnit.SECONDS));
            assertEquals("CANCELLED", ((ShanbaySseClient.Failure) failure.getCause()).code);
        } finally { worker.shutdownNow(); }
    }

    @Test public void oversizedStreamsAndInvalidQuotaValuesAreRejected() {
        assertThrows(ShanbaySseClient.Failure.class, () -> parse("analysis", "Hello.", ":" + "x".repeat(ShanbaySseClient.MAX_BYTES + 1)));
        assertThrows(ShanbaySseClient.Failure.class, () -> parse("analysis", "Hello.", "event: usage\ndata: {\"remaining_percent\":101}\n\n"));
    }
}

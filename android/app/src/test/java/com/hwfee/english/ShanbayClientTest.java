package com.hwfee.english;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.Test;

import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class ShanbayClientTest {
    private static final String COOKIE = "other=x; auth_token=token-value; csrftoken=csrf-value";

    @Test public void sendsFixedBrowserHeadersCookieCsrfMethodAndBody() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setBody("{\"ok\":true}"));
            ShanbayClient client = new ShanbayClient(server.url("/").toString());

            String result = client.request("POST", "/wordscollection/words?x=1", "{\"word\":\"test\"}", COOKIE);
            RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
            assertEquals("{\"ok\":true}", result);
            assertEquals("POST", request.getMethod());
            assertEquals("/wordscollection/words?x=1", request.getPath());
            assertEquals(COOKIE, request.getHeader("Cookie"));
            assertEquals("csrf-value", request.getHeader("X-CSRFToken"));
            assertEquals("https://web.shanbay.com", request.getHeader("Origin"));
            assertEquals("https://web.shanbay.com/", request.getHeader("Referer"));
            assertEquals("application/json", request.getHeader("Content-Type"));
            assertEquals("{\"word\":\"test\"}", request.getBody().readUtf8());
        }
    }

    @Test public void sendsDeleteWithJsonBody() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setResponseCode(204));
            ShanbayClient client = new ShanbayClient(server.url("/").toString());

            assertEquals("{}", client.request("DELETE", "/wordscollection/words", "{\"vocab_ids\":[7]}", COOKIE));
            RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
            assertEquals("DELETE", request.getMethod());
            assertEquals("{\"vocab_ids\":[7]}", request.getBody().readUtf8());
        }
    }

    @Test public void mapsAuthAndPreconditionStatusesWithoutLeakingRequestDetails() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setResponseCode(401).setBody("private response body"));
            ShanbayClient client = new ShanbayClient(server.url("/").toString());
            ShanbayClient.ShanbayException error = requestFailure(client, "GET", "/private/path?token=secret");
            assertEquals("UNAUTHORIZED", error.code);
            assertTrue(error.getMessage().contains("登录已过期"));
            assertFalse(error.getMessage().contains("private"));
            assertFalse(error.getMessage().contains("secret"));

            server.enqueue(new MockResponse().setResponseCode(412).setBody("server details"));
            error = requestFailure(client, "GET", "/today");
            assertEquals("NOT_READY", error.code);
            assertFalse(error.getMessage().contains("server details"));

            server.enqueue(new MockResponse().setResponseCode(403));
            assertEquals("FORBIDDEN", requestFailure(client, "GET", "/forbidden").code);

            server.enqueue(new MockResponse().setResponseCode(429));
            assertEquals("RATE_LIMITED", requestFailure(client, "GET", "/limited").code);
        }
    }

    @Test public void rejectsRedirectWithoutFollowingIt() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", "/other"));
            ShanbayClient client = new ShanbayClient(server.url("/").toString());

            ShanbayClient.ShanbayException error = requestFailure(client, "GET", "/redirect");
            assertEquals("REDIRECT_BLOCKED", error.code);
            assertEquals(1, server.getRequestCount());
            assertEquals("/redirect", server.takeRequest(1, TimeUnit.SECONDS).getPath());
        }
    }

    @Test public void rejectsUnsafePathsMethodsAndCookiesBeforeConnecting() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            ShanbayClient client = new ShanbayClient(server.url("/").toString());
            assertFailure(client, "GET", "//other/path", COOKIE, "INVALID_ARGUMENT");
            assertFailure(client, "GET", "/ok#fragment", COOKIE, "INVALID_ARGUMENT");
            assertFailure(client, "GET", "/line\r\nX: forged", COOKIE, "INVALID_ARGUMENT");
            assertFailure(client, "GET", "/a/../secret", COOKIE, "INVALID_ARGUMENT");
            assertFailure(client, "PATCH", "/ok", COOKIE, "INVALID_ARGUMENT");
            assertFailure(client, "GET", "/ok", "auth_token=\r\nX-Evil: 1", "INVALID_COOKIE");
            assertFailure(client, "GET", "/ok", "not_auth_token=x", "INVALID_COOKIE");
            assertFailure(client, "GET", "/ok", "auth_token=", "INVALID_COOKIE");
            assertNull(server.takeRequest(100, TimeUnit.MILLISECONDS));
        }
    }

    @Test public void capsSuccessfulResponseSize() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setBody(new String(
                    new char[ShanbayClient.MAX_RESPONSE_BYTES + 1])));
            ShanbayClient client = new ShanbayClient(server.url("/").toString());
            ShanbayClient.ShanbayException error = requestFailure(client, "GET", "/large");
            assertEquals("RESPONSE_TOO_LARGE", error.code);
        }
    }

    private static ShanbayClient.ShanbayException requestFailure(
            ShanbayClient client, String method, String path) throws Exception {
        try {
            client.request(method, path, null, COOKIE);
            fail("Expected Shanbay request to fail");
            return null;
        } catch (ShanbayClient.ShanbayException error) {
            return error;
        }
    }

    private static void assertFailure(ShanbayClient client, String method, String path,
                                      String cookie, String code) throws Exception {
        try {
            client.request(method, path, null, cookie);
            fail("Expected request validation to fail");
        } catch (ShanbayClient.ShanbayException error) {
            assertEquals(code, error.code);
        }
    }
}

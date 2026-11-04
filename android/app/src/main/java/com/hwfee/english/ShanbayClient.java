package com.hwfee.english;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ProtocolException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Cookie-authenticated Shanbay HTTP transport. Only the plugin can supply production requests. */
final class ShanbayClient {
    static final String API_ORIGIN = "https://apiv3.shanbay.com";
    static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
    private static final String ORIGIN = "https://web.shanbay.com";

    private final String baseUrl;

    ShanbayClient() {
        this(API_ORIGIN);
    }

    /** Internal constructor for loopback HTTP-server tests. */
    ShanbayClient(String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    String request(String method, String path, String body, String cookie) throws ShanbayException {
        String verb = validateMethod(method);
        validatePath(path);
        String csrf = validateCookie(cookie);

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            try {
                connection.setRequestMethod(verb);
            } catch (ProtocolException error) {
                throw new ShanbayException("INVALID_ARGUMENT", "不支持的请求方法");
            }
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Origin", ORIGIN);
            connection.setRequestProperty("Referer", ORIGIN + "/");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0");
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (csrf != null) connection.setRequestProperty("X-CSRFToken", csrf);

            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }

            int status = connection.getResponseCode();
            if (status == 204) {
                closeResponseStreams(connection);
                return "{}";
            }
            if (status >= 300 && status < 400) {
                closeResponseStreams(connection);
                throw new ShanbayException("REDIRECT_BLOCKED", "扇贝接口暂时不可用，请稍后再试");
            }
            if (status >= 400) {
                closeQuietly(connection.getErrorStream());
                throw statusError(status);
            }

            try (InputStream stream = connection.getInputStream()) {
                return stream == null ? "" : readBounded(stream, MAX_RESPONSE_BYTES);
            }
        } catch (ShanbayException error) {
            throw error;
        } catch (ResponseTooLargeException error) {
            throw new ShanbayException("RESPONSE_TOO_LARGE", "扇贝返回内容过大，请稍后重试");
        } catch (IOException error) {
            throw new ShanbayException("NETWORK_ERROR", "网络连接失败，请检查网络后重试");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static String validateCookie(String cookie) throws ShanbayException {
        if (cookie == null || cookie.trim().isEmpty() || cookie.length() > 20000 || containsControl(cookie)) {
            throw new ShanbayException("INVALID_COOKIE", "Cookie 格式无效，请重新粘贴扇贝 Cookie");
        }
        String authToken = null;
        String csrf = null;
        for (String part : cookie.split(";")) {
            String[] pair = part.trim().split("=", 2);
            if (pair.length != 2) continue;
            String name = pair[0].trim();
            String value = pair[1].trim();
            if (name.equals("auth_token")) {
                if (value.isEmpty() || authToken != null) {
                    throw new ShanbayException("INVALID_COOKIE", "Cookie 格式无效，请重新粘贴扇贝 Cookie");
                }
                authToken = value;
            } else if (name.equals("csrftoken")) {
                csrf = value;
            }
        }
        if (authToken == null) {
            throw new ShanbayException("INVALID_COOKIE", "Cookie 中缺少 auth_token，请重新连接扇贝");
        }
        return csrf == null || csrf.isEmpty() ? null : csrf;
    }

    private static void validatePath(String path) throws ShanbayException {
        if (path == null || !path.startsWith("/") || path.startsWith("//") || containsHeaderBreak(path)) {
            throw invalidPath();
        }
        try {
            URI uri = new URI(path);
            if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null
                    || uri.getPath() == null || uri.getPath().isEmpty()
                    || containsControl(uri.getPath())) {
                throw invalidPath();
            }
            for (String segment : uri.getPath().split("/")) {
                if (segment.equals(".") || segment.equals("..")) throw invalidPath();
            }
        } catch (URISyntaxException error) {
            throw invalidPath();
        }
    }

    private static ShanbayException invalidPath() {
        return new ShanbayException("INVALID_ARGUMENT", "扇贝请求路径无效");
    }

    private static String validateMethod(String method) throws ShanbayException {
        if (method == null) throw new ShanbayException("INVALID_ARGUMENT", "不支持的请求方法");
        String normalized = method.toUpperCase(java.util.Locale.ROOT);
        if (!normalized.equals("GET") && !normalized.equals("POST") && !normalized.equals("DELETE")
                && !normalized.equals("PUT")) {
            throw new ShanbayException("INVALID_ARGUMENT", "不支持的请求方法");
        }
        return normalized;
    }

    private static ShanbayException statusError(int status) {
        if (status == 401) return new ShanbayException("UNAUTHORIZED", "登录已过期，请重新连接扇贝");
        if (status == 403) return new ShanbayException("FORBIDDEN", "请求被拒绝，请在扇贝网页确认登录状态");
        if (status == 412) return new ShanbayException("NOT_READY", "今日学习数据尚未就绪，请先打开官方学习页");
        if (status == 404) return new ShanbayException("NOT_FOUND", "扇贝没有这条内容");
        if (status == 429) return new ShanbayException("RATE_LIMITED", "请求太频繁，请稍后再试");
        return new ShanbayException("HTTP_ERROR", "扇贝接口暂时不可用，请稍后再试");
    }

    private static boolean containsHeaderBreak(String value) {
        return value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0;
    }

    private static boolean containsControl(String value) {
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (ch < 0x20 || ch == 0x7f) return true;
        }
        return false;
    }

    private static String readBounded(InputStream stream, int limit) throws IOException, ResponseTooLargeException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(Math.min(limit, 64 * 1024));
        byte[] chunk = new byte[32 * 1024];
        int read;
        while ((read = stream.read(chunk)) != -1) {
            if (read == 0) continue;
            if (buffer.size() > limit - read) throw new ResponseTooLargeException();
            buffer.write(chunk, 0, read);
        }
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void closeQuietly(InputStream stream) {
        if (stream == null) return;
        try {
            stream.close();
        } catch (IOException ignored) {
        }
    }

    private static void closeResponseStreams(HttpURLConnection connection) {
        closeQuietly(connection.getErrorStream());
        try {
            closeQuietly(connection.getInputStream());
        } catch (IOException ignored) {
        }
    }

    static final class ShanbayException extends Exception {
        final String code;

        ShanbayException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private static final class ResponseTooLargeException extends Exception {}
}

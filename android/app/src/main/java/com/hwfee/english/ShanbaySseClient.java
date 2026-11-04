package com.hwfee.english;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Cookie-authenticated, bounded SSE transport. The production destination is fixed, not supplied by JS. */
final class ShanbaySseClient {
    static final String ORIGIN = "https://sse.shanbay.com";
    static final int MAX_BYTES = 1024 * 1024;
    static final java.util.List<String> TYPES = Arrays.asList("subj", "pred", "obj", "clause", "prep", "nonpred", "appos", "coord", "other");
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "shanbay-sse-deadline"); thread.setDaemon(true); return thread;
    });
    private final String origin;
    private final int connectTimeout, readTimeout, totalTimeout;

    ShanbaySseClient() { this(ORIGIN, 8000, 15000, 45000); }
    /** Loopback fixtures only. The native plugin never exposes an origin argument. */
    ShanbaySseClient(String origin, int connectTimeout, int readTimeout, int totalTimeout) {
        this.origin = origin;
        this.connectTimeout = connectTimeout; this.readTimeout = readTimeout; this.totalTimeout = totalTimeout;
    }

    static final class Result {
        final JSONObject analysis;
        final String translation;
        final Integer remainingPercent;
        Result(JSONObject analysis, String translation, Integer remainingPercent) {
            this.analysis = analysis; this.translation = translation; this.remainingPercent = remainingPercent;
        }
    }

    static final class Failure extends IOException {
        final String code, resetAt;
        Failure(String code, String message) { this(code, message, ""); }
        Failure(String code, String message, String resetAt) { super(message); this.code = code; this.resetAt = resetAt; }
    }

    Result request(String task, String text, String cookie, SentenceCancellation cancellation) throws Failure {
        if (!"analysis".equals(task) && !"translation".equals(task)) throw new Failure("INVALID_ARGUMENT", "句子任务无效");
        String csrf;
        try { csrf = ShanbayClient.validateCookie(cookie); }
        catch (ShanbayClient.ShanbayException error) { throw new Failure("NO_SESSION", "尚未连接扇贝，请在设置中登录"); }
        HttpURLConnection connection = null;
        ScheduledFuture<?> deadline = null;
        AtomicBoolean expired = new AtomicBoolean();
        try {
            String path = "analysis".equals(task) ? "sentence_analysis" : "translate_sentence";
            connection = (HttpURLConnection) new URL(origin + "/bay-translate/sse/" + path).openConnection();
            cancellation.bind(connection);
            connection.setRequestMethod("POST");
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(connectTimeout); connection.setReadTimeout(readTimeout);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "text/event-stream");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Origin", "https://web.shanbay.com");
            connection.setRequestProperty("Referer", "https://web.shanbay.com/");
            if (csrf != null) connection.setRequestProperty("X-CSRFToken", csrf);
            JSONObject body = new JSONObject().put("request_id", UUID.randomUUID().toString()).put("text", text);
            if ("translation".equals(task)) body.put("target_lang", "zh-CN");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            final HttpURLConnection running = connection;
            deadline = DEADLINES.schedule(() -> { expired.set(true); running.disconnect(); }, totalTimeout, TimeUnit.MILLISECONDS);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int status = connection.getResponseCode();
            if (status == 401) throw new Failure("UNAUTHORIZED", "扇贝登录已过期，请重新连接");
            if (status == 403) throw new Failure("FORBIDDEN", "扇贝当前账号无权使用此功能");
            if (status == 429) throw new Failure("RATE_LIMITED", "扇贝请求过于频繁，请稍后重试");
            if (status < 200 || status >= 300) throw new Failure("HTTP_ERROR", "扇贝接口暂不可用（HTTP " + status + "）");
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).startsWith("text/event-stream")) {
                throw new Failure("INVALID_RESPONSE", "扇贝返回了无效的数据格式");
            }
            try (InputStream input = connection.getInputStream()) { return parse(task, text, input, cancellation); }
        } catch (Failure error) {
            if (cancellation.cancelled()) throw new Failure("CANCELLED", "请求已取消");
            if (expired.get()) throw new Failure("TIMEOUT", "扇贝请求超时");
            throw error;
        }
        catch (SocketTimeoutException error) {
            if (cancellation.cancelled()) throw new Failure("CANCELLED", "请求已取消");
            throw new Failure("TIMEOUT", "扇贝请求超时");
        }
        catch (IOException error) {
            if (cancellation.cancelled()) throw new Failure("CANCELLED", "请求已取消");
            if (expired.get()) throw new Failure("TIMEOUT", "扇贝请求超时");
            throw new Failure("NETWORK_ERROR", "无法连接扇贝，请检查网络");
        } catch (JSONException error) { throw new Failure("INVALID_ARGUMENT", "无法生成扇贝请求"); }
        catch (RuntimeException error) {
            if (cancellation.cancelled()) throw new Failure("CANCELLED", "请求已取消");
            if (expired.get()) throw new Failure("TIMEOUT", "扇贝请求超时");
            throw new Failure("NETWORK_ERROR", "无法连接扇贝，请检查网络");
        }
        finally {
            if (deadline != null) deadline.cancel(false);
            if (connection != null) { cancellation.unbind(connection); connection.disconnect(); }
        }
    }

    static Result parse(String task, String text, InputStream input, SentenceCancellation cancellation) throws IOException {
        Accumulator state = new Accumulator(task, text);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new LimitedStream(input),
                StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)))) {
            String event = "", line;
            StringBuilder data = new StringBuilder();
            boolean first = true;
            while ((line = reader.readLine()) != null) {
                if (cancellation.cancelled()) throw new Failure("CANCELLED", "请求已取消");
                if (first && line.startsWith("\ufeff")) line = line.substring(1);
                first = false;
                if (line.isEmpty()) {
                    if (data.length() > 0 && state.accept(event, data.toString())) return state.result();
                    event = ""; data.setLength(0); continue;
                }
                if (line.startsWith(":")) continue;
                int colon = line.indexOf(':');
                String field = colon < 0 ? line : line.substring(0, colon);
                String value = colon < 0 ? "" : line.substring(colon + 1);
                if (value.startsWith(" ")) value = value.substring(1);
                if (field.equals("event")) event = value;
                else if (field.equals("data")) { if (data.length() > 0) data.append('\n'); data.append(value); }
            }
        }
        throw new Failure("INCOMPLETE_RESPONSE", "扇贝结果传输中断，请重试");
    }

    private static final class Accumulator {
        final String task, text;
        final JSONArray segments = new JSONArray();
        final StringBuilder tokens = new StringBuilder();
        Integer remaining;
        // Source offset already covered by emitted segments; segments hold source slices.
        int cursor;
        boolean done;
        Accumulator(String task, String text) { this.task = task; this.text = text; }

        boolean accept(String event, String data) throws Failure {
            if (!Arrays.asList("component", "token", "usage", "done", "quota_exceeded", "error").contains(event)) return false;
            try {
                JSONObject value = new JSONObject(data);
                switch (event) {
                    case "component":
                        if (!task.equals("analysis")) break;
                        Object rawText = value.opt("text"), rawLabel = value.opt("label"), rawType = value.opt("type");
                        if (!(rawText instanceof String) || ((String) rawText).trim().isEmpty() || segments.length() >= 1024) throw invalid();
                        String part = (String) rawText;
                        String type = rawType instanceof String && TYPES.contains(rawType) ? (String) rawType : "other";
                        String label = rawLabel instanceof String && !((String) rawLabel).trim().isEmpty()
                                && ((String) rawLabel).length() <= 80 ? ((String) rawLabel).trim() : SourceAlign.labelFor(type);
                        // Shanbay normalizes whitespace (double spaces, tabs, NBSP) and drops trailing
                        // spaces, so the span is rebuilt from the source instead of the echo.
                        int end = SourceAlign.matchAt(text, cursor, part);
                        int start = cursor;
                        if (end < 0) {
                            start = SourceAlign.startOf(text, cursor, part);
                            end = start < 0 ? -1 : SourceAlign.matchAt(text, start, part);
                        }
                        if (end <= cursor) break;
                        if (start > cursor && SourceAlign.hasWord(text.substring(cursor, start))) {
                            throw incompleteAnalysis();
                        }
                        if (SourceAlign.hasWord(part) && !SourceAlign.meaningfulLabel(label)) throw incompleteAnalysis();
                        segments.put(new JSONObject().put("type", type).put("text", text.substring(cursor, end)).put("label", label));
                        cursor = end;
                        break;
                    case "token":
                        if (task.equals("translation")) {
                            Object token = value.opt("t");
                            if (!(token instanceof String) || tokens.length() + ((String) token).length() > 128000) throw invalid();
                            tokens.append(token);
                        }
                        break;
                    case "usage":
                        Object percent = value.opt("remaining_percent");
                        if (!(percent instanceof Number) || ((Number) percent).doubleValue() != ((Number) percent).intValue()
                                || ((Number) percent).intValue() < 0 || ((Number) percent).intValue() > 100) throw invalid();
                        remaining = ((Number) percent).intValue(); break;
                    case "quota_exceeded":
                        String reset = value.optString("reset_at", "");
                        throw new Failure("QUOTA_EXCEEDED", "扇贝今日额度已用完", reset.length() <= 100 ? reset : "");
                    case "error":
                        String code = value.optString("code", "").toLowerCase(java.util.Locale.ROOT);
                        if (code.equals("401") || code.equals("unauthorized")) throw new Failure("UNAUTHORIZED", "扇贝登录已过期，请重新连接");
                        if (code.equals("403") || code.equals("vip_required") || code.equals("forbidden")) throw new Failure("FORBIDDEN", "扇贝当前账号无权使用此功能");
                        throw new Failure("SERVICE_ERROR", "扇贝句子服务暂不可用，请稍后重试");
                    case "done":
                        if (task.equals("analysis")) {
                            if (!value.optString("status", "ok").equals("ok") || segments.length() == 0) throw invalid();
                            // Cover anything the provider left out, so the card always reproduces the sentence.
                            if (cursor < text.length()) {
                                String tail = text.substring(cursor);
                                if (SourceAlign.hasWord(tail)) {
                                    throw incompleteAnalysis();
                                } else {
                                    JSONObject last = segments.getJSONObject(segments.length() - 1);
                                    last.put("text", last.getString("text") + tail);
                                }
                                cursor = text.length();
                            }
                        } else {
                            if (value.has("t")) {
                                Object complete = value.opt("t");
                                if (!(complete instanceof String) || ((String) complete).length() > 128000) throw invalid();
                                tokens.setLength(0); tokens.append(complete);
                            }
                            if (tokens.toString().trim().isEmpty()) throw invalid();
                        }
                        done = true; return true;
                    default: break;
                }
                return false;
            } catch (JSONException error) { throw invalid(); }
        }

        Result result() throws Failure {
            try {
                JSONObject analysis = task.equals("analysis") ? new JSONObject().put("schemaVersion", 2)
                        .put("sentence", text).put("segments", segments) : null;
                return new Result(analysis, task.equals("translation") ? tokens.toString().trim() : null, remaining);
            } catch (JSONException error) { throw invalid(); }
        }
        private Failure invalid() { return new Failure("INVALID_RESPONSE", "扇贝返回的句子结果不完整或格式无效"); }
        private Failure incompleteAnalysis() { return new Failure("INCOMPLETE_ANALYSIS", "扇贝未完成整句分析"); }
    }

    private static final class LimitedStream extends FilterInputStream {
        int count;
        LimitedStream(InputStream input) { super(input); }
        private void counted(int size) throws Failure {
            count += size;
            if (count > MAX_BYTES) throw new Failure("INVALID_RESPONSE", "扇贝返回内容过大");
        }
        @Override public int read() throws IOException { int value = in.read(); if (value >= 0) counted(1); return value; }
        @Override public int read(byte[] bytes, int off, int len) throws IOException {
            int size = in.read(bytes, off, Math.min(len, MAX_BYTES + 1 - count));
            if (size > 0) counted(size); return size;
        }
    }
}

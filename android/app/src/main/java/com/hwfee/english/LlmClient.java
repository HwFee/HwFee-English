package com.hwfee.english;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Native HTTP transport, kept independent of Android so provider responses can be tested locally. */
final class LlmClient {
    static final String DEFAULT_BASE = "https://api.deepseek.com/v1";
    static final String DEFAULT_MODEL = "deepseek-chat";
    static final int MAX_RESPONSE_BYTES = 1024 * 1024;

    private static final String SYSTEM = "你是英语精读助手。把用户给出的英文句子翻译成自然、准确的中文。"
            + "只输出译文本身，不要解释，不要加引号，不要重复原文。";

    private final int connectTimeout;
    private final int readTimeout;

    LlmClient() {
        this(20000, 90000);
    }

    LlmClient(int connectTimeout, int readTimeout) {
        this.connectTimeout = connectTimeout;
        this.readTimeout = readTimeout;
    }

    static final class Config {
        final String baseUrl;
        final String model;

        Config(String baseUrl, String model) {
            String base = valueOrDefault(baseUrl, DEFAULT_BASE);
            while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
            try {
                URI uri = new URI(base);
                String scheme = uri.getScheme();
                if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                        || uri.getHost() == null || uri.getPort() > 65535
                        || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                        || uri.getRawFragment() != null) {
                    throw new URISyntaxException(base, "Invalid API base URL");
                }
            } catch (URISyntaxException error) {
                // Never echo a URL: users sometimes paste credentials into it by mistake.
                throw new IllegalArgumentException("翻译接口地址无效，请填写不含密钥、查询参数或片段的 HTTP(S) 基础地址");
            }
            this.baseUrl = base;
            this.model = valueOrDefault(model, DEFAULT_MODEL);
        }

        Config requireHttps() {
            if (!baseUrl.regionMatches(true, 0, "https://", 0, 8)) {
                throw new IllegalArgumentException("翻译接口必须使用 HTTPS 地址");
            }
            return this;
        }
    }

    static String valueOrDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    static void validateKey(String key) {
        if (key == null || key.trim().isEmpty()) {
            throw new IllegalArgumentException("还没有配置翻译密钥");
        }
        for (int i = 0; i < key.length(); i++) {
            char character = key.charAt(i);
            if (character < 32 || character == 127) {
                throw new IllegalArgumentException("翻译密钥格式无效，请重新粘贴");
            }
        }
    }

    String translate(String key, Config config, String text) throws TranslationException {
        validateKey(key);
        if (text == null || text.trim().isEmpty()) {
            throw new IllegalArgumentException("没有要翻译的句子");
        }
        HttpURLConnection connection = null;
        try {
            JSONObject payload = new JSONObject();
            payload.put("model", config.model);
            payload.put("temperature", 0.2);
            payload.put("stream", false);
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", SYSTEM));
            messages.put(new JSONObject().put("role", "user").put("content", text.trim()));
            payload.put("messages", messages);

            connection = (HttpURLConnection) new URL(config.baseUrl + "/chat/completions").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            // A provider URL must not redirect a request carrying the user's API key.
            connection.setInstanceFollowRedirects(false);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + key.trim());
            connection.setRequestProperty("Accept", "application/json");
            byte[] request = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(request.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(request);
            }

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new TranslationException(httpError(status));
            try (InputStream in = connection.getInputStream()) {
                return parseTranslation(readResponse(in));
            }
        } catch (TranslationException error) {
            throw error;
        } catch (SocketTimeoutException error) {
            throw new TranslationException("翻译请求超时，请稍后重试");
        } catch (IOException error) {
            // Transport/provider error details can contain URLs, headers, or the key.
            throw new TranslationException("无法连接翻译接口，请检查网络和接口地址");
        } catch (JSONException error) {
            throw new TranslationException("无法生成翻译请求");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String httpError(int status) {
        if (status == 401 || status == 403) return "翻译密钥无效或无权访问，请在设置里检查密钥和模型";
        if (status == 402) return "翻译账户余额不足";
        if (status == 429) return "请求太频繁，请稍后再试";
        if (status >= 300 && status < 400) return "翻译接口发生重定向，请在设置里填写最终接口地址";
        return "翻译接口返回 HTTP " + status;
    }

    private static String readResponse(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int count;
        while ((count = in.read(chunk)) != -1) {
            if (count > MAX_RESPONSE_BYTES - buffer.size()) {
                throw new TranslationException("翻译接口返回内容过大，请检查接口设置");
            }
            buffer.write(chunk, 0, count);
        }
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String parseTranslation(String body) throws TranslationException {
        if (body.trim().isEmpty()) throw new TranslationException("翻译结果为空");
        try {
            JSONObject response = new JSONObject(body);
            JSONArray choices = response.optJSONArray("choices");
            JSONObject choice = choices == null ? null : choices.optJSONObject(0);
            JSONObject message = choice == null ? null : choice.optJSONObject("message");
            if (message == null) throw new TranslationException("翻译接口返回格式无效");
            if ("length".equals(choice.optString("finish_reason"))) {
                throw new TranslationException("翻译结果不完整，请重试");
            }
            Object refusal = message.opt("refusal");
            if ("content_filter".equals(choice.optString("finish_reason"))
                    || (refusal instanceof String && !((String) refusal).trim().isEmpty())) {
                throw new TranslationException("翻译请求被接口拒绝，请重试或检查模型设置");
            }
            Object content = message.opt("content");
            if (content == null || content == JSONObject.NULL) throw new TranslationException("翻译结果为空");
            if (!(content instanceof String)) throw new TranslationException("翻译接口返回格式无效");
            String translation = ((String) content).trim();
            if (translation.isEmpty()) throw new TranslationException("翻译结果为空");
            return translation;
        } catch (JSONException error) {
            throw new TranslationException("翻译接口返回格式无效");
        }
    }

    static final class TranslationException extends IOException {
        TranslationException(String message) {
            super(message);
        }
    }
}

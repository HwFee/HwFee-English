package com.hwfee.english;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Sentence translation against any OpenAI-compatible endpoint.
 *
 * The key lives in the Keystore and is used here, so it never enters the WebView. Shanbay's own
 * metered translate service is deliberately not used: it is quota-limited and VIP-gated, while a
 * personal key is unlimited for this workload.
 */
@CapacitorPlugin(name = "Llm")
public class LlmPlugin extends Plugin {

    private static final String KEY = "llm.key";
    private static final String BASE = "llm.base";
    private static final String MODEL = "llm.model";

    private static final String DEFAULT_BASE = "https://api.deepseek.com/v1";
    private static final String DEFAULT_MODEL = "deepseek-chat";
    private static final String SYSTEM = "你是英语精读助手。把用户给出的英文句子翻译成自然、准确的中文。"
            + "只输出译文本身，不要解释，不要加引号，不要重复原文。";

    @PluginMethod
    public void setConfig(PluginCall call) {
        String key = call.getString("key");
        String baseUrl = call.getString("baseUrl", DEFAULT_BASE);
        String model = call.getString("model", DEFAULT_MODEL);
        try {
            if (key != null && !key.isEmpty()) Vault.put(getContext(), KEY, key.trim());
            Vault.put(getContext(), BASE, baseUrl == null || baseUrl.isEmpty() ? DEFAULT_BASE : baseUrl.trim());
            Vault.put(getContext(), MODEL, model == null || model.isEmpty() ? DEFAULT_MODEL : model.trim());
            call.resolve(configObject());
        } catch (Exception error) {
            call.reject("保存翻译设置失败：" + error.getMessage());
        }
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        call.resolve(configObject());
    }

    @PluginMethod
    public void clearConfig(PluginCall call) {
        Vault.remove(getContext(), KEY);
        JSObject out = new JSObject();
        out.put("has", false);
        call.resolve(out);
    }

    @PluginMethod
    public void translate(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("没有要翻译的句子");
            return;
        }
        String key = Vault.get(getContext(), KEY);
        if (key == null) {
            call.reject("还没有配置翻译密钥");
            return;
        }
        String base = Vault.get(getContext(), BASE);
        String model = Vault.get(getContext(), MODEL);
        getBridge().execute(() -> {
            try {
                call.resolve(chat(key, base, model, text.trim()));
            } catch (Exception error) {
                call.reject(error.getMessage());
            }
        });
    }

    // ------------------------------------------------------------------- llm

    private JSObject chat(String key, String base, String model, String text) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("model", model);
        payload.put("temperature", 0.2);
        payload.put("stream", false);
        JSONArray messages = new JSONArray();
        messages.put(new JSONObject().put("role", "system").put("content", SYSTEM));
        messages.put(new JSONObject().put("role", "user").put("content", text));
        payload.put("messages", messages);

        String baseUrl = base == null ? DEFAULT_BASE : base;
        while (baseUrl.endsWith("/")) baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        HttpURLConnection connection =
                (HttpURLConnection) new URL(baseUrl + "/chat/completions").openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(90000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + key);
        connection.setRequestProperty("Accept", "application/json");
        try (OutputStream out = connection.getOutputStream()) {
            out.write(payload.toString().getBytes(StandardCharsets.UTF_8));
        }

        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String body = stream == null ? "" : readAll(stream);
        connection.disconnect();

        if (status == 401) throw new Exception("翻译密钥无效，请在设置里更新");
        if (status == 402) throw new Exception("翻译账户余额不足");
        if (status == 429) throw new Exception("请求太频繁，请稍后再试");
        if (status >= 400) throw new Exception("翻译接口返回 HTTP " + status);

        String content = new JSONObject(body)
                .optJSONArray("choices")
                .optJSONObject(0)
                .optJSONObject("message")
                .optString("content", "");
        if (content.trim().isEmpty()) throw new Exception("翻译结果为空");

        JSObject out = new JSObject();
        out.put("translation", content.trim());
        out.put("model", model == null ? DEFAULT_MODEL : model);
        return out;
    }

    private JSObject configObject() {
        String base = Vault.get(getContext(), BASE);
        String model = Vault.get(getContext(), MODEL);
        JSObject out = new JSObject();
        out.put("has", Vault.has(getContext(), KEY));
        out.put("baseUrl", base == null ? DEFAULT_BASE : base);
        out.put("model", model == null ? DEFAULT_MODEL : model);
        return out;
    }

    private static String readAll(InputStream in) throws Exception {
        try (InputStream stream = in) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[32 * 1024];
            int read;
            while ((read = stream.read(chunk)) > 0) buffer.write(chunk, 0, read);
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}

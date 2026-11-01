package com.hwfee.english;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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

    @PluginMethod
    public void setConfig(PluginCall call) {
        String key = call.getString("key");
        String baseUrl = call.getString("baseUrl");
        String model = call.getString("model");
        LlmClient.Config config;
        try {
            config = new LlmClient.Config(
                    baseUrl == null ? Vault.get(getContext(), BASE) : baseUrl,
                    model == null ? Vault.get(getContext(), MODEL) : model).requireHttps();
            if (key != null && !key.trim().isEmpty()) LlmClient.validateKey(key);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage());
            return;
        }
        try {
            if (key != null && !key.trim().isEmpty()) Vault.put(getContext(), KEY, key.trim());
            Vault.put(getContext(), BASE, config.baseUrl);
            Vault.put(getContext(), MODEL, config.model);
            call.resolve(configObject());
        } catch (Exception error) {
            call.reject("保存翻译设置失败，请重试");
        }
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        call.resolve(configObject());
    }

    @PluginMethod
    public void clearConfig(PluginCall call) {
        Vault.remove(getContext(), KEY);
        call.resolve(configObject());
    }

    @PluginMethod
    public void translate(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("没有要翻译的句子");
            return;
        }
        String key = Vault.get(getContext(), KEY);
        LlmClient.Config config;
        try {
            LlmClient.validateKey(key);
            config = new LlmClient.Config(Vault.get(getContext(), BASE), Vault.get(getContext(), MODEL)).requireHttps();
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage());
            return;
        }
        getBridge().execute(() -> {
            try {
                JSObject out = new JSObject();
                out.put("translation", new LlmClient().translate(key, config, text));
                out.put("model", config.model);
                call.resolve(out);
            } catch (LlmClient.TranslationException | IllegalArgumentException error) {
                call.reject(error.getMessage());
            }
        });
    }

    private JSObject configObject() {
        String base = Vault.get(getContext(), BASE);
        String model = Vault.get(getContext(), MODEL);
        JSObject out = new JSObject();
        String key = Vault.get(getContext(), KEY);
        out.put("has", key != null && !key.trim().isEmpty());
        out.put("baseUrl", LlmClient.valueOrDefault(base, LlmClient.DEFAULT_BASE));
        out.put("model", LlmClient.valueOrDefault(model, LlmClient.DEFAULT_MODEL));
        return out;
    }
}

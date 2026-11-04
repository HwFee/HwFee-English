package com.hwfee.english;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Context;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Shanbay-first sentence tools with a personal OpenAI-compatible fallback. Secrets stay native. */
@CapacitorPlugin(name = "Llm")
public class LlmPlugin extends Plugin {

    private static final String KEY = "llm.key";
    private static final String BASE = "llm.base";
    private static final String MODEL = "llm.model";
    private static final String PREFS = "reader-ai";
    private static final ExecutorService REQUESTS = Executors.newFixedThreadPool(3);
    private static final ExecutorService PRETRANSLATION = Executors.newSingleThreadExecutor();
    private static final ExecutorService CANCELLATIONS = Executors.newFixedThreadPool(2);
    private static final ExecutorService READS = Executors.newSingleThreadExecutor();
    private static final ExecutorService BALANCES = Executors.newFixedThreadPool(2);
    private static final DeepSeekBalanceClient balanceClient = new DeepSeekBalanceClient();
    private static LlmRepository repository;
    private static LlmCache cache;
    private static UsageStore usage;
    private static SentenceService sentenceService;
    private static final java.util.concurrent.atomic.AtomicInteger PRETRANSLATION_REVISION = new java.util.concurrent.atomic.AtomicInteger();

    @Override public void load() {
        REQUESTS.execute(() -> { try { repository(); } catch (Exception ignored) { /* A later request can retry storage. */ } });
    }

    private LlmRepository repository() {
        synchronized (LlmPlugin.class) {
            if (repository == null) {
                cache = new LlmCache(getContext());
                usage = new UsageStore(cache);
                repository = new LlmRepository(cache, new LlmClient(usage.observer()));
            }
            return repository;
        }
    }

    private SentenceService service() {
        synchronized (LlmPlugin.class) {
            if (sentenceService == null) sentenceService = new SentenceService(cacheForService(), repository(), new ShanbaySseClient(), usage);
            return sentenceService;
        }
    }

    private LlmCache cacheForService() { repository(); return cache; }

    private SentenceService.Settings settings(LlmClient.Config config, String key) {
        return new SentenceService.Settings(Vault.get(getContext(), "shanbay.cookie"), key, config);
    }

    private boolean autoTranslate() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("autoTranslate", false);
    }

    @PluginMethod
    public void setPreferences(PluginCall call) {
        Boolean enabled = call.getBoolean("autoTranslate");
        if (enabled == null) { call.reject("缺少自动预译开关状态"); return; }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("autoTranslate", enabled).apply();
        if (!enabled) PRETRANSLATION_REVISION.incrementAndGet();
        call.resolve(configObject());
    }

    @PluginMethod
    public void cancelPretranslation(PluginCall call) {
        PRETRANSLATION_REVISION.incrementAndGet();
        call.resolve();
    }

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
            config.requireKeyForEndpointChange(Vault.get(getContext(), BASE), Vault.get(getContext(), KEY), key);
            if (key != null && !key.trim().isEmpty()) LlmClient.validateKey(key);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage());
            return;
        }
        try {
            if (key != null && !key.trim().isEmpty()) Vault.put(getContext(), KEY, key.trim());
            Vault.put(getContext(), BASE, config.baseUrl);
            Vault.put(getContext(), MODEL, config.model);
            PRETRANSLATION_REVISION.incrementAndGet();
            balanceClient.invalidate();
            call.resolve(configObject());
        } catch (Exception error) {
            call.reject("保存翻译设置失败，请重试");
        }
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        call.resolve(configObject());
    }

    /** Read-only local statistics: this method never probes either paid sentence endpoint. */
    @PluginMethod
    public void getUsage(PluginCall call) {
        Object rawDays = call.getData().opt("days");
        if (rawDays != null && !(rawDays instanceof Integer)) { call.reject("统计天数必须为整数", "INVALID_ARGUMENT"); return; }
        int days = call.getInt("days", 30);
        if (days < 1 || days > 3650) { call.reject("统计天数应为 1–3650", "INVALID_ARGUMENT"); return; }
        READS.execute(() -> {
            try {
                LlmClient.Config config = new LlmClient.Config(Vault.get(getContext(), BASE), Vault.get(getContext(), MODEL));
                call.resolve(JSObject.fromJSONObject(service().usage(settings(config, Vault.get(getContext(), KEY)), days)));
            } catch (Exception error) { call.reject("读取用量记录失败，请重试", "STORAGE_ERROR"); }
        });
    }

    /** Independent Shanbay account quota read, including while sentence requests are blocked. */
    @PluginMethod
    public void getShanbayQuota(PluginCall call) {
        Object rawForce = call.getData().opt("forceRefresh");
        if (rawForce != null && !(rawForce instanceof Boolean)) {
            call.reject("刷新选项必须为布尔值", "INVALID_ARGUMENT"); return;
        }
        boolean force = call.getBoolean("forceRefresh", false);
        String cookie = Vault.get(getContext(), "shanbay.cookie");
        BALANCES.execute(() -> {
            try {
                LlmClient.Config config = new LlmClient.Config(Vault.get(getContext(), BASE), Vault.get(getContext(), MODEL));
                SentenceService.Settings selected = new SentenceService.Settings(cookie, Vault.get(getContext(), KEY), config);
                org.json.JSONObject result = service().refreshQuota(selected, new ShanbayClient(), force);
                if (!java.util.Objects.equals(cookie, Vault.get(getContext(), "shanbay.cookie"))) {
                    call.reject("扇贝账号已变更，请重新读取", "CONFIG_CHANGED"); return;
                }
                call.resolve(JSObject.fromJSONObject(result));
            } catch (ShanbayClient.ShanbayException error) { call.reject(error.getMessage(), error.code); }
            catch (Exception error) { call.reject("读取扇贝额度失败，请重试", "QUOTA_ERROR"); }
        });
    }

    /** Account balance read with the saved official DeepSeek key; no model or sentence is sent. */
    @PluginMethod
    public void getDeepSeekBalance(PluginCall call) {
        Object rawForce = call.getData().opt("forceRefresh");
        if (rawForce != null && !(rawForce instanceof Boolean)) {
            call.reject("刷新选项必须为布尔值", "INVALID_ARGUMENT"); return;
        }
        boolean force = call.getBoolean("forceRefresh", false);
        String key = Vault.get(getContext(), KEY);
        LlmClient.Config config;
        try { config = new LlmClient.Config(Vault.get(getContext(), BASE), null).requireHttps(); }
        catch (IllegalArgumentException invalid) { call.reject("翻译接口配置无效，请在设置中检查", "INVALID_CONFIG"); return; }
        BALANCES.execute(() -> {
            try {
                org.json.JSONObject result = balanceClient.get(key, config, force);
                LlmClient.Config current = new LlmClient.Config(Vault.get(getContext(), BASE), null);
                if (!java.util.Objects.equals(key, Vault.get(getContext(), KEY)) || !config.baseUrl.equals(current.baseUrl)) {
                    call.reject("翻译设置已更改，请重新查询余额", "CONFIG_CHANGED"); return;
                }
                call.resolve(JSObject.fromJSONObject(result));
            } catch (DeepSeekBalanceClient.Failure error) { call.reject(error.getMessage(), error.code); }
            catch (Exception error) { call.reject("读取 DeepSeek 余额失败，请重试", "BALANCE_ERROR"); }
        });
    }

    @PluginMethod
    public void clearConfig(PluginCall call) {
        Vault.remove(getContext(), KEY);
        PRETRANSLATION_REVISION.incrementAndGet();
        balanceClient.invalidate();
        call.resolve(configObject());
    }

    /** Uses only the saved address and saved key, never a caller-supplied destination. */
    @PluginMethod
    public void listModels(PluginCall call) {
        String key = Vault.get(getContext(), KEY);
        LlmClient.Config config;
        try {
            LlmClient.validateKey(key);
            config = new LlmClient.Config(Vault.get(getContext(), BASE), null).requireHttps();
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage());
            return;
        }
        REQUESTS.execute(() -> {
            try {
                JSArray models = new JSArray();
                for (LlmClient.Model model : new LlmClient().listModels(key, config)) {
                    JSObject item = new JSObject();
                    item.put("id", model.id);
                    item.put("name", model.name);
                    models.put(item);
                }
                JSObject out = new JSObject();
                out.put("models", models);
                call.resolve(out);
            } catch (LlmClient.TranslationException | IllegalArgumentException error) {
                call.reject(error.getMessage());
            }
        });
    }

    @PluginMethod
    public void translate(PluginCall call) {
        request(call, "translation");
    }

    @PluginMethod
    public void analyze(PluginCall call) {
        request(call, "analysis");
    }

    @PluginMethod
    public void cancelSentence(PluginCall call) {
        String id = call.getString("requestId", "");
        if (!id.matches("[A-Za-z0-9_-]{1,128}")) { call.reject("请求编号无效", "INVALID_ARGUMENT"); return; }
        CANCELLATIONS.execute(() -> service().cancel(id));
        call.resolve();
    }

    private void request(PluginCall call, String task) {
        String text;
        String key = Vault.get(getContext(), KEY);
        LlmClient.Config config;
        try {
            text = SentenceService.validate(task, call.getString("text"));
            config = new LlmClient.Config(Vault.get(getContext(), BASE), Vault.get(getContext(), MODEL)).requireHttps();
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "INVALID_ARGUMENT");
            return;
        }
        String requestId = call.getString("requestId");
        if (requestId != null && !requestId.matches("[A-Za-z0-9_-]{1,128}")) {
            call.reject("请求编号无效", "INVALID_ARGUMENT"); return;
        }
        SentenceService.Settings selected = settings(config, key);
        REQUESTS.execute(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(service().request(selected, task, text, requestId).json()));
            } catch (ShanbaySseClient.Failure error) {
                call.reject(error.getMessage(), error.code, null, new JSObject().put("quotaResetAt", error.resetAt));
            } catch (IllegalArgumentException error) {
                call.reject(error.getMessage(), "INVALID_ARGUMENT");
            } catch (Exception error) {
                call.reject("处理请求失败，请稍后重试");
            }
        });
    }

    @PluginMethod
    public void pretranslate(PluginCall call) {
        Object rawAnalysis = call.getData().opt("includeAnalysis");
        if (rawAnalysis != null && !(rawAnalysis instanceof Boolean)) { call.reject("分析预加载选项必须为布尔值", "INVALID_ARGUMENT"); return; }
        boolean includeAnalysis = call.getBoolean("includeAnalysis", true);
        List<String> sentences = new ArrayList<>();
        LlmClient.Config config;
        String key = Vault.get(getContext(), KEY);
        try {
            JSArray sources = call.getArray("sentences");
            if (sources == null || sources.length() > 400) throw new IllegalArgumentException("预译文章句数无效");
            int characters = 0;
            for (int i = 0; i < sources.length(); i++) {
                Object source = sources.get(i);
                if (!(source instanceof String)) throw new IllegalArgumentException("预译句子格式无效");
                String text = SentenceService.validate("translation", (String) source);
                sentences.add(text);
                characters += text.length();
            }
            if (characters > 250000) throw new IllegalArgumentException("预译文章过长");
            config = new LlmClient.Config(Vault.get(getContext(), BASE), Vault.get(getContext(), MODEL)).requireHttps();
        } catch (Exception error) { call.reject("预译文章参数无效"); return; }
        int revision = PRETRANSLATION_REVISION.incrementAndGet();
        SentenceService.Settings selected = settings(config, key);
        PRETRANSLATION.execute(() -> {
            try {
                org.json.JSONObject progress = service().pretranslate(selected, sentences, () -> revision == PRETRANSLATION_REVISION.get() && autoTranslate()
                        && config.baseUrl.equals(new LlmClient.Config(Vault.get(getContext(), BASE), Vault.get(getContext(), MODEL)).baseUrl)
                        && config.model.equals(new LlmClient.Config(Vault.get(getContext(), BASE), Vault.get(getContext(), MODEL)).model)
                        && java.util.Objects.equals(key, Vault.get(getContext(), KEY))
                        && java.util.Objects.equals(selected.cookie, Vault.get(getContext(), "shanbay.cookie")), includeAnalysis);
                call.resolve(JSObject.fromJSONObject(progress));
            } catch (ShanbaySseClient.Failure error) {
                call.reject(error.getMessage(), error.code, null, new JSObject().put("quotaResetAt", error.resetAt));
            } catch (LlmClient.TranslationException | IllegalArgumentException error) {
                call.reject(error.getMessage());
            } catch (Exception error) { call.reject("文章预译失败，请稍后重试"); }
        });
    }

    private JSObject configObject() {
        String base = Vault.get(getContext(), BASE);
        String model = Vault.get(getContext(), MODEL);
        JSObject out = new JSObject();
        String key = Vault.get(getContext(), KEY);
        out.put("has", key != null && !key.trim().isEmpty());
        out.put("hasShanbay", Vault.has(getContext(), "shanbay.cookie"));
        out.put("canTranslate", out.getBoolean("has", false) || out.getBoolean("hasShanbay", false));
        out.put("routing", "shanbay-first");
        out.put("cacheVersion", "sentence-analysis-v2");
        String cookie = Vault.get(getContext(), "shanbay.cookie");
        out.put("sessionScope", new SentenceService.Settings(cookie, null, new LlmClient.Config(null, null)).scope);
        out.put("autoTranslate", autoTranslate());
        try {
            LlmClient.Config config = new LlmClient.Config(base, model);
            out.put("baseUrl", config.baseUrl);
            out.put("model", config.model);
        } catch (IllegalArgumentException ignored) {
            out.put("baseUrl", LlmClient.valueOrDefault(base, LlmClient.DEFAULT_BASE));
            out.put("model", LlmClient.effectiveModel(base, model));
        }
        return out;
    }
}

package com.hwfee.english;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Shanbay first, personal LLM fallback. Manual taps and pretranslation share the same reservations. */
final class SentenceService {
    private final LlmCache cache;
    private final LlmRepository fallback;
    private final ShanbaySseClient shanbay;
    private final UsageStore usage;
    private final Object quotaReadLock = new Object();
    private final ConcurrentHashMap<String, Work> pending = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Subscriber> subscribers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> cancelledIds = new ConcurrentHashMap<>();

    SentenceService(LlmCache cache, LlmRepository fallback, ShanbaySseClient shanbay) {
        this(cache, fallback, shanbay, new UsageStore(cache));
    }

    SentenceService(LlmCache cache, LlmRepository fallback, ShanbaySseClient shanbay, UsageStore usage) {
        this.cache = cache; this.fallback = fallback; this.shanbay = shanbay;
        this.usage = usage;
    }

    static final class Settings {
        final String cookie, key, scope;
        final LlmClient.Config config;
        Settings(String cookie, String key, LlmClient.Config config) {
            this.cookie = cookie; this.key = key; this.config = config;
            String account = "";
            if (cookie != null) for (String part : cookie.split(";")) {
                if (part.trim().startsWith("auth_token=")) { account = part.trim(); break; }
            }
            scope = LlmRepository.hash(account);
        }
        boolean hasKey() { return key != null && !key.trim().isEmpty(); }
    }

    static int words(String text) {
        int count = 0;
        for (String word : LlmRepository.WHITESPACE.matcher(text).replaceAll(" ").trim().split(" ")) {
            if (word.matches(".*[A-Za-z].*")) count++;
        }
        return count;
    }

    static String validate(String task, String text) {
        if (text == null || text.trim().isEmpty()) throw new IllegalArgumentException("没有要处理的句子");
        if (text.length() > LlmRepository.MAX_SENTENCE_LENGTH || words(text) > 300) {
            throw new IllegalArgumentException("选择内容过长，请缩小到 300 个英文词以内");
        }
        if (task.equals("analysis") && (words(text) < 10 || words(text) > 120)) {
            throw new IllegalArgumentException("长难句分析支持 10–120 个英文词");
        }
        return text; // Preserve every source character for Shanbay's component tiling.
    }

    static final class Answer {
        final JSONObject analysis;
        final String translation, provider, model, fallbackReason;
        final boolean cached;
        final long expiresAt;
        final JSONObject quota;
        Answer(JSONObject analysis, String translation, String provider, String model, boolean cached,
               String fallbackReason, long expiresAt, JSONObject quota) {
            this.analysis = analysis; this.translation = translation; this.provider = provider; this.model = model;
            this.cached = cached; this.fallbackReason = fallbackReason; this.expiresAt = expiresAt; this.quota = quota;
        }
        JSONObject json() throws JSONException {
            JSONObject result = new JSONObject().put("provider", provider).put("model", model).put("cached", cached)
                    .put("fallbackReason", fallbackReason).put("expiresAt", expiresAt);
            if (analysis != null) result.put("analysis", analysis); else result.put("translation", translation);
            if (quota.has("remainingPercent")) result.put("remainingPercent", quota.getInt("remainingPercent"));
            if (quota.has("usageAt")) result.put("usageAt", quota.getLong("usageAt"));
            if (quota.has("resetAt")) result.put("quotaResetAt", quota.getString("resetAt"));
            return result;
        }
    }

    private String primaryId(Settings settings, String task, String text) {
        return "shanbay:" + LlmRepository.hash(new JSONArray().put(task.equals("analysis") ? "v3" : "v1").put(settings.scope).put(task)
                .put(task.equals("translation") ? LlmRepository.sentence(text) : text).toString());
    }

    private Answer saved(Settings settings, String task, String text) throws JSONException {
        String id = primaryId(settings, task, text);
        String primary = cache.get(id, System.currentTimeMillis());
        if (primary != null) try {
            JSONObject value = new JSONObject(primary);
            return new Answer(value.optJSONObject("analysis"), value.optString("translation", null), "shanbay", "扇贝",
                    true, "", cache.expiresAt(id), quota(settings));
        } catch (JSONException ignored) { /* A corrupt answer is a cache miss. */ }
        LlmRepository.Result existing = fallback.cached(task, settings.config, text);
        return existing == null ? null : fallbackAnswer(settings, task, text, existing, "");
    }

    Answer request(Settings settings, String task, String source, String requestId) throws Exception {
        String text = validate(task, source);
        Answer existing = saved(settings, task, text);
        if (existing != null) { reuse(settings, task, existing, false); return existing; }
        String id = LlmRepository.hash(new JSONArray().put(settings.scope).put(settings.config.baseUrl)
                .put(settings.config.model).put(task).put(task.equals("translation") ? LlmRepository.sentence(text) : text).toString());
        Subscriber subscriber;
        Work work;
        boolean joined;
        for (;;) {
            Work own = new Work(id, settings, task, text);
            Work other = pending.putIfAbsent(id, own);
            work = other == null ? own : other;
            synchronized (work) {
                if (work.cancellation.cancelled()) { pending.remove(id, work); continue; }
                work.waiters++;
                subscriber = new Subscriber(work);
                joined = other != null;
                break;
            }
        }
        if (requestId != null && !requestId.isEmpty()) {
            pruneCancelled();
            subscribers.put(requestId, subscriber);
            if (cancelledIds.remove(requestId) != null) subscriber.cancel();
        }
        try {
            if (subscriber.cancelled) throw new ShanbaySseClient.Failure("CANCELLED", "请求已取消");
            work.future.run(); // Only the first caller executes a FutureTask.
            for (;;) {
                if (subscriber.cancelled) throw new ShanbaySseClient.Failure("CANCELLED", "请求已取消");
                try {
                    Answer result = work.future.get(150, TimeUnit.MILLISECONDS);
                    if (joined || result.cached) reuse(settings, task, result, joined);
                    return result;
                }
                catch (TimeoutException waiting) { /* A cancelled subscriber need not wait for another subscriber's LLM. */ }
            }
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new ShanbaySseClient.Failure("SERVICE_ERROR", "句子处理失败，请重试");
        } finally {
            subscriber.detach();
            if (requestId != null) subscribers.remove(requestId, subscriber);
        }
    }

    private void reuse(Settings settings, String task, Answer answer, boolean joined) {
        usage.reuse(answer.provider, answer.provider.equals("shanbay") ? settings.scope : settings.config.baseUrl,
                answer.provider.equals("shanbay") ? "扇贝" : answer.model, task, joined);
    }

    private final class Work {
        final String id;
        final SentenceCancellation cancellation = new SentenceCancellation();
        final FutureTask<Answer> future;
        int waiters;
        Work(String id, Settings settings, String task, String text) {
            this.id = id;
            future = new FutureTask<>(() -> {
                try { return load(settings, task, text, cancellation); }
                finally { pending.remove(id, this); }
            });
        }
    }

    private final class Subscriber {
        final Work work;
        volatile boolean cancelled;
        boolean detached;
        Subscriber(Work work) { this.work = work; }
        void cancel() { cancelled = true; detach(); }
        void detach() {
            synchronized (work) {
                if (detached) return;
                detached = true;
                if (--work.waiters == 0 && !work.future.isDone()) {
                    work.cancellation.cancel(); pending.remove(work.id, work);
                }
            }
        }
    }

    void cancel(String requestId) {
        Subscriber subscriber = subscribers.get(requestId);
        if (subscriber != null) subscriber.cancel();
        else { pruneCancelled(); if (cancelledIds.size() < 256) cancelledIds.put(requestId, System.currentTimeMillis()); }
    }

    private void pruneCancelled() {
        long cutoff = System.currentTimeMillis() - 60000;
        for (Map.Entry<String, Long> entry : cancelledIds.entrySet()) if (entry.getValue() < cutoff) cancelledIds.remove(entry.getKey(), entry.getValue());
    }

    private Answer load(Settings settings, String task, String text, SentenceCancellation cancellation) throws Exception {
        Answer existing = saved(settings, task, text);
        if (existing != null) return existing;
        String reason = unavailable(settings, task);
        String reset = quota(settings).optString("resetAt", "");
        if (reason.isEmpty()) {
            long started = System.nanoTime();
            boolean success = false, cancelled = false;
            usage.started("shanbay");
            try {
                ShanbaySseClient.Result result = shanbay.request(task, text, settings.cookie, cancellation);
                if (cancellation.cancelled()) throw new ShanbaySseClient.Failure("CANCELLED", "请求已取消");
                success = true;
                rememberUsage(settings, result.remainingPercent);
                String id = primaryId(settings, task, text);
                JSONObject value = new JSONObject();
                if (result.analysis != null) value.put("analysis", result.analysis); else value.put("translation", result.translation);
                cache.put(id, value.toString(), System.currentTimeMillis());
                return new Answer(result.analysis, result.translation, "shanbay", "扇贝", false, "", cache.expiresAt(id), quota(settings));
            } catch (ShanbaySseClient.Failure failure) {
                if (failure.code.equals("CANCELLED") || cancellation.cancelled()) {
                    cancelled = true;
                    throw new ShanbaySseClient.Failure("CANCELLED", "请求已取消");
                }
                rememberFailure(settings, task, failure);
                reason = failure.getMessage(); reset = failure.resetAt;
            } finally {
                try { usage.request("shanbay", settings.scope, "扇贝", task, success, cancelled,
                        TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started), null); }
                finally { usage.finished("shanbay"); }
            }
        }
        if (cancellation.cancelled()) throw new ShanbaySseClient.Failure("CANCELLED", "请求已取消");
        if (!settings.hasKey()) throw new ShanbaySseClient.Failure("FALLBACK_UNAVAILABLE",
                reason + "；尚未配置回退 API，请在设置中填写密钥", reset);
        try {
            LlmRepository.Result result = fallback.request(task, settings.key, settings.config, text);
            if (cancellation.cancelled()) throw new ShanbaySseClient.Failure("CANCELLED", "请求已取消");
            return fallbackAnswer(settings, task, text, result, reason);
        } catch (LlmClient.TranslationException | IllegalArgumentException error) {
            throw new ShanbaySseClient.Failure("FALLBACK_FAILED", reason + "；回退 API 也失败：" + error.getMessage(), reset);
        }
    }

    private Answer fallbackAnswer(Settings settings, String task, String text, LlmRepository.Result result, String reason) throws JSONException {
        JSONObject analysis = task.equals("analysis") ? adaptAnalysis(text, new JSONObject(result.value)) : null;
        return new Answer(analysis, task.equals("translation") ? result.value : null, "llm", settings.config.model,
                result.cached, reason, fallback.expiresAt(task, settings.config, text), quota(settings));
    }

    /** Retain the original whitespace while adapting the existing, validated LLM offsets. */
    static JSONObject adaptAnalysis(String raw, JSONObject original) throws JSONException {
        String normalized = LlmRepository.sentence(raw);
        if (!normalized.equals(original.getString("sentence"))) throw new JSONException("analysis source changed");
        int[] ends = new int[normalized.length() + 1];
        int normal = 0;
        java.util.regex.Matcher whitespace = LlmRepository.WHITESPACE.matcher(raw);
        int cursor = 0;
        while (cursor < raw.length()) {
            whitespace.region(cursor, raw.length());
            if (whitespace.lookingAt()) {
                int end = whitespace.end();
                if (normal > 0 && end < raw.length()) ends[++normal] = end;
                cursor = end;
            } else { ends[++normal] = ++cursor; }
        }
        JSONArray source = original.getJSONArray("segments"), components = new JSONArray();
        int previous = 0;
        for (int i = 0; i < source.length(); i++) {
            JSONObject segment = source.getJSONObject(i);
            int end = i == source.length() - 1 ? raw.length()
                    : ends[Math.min(Math.max(segment.optInt("end", 0), 0), normalized.length())];
            if (end <= previous) continue;
            String type = segment.optString("type", "other");
            String label = segment.optString("label", "");
            components.put(new JSONObject().put("type", ShanbaySseClient.TYPES.contains(type) ? type : "other")
                    .put("text", raw.substring(previous, end))
                    .put("label", label.trim().isEmpty() ? SourceAlign.labelFor(type) : label));
            previous = end;
        }
        if (components.length() == 0) throw new JSONException("analysis segments");
        if (previous < raw.length()) {
            JSONObject last = components.getJSONObject(components.length() - 1);
            last.put("text", last.getString("text") + raw.substring(previous));
        }
        return new JSONObject().put("schemaVersion", 2).put("sentence", raw).put("segments", components);
    }

    private static final class PreparedAnalyses {
        int total, completed, cached, analyzed, shanbay, llm;
        long expiry = Long.MAX_VALUE;
        String error = "", errorCode = "";
        JSONObject json(boolean included) throws JSONException {
            return new JSONObject().put("included", included).put("total", total).put("completed", completed)
                    .put("cached", cached).put("analyzed", analyzed).put("shanbay", shanbay).put("llm", llm)
                    .put("stopped", completed < total).put("error", error).put("errorCode", errorCode);
        }
    }

    private void prepareAnalyses(Settings settings, List<String> texts, LlmRepository.Enabled enabled, PreparedAnalyses progress) {
        for (String text : texts) {
            if (!enabled.getAsBoolean()) break;
            try {
                Answer answer = request(settings, "analysis", text, null);
                progress.completed++;
                if (answer.cached) progress.cached++; else progress.analyzed++;
                if (answer.provider.equals("shanbay")) progress.shanbay++; else progress.llm++;
                progress.expiry = Math.min(progress.expiry, answer.expiresAt);
            } catch (Exception failure) {
                if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
                progress.error = failure instanceof ShanbaySseClient.Failure ? failure.getMessage() : "句式分析预加载失败，请重试";
                progress.errorCode = failure instanceof ShanbaySseClient.Failure ? ((ShanbaySseClient.Failure) failure).code : "ANALYSIS_PREPARATION_FAILED";
                break; // Preserve completed work and still prepare translations after an analysis failure.
            }
        }
    }

    JSONObject pretranslate(Settings settings, List<String> sources, LlmRepository.Enabled enabled) throws Exception {
        return pretranslate(settings, sources, enabled, true);
    }

    JSONObject pretranslate(Settings settings, List<String> sources, LlmRepository.Enabled enabled, boolean includeAnalysis) throws Exception {
        Map<String, String> unique = new LinkedHashMap<>();
        java.util.Set<String> eligible = new java.util.LinkedHashSet<>();
        for (String source : sources) {
            unique.put(LlmRepository.sentence(validate("translation", source)), source);
            String exact = source.trim();
            if (includeAnalysis && words(exact) >= 10 && words(exact) <= 120) eligible.add(exact);
        }
        List<String> analysisTexts = new ArrayList<>(eligible);
        PreparedAnalyses analyses = new PreparedAnalyses(); analyses.total = analysisTexts.size();
        List<String> texts = new ArrayList<>(unique.values());
        int completed = 0, cached = 0, translated = 0, bayCount = 0, llmCount = 0;
        long expiry = Long.MAX_VALUE;
        String fallbackReason = "";
        boolean failed = false;
        try {
        // A fallback analysis also supplies a translation, so prepare it first when the
        // primary is unavailable. Otherwise make today's cheaper translations ready first.
        boolean analysisFirst = settings.hasKey() && !unavailable(settings, "translation").isEmpty();
        if (analysisFirst) prepareAnalyses(settings, analysisTexts, enabled, analyses);
        for (int i = 0; i < texts.size() && enabled.getAsBoolean(); i++) {
            if (!unavailable(settings, "translation").isEmpty() && settings.hasKey()) {
                List<String> missing = new ArrayList<>();
                for (int j = i; j < texts.size(); j++) {
                    Answer answer = saved(settings, "translation", texts.get(j));
                    if (answer == null) missing.add(texts.get(j));
                    else { completed++; cached++; expiry = Math.min(expiry, answer.expiresAt); reuse(settings, "translation", answer, false);
                        if (answer.provider.equals("shanbay")) bayCount++; else llmCount++; }
                }
                fallbackReason = unavailable(settings, "translation");
                if (!missing.isEmpty()) {
                    JSONObject result = fallback.pretranslate(settings.key, settings.config, missing, enabled);
                    completed += result.getInt("completed"); cached += result.getInt("cached");
                    translated += result.getInt("translated"); llmCount += result.getInt("completed");
                    if (result.getLong("expiresAt") > 0) expiry = Math.min(expiry, result.getLong("expiresAt"));
                }
                break;
            }
            Answer answer = request(settings, "translation", texts.get(i), null);
            completed++; if (answer.cached) cached++; else translated++;
            if (answer.provider.equals("shanbay")) bayCount++; else { llmCount++; fallbackReason = answer.fallbackReason; }
            expiry = Math.min(expiry, answer.expiresAt);
        }
        if (!analysisFirst) prepareAnalyses(settings, analysisTexts, enabled, analyses);
        expiry = Math.min(expiry, analyses.expiry);
        JSONObject result = new JSONObject().put("total", texts.size()).put("completed", completed).put("cached", cached)
                .put("translated", translated).put("shanbay", bayCount).put("llm", llmCount).put("fallbackReason", fallbackReason)
                .put("analysis", analyses.json(includeAnalysis))
                .put("stopped", completed < texts.size() || analyses.completed < analyses.total)
                .put("expiresAt", expiry == Long.MAX_VALUE ? 0 : expiry);
        JSONObject state = quota(settings);
        if (state.has("remainingPercent")) result.put("remainingPercent", state.getInt("remainingPercent"));
        if (state.has("resetAt")) result.put("quotaResetAt", state.getString("resetAt"));
        return result;
        } catch (Exception error) { failed = true; throw error; }
        finally { usage.pretranslation(settings.scope, completed, cached, bayCount, llmCount,
                completed < texts.size() || analyses.completed < analyses.total, failed || !analyses.error.isEmpty(), analyses.completed, analyses.cached); }
    }

    synchronized JSONObject quota(Settings settings) {
        try { String raw = cache.get("shanbay-state:" + settings.scope, System.currentTimeMillis());
            return raw == null ? new JSONObject() : new JSONObject(raw); }
        catch (JSONException error) { return new JSONObject(); }
    }

    /** The account endpoint is independent of sentence quota, caches and cooldowns. */
    JSONObject refreshQuota(Settings settings, ShanbayClient client, boolean force) throws Exception {
        synchronized (quotaReadLock) {
            if (settings.cookie == null || settings.cookie.trim().isEmpty()) {
                return usage(settings, 30).getJSONObject("shanbay");
            }
            long started = System.currentTimeMillis();
            long checked = quota(settings).optLong("quotaCheckedAt", 0);
            if (!force && checked > 0 && started >= checked && started - checked < 60000) {
                return usage(settings, 30).getJSONObject("shanbay");
            }
            JSONObject response;
            int percent;
            String reset;
            try {
                response = new JSONObject(client.request("GET", "/bay-translate/quota", null, settings.cookie));
                Object raw = response.opt("remaining_percent"), rawReset = response.opt("reset_at");
                if (!(raw instanceof Number) || ((Number) raw).doubleValue() != ((Number) raw).intValue()
                        || ((Number) raw).intValue() < 0 || ((Number) raw).intValue() > 100
                        || (rawReset != null && rawReset != JSONObject.NULL && !(rawReset instanceof String))) {
                    throw new JSONException("Invalid quota");
                }
                percent = ((Number) raw).intValue();
                reset = rawReset instanceof String ? (String) rawReset : "";
                if (reset.length() > 100) throw new JSONException("Invalid reset");
            } catch (JSONException invalid) {
                throw new ShanbayClient.ShanbayException("INVALID_RESPONSE", "扇贝额度返回格式无效，请重试");
            }
            synchronized (this) {
                JSONObject state = quota(settings);
                // A sentence completed during the read may have consumed more quota.
                if (state.optLong("usageAt", 0) <= started) {
                    state.put("remainingPercent", percent).put("usageAt", started).put("quotaCheckedAt", started);
                    state.remove("resetAt");
                    if (!reset.isEmpty()) state.put("resetAt", reset);
                    if (percent > 0 && "QUOTA_EXCEEDED".equals(state.optString("code"))) {
                        state.remove("blockedUntil"); state.remove("reason"); state.remove("code");
                    } else if (percent == 0 && (state.optLong("blockedUntil", 0) <= started
                            || "QUOTA_EXCEEDED".equals(state.optString("code")))) {
                        state.put("blockedUntil", resetTime(reset, started))
                                .put("reason", "扇贝额度已用完").put("code", "QUOTA_EXCEEDED");
                    }
                    cache.put("shanbay-state:" + settings.scope, state.toString(), System.currentTimeMillis());
                }
            }
            return usage(settings, 30).getJSONObject("shanbay");
        }
    }

    JSONObject usage(Settings settings, int days) throws JSONException {
        JSONObject report = usage.snapshot(days, settings.scope);
        JSONObject state = quota(settings), account = report.getJSONObject("shanbay");
        boolean connected = settings.cookie != null && !settings.cookie.trim().isEmpty();
        account.put("connected", connected).put("quotaScope", "current_session_account_shared");
        account.put("remainingPercent", state.has("remainingPercent") ? state.getInt("remainingPercent") : JSONObject.NULL);
        account.put("accountUsedPercent", state.has("remainingPercent") ? 100 - state.getInt("remainingPercent") : JSONObject.NULL);
        account.put("usageAt", state.has("usageAt") ? state.getLong("usageAt") : JSONObject.NULL);
        account.put("resetAt", state.has("resetAt") ? state.getString("resetAt") : JSONObject.NULL);
        JSONObject availability = new JSONObject();
        for (String task : new String[]{"analysis", "translation"}) {
            JSONObject selected = state;
            if (state.optLong("blockedUntil", 0) <= System.currentTimeMillis()) {
                try {
                    String raw = cache.get("shanbay-task-state:" + settings.scope + ':' + task, System.currentTimeMillis());
                    selected = raw == null ? new JSONObject() : new JSONObject(raw);
                } catch (JSONException invalid) { selected = new JSONObject(); }
            }
            boolean blocked = selected.optLong("blockedUntil", 0) > System.currentTimeMillis();
            availability.put(task, new JSONObject().put("canRequest", connected && !blocked)
                    .put("code", !connected ? "NO_SESSION" : blocked ? selected.optString("code", "COOLDOWN") : "")
                    .put("reason", !connected ? "尚未连接扇贝" : blocked ? selected.optString("reason", "扇贝暂不可用") : "")
                    .put("blockedUntil", blocked ? selected.getLong("blockedUntil") : JSONObject.NULL));
        }
        account.put("availability", availability);
        report.getJSONObject("llm").put("configured", settings.hasKey());
        return report;
    }

    private synchronized String unavailable(Settings settings, String task) {
        if (settings.cookie == null || settings.cookie.trim().isEmpty()) return "尚未连接扇贝";
        JSONObject state = quota(settings);
        if (state.optLong("blockedUntil", 0) > System.currentTimeMillis()) return state.optString("reason", "扇贝暂不可用");
        try {
            String raw = cache.get("shanbay-task-state:" + settings.scope + ':' + task, System.currentTimeMillis());
            JSONObject specific = raw == null ? new JSONObject() : new JSONObject(raw);
            return specific.optLong("blockedUntil", 0) > System.currentTimeMillis() ? specific.optString("reason", "扇贝暂不可用") : "";
        } catch (JSONException invalid) { return ""; }
    }

    private synchronized void rememberUsage(Settings settings, Integer percent) throws JSONException {
        if (percent == null) return;
        JSONObject state = quota(settings);
        if (percent > 0 && state.optInt("remainingPercent", -1) == 0 && state.optLong("blockedUntil", 0) > System.currentTimeMillis()) return;
        if (percent > 0) { state.remove("blockedUntil"); state.remove("reason"); state.remove("resetAt"); state.remove("code"); }
        state.put("remainingPercent", percent).put("usageAt", System.currentTimeMillis());
        if (percent == 0) state.put("blockedUntil", System.currentTimeMillis() + 15 * 60000)
                .put("reason", "扇贝额度已用完").put("code", "QUOTA_EXCEEDED");
        cache.put("shanbay-state:" + settings.scope, state.toString(), System.currentTimeMillis());
    }

    private synchronized void rememberFailure(Settings settings, String task, ShanbaySseClient.Failure failure) throws JSONException {
        if (failure.code.equals("INCOMPLETE_ANALYSIS")) return; // A partial sentence is not an account outage.
        long now = System.currentTimeMillis();
        long until = now + 30000;
        if (failure.code.equals("QUOTA_EXCEEDED")) until = resetTime(failure.resetAt, now);
        else if (failure.code.equals("UNAUTHORIZED") || failure.code.equals("FORBIDDEN")) until = now + 10 * 60000;
        else if (failure.code.equals("RATE_LIMITED")) until = now + 60000;
        boolean taskOnly = failure.code.equals("FORBIDDEN") || failure.code.equals("INVALID_RESPONSE")
                || failure.code.equals("INCOMPLETE_RESPONSE") || failure.code.equals("SERVICE_ERROR");
        JSONObject state = (taskOnly ? new JSONObject() : quota(settings)).put("blockedUntil", until).put("reason", failure.getMessage()).put("code", failure.code);
        if (!failure.resetAt.isEmpty()) state.put("resetAt", failure.resetAt);
        if (failure.code.equals("QUOTA_EXCEEDED")) state.put("remainingPercent", 0).put("usageAt", now);
        cache.put(taskOnly ? "shanbay-task-state:" + settings.scope + ':' + task : "shanbay-state:" + settings.scope, state.toString(), now);
    }

    static long resetTime(String raw, long now) {
        long fallback = now + 15 * 60000;
        try {
            long parsed;
            if (raw.matches("\\d{10,13}")) { parsed = Long.parseLong(raw); if (raw.length() <= 10) parsed *= 1000; }
            else {
                String value = raw;
                java.util.TimeZone zone = java.util.TimeZone.getTimeZone("Asia/Shanghai");
                if (value.endsWith("Z")) { zone = java.util.TimeZone.getTimeZone("UTC"); value = value.substring(0, value.length() - 1); }
                else if (value.matches(".*[+-]\\d{2}:\\d{2}$")) {
                    zone = java.util.TimeZone.getTimeZone("GMT" + value.substring(value.length() - 6)); value = value.substring(0, value.length() - 6);
                }
                value = value.replace('T', ' ').replaceFirst("\\.\\d+$", "");
                java.text.SimpleDateFormat format = new java.text.SimpleDateFormat(value.length() == 10 ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss", java.util.Locale.ROOT);
                format.setTimeZone(zone); format.setLenient(false);
                java.text.ParsePosition position = new java.text.ParsePosition(0);
                java.util.Date date = format.parse(value, position);
                if (date == null || position.getIndex() != value.length()) return fallback;
                parsed = date.getTime();
            }
            return parsed > now && parsed <= now + 7L * 86400000 ? parsed : fallback;
        } catch (RuntimeException invalid) { return fallback; }
    }
}

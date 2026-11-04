package com.hwfee.english;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;

/** Shared cache and in-flight requests for interactive and article-wide work. */
final class LlmRepository {
    static final int MAX_SENTENCE_LENGTH = 8000;
    static final int BATCH_SIZE = 8;
    static final java.util.regex.Pattern WHITESPACE = java.util.regex.Pattern.compile(
            "[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+");
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private final LlmCache cache;
    private final LlmClient client;
    private final ConcurrentHashMap<String, Work> pending = new ConcurrentHashMap<>();
    interface Enabled { boolean getAsBoolean(); }

    LlmRepository(LlmCache cache, LlmClient client) {
        this.cache = cache;
        this.client = client;
        cache.prune(System.currentTimeMillis());
    }

    static String sentence(String text) {
        String normalized = text == null ? "" : WHITESPACE.matcher(text).replaceAll(" ").trim();
        if (normalized.isEmpty()) throw new IllegalArgumentException("没有要处理的句子");
        if (normalized.length() > MAX_SENTENCE_LENGTH) throw new IllegalArgumentException("句子过长，请缩小选择范围");
        return normalized;
    }

    static String cacheId(String task, LlmClient.Config config, String text) {
        String identity = new org.json.JSONArray().put(task.equals("analysis") ? "v3" : "v1").put(task).put(config.baseUrl)
                .put(config.model).put(sentence(text)).toString();
        return hash(identity);
    }

    static String hash(String identity) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(identity.getBytes(StandardCharsets.UTF_8));
            char[] hex = new char[digest.length * 2];
            for (int i = 0; i < digest.length; i++) {
                int value = digest[i] & 255;
                hex[i * 2] = HEX[value >>> 4];
                hex[i * 2 + 1] = HEX[value & 15];
            }
            return new String(hex);
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    Result cached(String task, LlmClient.Config config, String text) {
        String saved = cache.get(cacheId(task, config, text), System.currentTimeMillis());
        return saved == null ? null : new Result(saved, true);
    }

    long expiresAt(String task, LlmClient.Config config, String text) { return cache.expiresAt(cacheId(task, config, text)); }

    static final class Result {
        final String value;
        final boolean cached;
        Result(String value, boolean cached) { this.value = value; this.cached = cached; }
    }

    private static final class Work extends FutureTask<Result> {
        Work(Callable<Result> callable) { super(callable); }
        void finish(Result result) { set(result); }
        void fail(Throwable error) { setException(error); }
    }

    Result request(String task, String key, LlmClient.Config config, String source) throws LlmClient.TranslationException {
        String text = sentence(source);
        String id = cacheId(task, config, text);
        String saved = cache.get(id, System.currentTimeMillis());
        if (saved != null) return new Result(saved, true);
        Work own = new Work(() -> {
            // Another request may have committed between the first lookup and reservation.
            String raced = cache.get(id, System.currentTimeMillis());
            if (raced != null) return new Result(raced, true);
            String value;
            if ("analysis".equals(task)) {
                JSONObject analysis = client.analyze(key, config, text);
                value = analysis.toString();
                // An analysis usually carries its own translation; seed it when the model omitted it.
                String translated = analysis.optString("translation", "");
                if (!translated.trim().isEmpty()) {
                    String translationId = cacheId("translation", config, text);
                    if (cache.get(translationId, System.currentTimeMillis()) == null) {
                        cache.put(translationId, translated, System.currentTimeMillis());
                    }
                }
            } else value = client.translate(key, config, text);
            cache.put(id, value, System.currentTimeMillis());
            return new Result(value, false);
        });
        Work existing = pending.putIfAbsent(id, own);
        if (existing != null) return await(existing);
        try { own.run(); return await(own); }
        finally { pending.remove(id, own); }
    }

    /** Missing sentences use one request per eight; manual taps join these same reservations. */
    JSONObject pretranslate(String key, LlmClient.Config config, List<String> sources, Enabled enabled)
            throws LlmClient.TranslationException, JSONException {
        Map<String, String> unique = new LinkedHashMap<>();
        for (String source : sources) {
            String text = sentence(source);
            unique.put(cacheId("translation", config, text), text);
        }
        int completed = 0, cached = 0, translated = 0;
        List<Map.Entry<String, String>> entries = new ArrayList<>();
        for (Map.Entry<String, String> entry : unique.entrySet()) {
            if (cache.get(entry.getKey(), System.currentTimeMillis()) != null) { cached++; completed++; }
            else entries.add(entry);
        }
        for (int offset = 0; offset < entries.size() && enabled.getAsBoolean(); offset += BATCH_SIZE) {
            Map<String, Work> owned = new LinkedHashMap<>();
            List<String> texts = new ArrayList<>();
            List<Work> joined = new ArrayList<>();
            try {
                for (int i = offset; i < Math.min(offset + BATCH_SIZE, entries.size()); i++) {
                    Map.Entry<String, String> entry = entries.get(i);
                    if (cache.get(entry.getKey(), System.currentTimeMillis()) != null) { cached++; completed++; continue; }
                    Work own = new Work(() -> null);
                    Work existing = pending.putIfAbsent(entry.getKey(), own);
                    if (existing != null) joined.add(existing);
                    else {
                        // Recheck after claiming the slot, as in the interactive path.
                        String raced = cache.get(entry.getKey(), System.currentTimeMillis());
                        if (raced != null) {
                            own.finish(new Result(raced, true));
                            pending.remove(entry.getKey(), own);
                            cached++; completed++;
                        } else { owned.put(entry.getKey(), own); texts.add(entry.getValue()); }
                    }
                }
                if (!texts.isEmpty()) {
                    List<String> values = client.translateBatch(key, config, texts);
                    int index = 0;
                    for (Map.Entry<String, Work> entry : owned.entrySet()) {
                        String value = values.get(index++);
                        cache.put(entry.getKey(), value, System.currentTimeMillis());
                        entry.getValue().finish(new Result(value, false));
                        completed++; translated++;
                    }
                }
                for (Work other : joined) { await(other); cached++; completed++; }
            } catch (Exception error) {
                for (Work work : owned.values()) work.fail(error);
                if (error instanceof LlmClient.TranslationException) throw (LlmClient.TranslationException) error;
                if (error instanceof IllegalArgumentException) throw (IllegalArgumentException) error;
                throw new LlmClient.TranslationException("文章预译失败，请稍后重试");
            } finally {
                for (Map.Entry<String, Work> entry : owned.entrySet()) pending.remove(entry.getKey(), entry.getValue());
            }
        }
        long expiresAt = Long.MAX_VALUE;
        for (String id : unique.keySet()) expiresAt = Math.min(expiresAt, cache.expiresAt(id));
        return new JSONObject().put("total", unique.size()).put("completed", completed)
                .put("cached", cached).put("translated", translated).put("stopped", completed < unique.size())
                .put("expiresAt", unique.isEmpty() ? 0 : expiresAt);
    }

    private static Result await(Work work) throws LlmClient.TranslationException {
        try { return work.get(); }
        catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new LlmClient.TranslationException("请求已取消，请重试");
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof LlmClient.TranslationException) throw (LlmClient.TranslationException) cause;
            if (cause instanceof IllegalArgumentException) throw (IllegalArgumentException) cause;
            throw new LlmClient.TranslationException("处理请求失败，请稍后重试");
        }
    }
}

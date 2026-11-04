package com.hwfee.english;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/** Daily numeric counters only. No sentence, translation, cookie or key is stored in this ledger. */
final class UsageStore {
    private final LlmCache cache;
    private int droppedRecords;
    private final java.util.concurrent.atomic.AtomicInteger activeShanbay = new java.util.concurrent.atomic.AtomicInteger();
    private final java.util.concurrent.atomic.AtomicInteger activeLlm = new java.util.concurrent.atomic.AtomicInteger();
    UsageStore(LlmCache cache) { this.cache = cache; }
    private static final String[] COUNTERS = {"requests", "successes", "failures", "cancelled", "cacheHits", "joinedRequests", "totalLatencyMs"};
    private static final String[] TOKENS = {"inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens"};
    private static final String[] JOBS = {"runs", "completedSentences", "cachedSentences", "shanbaySentences", "llmSentences", "stoppedRuns", "failedRuns", "analyzedSentences", "cachedAnalyses"};

    static String day(long timestamp) {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        return format.format(new java.util.Date(timestamp));
    }

    private synchronized void record(String provider, String scope, String model, String task, JSONObject delta) {
        SQLiteDatabase database = null;
        boolean transaction = false;
        try {
            database = cache.getWritableDatabase();
            database.beginTransaction(); transaction = true;
            String today = day(System.currentTimeMillis());
            String[] args = {today, provider, scope, model, task};
            JSONObject current = new JSONObject();
            try (Cursor cursor = database.query("usage_daily", new String[]{"metrics"},
                    "day=? AND provider=? AND scope=? AND model=? AND task=?", args, null, null, null)) {
                if (cursor.moveToFirst()) current = new JSONObject(cursor.getString(0));
            }
            for (java.util.Iterator<String> keys = delta.keys(); keys.hasNext();) {
                String key = keys.next(); current.put(key, current.optLong(key, 0) + delta.getLong(key));
            }
            ContentValues row = new ContentValues();
            row.put("day", today); row.put("provider", provider); row.put("scope", scope); row.put("model", model); row.put("task", task);
            row.put("metrics", current.toString());
            if (database.insertWithOnConflict("usage_daily", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0) {
                throw new android.database.sqlite.SQLiteException("usage write failed");
            }
            database.setTransactionSuccessful();
        } catch (Exception unavailable) { droppedRecords++; }
        finally {
            if (database != null && transaction) try { database.endTransaction(); }
            catch (RuntimeException unavailable) { droppedRecords++; }
        }
    }

    void request(String provider, String scope, String model, String task, boolean success, boolean cancelled, long elapsedMs, JSONObject usage) {
        try {
            JSONObject delta = new JSONObject().put("requests", 1).put(success ? "successes" : cancelled ? "cancelled" : "failures", 1)
                    .put("totalLatencyMs", Math.max(0, elapsedMs));
            if (provider.equals("llm")) {
                Long input = count(usage, "prompt_tokens", "input_tokens");
                Long output = count(usage, "completion_tokens", "output_tokens");
                Long total = count(usage, "total_tokens");
                if (total == null && input != null && output != null) total = input + output;
                Long cached = count(usage, "prompt_cache_hit_tokens");
                if (cached == null) cached = count(usage == null ? null : usage.optJSONObject("prompt_tokens_details"), "cached_tokens");
                Long reasoning = count(usage == null ? null : usage.optJSONObject("completion_tokens_details"), "reasoning_tokens");
                Long[] values = {input, output, total, cached, reasoning};
                for (int i = 0; i < TOKENS.length; i++) if (values[i] != null) {
                    delta.put(TOKENS[i], values[i]).put("_" + TOKENS[i] + "Reports", 1);
                }
                if (input != null || output != null || total != null) delta.put("usageReports", 1);
                if (input != null && output != null && total != null) delta.put("completeUsageReports", 1);
            }
            record(provider, scope, model, task, delta);
        } catch (JSONException invalid) { synchronized (this) { droppedRecords++; } }
    }

    void llm(LlmClient.Config config, String task, boolean success, JSONObject usage, long elapsedMs) {
        request("llm", config.baseUrl, config.model, task, success, false, elapsedMs, usage);
    }

    void started(String provider) { (provider.equals("shanbay") ? activeShanbay : activeLlm).incrementAndGet(); }
    void finished(String provider) { (provider.equals("shanbay") ? activeShanbay : activeLlm).decrementAndGet(); }

    LlmClient.UsageObserver observer() {
        return new LlmClient.UsageObserver() {
            @Override public void started() { UsageStore.this.started("llm"); }
            @Override public void record(LlmClient.Config config, String task, boolean success, JSONObject usage, long elapsedMs) {
                try { llm(config, task, success, usage, elapsedMs); }
                finally { UsageStore.this.finished("llm"); }
            }
        };
    }

    void reuse(String provider, String scope, String model, String task, boolean joined) {
        try { record(provider, scope, model, task, new JSONObject().put(joined ? "joinedRequests" : "cacheHits", 1)); }
        catch (JSONException invalid) { synchronized (this) { droppedRecords++; } }
    }

    void pretranslation(String scope, int completed, int cached, int shanbay, int llm, boolean stopped, boolean failed, int analyzed, int cachedAnalyses) {
        try { record("pretranslation", scope, "", "pretranslation", new JSONObject().put("runs", 1)
                .put("completedSentences", completed).put("cachedSentences", cached).put("shanbaySentences", shanbay)
                .put("llmSentences", llm).put("stoppedRuns", stopped ? 1 : 0).put("failedRuns", failed ? 1 : 0)
                .put("analyzedSentences", analyzed).put("cachedAnalyses", cachedAnalyses)); }
        catch (JSONException invalid) { synchronized (this) { droppedRecords++; } }
    }

    private static Long count(JSONObject object, String... keys) {
        if (object == null) return null;
        for (String key : keys) {
            Object value = object.opt(key);
            if (value instanceof Number) {
                double number = ((Number) value).doubleValue();
                if (number >= 0 && number <= 100000000 && number == Math.rint(number)) return ((Number) value).longValue();
            }
        }
        return null;
    }

    private static void add(JSONObject target, JSONObject values) throws JSONException {
        for (java.util.Iterator<String> keys = values.keys(); keys.hasNext();) {
            String key = keys.next(); target.put(key, target.optLong(key, 0) + values.getLong(key));
        }
    }

    private static JSONObject stats(JSONObject raw, boolean llm) throws JSONException {
        JSONObject result = new JSONObject();
        for (String counter : COUNTERS) result.put(counter, raw.optLong(counter, 0));
        long requests = raw.optLong("requests", 0);
        result.put("averageLatencyMs", requests == 0 ? JSONObject.NULL : raw.optLong("totalLatencyMs", 0) / requests);
        if (llm) {
            for (String token : TOKENS) result.put(token, raw.optLong("_" + token + "Reports", 0) == 0 ? JSONObject.NULL : raw.optLong(token, 0));
            result.put("usageReports", raw.optLong("usageReports", 0));
            result.put("missingUsageRequests", requests - raw.optLong("completeUsageReports", 0));
            result.put("tokenStatsComplete", requests > 0 && requests == raw.optLong("completeUsageReports", 0));
        }
        return result;
    }

    private static JSONObject jobs(JSONObject raw) throws JSONException {
        JSONObject value = new JSONObject();
        for (String name : JOBS) value.put(name, raw.optLong(name, 0));
        return value;
    }

    synchronized JSONObject snapshot(int days, String shanbayScope) throws JSONException {
        if (days < 1 || days > 3650) throw new IllegalArgumentException("统计天数应为 1–3650");
        long now = System.currentTimeMillis();
        Calendar start = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai")); start.setTimeInMillis(now); start.add(Calendar.DATE, 1 - days);
        String from = day(start.getTimeInMillis()), to = day(now);
        JSONObject shanbay = new JSONObject(), shanbayCurrent = new JSONObject(), llm = new JSONObject(), job = new JSONObject();
        Map<String, JSONObject> models = new LinkedHashMap<>(), modelMeta = new LinkedHashMap<>(), daily = new LinkedHashMap<>();
        int corruptRows = 0;
        try (Cursor cursor = cache.getReadableDatabase().query("usage_daily", new String[]{"day", "provider", "scope", "model", "metrics"},
                "day>=? AND day<=?", new String[]{from, to}, null, null, "day ASC")) {
            while (cursor.moveToNext()) {
                JSONObject metrics;
                try { metrics = new JSONObject(cursor.getString(4)); }
                catch (JSONException invalid) { corruptRows++; continue; }
                String date = cursor.getString(0), provider = cursor.getString(1);
                JSONObject each = daily.get(date);
                if (each == null) { each = new JSONObject().put("date", date).put("shanbay", new JSONObject()).put("llm", new JSONObject()).put("pretranslation", new JSONObject()); daily.put(date, each); }
                if (provider.equals("shanbay")) {
                    add(shanbay, metrics); add(each.getJSONObject("shanbay"), metrics);
                    if (cursor.getString(2).equals(shanbayScope)) add(shanbayCurrent, metrics);
                }
                else if (provider.equals("llm")) {
                    add(llm, metrics); add(each.getJSONObject("llm"), metrics);
                    String id = new JSONArray().put(cursor.getString(2)).put(cursor.getString(3)).toString();
                    if (!models.containsKey(id)) { models.put(id, new JSONObject()); modelMeta.put(id, new JSONObject().put("baseUrl", cursor.getString(2)).put("model", cursor.getString(3))); }
                    add(models.get(id), metrics);
                } else if (provider.equals("pretranslation")) { add(job, metrics); add(each.getJSONObject("pretranslation"), metrics); }
            }
        }
        JSONArray byModel = new JSONArray(), daysOut = new JSONArray();
        for (String id : models.keySet()) byModel.put(modelMeta.get(id).put("stats", stats(models.get(id), true)));
        for (JSONObject value : daily.values()) daysOut.put(new JSONObject().put("date", value.getString("date"))
                .put("shanbay", stats(value.getJSONObject("shanbay"), false)).put("llm", stats(value.getJSONObject("llm"), true))
                .put("pretranslation", jobs(value.getJSONObject("pretranslation"))));
        long trackingSince = now;
        try (Cursor cursor = cache.getReadableDatabase().rawQuery("SELECT value FROM usage_meta WHERE id='trackingSince'", null)) {
            if (cursor.moveToFirst()) trackingSince = cursor.getLong(0);
        }
        return new JSONObject().put("schemaVersion", 1).put("observedAt", now).put("trackingSince", trackingSince)
                .put("period", new JSONObject().put("days", days).put("from", from).put("to", to).put("timeZone", "Asia/Shanghai"))
                .put("statsScope", "this_install_all_sessions")
                .put("shanbay", new JSONObject().put("stats", stats(shanbay, false)).put("currentSessionStats", stats(shanbayCurrent, false))
                        .put("inFlight", activeShanbay.get()))
                .put("llm", new JSONObject().put("stats", stats(llm, true)).put("byModel", byModel).put("inFlight", activeLlm.get()))
                .put("pretranslation", jobs(job)).put("daily", daysOut)
                .put("recording", new JSONObject().put("available", droppedRecords == 0 && corruptRows == 0)
                        .put("droppedRecordsSinceStart", droppedRecords).put("corruptRows", corruptRows));
    }
}

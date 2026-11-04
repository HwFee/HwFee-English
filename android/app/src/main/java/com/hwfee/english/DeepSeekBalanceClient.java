package com.hwfee.english;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Fixed-origin account read, independent of the sentence cache and token-usage ledger. */
final class DeepSeekBalanceClient {
    static final int MAX_BYTES = 64 * 1024;
    static final long CACHE_MS = 60000;
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "deepseek-balance-deadline"); thread.setDaemon(true); return thread;
    });
    private final String origin;
    private final int connectTimeout, readTimeout, totalTimeout;
    interface Clock { long now(); }
    private final Clock clock;
    private final Map<String, FutureTask<Snapshot>> inFlight = new HashMap<>();
    private String cachedScope;
    private Snapshot cached;
    private int revision;

    DeepSeekBalanceClient() { this(LlmClient.DEFAULT_BASE, 8000, 8000, 12000); }

    /** The native plugin never accepts an origin. This constructor supports loopback fixtures. */
    DeepSeekBalanceClient(String origin, int connectTimeout, int readTimeout, int totalTimeout) {
        this(origin, connectTimeout, readTimeout, totalTimeout, System::currentTimeMillis);
    }

    DeepSeekBalanceClient(String origin, int connectTimeout, int readTimeout, int totalTimeout, Clock clock) {
        this.origin = origin.endsWith("/") ? origin.substring(0, origin.length() - 1) : origin;
        this.connectTimeout = connectTimeout; this.readTimeout = readTimeout; this.totalTimeout = totalTimeout;
        this.clock = clock;
    }

    static final class Failure extends IOException {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }

    private static final class Snapshot {
        final String json;
        final long observedAt;
        Snapshot(JSONObject balance, long observedAt) { json = balance.toString(); this.observedAt = observedAt; }
        JSONObject reply(boolean fromCache) throws JSONException {
            return new JSONObject(json).put("schemaVersion", 1).put("provider", "deepseek")
                    .put("observedAt", observedAt).put("expiresAt", observedAt + CACHE_MS).put("cached", fromCache);
        }
    }

    synchronized void invalidate() { cached = null; cachedScope = null; revision++; }

    JSONObject get(String key, LlmClient.Config config, boolean forceRefresh) throws Failure {
        if (!LlmClient.isOfficialDeepSeek(config.baseUrl)) {
            throw new Failure("UNSUPPORTED_PROVIDER", "余额查询仅支持 DeepSeek 官方接口，请先在设置中选择 DeepSeek");
        }
        if (key == null || key.trim().isEmpty()) throw new Failure("NO_API_KEY", "请先在设置中保存 DeepSeek API Key");
        try { LlmClient.validateKey(key); }
        catch (IllegalArgumentException error) { throw new Failure("INVALID_API_KEY", "DeepSeek 密钥格式无效，请重新粘贴"); }
        String scope = fingerprint(key.trim());
        FutureTask<Snapshot> work;
        boolean owner = false;
        synchronized (this) {
            long age = cached == null ? -1 : clock.now() - cached.observedAt;
            if (!forceRefresh && cached != null && scope.equals(cachedScope) && age >= 0 && age < CACHE_MS) {
                try { return cached.reply(true); }
                catch (JSONException invalid) { throw new Failure("INVALID_RESPONSE", "DeepSeek 余额数据格式无效，请重试"); }
            }
            work = inFlight.get(scope);
            if (work == null) {
                int requestedRevision = revision;
                work = new FutureTask<>(() -> {
                    Snapshot result = fetch(key.trim());
                    synchronized (DeepSeekBalanceClient.this) {
                        if (requestedRevision == revision) { cached = result; cachedScope = scope; }
                    }
                    return result;
                });
                inFlight.put(scope, work); owner = true;
            }
        }
        if (owner) work.run();
        try { return work.get().reply(false); }
        catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); throw new Failure("CANCELLED", "余额查询已取消");
        } catch (ExecutionException error) {
            if (error.getCause() instanceof Failure) throw (Failure) error.getCause();
            throw new Failure("NETWORK_ERROR", "无法查询 DeepSeek 余额，请稍后重试");
        } catch (JSONException invalid) { throw new Failure("INVALID_RESPONSE", "DeepSeek 余额数据格式无效，请重试"); }
        finally {
            if (owner) synchronized (this) { if (inFlight.get(scope) == work) inFlight.remove(scope); }
        }
    }

    private Snapshot fetch(String key) throws Failure {
        HttpURLConnection connection = null;
        ScheduledFuture<?> deadline = null;
        AtomicBoolean expired = new AtomicBoolean();
        try {
            connection = (HttpURLConnection) new URL(origin + "/user/balance").openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(connectTimeout); connection.setReadTimeout(readTimeout);
            connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setRequestProperty("Authorization", "Bearer " + key);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "identity");
            final HttpURLConnection running = connection;
            deadline = DEADLINES.schedule(() -> { expired.set(true); running.disconnect(); }, totalTimeout, TimeUnit.MILLISECONDS);
            int status = connection.getResponseCode();
            if (status == 401) throw new Failure("UNAUTHORIZED", "DeepSeek 密钥无效或已失效，请在设置中更新");
            if (status == 403) throw new Failure("FORBIDDEN", "DeepSeek 当前密钥无权查询余额");
            if (status == 429) throw new Failure("RATE_LIMITED", "余额查询过于频繁，请稍后重试");
            if (status >= 300 && status < 400) throw new Failure("REDIRECT_REFUSED", "DeepSeek 余额接口发生重定向，请稍后重试");
            if (status < 200 || status >= 300) throw new Failure("HTTP_ERROR", "DeepSeek 余额接口暂不可用（HTTP " + status + "）");
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] chunk = new byte[4096];
                int count;
                while ((count = input.read(chunk)) != -1) {
                    if (expired.get()) throw new Failure("TIMEOUT", "DeepSeek 余额查询超时，请重试");
                    if (count > MAX_BYTES - body.size()) throw new Failure("INVALID_RESPONSE", "DeepSeek 余额数据过大，请稍后重试");
                    body.write(chunk, 0, count);
                }
            }
            if (expired.get()) throw new Failure("TIMEOUT", "DeepSeek 余额查询超时，请重试");
            return new Snapshot(parse(new String(body.toByteArray(), StandardCharsets.UTF_8)), clock.now());
        } catch (Failure error) {
            if (expired.get()) throw new Failure("TIMEOUT", "DeepSeek 余额查询超时，请重试");
            throw error;
        } catch (SocketTimeoutException timeout) { throw new Failure("TIMEOUT", "DeepSeek 余额查询超时，请重试"); }
        catch (IOException | RuntimeException error) {
            if (expired.get()) throw new Failure("TIMEOUT", "DeepSeek 余额查询超时，请重试");
            throw new Failure("NETWORK_ERROR", "无法连接 DeepSeek 余额接口，请检查网络");
        } finally {
            if (deadline != null) deadline.cancel(false);
            if (connection != null) try { connection.disconnect(); } catch (RuntimeException ignored) { /* Already disconnected. */ }
        }
    }

    static JSONObject parse(String body) throws Failure {
        try {
            JSONObject raw = new JSONObject(body);
            Object available = raw.get("is_available");
            if (!(available instanceof Boolean)) throw new JSONException("availability");
            JSONArray rows = raw.getJSONArray("balance_infos"), balances = new JSONArray();
            if (rows.length() > 16) throw new JSONException("balances");
            java.util.Set<String> currencies = new java.util.HashSet<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                Object currency = row.get("currency");
                if (!("CNY".equals(currency) || "USD".equals(currency)) || !currencies.add((String) currency)) {
                    throw new JSONException("currency");
                }
                balances.put(new JSONObject().put("currency", currency)
                        .put("totalBalance", amount(row, "total_balance"))
                        .put("grantedBalance", amount(row, "granted_balance"))
                        .put("toppedUpBalance", amount(row, "topped_up_balance")));
            }
            return new JSONObject().put("isAvailable", available).put("balanceInfos", balances);
        } catch (JSONException invalid) { throw new Failure("INVALID_RESPONSE", "DeepSeek 余额数据格式无效，请重试"); }
    }

    private static String amount(JSONObject row, String name) throws JSONException {
        Object value = row.get(name);
        if (!(value instanceof String) || ((String) value).length() > 64
                || !((String) value).matches("-?[0-9]+(?:\\.[0-9]+)?")) throw new JSONException("amount");
        return (String) value;
    }

    private static String fingerprint(String key) throws Failure {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            char[] chars = new char[bytes.length * 2], hex = "0123456789abcdef".toCharArray();
            for (int i = 0; i < bytes.length; i++) { chars[i * 2] = hex[(bytes[i] & 255) >>> 4]; chars[i * 2 + 1] = hex[bytes[i] & 15]; }
            return new String(chars);
        } catch (java.security.NoSuchAlgorithmException unavailable) { throw new Failure("INTERNAL_ERROR", "无法读取 DeepSeek 余额，请重试"); }
    }
}

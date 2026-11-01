package com.hwfee.english;

import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Shanbay transport.
 *
 * The cookie lives in the Keystore and is attached here, so it never reaches the WebView. A browser
 * cannot make these calls at all: `Cookie` is a forbidden header for fetch, and the requests are
 * cross-origin.
 *
 * Parsing stays in JavaScript (web/read/lib.mjs + daily.mjs) because the API's word payload is
 * defensively encoded and the decoder is already written there.
 */
@CapacitorPlugin(name = "Shanbay")
public class ShanbayPlugin extends Plugin {

    private static final String COOKIE = "shanbay.cookie";
    private static final String BASE = "https://apiv3.shanbay.com";

    @PluginMethod
    public void setCookie(PluginCall call) {
        String cookie = call.getString("cookie");
        if (cookie == null || !cookie.contains("auth_token=")) {
            call.reject("未找到 auth_token，请粘贴扇贝请求的 Cookie");
            return;
        }
        try {
            Vault.put(getContext(), COOKIE, cookie);
            JSObject out = new JSObject();
            out.put("saved", true);
            call.resolve(out);
        } catch (Exception error) {
            call.reject("保存登录态失败：" + error.getMessage());
        }
    }

    @PluginMethod
    public void hasCookie(PluginCall call) {
        JSObject out = new JSObject();
        out.put("has", Vault.has(getContext(), COOKIE));
        call.resolve(out);
    }

    @PluginMethod
    public void clearCookie(PluginCall call) {
        Vault.remove(getContext(), COOKIE);
        JSObject out = new JSObject();
        out.put("cleared", true);
        call.resolve(out);
    }

    /** Opens the Shanbay login page in-app; the activity stores the captured cookie itself. */
    @PluginMethod
    public void login(PluginCall call) {
        Intent intent = new Intent(getActivity(), LoginActivity.class);
        startActivityForResult(call, intent, "loginFinished");
    }

    @ActivityCallback
    private void loginFinished(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        out.put("connected", Vault.has(getContext(), COOKIE));
        call.resolve(out);
    }

    /** Any authenticated GET/POST against apiv3; returns the response body verbatim. */
    @PluginMethod
    public void request(PluginCall call) {
        String path = call.getString("path");
        if (path == null || !path.startsWith("/")) {
            call.reject("path 必须以 / 开头");
            return;
        }
        String cookie = Vault.get(getContext(), COOKIE);
        if (cookie == null) {
            call.reject("尚未连接扇贝");
            return;
        }
        String method = call.getString("method", "GET");
        JSObject body = call.getObject("body");
        getBridge().execute(() -> {
            try {
                String text = http(method, path, body == null ? null : body.toString(), cookie);
                JSObject out = new JSObject();
                out.put("body", text);
                call.resolve(out);
            } catch (Exception error) {
                call.reject(error.getMessage());
            }
        });
    }

    // ------------------------------------------------------------------ http

    private String http(String method, String path, String body, String cookie) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(BASE + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cookie", cookie);
        connection.setRequestProperty("Origin", "https://web.shanbay.com");
        connection.setRequestProperty("Referer", "https://web.shanbay.com/");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0");
        connection.setRequestProperty("Accept-Encoding", "identity");
        String csrf = csrfOf(cookie);
        if (csrf != null) connection.setRequestProperty("X-CSRFToken", csrf);

        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }

        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String text = stream == null ? "" : readAll(stream);
        connection.disconnect();

        if (status == 204) return "{}";
        if (status == 401) throw new Exception("登录已过期，请重新连接扇贝");
        if (status == 403) throw new Exception("请求被拒绝，请在扇贝网页确认登录状态");
        if (status == 412) throw new Exception("今日学习数据尚未就绪，请先打开官方学习页");
        if (status == 429) throw new Exception("请求太频繁，请稍后再试");
        if (status >= 400) throw new Exception("扇贝接口返回 HTTP " + status + "：" + path);
        return text;
    }

    private static String csrfOf(String cookie) {
        for (String part : cookie.split(";")) {
            String[] pair = part.trim().split("=", 2);
            if (pair.length == 2 && pair[0].equals("csrftoken")) return pair[1];
        }
        return null;
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

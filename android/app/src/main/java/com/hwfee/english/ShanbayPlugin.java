package com.hwfee.english;

import android.content.Intent;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    private final ShanbayClient client = new ShanbayClient();
    // Capacitor has one plugin thread: network waits here must not delay audio controls or chrome.
    private static final ExecutorService REQUESTS = Executors.newFixedThreadPool(4);

    @PluginMethod
    public void setCookie(PluginCall call) {
        String cookie = call.getString("cookie");
        try {
            ShanbayClient.validateCookie(cookie);
        } catch (ShanbayClient.ShanbayException error) {
            call.reject(error.getMessage(), error.code);
            return;
        }
        try {
            Vault.put(getContext(), COOKIE, cookie);
            JSObject out = new JSObject();
            out.put("saved", true);
            call.resolve(out);
        } catch (Exception error) {
            call.reject("保存登录态失败，请稍后重试", "STORAGE_ERROR");
        }
    }

    @PluginMethod
    public void hasCookie(PluginCall call) {
        try {
            JSObject out = new JSObject();
            out.put("has", Vault.has(getContext(), COOKIE));
            out.put("sessionScope", new SentenceService.Settings(Vault.get(getContext(), COOKIE), null,
                    new LlmClient.Config(null, null)).scope);
            call.resolve(out);
        } catch (Exception error) { call.reject("读取登录态失败，请重试", "STORAGE_ERROR"); }
    }

    @PluginMethod
    public void clearCookie(PluginCall call) {
        Vault.remove(getContext(), COOKIE);
        getActivity().runOnUiThread(() -> CookieManager.getInstance().removeAllCookies(removed -> {
            CookieManager.getInstance().flush();
            JSObject out = new JSObject();
            out.put("cleared", true);
            call.resolve(out);
        }));
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

    /** Authenticated Shanbay request; successful response text is returned verbatim. */
    @PluginMethod
    public void request(PluginCall call) {
        String path = call.getString("path");
        String cookie;
        try {
            cookie = Vault.get(getContext(), COOKIE);
        } catch (Exception error) {
            call.reject("无法读取扇贝登录态，请重新连接", "STORAGE_ERROR");
            return;
        }
        if (cookie == null) {
            call.reject("尚未连接扇贝", "NO_SESSION");
            return;
        }
        String method = call.getString("method", "GET");
        JSObject body = call.getObject("body");
        REQUESTS.execute(() -> {
            try {
                String text = client.request(method, path, body == null ? null : body.toString(), cookie);
                JSObject out = new JSObject();
                out.put("body", text);
                call.resolve(out);
            } catch (ShanbayClient.ShanbayException error) {
                call.reject(error.getMessage(), error.code);
            } catch (Exception error) {
                call.reject("网络连接失败，请检查网络后重试", "NETWORK_ERROR");
            }
        });
    }
}

package com.hwfee.english;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.view.WindowCompat;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app Shanbay login.
 *
 * The user signs in on Shanbay's own page inside the app; this activity then lifts the resulting
 * cookies out of the WebView jar and hands them to the Keystore vault. No credentials ever pass
 * through our own code.
 */
public class LoginActivity extends Activity {

    private static final String LOGIN_URL = "https://web.shanbay.com/bayaccount/login?channel=translate";
    private static final String[] COOKIE_HOSTS = {"https://web.shanbay.com", "https://apiv3.shanbay.com"};

    private WebView web;
    private boolean finishing = false;
    private String lastAttempt = null;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFFCF8EE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(18), dp(12), dp(18), dp(12));

        TextView title = new TextView(this);
        title.setText("登录扇贝");
        title.setTextColor(0xFF322B23);
        title.setTextSize(16);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(title);

        TextView close = new TextView(this);
        close.setText("取消");
        close.setTextColor(0xFF9B5B3B);
        close.setTextSize(15);
        close.setPadding(dp(8), dp(4), 0, dp(4));
        close.setOnClickListener((view) -> finish());
        bar.addView(close);
        root.addView(bar);

        web = new WebView(this);
        web.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                captureCookies();
            }
        });
        root.addView(web);

        setContentView(root);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.loadUrl(LOGIN_URL);
    }

    /**
     * Shanbay sets an auth_token shaped cookie before the credentials are even entered, so a
     * present auth_token proves nothing. A captured cookie is only accepted once it authenticates
     * against /bayuser/user — otherwise the user keeps signing in and an already-working session
     * is never replaced by a guest one.
     */
    private void captureCookies() {
        if (finishing) return;
        final String cookie = mergedCookies();
        if (!cookie.contains("auth_token=")) return;
        if (cookie.equals(lastAttempt)) return;
        lastAttempt = cookie;

        new Thread(() -> {
            if (!authenticates(cookie)) return;
            try {
                Vault.put(this, "shanbay.cookie", cookie);
                CookieManager.getInstance().flush();
                runOnUiThread(() -> {
                    if (finishing) return;
                    finishing = true;
                    setResult(RESULT_OK);
                    finish();
                });
            } catch (Exception ignored) {
                // stay on the page; the user can still cancel
            }
        }).start();
    }

    private String mergedCookies() {
        CookieManager cookies = CookieManager.getInstance();
        StringBuilder merged = new StringBuilder();
        for (String host : COOKIE_HOSTS) {
            String jar = cookies.getCookie(host);
            if (jar == null || jar.isEmpty()) continue;
            for (String part : jar.split(";")) {
                String piece = part.trim();
                if (piece.isEmpty()) continue;
                String name = piece.split("=", 2)[0];
                boolean duplicate = false;
                for (String existing : merged.toString().split(";")) {
                    if (existing.trim().startsWith(name + "=")) {
                        duplicate = true;
                        break;
                    }
                }
                if (duplicate) continue;
                if (merged.length() > 0) merged.append("; ");
                merged.append(piece);
            }
        }
        return merged.toString();
    }

    private boolean authenticates(String cookie) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("https://apiv3.shanbay.com/bayuser/user").openConnection();
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            return connection.getResponseCode() == 200;
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

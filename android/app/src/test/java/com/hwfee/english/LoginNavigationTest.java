package com.hwfee.english;

import android.net.Uri;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 23, manifest = Config.NONE)
public class LoginNavigationTest {
    @Test public void allowsOnlyHttpsShanbayOriginsIncludingLegacyAndroid() {
        for (String url : new String[]{"https://shanbay.com", "https://web.shanbay.com/bayaccount/login",
                "https://WEB.SHANBAY.COM:443/bayaccount/login"}) {
            assertTrue(url, LoginActivity.isShanbayNavigation(Uri.parse(url)));
        }
    }

    @Test public void rejectsLookalikeHostsSchemesCredentialsAndUnexpectedPorts() {
        for (String url : new String[]{"http://web.shanbay.com", "https://web.shanbay.com.attacker.invalid",
                "https://evilshanbay.com", "https://attacker.invalid", "file:///sdcard/login.html",
                "javascript:alert(1)", "https://user@web.shanbay.com", "https://web.shanbay.com:8443"}) {
            assertFalse(url, LoginActivity.isShanbayNavigation(Uri.parse(url)));
        }
    }

    @Test public void allowsOfficialWechatAuthorizationAndShanbayCallbacks() {
        assertTrue(LoginActivity.isLoginNavigation(Uri.parse("https://open.weixin.qq.com/connect/qrconnect?appid=test")));
        assertTrue(LoginActivity.isLoginNavigation(Uri.parse("https://long.open.weixin.qq.com/connect/l/qrconnect")));
        assertTrue(LoginActivity.isLoginNavigation(Uri.parse("https://www.shanbay.com/web/account/social-login/complete")));
        assertFalse(LoginActivity.isLoginNavigation(Uri.parse("https://open.weixin.qq.com.attacker.invalid")));
        assertFalse(LoginActivity.isLoginNavigation(Uri.parse("https://user@open.weixin.qq.com")));
        assertFalse(LoginActivity.isLoginNavigation(Uri.parse("http://open.weixin.qq.com")));
    }

    @Test public void wechatWakeupIsPinnedToWechatAndDropsInjectedIntentExtras() {
        Uri source = Uri.parse("https://open.weixin.qq.com/connect/qrconnect");
        android.content.Intent direct = LoginActivity.wechatIntent(Uri.parse("weixin://dl/scan"), source);
        assertNotNull(direct);
        assertEquals("com.tencent.mm", direct.getPackage());
        android.content.Intent wrapped = LoginActivity.wechatIntent(Uri.parse(
                "intent://dl/scan#Intent;scheme=weixin;package=com.tencent.mm;component=com.tencent.mm/.Injected;S.secret=discard;end"), source);
        assertNotNull(wrapped);
        assertNull(wrapped.getComponent());
        assertNull(wrapped.getExtras());
        assertNull(LoginActivity.wechatIntent(Uri.parse("weixin://dl/scan"), Uri.parse("https://attacker.invalid")));
        assertNull(LoginActivity.wechatIntent(Uri.parse("intent://x#Intent;scheme=weixin;package=attacker.app;end"), source));
        assertNull(LoginActivity.wechatIntent(Uri.parse("file:///sdcard/x"), source));
        assertNull(LoginActivity.wechatIntent(Uri.parse("javascript:alert(1)"), source));
    }
}

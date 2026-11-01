package com.hwfee.english;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secrets at rest, backed by the Android Keystore.
 *
 * Replaces the desktop's secure-store.mjs, whose DPAPI/pwsh path has no Android equivalent.
 * The key never leaves the Keystore; only the sealed bytes sit in SharedPreferences, and no
 * secret is ever handed back to JavaScript.
 */
public final class Vault {

    private static final String PREFS = "hwfee-vault";
    private static final String KEY_ALIAS = "hwfee.vault.v1";
    private static final int TAG_BITS = 128;

    private Vault() {
    }

    public static synchronized void put(Context context, String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        // The Keystore generates the IV itself; supplying one is rejected on Android.
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        String stored = Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                + Base64.encodeToString(sealed, Base64.NO_WRAP);
        prefs(context).edit().putString(name, stored).apply();
    }

    public static synchronized String get(Context context, String name) {
        String stored = prefs(context).getString(name, null);
        if (stored == null) return null;
        try {
            int split = stored.indexOf(':');
            if (split < 0) return null;
            byte[] iv = Base64.decode(stored.substring(0, split), Base64.NO_WRAP);
            byte[] sealed = Base64.decode(stored.substring(split + 1), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(sealed), StandardCharsets.UTF_8);
        } catch (Exception error) {
            // A key that no longer matches (restore, reinstall) means the secret is gone, not fatal.
            return null;
        }
    }

    public static synchronized boolean has(Context context, String name) {
        String value = get(context, name);
        return value != null && !value.isEmpty();
    }

    public static synchronized void remove(Context context, String name) {
        prefs(context).edit().remove(name).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }
}

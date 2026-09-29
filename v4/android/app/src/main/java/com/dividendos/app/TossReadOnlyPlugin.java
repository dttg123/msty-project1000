package com.dividendos.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "TossReadOnly")
public class TossReadOnlyPlugin extends Plugin {
    private static final String API_BASE = "https://openapi.tossinvest.com";
    private static final String PREFS = "dividend_os_toss_secure";
    private static final String KEY_ALIAS = "dividend_os_toss_credentials_v1";
    private static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
    private static final Pattern ORDER_PATH = Pattern.compile("^/api/v1/orders\\?[A-Za-z0-9%=&._,-]{1,2048}$");
    private static final Pattern PRICE_PATH = Pattern.compile("^/api/v1/prices\\?symbols=[A-Za-z0-9.,-]{1,4096}$");
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String accessToken = "";
    private long accessTokenExpiresAt = 0;

    @PluginMethod
    public void credentialStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", encryptedPreferences().contains("ciphertext"));
        result.put("lastPublicIp", encryptedPreferences().getString("lastPublicIp", ""));
        call.resolve(result);
    }

    @PluginMethod
    public void markPublicIp(PluginCall call) {
        String ip = trimmed(call.getString("ip", ""));
        if (!ip.matches("^[0-9a-fA-F:.]{3,64}$")) {
            call.reject("공인 IP 형식이 올바르지 않습니다.", "invalid-ip");
            return;
        }
        encryptedPreferences().edit().putString("lastPublicIp", ip).apply();
        call.resolve();
    }

    @PluginMethod
    public void saveCredentials(PluginCall call) {
        String clientId = trimmed(call.getString("clientId", ""));
        String clientSecret = trimmed(call.getString("clientSecret", ""));
        if (clientId.isEmpty() || clientId.length() > 256 || clientSecret.isEmpty() || clientSecret.length() > 512) {
            call.reject("Client ID 또는 Secret을 확인해 주세요.", "invalid-credentials");
            return;
        }
        try {
            JSONObject value = new JSONObject().put("clientId", clientId).put("clientSecret", clientSecret);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
            encryptedPreferences().edit()
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .apply();
            accessToken = "";
            accessTokenExpiresAt = 0;
            call.resolve();
        } catch (Exception error) {
            call.reject("이 기기에 토스 키를 안전하게 저장하지 못했습니다.", "secure-storage", error);
        }
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        encryptedPreferences().edit().clear().apply();
        accessToken = "";
        accessTokenExpiresAt = 0;
        call.resolve();
    }

    @PluginMethod
    public void publicIp(PluginCall call) {
        executor.execute(() -> {
            try {
                JSONObject body = requestJson("GET", "https://api.ipify.org?format=json", null, null);
                String ip = trimmed(body.optString("ip"));
                if (!ip.matches("^[0-9a-fA-F:.]{3,64}$")) throw new Exception("invalid IP response");
                JSObject result = new JSObject();
                result.put("ip", ip);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("현재 공인 IP를 확인하지 못했습니다.", "ip-unavailable");
            }
        });
    }

    @PluginMethod
    public void openToss(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.tossinvest.com/"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void request(PluginCall call) {
        String path = call.getString("path", "");
        String accountSeq = trimmed(call.getString("accountSeq", ""));
        if (!allowedReadPath(path)) {
            call.reject("허용되지 않은 토스 조회 경로입니다.", "blocked-path");
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject data = tossGet(path, accountSeq, true);
                JSObject result = new JSObject();
                result.put("data", data);
                call.resolve(result);
            } catch (AuthException error) {
                call.reject(error.getMessage(), error.code);
            } catch (Exception error) {
                call.reject("토스 읽기 전용 조회에 실패했습니다.", "toss-read-failed");
            }
        });
    }

    private boolean allowedReadPath(String path) {
        return "/api/v1/accounts".equals(path) || "/api/v1/holdings".equals(path) || ORDER_PATH.matcher(path).matches() || PRICE_PATH.matcher(path).matches();
    }

    private JSONObject tossGet(String path, String accountSeq, boolean retry) throws Exception {
        String token = token();
        HttpURLConnection connection = connection(API_BASE + path, "GET");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        if (!accountSeq.isEmpty()) connection.setRequestProperty("X-Tossinvest-Account", accountSeq);
        int status = connection.getResponseCode();
        if (status == 401 && retry) {
            accessToken = "";
            accessTokenExpiresAt = 0;
            connection.disconnect();
            return tossGet(path, accountSeq, false);
        }
        JSONObject envelope = readJson(connection, status);
        if (status < 200 || status >= 300) {
            if (status == 403) throw new AuthException("현재 IP가 토스 허용 목록에 없습니다.", "ip-not-allowed");
            if (status == 429) throw new AuthException("토스 조회가 너무 빠릅니다. 잠시 후 다시 시도해 주세요.", "rate-limit");
            throw new AuthException("토스 조회에 실패했습니다.", "toss-" + status);
        }
        Object result = envelope.opt("result");
        JSObject wrapped = new JSObject();
        wrapped.put("result", result == null ? JSONObject.NULL : result);
        return wrapped;
    }

    private synchronized String token() throws Exception {
        if (!accessToken.isEmpty() && System.currentTimeMillis() < accessTokenExpiresAt - 60_000) return accessToken;
        JSONObject credentials = credentials();
        String form = "grant_type=client_credentials&client_id=" + encode(credentials.getString("clientId")) + "&client_secret=" + encode(credentials.getString("clientSecret"));
        HttpURLConnection connection = connection(API_BASE + "/oauth2/token", "POST");
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(form.getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        JSONObject body = readJson(connection, status);
        if (status == 403) throw new AuthException("현재 IP가 토스 허용 목록에 없습니다.", "ip-not-allowed");
        if (status < 200 || status >= 300) throw new AuthException("토스 Client ID 또는 Secret을 확인해 주세요.", "toss-auth");
        String value = trimmed(body.optString("access_token"));
        long expiresIn = body.optLong("expires_in", 0);
        if (value.isEmpty() || expiresIn <= 0) throw new AuthException("토스 인증 응답을 확인하지 못했습니다.", "toss-auth-response");
        accessToken = value;
        accessTokenExpiresAt = System.currentTimeMillis() + expiresIn * 1000;
        return accessToken;
    }

    private JSONObject credentials() throws Exception {
        SharedPreferences preferences = encryptedPreferences();
        String encodedIv = preferences.getString("iv", "");
        String encodedCiphertext = preferences.getString("ciphertext", "");
        if (encodedIv.isEmpty() || encodedCiphertext.isEmpty()) throw new AuthException("토스 Client ID와 Secret을 먼저 저장해 주세요.", "credentials-missing");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(encodedIv, Base64.NO_WRAP)));
        byte[] plain = cipher.doFinal(Base64.decode(encodedCiphertext, Base64.NO_WRAP));
        return new JSONObject(new String(plain, StandardCharsets.UTF_8));
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(KEY_ALIAS,
            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private SharedPreferences encryptedPreferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private JSONObject requestJson(String method, String url, String body, String contentType) throws Exception {
        HttpURLConnection connection = connection(url, method);
        if (contentType != null) connection.setRequestProperty("Content-Type", contentType);
        if (body != null) {
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int status = connection.getResponseCode();
        JSONObject result = readJson(connection, status);
        if (status < 200 || status >= 300) throw new Exception("HTTP " + status);
        return result;
    }

    private HttpURLConnection connection(String url, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        return connection;
    }

    private JSONObject readJson(HttpURLConnection connection, int status) throws Exception {
        InputStream input = status >= 200 && status < 400 ? connection.getInputStream() : connection.getErrorStream();
        if (input == null) return new JSONObject();
        try (input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new Exception("response too large");
                output.write(buffer, 0, read);
            }
            String text = new String(output.toByteArray(), StandardCharsets.UTF_8);
            return text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } finally {
            connection.disconnect();
        }
    }

    private static String encode(String value) throws Exception { return URLEncoder.encode(value, StandardCharsets.UTF_8.name()); }
    private static String trimmed(String value) { return value == null ? "" : value.trim(); }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static final class AuthException extends Exception {
        final String code;
        AuthException(String message, String code) { super(message); this.code = code; }
    }
}

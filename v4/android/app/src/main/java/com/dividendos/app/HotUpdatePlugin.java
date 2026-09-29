package com.dividendos.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.WebView;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

@CapacitorPlugin(name = "HotUpdate")
public class HotUpdatePlugin extends Plugin {
    private static final String MANIFEST_URL = "https://raw.githubusercontent.com/dttg123/msty-project1000/main/updates/latest.json";
    private static final String BUNDLE_PREFIX = "https://raw.githubusercontent.com/dttg123/msty-project1000/main/updates/";
    private static final String PUBLIC_KEY = "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAwxX0/7SucE1DPtBlEsc8XrSn+uG4cZa4pYeZgDO/A37LIikVthCKCS/qSq7lraAhZX+iYT5IQ5uhgGoNcj5WVLFrTYYX2crBKevkg9I5F4tCu7MukfX4swf2dYyqZLuW0cUr+OXRKcYdWk7NAYU+S0voFISW2gnUw65pOU9fLhqXP+6vIWGYjnwnYwIFqkS1B38PuZ204R4+WDisRceneV+difx4EYiM3++z1NkICDjgq3UgmCX1BEBJ5UpRHJWCHhN2MnAtv38Q9BHsdPhGuKGSxS6sIdOnpdKSJwWW8FK2FhMqY4eeGO1N1XBVCKlpmDR9oiri3LebAc2k0FjNhL16quvu8MlEASuLCB4Z0Hq8Z681G7iA7XzhqcjseTs4EVYbtbjHBj6SucStZldujoJ+GV8Dk3zUQbpZnOv7MJ5609NbLYqF6bLc+NL78M4tJSuiv481N1i8jsLpbrSXz7Ru2PFCJ253bsC+ak4GcvEB01IlzfN3JbkFRsAH5Zv5AgMBAAE=";
    private static final String PREFS = "dividend_os_hot_update";
    private static final long MAX_BUNDLE_BYTES = 12L * 1024L * 1024L;
    private static final long MAX_EXPANDED_BYTES = 32L * 1024L * 1024L;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());

    public static void rollbackPendingUpdate(Context context) {
        SharedPreferences own = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!own.getBoolean("pending", false)) return;
        String previous = own.getString("previousPath", "");
        context.getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE).edit().putString(WebView.CAP_SERVER_PATH, previous).apply();
        own.edit().putBoolean("pending", false).putString("failedVersion", own.getString("pendingVersion", "")).remove("pendingVersion").apply();
    }

    @PluginMethod
    public void status(PluginCall call) {
        executor.execute(() -> {
            try {
                Update update = fetchVerifiedManifest();
                String current = currentVersion();
                JSObject result = new JSObject();
                result.put("available", true);result.put("currentVersion", current);result.put("latestVersion", update.version);
                result.put("updateAvailable", compareVersions(update.version, current) > 0);
                result.put("nativeUpdateRequired", compareVersions(update.minNativeVersion, BuildConfig.VERSION_NAME) > 0);
                result.put("failedVersion", preferences().getString("failedVersion", ""));call.resolve(result);
            } catch (Exception error) {call.reject("업데이트 정보를 확인하지 못했습니다.", "update-check-failed");}
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        executor.execute(() -> {
            try {
                Update update = fetchVerifiedManifest();
                if (compareVersions(update.minNativeVersion, BuildConfig.VERSION_NAME) > 0) {call.reject("Android 보안 모듈 업데이트가 필요합니다.", "native-update-required");return;}
                if (compareVersions(update.version, currentVersion()) <= 0) {call.reject("이미 최신 버전입니다.", "already-current");return;}
                byte[] zip = download(update.bundleUrl, MAX_BUNDLE_BYTES);
                if (!hex(MessageDigest.getInstance("SHA-256").digest(zip)).equalsIgnoreCase(update.sha256)) throw new Exception("bundle hash mismatch");
                File root = new File(getContext().getFilesDir(), "hot-updates");root.mkdirs();
                File staging = new File(root, update.version + ".tmp");deleteTree(staging);staging.mkdirs();unzip(zip, staging);
                if (!new File(staging, "index.html").isFile() || !new File(staging, "app.js").isFile() || !new File(staging, "build-manifest.json").isFile()) throw new Exception("bundle incomplete");
                File target = new File(root, update.version);deleteTree(target);
                if (!staging.renameTo(target)) throw new Exception("bundle activation failed");
                String previous = bridge.getServerBasePath();if (previous == null || !new File(previous).isDirectory()) previous = "";
                preferences().edit().putBoolean("pending", true).putString("pendingVersion", update.version).putString("previousPath", previous).apply();
                getContext().getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE).edit().putString(WebView.CAP_SERVER_PATH, target.getAbsolutePath()).apply();
                final String rollbackPath = previous;
                handler.post(() -> bridge.setServerBasePath(target.getAbsolutePath()));
                handler.postDelayed(() -> {if (!preferences().getBoolean("pending", false)) return;rollback(rollbackPath);}, 15000);
                JSObject result = new JSObject();result.put("started", true);result.put("version", update.version);call.resolve(result);
            } catch (Exception error) {call.reject("안전한 업데이트를 적용하지 못했습니다.", "update-install-failed");}
        });
    }

    @PluginMethod
    public void confirmReady(PluginCall call) {
        SharedPreferences prefs = preferences();
        if (prefs.getBoolean("pending", false)) prefs.edit().putString("activeVersion", prefs.getString("pendingVersion", BuildConfig.VERSION_NAME)).putBoolean("pending", false).remove("pendingVersion").remove("failedVersion").apply();
        call.resolve();
    }

    private void rollback(String previous) {
        String failed = preferences().getString("pendingVersion", "");
        preferences().edit().putBoolean("pending", false).putString("failedVersion", failed).remove("pendingVersion").apply();
        getContext().getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE).edit().putString(WebView.CAP_SERVER_PATH, previous).apply();
        if (previous.isEmpty()) bridge.setServerAssetPath("public"); else bridge.setServerBasePath(previous);
    }

    private Update fetchVerifiedManifest() throws Exception {
        JSONObject body = new JSONObject(new String(download(MANIFEST_URL, 512 * 1024), StandardCharsets.UTF_8));
        String version = cleanVersion(body.optString("version")),minNative = cleanVersion(body.optString("minNativeVersion"));
        String bundleUrl = body.optString("bundleUrl"),sha256 = body.optString("sha256").toLowerCase(),signature = body.optString("signature");
        if (version.isEmpty() || minNative.isEmpty() || !bundleUrl.startsWith(BUNDLE_PREFIX) || !sha256.matches("^[a-f0-9]{64}$")) throw new Exception("invalid manifest");
        String signed = version + "\n" + sha256 + "\n" + minNative;
        PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.decode(PUBLIC_KEY, Base64.NO_WRAP)));
        Signature verifier = Signature.getInstance("SHA256withRSA");verifier.initVerify(key);verifier.update(signed.getBytes(StandardCharsets.UTF_8));
        if (!verifier.verify(Base64.decode(signature, Base64.NO_WRAP))) throw new Exception("invalid signature");
        return new Update(version,minNative,bundleUrl,sha256);
    }

    private byte[] download(String value, long limit) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(value).openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setUseCaches(false);connection.setRequestProperty("User-Agent", "DividendOS-Android");
        int status = connection.getResponseCode();if (status < 200 || status >= 300) throw new Exception("HTTP " + status);
        try (InputStream input = connection.getInputStream();ByteArrayOutputStream output = new ByteArrayOutputStream()) {byte[] buffer=new byte[16384];int read;long total=0;while((read=input.read(buffer))!=-1){total+=read;if(total>limit)throw new Exception("download too large");output.write(buffer,0,read);}return output.toByteArray();} finally {connection.disconnect();}
    }

    private void unzip(byte[] bytes, File target) throws Exception {
        String root = target.getCanonicalPath() + File.separator;long total=0;int files=0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {ZipEntry entry;byte[] buffer=new byte[16384];while((entry=zip.getNextEntry())!=null){if(++files>300)throw new Exception("too many files");File output=new File(target,entry.getName());if(!output.getCanonicalPath().startsWith(root))throw new Exception("unsafe path");if(entry.isDirectory()){output.mkdirs();continue;}output.getParentFile().mkdirs();try(FileOutputStream stream=new FileOutputStream(output)){int read;while((read=zip.read(buffer))!=-1){total+=read;if(total>MAX_EXPANDED_BYTES)throw new Exception("bundle too large");stream.write(buffer,0,read);}}}}
    }
    private void deleteTree(File file) {if(file==null||!file.exists())return;if(file.isDirectory()){File[] children=file.listFiles();if(children!=null)for(File child:children)deleteTree(child);}file.delete();}
    private SharedPreferences preferences(){return getContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    private String currentVersion(){String active=preferences().getString("activeVersion","");return !active.isEmpty()&&compareVersions(active,BuildConfig.VERSION_NAME)>0?active:BuildConfig.VERSION_NAME;}
    private static String cleanVersion(String value){String result=value==null?"":value.trim();return result.matches("^[0-9]+\\.[0-9]+\\.[0-9]+$")?result:"";}
    private static int compareVersions(String left,String right){for(int i=0;i<3;i++){int a=part(left,i),b=part(right,i);if(a!=b)return Integer.compare(a,b);}return 0;}
    private static int part(String value,int index){String[] pieces=value.split("\\.");try{return index<pieces.length?Integer.parseInt(pieces[index]):0;}catch(Exception ignored){return 0;}}
    private static String hex(byte[] bytes){StringBuilder value=new StringBuilder();for(byte item:bytes)value.append(String.format("%02x",item));return value.toString();}
    @Override protected void handleOnDestroy(){executor.shutdownNow();handler.removeCallbacksAndMessages(null);super.handleOnDestroy();}
    private static final class Update{final String version,minNativeVersion,bundleUrl,sha256;Update(String version,String minNativeVersion,String bundleUrl,String sha256){this.version=version;this.minNativeVersion=minNativeVersion;this.bundleUrl=bundleUrl;this.sha256=sha256;}}
}

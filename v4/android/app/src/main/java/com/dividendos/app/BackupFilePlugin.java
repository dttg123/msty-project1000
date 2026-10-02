package com.dividendos.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

@CapacitorPlugin(name = "BackupFile")
public class BackupFilePlugin extends Plugin {
    private static final int MAX_BYTES = 32 * 1024 * 1024;
    private byte[] bytes(PluginCall call) throws Exception {
        String data = call.getString("base64", "");
        if (data.length() > ((MAX_BYTES + 2L) / 3L) * 4L) throw new Exception("Backup too large");
        byte[] value = Base64.decode(data, Base64.DEFAULT);
        if (value.length == 0 || value.length > MAX_BYTES) throw new Exception("Invalid backup size");
        return value;
    }
    private String filename(PluginCall call) {
        String name = call.getString("filename", "DividendOS-backup.zip");
        return name.matches("[A-Za-z0-9_.-]{1,160}\\.zip") ? name : "DividendOS-backup.zip";
    }
    @PluginMethod
    public void save(PluginCall call) {
        try {
            bytes(call);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/zip");
            intent.putExtra(Intent.EXTRA_TITLE, filename(call));
            startActivityForResult(call, intent, "saveResult");
        } catch (Exception error) { call.reject("저장 위치를 열 수 없습니다.", error); }
    }
    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            JSObject value = new JSObject(); value.put("cancelled", true); call.resolve(value); return;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null) { call.reject("저장 위치가 없습니다."); return; }
        getBridge().execute(() -> {
            try { write(uri, bytes(call)); call.resolve(new JSObject().put("saved", true)); }
            catch (Exception error) { call.reject("백업 파일 쓰기에 실패했습니다.", error); }
        });
    }
    private void write(Uri uri, byte[] value) throws Exception {
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (stream == null) throw new Exception("No output stream");
            stream.write(value); stream.flush();
        }
    }
    @PluginMethod
    public void download(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { save(call); return; }
        getBridge().execute(() -> {
            Uri uri = null;
            try {
                byte[] value = bytes(call);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename(call));
                values.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new Exception("No download location");
                write(uri, value);
                ContentValues ready = new ContentValues(); ready.put(MediaStore.Downloads.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, ready, null, null);
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) {
                if (uri != null) getContext().getContentResolver().delete(uri, null, null);
                call.reject("다운로드 폴더 저장에 실패했습니다.", error);
            }
        });
    }
}

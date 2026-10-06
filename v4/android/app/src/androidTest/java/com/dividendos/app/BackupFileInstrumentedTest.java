package com.dividendos.app;

import static org.junit.Assert.*;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BackupFileInstrumentedTest {
    private static class CapturedCall extends PluginCall {
        final CountDownLatch done = new CountDownLatch(1);
        volatile JSObject result;
        volatile String error;
        CapturedCall(JSObject data) { super(null, "BackupFile", "native-qa", "download", data); }
        @Override public void resolve(JSObject value) { result = value; done.countDown(); }
        @Override public void reject(String message, Exception cause) { error = message; done.countDown(); }
        @Override public void reject(String message) { error = message; done.countDown(); }
    }
    private Uri find(ContentResolver resolver, String filename) {
        try (Cursor cursor = resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Downloads._ID}, MediaStore.Downloads.DISPLAY_NAME+"=?", new String[]{filename}, null)) {
            return cursor != null && cursor.moveToFirst() ? ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0)) : null;
        }
    }
    @Test public void largeZipIsActuallyWrittenAndReadable() throws Exception {
        byte[] content = new byte[2*1024*1024]; new Random(27).nextBytes(content);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            zip.putNextEntry(new ZipEntry("data/random.bin"));zip.write(content);zip.closeEntry();
        }
        byte[] expected = output.toByteArray();assertTrue(expected.length > 1024*1024);
        String name = "DividendOS-native-qa-"+System.nanoTime()+".zip";
        ContentResolver resolver = InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        Uri written = null;
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            CapturedCall call = new CapturedCall(new JSObject().put("filename",name).put("base64",Base64.encodeToString(expected,Base64.NO_WRAP)));
            scenario.onActivity(activity -> ((BackupFilePlugin)activity.getBridge().getPlugin("BackupFile").getInstance()).download(call));
            assertTrue("native call timed out",call.done.await(30,TimeUnit.SECONDS));assertNull(call.error);
            assertNotNull(call.result);assertTrue(call.result.getBoolean("saved",false));
            written = find(resolver,name);assertNotNull("Download file does not exist",written);
            try (InputStream input = resolver.openInputStream(written)) {assertNotNull(input);assertArrayEquals(expected,input.readAllBytes());}
            try (ZipInputStream zip = new ZipInputStream(resolver.openInputStream(written))) {
                assertEquals("data/random.bin",zip.getNextEntry().getName());assertArrayEquals(content,zip.readAllBytes());assertNull(zip.getNextEntry());
            }
        } finally { if(written==null)written=find(resolver,name);if(written!=null)resolver.delete(written,null,null); }
    }
    @Test public void newerApkDoesNotRenderAnOlderRetainedWebBundle() throws Exception {
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.content.SharedPreferences own=context.getSharedPreferences("dividend_os_hot_update",0);
        android.content.SharedPreferences web=context.getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME,0);
        String beforePath=web.getString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH,""),beforeVersion=own.getString("activeVersion","");
        try {
            own.edit().putString("activeVersion","0.12.25").putBoolean("pending",false).commit();
            web.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH,"/retained/older/bundle").commit();
            HotUpdatePlugin.rollbackPendingUpdate(context);
            assertEquals("",web.getString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH,""));
            assertEquals(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName,own.getString("activeVersion",""));
        } finally {
            own.edit().putString("activeVersion",beforeVersion).commit();web.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH,beforePath).commit();
        }
    }
    private String javascript(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);java.util.concurrent.atomic.AtomicReference<String> result=new java.util.concurrent.atomic.AtomicReference<>();
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);done.countDown();}));
        assertTrue("WebView callback timed out",done.await(10,TimeUnit.SECONDS));return result.get();
    }
    private void waitForJavascript(ActivityScenario<MainActivity> scenario,String expression) throws Exception {
        for(int i=0;i<160;i++){if("true".equals(javascript(scenario,expression)))return;Thread.sleep(250);}
        fail("Actual app condition not reached: "+expression);
    }
    @Test public void actualWebViewBackupButtonWritesRestorableZip() throws Exception {
        ContentResolver resolver=InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        java.util.Set<Long> before=new java.util.HashSet<>();
        try(Cursor cursor=resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Downloads._ID},null,null,null)){
            if(cursor!=null)while(cursor.moveToNext())before.add(cursor.getLong(0));
        }
        java.util.List<Uri> created=new java.util.ArrayList<>();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            waitForJavascript(scenario,"!!document.querySelector('[data-backup]') && !document.querySelector('#splashScreen')");
            javascript(scenario,"document.querySelector('[data-page=\"settings\"]').click();document.querySelector('[data-backup]').closest('details').open=true;document.querySelector('[data-backup]').click()");
            waitForJavascript(scenario,"!!document.querySelector('[data-backup-download]')");
            assertEquals("true",javascript(scenario,"!!document.querySelector('[data-backup-save]')"));
            javascript(scenario,"document.querySelector('[data-backup-download]').click()");
            waitForJavascript(scenario,"document.querySelector('#toast').textContent.includes('다운로드 폴더에 ZIP 백업을 저장')");
            try(Cursor cursor=resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Downloads._ID,MediaStore.Downloads.DISPLAY_NAME,MediaStore.Downloads.IS_PENDING},null,null,null)){
                if(cursor!=null)while(cursor.moveToNext())if(!before.contains(cursor.getLong(0))&&cursor.getString(1).startsWith("DividendOS_v")){
                    assertEquals(0,cursor.getInt(2));created.add(ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0)));
                }
            }
            assertEquals("Actual backup button must create one download",1,created.size());
            byte[] bytes;try(InputStream input=resolver.openInputStream(created.get(0))){assertNotNull(input);bytes=input.readAllBytes();}
            assertTrue("Portable app ZIP is unexpectedly empty",bytes.length>700000);
            boolean stateFound=false,runtimeFound=false;
            try(ZipInputStream zip=new ZipInputStream(new java.io.ByteArrayInputStream(bytes))){ZipEntry entry;while((entry=zip.getNextEntry())!=null){
                if(entry.getName().equals("data/state.json")){org.json.JSONObject state=new org.json.JSONObject(new String(zip.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));assertTrue(state.getJSONArray("projects").length()>0);assertNotNull(state.getJSONArray("trades"));assertNotNull(state.getJSONArray("dividends"));stateFound=true;}
                if(entry.getName().equals("app/hot-update.js"))runtimeFound=true;
            }}
            assertTrue("State is missing from the actual downloaded ZIP",stateFound);assertTrue("Portable runtime dependency is missing",runtimeFound);
        } finally {for(Uri uri:created)resolver.delete(uri,null,null);}
    }
    @Test public void emptyPayloadFailsWithoutCreatingZeroByteFile() throws Exception {
        String name="DividendOS-native-empty-"+System.nanoTime()+".zip";
        ContentResolver resolver=InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            CapturedCall call=new CapturedCall(new JSObject().put("filename",name).put("base64",""));
            scenario.onActivity(activity -> ((BackupFilePlugin)activity.getBridge().getPlugin("BackupFile").getInstance()).download(call));
            assertTrue(call.done.await(30,TimeUnit.SECONDS));assertNotNull(call.error);assertNull(call.result);assertNull(find(resolver,name));
        }
    }
    @Test public void pickerRetainsSmallCallAndWritesSelectedLocation() throws Exception {
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        android.content.Context context=instrumentation.getTargetContext();
        ContentResolver resolver=context.getContentResolver();
        android.content.ContentValues values=new android.content.ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME,"DividendOS-picker-qa-"+System.nanoTime()+".zip");values.put(MediaStore.Downloads.MIME_TYPE,"application/zip");
        Uri destination=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);assertNotNull(destination);
        android.content.IntentFilter filter=new android.content.IntentFilter(android.content.Intent.ACTION_CREATE_DOCUMENT);filter.addCategory(android.content.Intent.CATEGORY_OPENABLE);filter.addDataType("application/zip");
        android.app.Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(filter,new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,new android.content.Intent().setData(destination)),true);
        byte[] expected=new byte[2*1024*1024];new Random(29).nextBytes(expected);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            CapturedCall call=new CapturedCall(new JSObject().put("filename","DividendOS-picker.zip").put("base64",Base64.encodeToString(expected,Base64.NO_WRAP)));
            scenario.onActivity(activity->((BackupFilePlugin)activity.getBridge().getPlugin("BackupFile").getInstance()).save(call));
            assertTrue("Picker write timed out",call.done.await(30,TimeUnit.SECONDS));assertNull(call.error);assertTrue(call.result.getBoolean("saved",false));
            assertFalse("Large payload retained across Activity",call.getData().has("base64"));
            assertTrue("System picker was not invoked",monitor.getHits()>0);
            try(InputStream input=resolver.openInputStream(destination)){assertArrayEquals(expected,input.readAllBytes());}
            assertFalse(new java.io.File(call.getString("backupPath","")).exists());
        } finally {instrumentation.removeMonitor(monitor);resolver.delete(destination,null,null);}
    }
    @Test public void pickerCancellationRemovesStagedPayload() throws Exception {
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        android.content.IntentFilter filter=new android.content.IntentFilter(android.content.Intent.ACTION_CREATE_DOCUMENT);filter.addCategory(android.content.Intent.CATEGORY_OPENABLE);filter.addDataType("application/zip");
        android.app.Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(filter,new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null),true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            CapturedCall call=new CapturedCall(new JSObject().put("filename","DividendOS-cancel.zip").put("base64",Base64.encodeToString(new byte[1024],Base64.NO_WRAP)));
            scenario.onActivity(activity->((BackupFilePlugin)activity.getBridge().getPlugin("BackupFile").getInstance()).save(call));
            assertTrue(call.done.await(30,TimeUnit.SECONDS));assertNull(call.error);assertTrue(call.result.getBoolean("cancelled",false));assertFalse(call.result.getBoolean("saved",false));
            assertFalse(call.getData().has("base64"));assertFalse(new java.io.File(call.getString("backupPath","")).exists());
        } finally {instrumentation.removeMonitor(monitor);}
    }

}

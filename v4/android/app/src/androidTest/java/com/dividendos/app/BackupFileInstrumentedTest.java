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
    @Test public void emptyPayloadFailsWithoutCreatingZeroByteFile() throws Exception {
        String name="DividendOS-native-empty-"+System.nanoTime()+".zip";
        ContentResolver resolver=InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            CapturedCall call=new CapturedCall(new JSObject().put("filename",name).put("base64",""));
            scenario.onActivity(activity -> ((BackupFilePlugin)activity.getBridge().getPlugin("BackupFile").getInstance()).download(call));
            assertTrue(call.done.await(30,TimeUnit.SECONDS));assertNotNull(call.error);assertNull(call.result);assertNull(find(resolver,name));
        }
    }
}

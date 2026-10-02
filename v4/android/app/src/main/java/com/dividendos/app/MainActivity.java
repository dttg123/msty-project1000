package com.dividendos.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        HotUpdatePlugin.rollbackPendingUpdate(this);
        registerPlugin(TossReadOnlyPlugin.class);
        registerPlugin(BackupFilePlugin.class);
        registerPlugin(HotUpdatePlugin.class);
        registerPlugin(NativeGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

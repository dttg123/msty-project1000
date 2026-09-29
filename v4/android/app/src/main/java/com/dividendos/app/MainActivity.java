package com.dividendos.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        HotUpdatePlugin.rollbackPendingUpdate(this);
        registerPlugin(TossReadOnlyPlugin.class);
        registerPlugin(HotUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

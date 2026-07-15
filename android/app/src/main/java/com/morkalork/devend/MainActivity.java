package com.morkalork.devend;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Let the background music start on app launch (the main-menu screen)
        // instead of waiting for the first tap. The Android WebView otherwise
        // requires a user gesture before any media plays, which is why music
        // only kicked in once the player reached level 1.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}

package com.morkalork.devend;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Two-player over Nearby Connections (TWO_PLAYER_PLAN.md step 9).
        // Registered BEFORE super.onCreate, which is where Capacitor builds the
        // bridge: a plugin added afterwards is a plugin the web layer cannot
        // see.
        registerPlugin(NearbyPlugin.class);
        super.onCreate(savedInstanceState);
        // Let the background music start on app launch (the main-menu screen)
        // instead of waiting for the first tap. The Android WebView otherwise
        // requires a user gesture before any media plays, which is why music
        // only kicked in once the player reached level 1.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}

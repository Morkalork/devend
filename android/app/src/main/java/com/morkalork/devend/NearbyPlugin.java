package com.morkalork.devend;

import android.Manifest;
import android.os.Build;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import java.nio.charset.StandardCharsets;

/**
 * Nearby Connections, for the two-player mode's Android end state
 * (TWO_PLAYER_PLAN.md step 9).
 *
 * What it buys over the WebRTC path the web build keeps: no QR, no camera, no
 * Wi-Fi network and no server of any kind. Both players open 2-Player, the
 * phones find each other over Bluetooth, agree on a four-digit token that says
 * "yes, that is the phone across the table", and the link upgrades itself to
 * Wi-Fi Direct for bandwidth. Nothing about the pairing leaves the room,
 * because there is nowhere for it to go.
 *
 * P2P_POINT_TO_POINT, because this is exactly two devices and the strategy
 * that knows that is the one that gets the best throughput. Both sides
 * advertise AND discover under one service id, so there is no host/guest choice
 * to put in front of the players: whoever's device id sorts lower hosts, which
 * is decided above this layer.
 *
 * Deliberately thin. It moves bytes and reports what the radio is doing; every
 * decision about what those bytes mean lives in TypeScript, where it is testable
 * without two phones in a room.
 */
@CapacitorPlugin(
    name = "Nearby",
    permissions = {
        // Android 12+ splits Bluetooth into three runtime permissions.
        @Permission(alias = "bluetooth", strings = {
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        }),
        // Android 13+ wants this instead of location for Wi-Fi peer discovery.
        @Permission(alias = "wifi", strings = { "android.permission.NEARBY_WIFI_DEVICES" }),
        // Android 11 and below: Nearby needs fine location, AND location
        // services switched on. That prompt is the one that surprises people,
        // which is why the 2-Player screen explains it before this asks.
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class NearbyPlugin extends Plugin {

    /** One id for the app; two builds with different ids simply never meet. */
    private static final String SERVICE_ID = "com.morkalork.devend.pair";

    private ConnectionsClient client;
    private String localName = "Player";
    private String connectedEndpoint = null;

    @Override
    public void load() {
        client = Nearby.getConnectionsClient(getContext());
    }

    // ── Permissions ─────────────────────────────────────────────────────────

    /**
     * What is missing, by name.
     *
     * "Found nobody" and "was never allowed to look" are the same picture from
     * the outside, and telling them apart is the difference between a player
     * fixing it in ten seconds and deciding the mode is broken.
     */
    @PluginMethod
    public void permissionState(PluginCall call) {
        JSObject out = new JSObject();
        out.put("bluetooth", Build.VERSION.SDK_INT >= 31 ? getPermissionState("bluetooth").toString() : "granted");
        out.put("wifi", Build.VERSION.SDK_INT >= 33 ? getPermissionState("wifi").toString() : "granted");
        out.put("location", Build.VERSION.SDK_INT < 31 ? getPermissionState("location").toString() : "granted");
        call.resolve(out);
    }

    @PluginMethod
    public void requestNearbyPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(new String[]{ "bluetooth", "wifi" }, call, "afterPermissions");
        } else if (Build.VERSION.SDK_INT >= 31) {
            requestPermissionForAlias("bluetooth", call, "afterPermissions");
        } else {
            requestPermissionForAlias("location", call, "afterPermissions");
        }
    }

    @PermissionCallback
    private void afterPermissions(PluginCall call) {
        permissionState(call);
    }

    // ── Advertising and discovery ───────────────────────────────────────────

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        localName = call.getString("name", "Player");
        AdvertisingOptions options =
            new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_POINT_TO_POINT).build();
        client
            .startAdvertising(localName, SERVICE_ID, connectionLifecycle, options)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> call.reject("advertise failed: " + e.getMessage()));
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        DiscoveryOptions options =
            new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_POINT_TO_POINT).build();
        client
            .startDiscovery(SERVICE_ID, endpointDiscovery, options)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> call.reject("discovery failed: " + e.getMessage()));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        client.stopAdvertising();
        client.stopDiscovery();
        call.resolve();
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null) { call.reject("no endpointId"); return; }
        client
            .requestConnection(localName, endpointId, connectionLifecycle)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> call.reject("connect failed: " + e.getMessage()));
    }

    /**
     * Accept the connection whose four digits both players just compared.
     *
     * The token IS the security model here, and it is the right one for a game
     * two people are playing at the same table: they can see each other's
     * screens, so a matching pair of digits means the phone that answered is
     * the phone across the table and not someone on the next floor.
     */
    @PluginMethod
    public void accept(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null) { call.reject("no endpointId"); return; }
        client
            .acceptConnection(endpointId, payloadCallback)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> call.reject("accept failed: " + e.getMessage()));
    }

    @PluginMethod
    public void reject(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null) { call.reject("no endpointId"); return; }
        client.rejectConnection(endpointId);
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        if (connectedEndpoint != null) client.disconnectFromEndpoint(connectedEndpoint);
        connectedEndpoint = null;
        call.resolve();
    }

    // ── Moving bytes ────────────────────────────────────────────────────────

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        if (data == null || connectedEndpoint == null) { call.resolve(); return; }
        client.sendPayload(
            connectedEndpoint,
            Payload.fromBytes(data.getBytes(StandardCharsets.UTF_8))
        );
        call.resolve();
    }

    // ── Callbacks, forwarded as events ──────────────────────────────────────

    private final EndpointDiscoveryCallback endpointDiscovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(@NonNull String endpointId, @NonNull DiscoveredEndpointInfo info) {
            JSObject data = new JSObject();
            data.put("endpointId", endpointId);
            data.put("name", info.getEndpointName());
            notifyListeners("endpointFound", data);
        }

        @Override
        public void onEndpointLost(@NonNull String endpointId) {
            JSObject data = new JSObject();
            data.put("endpointId", endpointId);
            notifyListeners("endpointLost", data);
        }
    };

    private final ConnectionLifecycleCallback connectionLifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(@NonNull String endpointId, @NonNull ConnectionInfo info) {
            JSObject data = new JSObject();
            data.put("endpointId", endpointId);
            data.put("name", info.getEndpointName());
            // The digits both players compare before anyone accepts.
            data.put("token", info.getAuthenticationDigits());
            notifyListeners("connectionInitiated", data);
        }

        @Override
        public void onConnectionResult(@NonNull String endpointId, @NonNull ConnectionResolution result) {
            JSObject data = new JSObject();
            data.put("endpointId", endpointId);
            boolean ok = result.getStatus().getStatusCode() == ConnectionsStatusCodes.STATUS_OK;
            data.put("ok", ok);
            if (ok) {
                connectedEndpoint = endpointId;
                // Both sides have what they came for; leaving the radios
                // advertising and scanning costs battery and invites a third
                // phone to knock.
                client.stopAdvertising();
                client.stopDiscovery();
                notifyListeners("connected", data);
            } else {
                data.put("reason", result.getStatus().getStatusMessage());
                notifyListeners("disconnected", data);
            }
        }

        @Override
        public void onDisconnected(@NonNull String endpointId) {
            connectedEndpoint = null;
            JSObject data = new JSObject();
            data.put("endpointId", endpointId);
            data.put("reason", "peer disconnected");
            notifyListeners("disconnected", data);
        }
    };

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(@NonNull String endpointId, @NonNull Payload payload) {
            byte[] bytes = payload.asBytes();
            if (bytes == null) return;   // a stream or file payload; this game sends neither
            JSObject data = new JSObject();
            data.put("data", new String(bytes, StandardCharsets.UTF_8));
            notifyListeners("payload", data);
        }

        @Override
        public void onPayloadTransferUpdate(@NonNull String endpointId, @NonNull PayloadTransferUpdate update) {
            // Byte payloads arrive whole, so there is no partial progress worth
            // reporting. Required by the interface.
        }
    };
}

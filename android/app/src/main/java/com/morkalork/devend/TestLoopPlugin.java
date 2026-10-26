package com.morkalork.devend;

import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Firebase Test Lab's "game loop" test (DEVICE_LAB.md).
 *
 * Test Lab launches the app with a TEST_LOOP intent instead of the launcher
 * one. The intent carries the scenario number and, as its data, a file to
 * write the results into. The web layer asks here whether this launch was one
 * (src/lib/deviceCheck/testLoop.ts), runs the device check if so, and hands
 * the report back to be written; then the app closes, which is how Test Lab
 * knows the scenario is over.
 *
 * Deliberately thin, like NearbyPlugin: it moves the result and nothing else.
 */
@CapacitorPlugin(name = "TestLoop")
public class TestLoopPlugin extends Plugin {
    static final String ACTION = "com.google.intent.action.TEST_LOOP";
    private static final int LOG_PIECE = 3000;

    private Intent launchIntent() {
        return getActivity() == null ? null : getActivity().getIntent();
    }

    private boolean isTestLoop(Intent intent) {
        return intent != null && ACTION.equals(intent.getAction());
    }

    @PluginMethod
    public void launch(PluginCall call) {
        Intent intent = launchIntent();
        JSObject out = new JSObject();
        out.put("testLoop", isTestLoop(intent));
        out.put("scenario", isTestLoop(intent) ? intent.getIntExtra("scenario", 1) : 0);
        call.resolve(out);
    }

    @PluginMethod
    public void finish(PluginCall call) {
        Intent intent = launchIntent();
        if (!isTestLoop(intent)) {
            call.reject("not a Test Lab launch");
            return;
        }
        String result = call.getString("result", "{}");
        Uri uri = intent.getData();
        if (uri != null) {
            try (AssetFileDescriptor fd = getContext().getContentResolver().openAssetFileDescriptor(uri, "w");
                 FileOutputStream stream = fd == null ? null : fd.createOutputStream()) {
                if (stream != null) {
                    stream.write(result.getBytes(StandardCharsets.UTF_8));
                    stream.flush();
                }
            } catch (Exception e) {
                // Test Lab still has the run's video and logs; the report is lost, not the run.
                android.util.Log.e("TestLoop", "could not write the results file", e);
            }
        }
        // The report is also in the log, where Test Lab keeps it even without
        // the file, in numbered pieces: logcat cuts a line at about 4000 chars.
        String flat = result.replace('\n', ' ');
        int pieces = (flat.length() + LOG_PIECE - 1) / LOG_PIECE;
        for (int i = 0; i < pieces; i++) {
            String piece = flat.substring(i * LOG_PIECE, Math.min(flat.length(), (i + 1) * LOG_PIECE));
            android.util.Log.i("TestLoop", "DEVICE_CHECK_RESULT " + (i + 1) + "/" + pieces + " " + piece);
        }
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().finish());
    }
}

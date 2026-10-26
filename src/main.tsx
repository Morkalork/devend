import { StrictMode } from "react";
// First, before anything can rewrite the URL: a guest arriving on the host's
// QR link has the whole invitation in the fragment (see pairInvite.ts).
import "@/lib/net/pairInvite";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { i18nReady } from "./i18n";
import "./index.css";
import { loadSoundSettings } from "@/lib/soundSettings";
import { initAnalytics } from "@/lib/analytics";
import { installZoomRecorder } from "@/lib/zoomRecorder";
import { installBootDiagnostics } from "@/lib/bootDiagnostics";
import { installDeviceCheckHook } from "@/lib/deviceCheck/launch";
import { installTestLoop } from "@/lib/deviceCheck/testLoop";

// First: the on-device report (two fingers held still), for a phone with no console.
installBootDiagnostics();
// Apply persisted music/effects volumes before the first sound plays.
loadSoundSettings();
// Player-pattern telemetry (no-op without a VITE_POSTHOG_KEY at build time).
initAnalytics();
// What the board's zoom and resizes actually were, for Admin (CANVAS_UI_PLAN.md stage 0).
installZoomRecorder(window);
// The device check (DEVICE_LAB.md): the hook the emulated CI tiers call, and a
// Firebase Test Lab launch of the app, which runs it by itself.
installDeviceCheckHook();
void installTestLoop();

// After the player's language has arrived (a separate chunk unless it is
// English), so nothing is ever drawn in the wrong one first.
i18nReady.finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});

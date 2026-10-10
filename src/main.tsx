import { StrictMode } from "react";
// First, before anything can rewrite the URL: a guest arriving on the host's
// QR link has the whole invitation in the fragment (see pairInvite.ts).
import "@/lib/net/pairInvite";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./i18n";
import "./index.css";
import { loadSoundSettings } from "@/lib/soundSettings";
import { initAnalytics } from "@/lib/analytics";
import { installZoomRecorder } from "@/lib/zoomRecorder";

// Apply persisted music/effects volumes before the first sound plays.
loadSoundSettings();
// Player-pattern telemetry (no-op without a VITE_POSTHOG_KEY at build time).
initAnalytics();
// What the board's zoom and resizes actually were, for Admin (CANVAS_UI_PLAN.md stage 0).
installZoomRecorder(window);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

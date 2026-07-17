import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./i18n";
import "./index.css";
import { loadSoundSettings } from "@/lib/soundSettings";
import { initAnalytics } from "@/lib/analytics";

// Apply persisted music/effects volumes before the first sound plays.
loadSoundSettings();
// Player-pattern telemetry (no-op without a VITE_POSTHOG_KEY at build time).
initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

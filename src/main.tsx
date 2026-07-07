import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./i18n";
import "./index.css";
import { loadSoundSettings } from "@/lib/soundSettings";

// Apply persisted music/effects volumes before the first sound plays.
loadSoundSettings();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

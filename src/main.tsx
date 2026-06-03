import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Phase 5: Phaser is now the default build.
// ?react=1 to access the legacy React build for comparison/fallback.
const params = new URLSearchParams(window.location.search);
if (params.get("react") === "1") {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} else {
  const root = document.getElementById("root");
  if (root) root.id = "phaser-root";
  void import("./phaser/main").then(({ startPhaser }) => startPhaser());
}

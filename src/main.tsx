import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Migration parallel build: `?phaser=1` boots the Phaser scene instead of the
// React app, so each phase can be verified side-by-side. Default stays React.
const params = new URLSearchParams(window.location.search);
if (params.get("phaser") === "1") {
  const root = document.getElementById("root");
  if (root) root.id = "phaser-root";
  void import("./phaser/main").then(({ startPhaser }) => startPhaser());
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

import "@testing-library/jest-dom";
import { loadAllLanguages } from "@/i18n";

// Every language, up front: the app fetches one on demand (i18n/index.ts),
// and the tests read all four synchronously.
await loadAllLanguages();

// A test that opts into the node environment (the relay's, which runs a real
// server and Node's own WebSocket) has no window to patch.
if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

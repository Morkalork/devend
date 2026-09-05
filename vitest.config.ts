import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Vitest defaults to 5000ms, which suits unit tests and does not suit this
    // suite: several tests sweep the whole 35-map ladder across seeds, or drive
    // thousands of frames of real physics, and are legitimately a second or two
    // each locally. A loaded CI runner is several times slower than that, and
    // the margin ran out - destroyLeavesNothing timed out at 5000ms on CI while
    // taking 1.2s locally, turning a green build red on a commit with nothing
    // wrong with it.
    //
    // A false red is worse than a slow failure: it teaches people to re-run the
    // build rather than read it. 30s still catches a genuine hang (the whole
    // suite runs in about 165s), it just stops the clock being the thing that
    // decides.
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

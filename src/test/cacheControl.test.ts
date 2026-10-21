/** How long a browser may keep each kind of static file (server/cacheControl.js). */
import { describe, it, expect } from "vitest";
import { cacheControlFor } from "../../server/cacheControl.js";

describe("cache lifetimes", () => {
  it("keeps Vite's hashed build files for a year", () => {
    for (const f of ["/app/dist/assets/index-B2XXrCRd.js", "/app/dist/assets/index-AstibHBE.css", "/app/dist/assets/ThreeRenderer-Bd3u9RlJ.js"]) {
      expect(cacheControlFor(f)).toBe("public, max-age=31536000, immutable");
    }
  });

  it("keeps fixed-name music and fonts for a day, so a replaced file reaches players", () => {
    for (const f of ["/app/dist/assets/music/maps_16-20.mp3", "/app/dist/assets/music/main.mp3", "/app/dist/assets/fonts/Michroma-Regular.woff2", "/app/dist/assets/fonts/NotoSansBengali-400.woff2"]) {
      expect(cacheControlFor(f)).toBe("public, max-age=86400");
    }
  });

  it("revalidates the HTML and the YAML every time", () => {
    for (const f of ["/app/dist/index.html", "/app/dist/map.yml", "/app/dist/upgrades.yml"]) {
      expect(cacheControlFor(f)).toBe("no-cache");
    }
  });
});

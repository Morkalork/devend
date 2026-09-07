/**
 * Where the admin surface is on by default, and the one place it must never be.
 *
 * Admin is on for the local dev server and, now, for the staging deploy - which
 * is where maps actually get looked at, and where the ten-tap secret gesture was
 * a toll on the thing this project does most.
 *
 * ── The assertion this file exists for ─────────────────────────────────────
 *
 * "Enable it on localhost" is the obvious rule and it is exactly wrong.
 * Capacitor serves the packaged Android app from `http://localhost`
 * (capacitor.config.ts says so), so that rule ships the map builder, the
 * Playground and the live map tuner to every Play Store install. Staging is
 * also a PRODUCTION BUILD - the same `npm run build` output Capacitor packages -
 * so `import.meta.env.DEV` cannot separate them either.
 *
 * Hence: the staging host is named positively, and anything unrecognised is
 * treated as a real player's device.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminOnByDefault, isStagingHost } from "@/lib/adminAccess";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** A production bundle: what Heroku serves and what Capacitor packages. */
const BUILT = { DEV: false };

describe("the shipped Android app", () => {
  it("does NOT get admin, though Capacitor serves it from localhost", () => {
    expect(
      adminOnByDefault(BUILT, "localhost"),
      "the map builder just shipped to the Play Store",
    ).toBe(false);
  });

  it("does not get it on the other names a WebView may use", () => {
    for (const host of ["localhost", "127.0.0.1", "", "capacitor", "file"]) {
      expect(adminOnByDefault(BUILT, host), `admin on for "${host}"`).toBe(false);
    }
  });

  it("still serves from localhost, which is why the case above matters", () => {
    // If this ever stops being true the trap is gone - but so is the reason
    // this test reads the way it does, and the next person deserves to know.
    expect(read("capacitor.config.ts")).toMatch(/serves the bundled assets from http:\/\/localhost/);
  });
});

describe("where it IS on", () => {
  it("the local dev server", () => {
    expect(adminOnByDefault({ DEV: true }, "localhost")).toBe(true);
  });

  it("the staging deploy, which is the point of the change", () => {
    expect(adminOnByDefault(BUILT, "dev-end-staging-bf4fba8f101e.herokuapp.com")).toBe(true);
  });

  it("any staging dyno, not one hardcoded name", () => {
    // The app name carries a random suffix and can be recreated.
    expect(isStagingHost("dev-end-staging-0000000.herokuapp.com")).toBe(true);
    expect(isStagingHost("something-else.herokuapp.com")).toBe(true);
    expect(isStagingHost("herokuapp.com")).toBe(true);
  });

  it("but not a host that merely mentions it", () => {
    // The suffix is anchored, so a lookalike domain cannot claim it.
    expect(isStagingHost("herokuapp.com.evil.example")).toBe(false);
    expect(isStagingHost("notherokuapp.com")).toBe(false);
    expect(isStagingHost("devend.example.com")).toBe(false);
  });
});

describe("the override", () => {
  it("can shut it off on a host that would otherwise have it", () => {
    // A production dyno on herokuapp.com is one config var away from safe,
    // rather than a code change and a deploy.
    expect(adminOnByDefault({ ...BUILT, VITE_ADMIN: "0" }, "live.herokuapp.com")).toBe(false);
    expect(adminOnByDefault({ DEV: true, VITE_ADMIN: "0" }, "localhost")).toBe(false);
  });

  it("can turn it on anywhere, for debugging a real host", () => {
    expect(adminOnByDefault({ ...BUILT, VITE_ADMIN: "1" }, "devend.example.com")).toBe(true);
  });

  it("ignores anything that is not an explicit 1 or 0", () => {
    // A half-set variable must not be read as consent either way.
    for (const v of ["", "true", "yes", "no", "01"]) {
      expect(adminOnByDefault({ ...BUILT, VITE_ADMIN: v }, "localhost"), v).toBe(false);
      expect(adminOnByDefault({ ...BUILT, VITE_ADMIN: v }, "x.herokuapp.com"), v).toBe(true);
    }
  });
});

describe("the wiring", () => {
  it("is what the welcome screen actually asks", () => {
    const src = read("src/pages/Index.tsx");
    expect(src).toMatch(/useState\(adminOnHere\)/);
    expect(src, "the old dev-only gate is back").not.toMatch(/useState\(import\.meta\.env\.DEV\)/);
  });

  it("leaves the secret gesture as the way in everywhere else", () => {
    const src = read("src/pages/Index.tsx");
    expect(src).toMatch(/onSecretUnlock=\{adminUnlocked \? undefined : handleSecretAdminUnlock\}/);
  });
});

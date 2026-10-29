/**
 * The Play build's guard rails (PLAY_RELEASE_PLAN.md): what the release
 * workflow checks, and what the Android project must keep true for it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const WORKFLOW = read(".github/workflows/android-release.yml");

describe("the release build", () => {
  it("takes its version from the workflow, so every upload can rise", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain('def appVersionCode = (project.findProperty("versionCode") ?: "1").toString().toInteger()');
    expect(gradle).toMatch(/versionCode appVersionCode\s+versionName appVersionName/);
    expect(WORKFLOW).toContain("-PversionCode=${{ steps.version.outputs.code }}");
  });

  it("is signed only from secrets, refuses to run signed without them, and leaves no key behind", () => {
    for (const s of ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
      expect(WORKFLOW).toContain(`secrets.${s}`);
    }
    expect(WORKFLOW).toMatch(/- name: Forget the keystore\s+if: always\(\)/);
    expect(read(".gitignore")).toMatch(/android\/keystore\.properties/);
  });

  it("ships analytics in a signed build: the key is required and checked in the bundle", () => {
    expect(WORKFLOW).toContain('[ -z "$PH" ] && missing="$missing POSTHOG_KEY"');
    expect(WORKFLOW).toMatch(/- name: Analytics key is in the bundle\s+if: env\.SIGNED == 'true'/);
    expect(WORKFLOW).toContain("VITE_POSTHOG_KEY: ${{ secrets.POSTHOG_KEY }}");
  });

  it("runs the whole gate before a signed build", () => {
    for (const step of ["Typecheck", "Tests", "Lint"]) {
      expect(WORKFLOW).toMatch(new RegExp(`- name: ${step}\\s+if: env\\.SIGNED == 'true'`));
    }
  });

  it("checks the shipped manifest, the 16 KB rule and that Admin is not forced on", () => {
    expect(WORKFLOW).toContain("- name: Release manifest");
    expect(WORKFLOW).toContain("node scripts/check-16kb.mjs android/app/build/outputs/bundle/release/app-release.aab");
    expect(WORKFLOW).toContain("- name: Admin is not forced on");
  });
});

describe("analytics", () => {
  it("asks PostHog to skip GeoIP on every event, so no location is collected", () => {
    const src = read("src/lib/analytics.ts");
    expect(src).toMatch(/posthog\.register\(\{ \$geoip_disable: true \}\);\s*client = posthog;/);
  });
});

describe("the Android project", () => {
  it("answers Test Lab's game-loop launch in debug builds only", () => {
    expect(read("android/app/src/main/AndroidManifest.xml")).not.toContain('android:name="com.google.intent.action.TEST_LOOP"');
    expect(existsSync("android/app/src/debug/AndroidManifest.xml")).toBe(true);
    expect(read("android/app/src/debug/AndroidManifest.xml")).toContain('android:name="com.google.intent.action.TEST_LOOP"');
  });
});

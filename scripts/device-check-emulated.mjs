// The device check (DEVICE_LAB.md) on emulated 2022 phones, for CI.
//
// Serves the production build, opens it in headless Chromium dressed as a
// phone of the tier (its screen, touch, user agent) with the CPU slowed by the
// tier's factor, runs the in-app device check through its CI hook, and writes
// the report. Frame rate is reported, not judged: Chromium here draws WebGL on
// a software GPU, two frames a second on any CPU, so only a real phone's rate
// (Firebase Test Lab) means anything. What this does judge is everything else
// a slow phone can break: the boot, the menu and the boards showing, the
// fences being taken, and no error on the way.
//
//   node scripts/device-check-emulated.mjs <tier> [--out dir]
//
// CHROMIUM_PATH picks the browser binary; otherwise Playwright's own.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

/** 2022 phones, from the top of the range to the bottom. cpu: how many times slower than this machine. */
export const TIERS = {
  "flagship-2022": {
    phone: "Pixel 7 class", cpu: 2,
    viewport: { width: 412, height: 915 },
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
  "mid-2022": {
    phone: "Galaxy A53 class", cpu: 4,
    viewport: { width: 412, height: 915 },
    userAgent: "Mozilla/5.0 (Linux; Android 12; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
  "budget-2022": {
    phone: "Galaxy A13 class", cpu: 6,
    viewport: { width: 360, height: 800 },
    userAgent: "Mozilla/5.0 (Linux; Android 12; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
};

const PORT = 4317;
const RUN_LIMIT_MS = 6 * 60 * 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function serve() {
  const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    stdio: "ignore", detached: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) {
        return server;
      }
    } catch {
      // Not up yet.
    }
    await sleep(300);
  }
  throw new Error("the preview server did not start");
}

function summaryLines(tierName, tier, result) {
  const lines = [
    `### ${result.pass ? "✅" : "❌"} ${tierName} (${tier.phone}, CPU ${tier.cpu}x slower)`,
    "",
    `Boot to menu: ${result.bootMs === null ? "never" : `${(result.bootMs / 1000).toFixed(1)}s`}; menu pixels ${result.menu ? `${result.menu.lit}/${result.menu.total}` : "unread"}`,
    "",
    "| Map | Board pixels | Fence | Renderer | Frames (reported, not judged) |",
    "|---|---|---|---|---|",
    ...result.maps.map(m => `| ${m.level} | ${m.board ? `${m.board.lit}/${m.board.total}` : "unread"} | ${m.fenceTaken ? "taken" : "NOT taken"} | ${m.tier} | ${m.frames.fps} fps, p95 ${m.frames.p95Ms}ms |`),
    "",
  ];
  for (const f of result.failures) {
    lines.push(`- ❌ ${f}`);
  }
  for (const w of result.warnings) {
    lines.push(`- ⚠️ ${w}`);
  }
  for (const e of result.errors) {
    lines.push(`- error: \`${e.slice(0, 300)}\``);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const tierName = process.argv[2];
  const tier = TIERS[tierName];
  if (!tier) {
    console.error(`usage: device-check-emulated.mjs <${Object.keys(TIERS).join("|")}> [--out dir]`);
    process.exit(2);
  }
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx > 0 ? process.argv[outIdx + 1] : "device-check-results";
  mkdirSync(outDir, { recursive: true });

  const server = await serve();
  let browser = null;
  let result = null;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      // The splash lifts by itself where sound needs no tap, as in the app.
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({
      viewport: tier.viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: tier.userAgent,
    });
    const page = await context.newPage();
    page.on("pageerror", e => console.error("pageerror:", e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: tier.cpu });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    const evaluate = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

    // The hook waits for the menu itself; a splash still asking for a tap
    // after a while gets one, the way a player would give it.
    await sleep(12000);
    if (await evaluate('!!document.getElementById("boot-splash")')) {
      const { width, height } = tier.viewport;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: width / 2, y: height / 2 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await evaluate("window.__devendStartDeviceCheck({ judgeFrames: false })");
    const since = Date.now();
    while (Date.now() - since < RUN_LIMIT_MS) {
      await sleep(3000);
      const state = JSON.parse(await evaluate("JSON.stringify(window.__devendDeviceCheck ?? null)"));
      if (state?.status === "done") {
        result = state.result;
        break;
      }
    }
    await page.screenshot({ path: join(outDir, `${tierName}.png`) });
  } finally {
    await browser?.close();
    try {
      process.kill(-server.pid);
    } catch {
      server.kill();
    }
  }

  if (!result) {
    console.error(`${tierName}: the device check did not finish within ${RUN_LIMIT_MS / 60000} minutes`);
    process.exit(1);
  }
  writeFileSync(join(outDir, `${tierName}.json`), JSON.stringify({ tier: tierName, ...tier, result }, null, 2));
  const summary = summaryLines(tierName, tier, result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  process.exit(result.pass ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

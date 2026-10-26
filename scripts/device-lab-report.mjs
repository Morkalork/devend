// Read Test Lab's results for the device check (DEVICE_LAB.md) and say what
// each phone did.
//
// Test Lab stores one directory per device. In it, the game loop's results
// file holds the report the app wrote (TestLoopPlugin.java); the logcat holds
// the same report in numbered pieces, used when the file is missing. A phone
// with neither never finished the check: that is a failure too, and the run's
// video in the Test Lab console shows how far it got.
//
//   node scripts/device-lab-report.mjs <downloaded results dir>
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The report, put back together from the log's DEVICE_CHECK_RESULT pieces, or null. */
export function resultFromLogcat(text) {
  const pieces = new Map();
  let total = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/DEVICE_CHECK_RESULT (\d+)\/(\d+) (.*)$/);
    if (m) {
      pieces.set(Number(m[1]), m[3]);
      total = Number(m[2]);
    }
  }
  if (total === 0 || pieces.size !== total) {
    return null;
  }
  try {
    return JSON.parse([...Array(total)].map((_, i) => pieces.get(i + 1)).join(""));
  } catch {
    return null;
  }
}

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...filesUnder(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

/** Each device directory's report, from the results file or else the log. */
export function readDevices(root) {
  const devices = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    const files = filesUnder(dir);
    let result = null;
    let from = "none";
    for (const f of files.filter(p => /game_loop_results\/.*\.json$/.test(p.replace(/\\/g, "/")))) {
      try {
        result = JSON.parse(readFileSync(f, "utf8"));
        from = "results file";
        break;
      } catch {
        // An empty or half-written file: try the log.
      }
    }
    if (!result) {
      const logcat = files.find(p => /logcat$/.test(p));
      if (logcat) {
        result = resultFromLogcat(readFileSync(logcat, "utf8"));
        from = result ? "logcat" : "none";
      }
    }
    if (files.length > 0) {
      devices.push({ device: name, result, from });
    }
  }
  return devices;
}

/** Markdown for the job summary, and whether every phone passed. Pure, for the tests. */
export function summarize(devices) {
  const lines = ["## Device lab: the device check on real phones", ""];
  let pass = devices.length > 0;
  if (devices.length === 0) {
    lines.push("No device results were found.");
  }
  for (const { device, result, from } of devices) {
    if (!result) {
      pass = false;
      lines.push(`### ❌ ${device}`, "", "No report: the check did not finish. The run's video in the Test Lab console shows how far it got.", "");
      continue;
    }
    pass = pass && result.pass;
    const gpu = result.device?.gpu ?? "GPU unknown";
    lines.push(
      `### ${result.pass ? "✅" : "❌"} ${device}`,
      "",
      `${gpu}; ${result.device?.screen} at ${result.device?.dpr}x; ${result.device?.cores ?? "?"} cores; boot to menu ${result.bootMs === null ? "never" : `${(result.bootMs / 1000).toFixed(1)}s`} (report from the ${from})`,
      "",
      "| Map | fps (median) | p95 frame | under 30 fps | Board | Fence | Renderer |",
      "|---|---|---|---|---|---|---|",
      ...(result.maps ?? []).map(m => `| ${m.level} | ${m.frames.fps} | ${m.frames.p95Ms}ms | ${Math.round(m.frames.slowShare * 100)}% | ${m.board ? `${m.board.lit}/${m.board.total}` : "unread"} | ${m.fenceTaken ? "taken" : "NOT taken"} | ${m.tier} |`),
      "",
      ...(result.failures ?? []).map(f => `- ❌ ${f}`),
      ...(result.warnings ?? []).map(w => `- ⚠️ ${w}`),
      ...(result.renderer ?? []).map(r => `- renderer: ${r}`),
      ...(result.errors ?? []).map(e => `- error: \`${String(e).slice(0, 300)}\``),
      "",
    );
  }
  return { markdown: lines.join("\n") + "\n", pass };
}

function main() {
  const root = process.argv[2];
  if (!root || !existsSync(root)) {
    console.error("usage: device-lab-report.mjs <downloaded results dir>");
    process.exit(2);
  }
  const { markdown, pass } = summarize(readDevices(root));
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  process.exit(pass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

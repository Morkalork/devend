// Pick Test Lab devices from the wishlist (device-lab.json, DEVICE_LAB.md).
//
// Reads the catalogue that `gcloud firebase test android models list
// --format=json` prints and the wishlist, and prints the `--device` flags for
// `gcloud firebase test android run`, one per line. Fails, listing every
// physical phone the catalogue has, when fewer than `min` wishes are found, so
// the wishlist can be fixed from the job log.
//
//   node scripts/device-lab-pick.mjs <catalogue.json> [device-lab.json]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The newest Android a model offers, as Test Lab names it ("34"). */
function newestVersion(model) {
  const versions = [...(model.supportedVersionIds ?? [])];
  versions.sort((a, b) => Number(b) - Number(a));
  return versions[0] ?? null;
}

function matches(model, needle) {
  const n = needle.toLowerCase();
  return (model.id ?? "").toLowerCase() === n || (model.name ?? "").toLowerCase().includes(n);
}

/**
 * Wishes in order, each answered by the first match the catalogue has among
 * its physical phones; a model is used once. Pure, for the tests.
 */
export function pickDevices(catalogue, wishlist) {
  const phones = catalogue.filter(m => m.form === "PHYSICAL" && (m.formFactor ?? "PHONE") === "PHONE" && newestVersion(m));
  const picked = [];
  const missed = [];
  for (const wish of wishlist.wishes) {
    let found = null;
    for (const needle of wish.match) {
      found = phones.find(m => matches(m, needle) && !picked.some(p => p.model === m.id));
      if (found) {
        break;
      }
    }
    if (found) {
      picked.push({ model: found.id, name: found.name, version: newestVersion(found), why: wish.why });
    } else {
      missed.push(wish.why);
    }
    if (picked.length >= wishlist.max) {
      break;
    }
  }
  return { picked, missed, enough: picked.length >= wishlist.min, phones };
}

/** The flags for `gcloud firebase test android run`. */
export function deviceFlags(picked) {
  return picked.map(p => `--device=model=${p.model},version=${p.version},locale=en,orientation=portrait`);
}

function main() {
  const [catPath, listPath = "device-lab.json"] = process.argv.slice(2);
  const catalogue = JSON.parse(readFileSync(catPath, "utf8"));
  const wishlist = JSON.parse(readFileSync(listPath, "utf8"));
  const { picked, missed, enough, phones } = pickDevices(catalogue, wishlist);
  for (const p of picked) {
    console.error(`picked ${p.model} (${p.name}, Android API ${p.version}) for ${p.why}`);
  }
  for (const m of missed) {
    console.error(`not in the catalogue: ${m}`);
  }
  if (!enough) {
    console.error(`\nOnly ${picked.length} of the ${wishlist.min} needed. Physical phones Test Lab has:`);
    for (const m of phones) {
      console.error(`  ${m.id}: ${m.name} (API ${(m.supportedVersionIds ?? []).join(", ")})`);
    }
    process.exit(1);
  }
  console.log(deviceFlags(picked).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

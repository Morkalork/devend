// Applies the portrait splash art and prunes unused landscape splashes.
//
// The app is locked to portrait (AndroidManifest screenOrientation), so the
// landscape splash drawables `@capacitor/assets` generates never display.
// This script overwrites every portrait splash.png with assets/banner_portrait.png
// (cover-fit to each density's size) and deletes the landscape ones.
//
// Run AFTER `npx @capacitor/assets generate --android`. Android still selects the
// right density bucket automatically — no AndroidManifest change is needed.
import { readFile, rm, rmdir, readdir } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

const BG = '#0a0f0a';
const RES = 'android/app/src/main/res';

const portrait = await readFile('assets/banner_portrait.png');

let applied = 0;
let removed = 0;
for await (const file of glob(`${RES}/drawable*/splash.png`)) {
  const meta = await sharp(file).metadata();
  if (meta.width >= meta.height) {
    // Landscape bucket — unused under a portrait lock. Drop it (and the folder
    // if it only held this splash).
    await rm(file);
    const dir = dirname(file);
    if ((await readdir(dir)).length === 0) await rmdir(dir);
    removed++;
    continue;
  }
  const out = await sharp(portrait)
    .resize(meta.width, meta.height, { fit: 'cover' })
    .flatten({ background: BG })
    .png()
    .toBuffer();
  await sharp(out).toFile(file);
  applied++;
}

console.log(`Portrait splash applied to ${applied} drawables; removed ${removed} landscape splash drawables.`);

// Builds Capacitor + Play Store source images from the artwork in assets/:
//   assets/icon.png             — square app icon (>=1024x1024)
//   assets/banner_landscape.png — OPTIONAL wide key art (>=1024x500) for the
//                                 Play listing feature graphic. The app is
//                                 portrait-only, but Play still requires a
//                                 landscape feature graphic, so it needs its own
//                                 wide source — the in-app portrait splash can't
//                                 fill it without ugly cropping. (This image is
//                                 NOT used as an in-app splash; apply-splash.mjs
//                                 only consumes banner_portrait.png.)
//
// Outputs:
//   assets/splash.png / splash-dark.png — 2732x2732 splash (icon on brand bg),
//       consumed by `npx @capacitor/assets generate`.
//   assets/play/icon-512.png            — Play listing icon (512x512).
//   assets/play/feature-graphic.png     — Play feature graphic (1024x500),
//       only (re)generated when assets/banner_landscape.png exists.
import { mkdir, access } from 'node:fs/promises';
import sharp from 'sharp';

const BG = '#0a0f0a';
await mkdir('assets/play', { recursive: true });

const exists = async (p) => access(p).then(() => true, () => false);

// Splash: brand background with the app icon centred at ~30% width.
const logo = await sharp('assets/icon.png')
  .resize(820, 820, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer();
const splashBuf = await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
  .composite([{ input: logo, gravity: 'centre' }])
  .png().toBuffer();
await sharp(splashBuf).toFile('assets/splash.png');
await sharp(splashBuf).toFile('assets/splash-dark.png');

// Play listing icon — 512x512 from the square source.
await sharp('assets/icon.png').resize(512, 512, { fit: 'cover' })
  .png().toFile('assets/play/icon-512.png');

// Play feature graphic — 1024x500 from the wide landscape source if present.
let wroteFeature = false;
if (await exists('assets/banner_landscape.png')) {
  await sharp('assets/banner_landscape.png').resize(1024, 500, { fit: 'cover' })
    .flatten({ background: BG }).png().toFile('assets/play/feature-graphic.png');
  wroteFeature = true;
}

console.log(
  'Wrote assets/splash.png, assets/splash-dark.png, assets/play/icon-512.png' +
  (wroteFeature
    ? ', assets/play/feature-graphic.png'
    : '\n(skipped feature-graphic: add assets/banner_landscape.png — a >=1024x500 wide image — to (re)generate it)')
);

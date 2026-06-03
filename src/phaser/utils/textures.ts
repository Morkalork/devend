/**
 * Phaser texture generation — bakes procedural ball and board visuals
 * into texture assets during BootScene preload, replacing per-frame Canvas 2D rendering.
 */
import Phaser from 'phaser';

/** Bake a ball base texture (glow + gradient sphere) and specular layer for a given color. */
export function bakeBallTextures(scene: Phaser.Scene, color: string): void {
  const colorInt = parseInt(color.slice(1), 16);
  const r = (colorInt >> 16) & 0xff;
  const g = (colorInt >> 8) & 0xff;
  const b = colorInt & 0xff;

  const radius = 32; // standard ball world radius; bake at 2x scale for quality
  const size = radius * 2 + 64; // glow + margin
  const halfSize = size / 2;

  // ── Ball base (outer glow + 3D gradient) ──────────────────────────────────
  const baseGfx = scene.make.graphics({ x: 0, y: 0, add: false });
  baseGfx.setScale(2);

  // Outer glow
  const outerGlow = baseGfx.createGradientStyle(
    {
      x: halfSize,
      y: halfSize,
      radius: radius + 20,
    },
    [
      Phaser.Display.Color.GetColor(r, g, b),
      Phaser.Display.Color.GetColor(r, g, b),
      Phaser.Display.Color.GetColor(0, 0, 0),
    ],
    [0, 0.4, 1],
    false,
  );
  baseGfx.fillCircleShape(
    new Phaser.Geom.Circle(halfSize, halfSize, radius + 20),
  );
  baseGfx.setAlpha(0.3);

  // 3D sphere gradient
  const baseGrad = baseGfx.createGradientStyle(
    {
      x: halfSize - radius * 0.3,
      y: halfSize - radius * 0.3,
      radius: radius * 1.3,
    },
    [
      Phaser.Display.Color.GetColor(
        Math.min(255, r + 50),
        Math.min(255, g + 50),
        Math.min(255, b + 50),
      ),
      Phaser.Display.Color.GetColor(r, g, b),
      Phaser.Display.Color.GetColor(Math.max(0, r - 100), Math.max(0, g - 100), Math.max(0, b - 100)),
    ],
    [0, 0.5, 1],
    false,
  );
  baseGfx.fillCircleShape(new Phaser.Geom.Circle(halfSize, halfSize, radius));
  baseGfx.setAlpha(1);

  baseGfx.generateTexture(`ball-base-${color}`, size, size);
  baseGfx.destroy();

  // ── Specular glare (white highlight) ──────────────────────────────────────
  const specGfx = scene.make.graphics({ x: 0, y: 0, add: false });
  specGfx.setScale(2);

  // Glare gradient
  const glareGrad = specGfx.createGradientStyle(
    {
      x: halfSize - radius * 0.4,
      y: halfSize - radius * 0.4,
      radius: radius * 0.6,
    },
    [0xffffff, 0xffffff, 0x000000],
    [0, 0.3, 1],
    false,
  );
  specGfx.fillCircleShape(
    new Phaser.Geom.Circle(halfSize - radius * 0.4, halfSize - radius * 0.4, radius * 0.6),
  );
  specGfx.setAlpha(0.6);

  // Sharp dot
  specGfx.fillCircleShape(
    new Phaser.Geom.Circle(halfSize - radius * 0.35, halfSize - radius * 0.35, radius * 0.12),
  );
  specGfx.setAlpha(0.7);

  specGfx.generateTexture(`ball-specular-${color}`, size, size);
  specGfx.destroy();
}

/** Bake a hex overlay texture (circuit-board pattern). */
export function bakeHexOverlay(scene: Phaser.Scene, color: string): void {
  const hexGfx = scene.make.graphics({ x: 0, y: 0, add: false });
  const SIZE = 128;
  const R = 10;
  const s3 = Math.sqrt(3);

  hexGfx.setDefaultStyles({
    lineStyle: { width: 2, color: parseInt(color.slice(1), 16) },
  });

  hexGfx.setAlpha(0.5);

  for (let col = -1; col <= Math.ceil(SIZE / (R * 1.5)) + 1; col++) {
    for (let row = -1; row <= Math.ceil(SIZE / (R * s3)) + 1; row++) {
      const cx = col * 1.5 * R;
      const cy = row * R * s3 + (col % 2 === 0 ? 0 : (R * s3) / 2);

      const points: Phaser.Types.Math.Vector2Like[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        points.push({
          x: cx + R * Math.cos(a),
          y: cy + R * Math.sin(a),
        });
      }
      hexGfx.strokePoints(points, true);
    }
  }

  hexGfx.generateTexture(`hex-overlay-${color}`, SIZE, SIZE);
  hexGfx.destroy();
}

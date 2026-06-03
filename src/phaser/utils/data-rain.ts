/**
 * Data-rain effect — ambient CRT background animation.
 * Simulates falling code/text lines with neon glow, similar to the React version.
 */
import Phaser from 'phaser';

const DATA_CHARS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const CHARS_PER_LINE = 40;

interface DataRainLine {
  text: Phaser.GameObjects.Text;
  x: number;
  y: number;
  speed: number;
  alpha: number;
}

export function createDataRain(scene: Phaser.Scene, lineCount: number = 12): DataRainLine[] {
  const lines: DataRainLine[] = [];

  for (let i = 0; i < lineCount; i++) {
    const x = Math.random() * 900;
    const y = Math.random() * 900 - 200;
    const speed = 20 + Math.random() * 40;
    const opacity = 0.1 + Math.random() * 0.15;

    const chars = Array.from(
      { length: CHARS_PER_LINE },
      () => DATA_CHARS[Math.floor(Math.random() * DATA_CHARS.length)]
    ).join('');

    const text = scene.add.text(x, y, chars, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#00ff88',
    });

    text.setAlpha(opacity);
    text.setOrigin(0, 0);
    text.setDepth(-10);

    lines.push({
      text,
      x,
      y,
      speed,
      alpha: opacity,
    });
  }

  return lines;
}

export function updateDataRain(lines: DataRainLine[], deltaTime: number): void {
  for (const line of lines) {
    line.y += line.speed * (deltaTime / 1000);

    // Reset to top when off-screen
    if (line.y > 950) {
      line.y = -50;
    }

    line.text.setY(line.y);
  }
}

export function destroyDataRain(lines: DataRainLine[]): void {
  for (const line of lines) {
    line.text.destroy();
  }
}

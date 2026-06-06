/**
 * SettingsScene — options & accessibility.
 *
 * Surfaces the persisted SettingsStore: master volume, mute, difficulty,
 * visual toggles (CRT / data-rain / particles) and accessibility options
 * (colorblind mode, large text). All changes write through the store and
 * persist to localStorage immediately; audio applies live, visual toggles
 * apply the next time GameScene is created.
 */
import Phaser from 'phaser';
import { settingsStore, Difficulty, GameSettings } from '../stores';

const GREEN = 0x00ff88;
const GREEN_STR = '#00ff88';
const DIM_STR = '#666666';
const OFF = 0x555555;

const LABEL_X = 140;
const CTRL_X = 560;

export class SettingsScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SettingsScene' });
  }

  create(): void {
    this.add.rectangle(450, 450, 900, 900, 0x0a0a0a).setOrigin(0.5);

    this.add
      .text(450, 70, 'SETTINGS', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: GREEN_STR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.sectionLabel(150, 'AUDIO');
    this.createSlider(195, 'Master Volume', 'masterVolume');
    this.createToggle(245, 'Mute', 'muted');

    this.sectionLabel(310, 'GAMEPLAY');
    this.createSegmented(355, 'Difficulty', 'difficulty', [
      { label: 'Easy', value: 'easy' },
      { label: 'Normal', value: 'normal' },
      { label: 'Hard', value: 'hard' },
    ]);

    this.sectionLabel(420, 'VISUALS');
    this.createToggle(465, 'CRT Effect', 'crtEnabled');
    this.createToggle(510, 'Data Rain', 'dataRainEnabled');
    this.createToggle(555, 'Particles', 'particlesEnabled');

    this.sectionLabel(620, 'ACCESSIBILITY');
    this.createToggle(665, 'Colorblind Mode', 'colorblindMode');
    this.createToggle(710, 'Large Text', 'largeText');

    // Back button
    const back = this.add
      .text(450, 800, '‹ Back to Menu', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: GREEN_STR,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setColor('#ffff00'));
    back.on('pointerout', () => back.setColor(GREEN_STR));
    back.on('pointerdown', () => this.scene.start('MenuScene'));

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));

    // Visual-change hint
    this.add
      .text(450, 845, 'Visual changes apply on the next game.', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#555555',
      })
      .setOrigin(0.5);
  }

  // ── Control builders ────────────────────────────────────────────────────────

  private sectionLabel(y: number, text: string): void {
    this.add.text(LABEL_X - 20, y, text, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: DIM_STR,
      fontStyle: 'bold',
    });
  }

  private rowLabel(y: number, text: string): void {
    this.add.text(LABEL_X, y, text, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#cccccc',
    });
  }

  private createToggle(y: number, label: string, key: keyof GameSettings): void {
    this.rowLabel(y, label);

    const pill = this.add.rectangle(CTRL_X + 30, y + 9, 64, 26, OFF, 1).setOrigin(0.5);
    const knob = this.add.circle(CTRL_X + 30, y + 9, 10, 0xffffff).setOrigin(0.5);
    const stateText = this.add
      .text(CTRL_X + 90, y, '', { fontFamily: 'monospace', fontSize: '14px', color: DIM_STR })
      .setOrigin(0, 0);

    const render = () => {
      const on = settingsStore.get(key) as boolean;
      pill.setFillStyle(on ? GREEN : OFF, 1);
      knob.x = on ? CTRL_X + 47 : CTRL_X + 13;
      stateText.setText(on ? 'ON' : 'OFF').setColor(on ? GREEN_STR : DIM_STR);
    };
    render();

    pill.setInteractive({ useHandCursor: true });
    pill.on('pointerdown', () => {
      settingsStore.set(key, !(settingsStore.get(key) as boolean) as any);
      render();
    });
  }

  private createSlider(y: number, label: string, key: keyof GameSettings): void {
    this.rowLabel(y, label);

    const trackX = CTRL_X;
    const trackW = 200;
    const cy = y + 9;

    this.add.rectangle(trackX, cy, trackW, 4, OFF, 1).setOrigin(0, 0.5);
    const fill = this.add.rectangle(trackX, cy, 0, 4, GREEN, 1).setOrigin(0, 0.5);
    const handle = this.add.circle(trackX, cy, 11, GREEN).setOrigin(0.5);
    const valueText = this.add
      .text(trackX + trackW + 20, y, '', { fontFamily: 'monospace', fontSize: '14px', color: GREEN_STR })
      .setOrigin(0, 0);

    const render = () => {
      const v = settingsStore.get(key) as number;
      handle.x = trackX + v * trackW;
      fill.width = v * trackW;
      valueText.setText(`${Math.round(v * 100)}%`);
    };
    render();

    handle.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(handle);
    handle.on('drag', (_p: Phaser.Input.Pointer, dragX: number) => {
      const clamped = Phaser.Math.Clamp(dragX, trackX, trackX + trackW);
      const v = (clamped - trackX) / trackW;
      settingsStore.set(key, v as any);
      render();
    });
  }

  private createSegmented(
    y: number,
    label: string,
    key: keyof GameSettings,
    options: { label: string; value: Difficulty }[]
  ): void {
    this.rowLabel(y, label);

    const btns: { value: Difficulty; text: Phaser.GameObjects.Text }[] = [];
    let x = CTRL_X;

    const render = () => {
      const current = settingsStore.get(key) as Difficulty;
      for (const b of btns) {
        const sel = b.value === current;
        b.text.setColor(sel ? GREEN_STR : DIM_STR);
        b.text.setFontStyle(sel ? 'bold' : 'normal');
      }
    };

    for (const opt of options) {
      const t = this.add
        .text(x, y, opt.label, { fontFamily: 'monospace', fontSize: '16px', color: DIM_STR })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        settingsStore.set(key, opt.value as any);
        render();
      });
      btns.push({ value: opt.value, text: t });
      x += t.width + 28;
    }
    render();
  }
}

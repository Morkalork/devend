/**
 * MenuScene — Phase 4: Main menu with animations.
 *
 * Provides navigation to start game, view achievements, or adjust settings.
 * Includes entrance animations and interactive button effects.
 */
import Phaser from 'phaser';
import { levelManagerStore } from '../stores';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    // Background
    this.add.rectangle(450, 450, 900, 900, 0x0a0a0a).setOrigin(0.5);

    // Title with entrance animation
    const title = this.add.text(450, 80, 'DEV/END', {
      fontFamily: 'monospace',
      fontSize: '64px',
      color: '#00ff88',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: title,
      alpha: 1,
      y: 100,
      duration: 600,
      ease: 'Power2.easeOut',
    });

    // Subtitle
    this.add.text(450, 170, 'Phaser Migration — Fully Polished', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5);

    // Play button
    const playBtn = this.createButton(450, 280, 'Play Game', () => {
      (levelManagerStore as any).resetToLevel?.(0);
      this.playButtonTransition(() => this.scene.start('AugmentScene'));
    });

    // Achievements button
    const achievBtn = this.createButton(450, 360, 'Achievements', () => {
      this.playButtonTransition(() => this.scene.start('AchievementsScene'));
    });

    // Phase 0 Spike Test button
    const spikeBtn = this.createButton(450, 440, 'Phase 0 Spike Test', () => {
      this.playButtonTransition(() => this.scene.start('SpikeScene'));
    });

    // Info text
    this.add.text(450, 750, 'Press ESC to return to React build (?phaser=0)', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#555555',
    }).setOrigin(0.5);

    this.input.keyboard?.on('keydown-ESC', () => {
      window.location.search = '';
    });
  }

  private createButton(
    x: number,
    y: number,
    text: string,
    callback: () => void
  ): Phaser.GameObjects.Text {
    const btn = this.add.text(x, y, text, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#00ff88',
    }).setOrigin(0.5);

    btn.setInteractive();
    btn.on('pointerdown', callback);

    // Hover effect
    btn.on('pointerover', () => {
      this.tweens.add({
        targets: btn,
        scale: 1.1,
        color: 0xffff00,
        duration: 200,
        ease: 'Quad.easeOut',
      });
    });

    btn.on('pointerout', () => {
      this.tweens.add({
        targets: btn,
        scale: 1,
        color: 0x00ff88,
        duration: 200,
        ease: 'Quad.easeOut',
      });
    });

    return btn;
  }

  private playButtonTransition(callback: () => void): void {
    const flash = this.add
      .rectangle(450, 450, 900, 900, 0x00ff88, 0)
      .setOrigin(0.5)
      .setDepth(5000);

    this.tweens.add({
      targets: flash,
      alpha: 0.5,
      duration: 300,
      ease: 'Power2.easeInOut',
      onComplete: () => {
        callback();
      },
    });
  }
}

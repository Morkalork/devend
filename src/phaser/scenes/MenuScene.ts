/**
 * MenuScene — Phase 4: Main menu screen.
 *
 * Provides navigation to start game, view achievements, or adjust settings.
 * Phase 4 will add full styling, animations, and rexUI containers.
 */
import Phaser from 'phaser';
import { levelManagerStore } from '../stores';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    this.add.text(450, 100, 'DEV/END', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#00ff88',
    }).setOrigin(0.5);

    this.add.text(450, 170, 'Phaser Migration Phase 4', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5);

    // Play button - starts at augment selection (which leads to game)
    const playBtn = this.add.text(450, 280, 'Play Game', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#00ff88',
    }).setOrigin(0.5);
    playBtn.setInteractive();
    playBtn.on('pointerdown', () => {
      // Reset level manager to level 1
      (levelManagerStore as any).resetToLevel?.(0);
      this.scene.start('AugmentScene');
    });

    // Achievements button
    const achievBtn = this.add.text(450, 340, 'Achievements', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#00ff88',
    }).setOrigin(0.5);
    achievBtn.setInteractive();
    achievBtn.on('pointerdown', () => this.scene.start('AchievementsScene'));

    // Phase 0 Spike Test button
    const spikeBtn = this.add.text(450, 400, 'Phase 0 Spike Test', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#00ff44',
    }).setOrigin(0.5);
    spikeBtn.setInteractive();
    spikeBtn.on('pointerdown', () => this.scene.start('SpikeScene'));

    this.add.text(450, 850, 'Press ESC to return to React build (?phaser=0)', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#00ff44',
    }).setOrigin(0.5);

    this.input.keyboard?.on('keydown-ESC', () => {
      window.location.search = '';
    });
  }
}

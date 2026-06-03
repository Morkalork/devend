/**
 * MenuScene — Phase 4 will port the full React WelcomeScreen here.
 * For Phase 1, this is a placeholder that proves the boot pipeline works.
 */
import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    this.add.text(450, 100, 'MENU SCENE', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#00ff88',
    }).setOrigin(0.5);

    this.add.text(450, 200, 'Phase 1: Boot complete', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#00ff88',
    }).setOrigin(0.5);

    // Test button to start game
    const gameBtn = this.add.text(450, 280, 'Play Phase 2 (GameScene)', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#00ff88',
    }).setOrigin(0.5);
    gameBtn.setInteractive();
    gameBtn.on('pointerdown', () => this.scene.start('GameScene'));

    // Test button to verify Phase 0 spike
    const spikeBtn = this.add.text(450, 350, 'Phase 0 Spike Test', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#00ff88',
    }).setOrigin(0.5);
    spikeBtn.setInteractive();
    spikeBtn.on('pointerdown', () => this.scene.start('SpikeScene'));

    this.add.text(450, 850, 'Press ESC to return to React build (?phaser=0)', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#00ff44',
    }).setOrigin(0.5);

    this.input.keyboard?.on('keydown-ESC', () => {
      // Redirect to non-phaser build
      window.location.search = '';
    });
  }
}

/**
 * AugmentScene — Phase 4: Augmentation/meta-progression choice screen.
 *
 * Shows available augments/modifiers that can be applied to the next run.
 * TODO: Full implementation deferred to later Phase 4 work.
 */
import Phaser from 'phaser';

export class AugmentScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AugmentScene' });
  }

  create(): void {
    // Title
    this.add.text(450, 100, 'AUGMENT SELECTION', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#00ff88',
    }).setOrigin(0.5);

    // Placeholder
    this.add.text(450, 300, '(Augment selection deferred to full Phase 4)', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5);

    // Start button
    const startBtn = this.add.text(450, 700, 'Start Run', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#00ff88',
    }).setOrigin(0.5);
    startBtn.setInteractive();
    startBtn.on('pointerdown', () => {
      this.scene.start('GameScene');
    });
  }
}

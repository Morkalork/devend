/**
 * AchievementsScene — Phase 4: Achievement/trophy display.
 *
 * Shows unlocked achievements and progression towards future milestones.
 * TODO: Full implementation deferred to later Phase 4 work.
 */
import Phaser from 'phaser';

export class AchievementsScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AchievementsScene' });
  }

  create(): void {
    // Title
    this.add.text(450, 100, 'ACHIEVEMENTS', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#00ff88',
    }).setOrigin(0.5);

    // Placeholder
    this.add.text(450, 300, '(Achievements deferred to full Phase 4)', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5);

    // Back button
    const backBtn = this.add.text(450, 700, 'Back to Menu', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#00ff88',
    }).setOrigin(0.5);
    backBtn.setInteractive();
    backBtn.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
  }
}

/**
 * ShopScene — Phase 4: Upgrade shop.
 *
 * TODO: Full implementation deferred to later Phase 4 work.
 * This is a scaffold showing the pattern for UI scenes that use stores.
 */
import Phaser from 'phaser';

export class ShopScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ShopScene' });
  }

  create(): void {
    // Title
    this.add.text(450, 100, 'UPGRADE SHOP', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#00ff88',
    }).setOrigin(0.5);

    // TODO: Load upgrades from store, render upgrade cards with stats
    this.add.text(450, 300, '(Upgrade shop deferred to full Phase 4)', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5);

    // Continue button
    const continueBtn = this.add.text(450, 700, 'Continue', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#00ff88',
    }).setOrigin(0.5);
    continueBtn.setInteractive();
    continueBtn.on('pointerdown', () => {
      this.scene.start('GameScene');
    });
  }
}

/**
 * ResultScene — Phase 4: Level completion screen.
 *
 * Shows score breakdown, rewards, and options to continue or return to menu.
 * This scene demonstrates the UI pattern using Phaser text elements and stores.
 *
 * TODO: Phase 4 will add Framer-style tweens, rexUI containers, and full Polish.
 */
import Phaser from 'phaser';
import { scoringStore } from '../stores';

export class ResultScene extends Phaser.Scene {
  private levelNumber = 1;
  private score = 0;
  private breakdown: any = null;

  constructor() {
    super({ key: 'ResultScene' });
  }

  init(data: { levelNumber?: number; score?: number; breakdown?: any }): void {
    this.levelNumber = data.levelNumber || 1;
    this.score = data.score || 0;
    this.breakdown = data.breakdown || {};
  }

  create(): void {
    // Background
    this.add
      .rectangle(450, 450, 900, 900, 0x0a0a0a)
      .setOrigin(0.5);

    // Title
    this.add.text(450, 100, 'LEVEL COMPLETE', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#00ff88',
    }).setOrigin(0.5);

    // Level number
    this.add.text(450, 170, `Level ${this.levelNumber}`, {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#00ff44',
    }).setOrigin(0.5);

    // Score display
    this.add.text(450, 250, 'SCORE', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#00ff88',
    }).setOrigin(0.5);

    this.add.text(450, 300, `+${this.score}`, {
      fontFamily: 'monospace',
      fontSize: '56px',
      color: '#ffff00',
    }).setOrigin(0.5);

    // Score breakdown (if available)
    let y = 380;
    if (this.breakdown && this.breakdown.breakdown) {
      const bd = this.breakdown.breakdown;
      this.add.text(450, y, 'BREAKDOWN', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#00ff88',
      }).setOrigin(0.5);

      y += 40;
      if (bd.base) {
        this.add.text(430, y, `Base: ${Math.round(bd.base)}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#00ff44',
        }).setOrigin(1, 0);
      }

      y += 30;
      if (bd.bonus) {
        this.add.text(430, y, `Bonus: +${Math.round(bd.bonus)}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#44ff44',
        }).setOrigin(1, 0);
      }

      y += 30;
      if (bd.penalty) {
        this.add.text(430, y, `Penalty: -${Math.round(bd.penalty)}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ff4444',
        }).setOrigin(1, 0);
      }
    }

    // Continue button
    const continueBtn = this.add.text(450, 700, 'Continue', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#00ff88',
    }).setOrigin(0.5);
    continueBtn.setInteractive();
    continueBtn.on('pointerdown', () => {
      // TODO: Advance to upgrade shop, then next level
      this.scene.start('MenuScene');
    });

    // Menu button
    const menuBtn = this.add.text(450, 780, 'Back to Menu', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#00ff44',
    }).setOrigin(0.5);
    menuBtn.setInteractive();
    menuBtn.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
  }
}

/**
 * ResultScene — Phase 4: Level completion screen with animations.
 *
 * Shows score breakdown, rewards, and options to continue or return to menu.
 * Includes entrance animations and score reveal effects.
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
    this.add.rectangle(450, 450, 900, 900, 0x0a0a0a).setOrigin(0.5);

    // Title with entrance
    const title = this.add.text(450, 100, 'LEVEL COMPLETE', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#00ff88',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0).setScale(0.8);

    this.tweens.add({
      targets: title,
      alpha: 1,
      scale: 1,
      duration: 500,
      ease: 'Back.easeOut',
    });

    // Level number
    this.add.text(450, 170, `Level ${this.levelNumber}`, {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#00ff44',
    }).setOrigin(0.5);

    // Score display with counter animation
    const scoreLabel = this.add.text(450, 250, 'SCORE', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#00ff88',
    }).setOrigin(0.5);

    const scoreDisplay = this.add.text(450, 320, '0', {
      fontFamily: 'monospace',
      fontSize: '56px',
      color: '#ffff00',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Animate score counter
    let displayedScore = 0;
    const increment = Math.max(1, Math.floor(this.score / 30));
    const counter = this.time.addEvent({
      delay: 30,
      repeat: Math.floor(this.score / increment),
      callback: () => {
        displayedScore = Math.min(displayedScore + increment, this.score);
        scoreDisplay.setText(`+${displayedScore}`);
        if (displayedScore >= this.score) {
          counter.remove();
        }
      },
    });

    // Score breakdown
    let y = 400;
    if (this.breakdown && this.breakdown.breakdown) {
      const bd = this.breakdown.breakdown;

      this.add.text(450, y, 'BREAKDOWN', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#00ff88',
      }).setOrigin(0.5);

      y += 40;
      if (bd.base) {
        const baseText = this.add.text(430, y, `Base: ${Math.round(bd.base)}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#00ff44',
          alpha: 0,
        }).setOrigin(1, 0);

        this.tweens.add({
          targets: baseText,
          alpha: 1,
          x: 430,
          duration: 300,
          delay: 400,
          ease: 'Quad.easeOut',
        });
      }

      y += 30;
      if (bd.bonus) {
        const bonusText = this.add.text(430, y, `Bonus: +${Math.round(bd.bonus)}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#44ff44',
          alpha: 0,
        }).setOrigin(1, 0);

        this.tweens.add({
          targets: bonusText,
          alpha: 1,
          x: 430,
          duration: 300,
          delay: 600,
          ease: 'Quad.easeOut',
        });
      }

      y += 30;
      if (bd.penalty) {
        const penaltyText = this.add.text(430, y, `Penalty: -${Math.round(bd.penalty)}`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ff4444',
          alpha: 0,
        }).setOrigin(1, 0);

        this.tweens.add({
          targets: penaltyText,
          alpha: 1,
          x: 430,
          duration: 300,
          delay: 800,
          ease: 'Quad.easeOut',
        });
      }
    }

    // Continue button
    const continueBtn = this.add.text(450, 700, 'Continue', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#00ff88',
      alpha: 0,
    }).setOrigin(0.5);

    this.tweens.add({
      targets: continueBtn,
      alpha: 1,
      duration: 300,
      delay: 1200,
      ease: 'Quad.easeOut',
    });

    continueBtn.setInteractive();
    continueBtn.on('pointerdown', () => {
      this.playTransition(() => this.scene.start('MenuScene'));
    });

    // Hover effect
    continueBtn.on('pointerover', () => {
      this.tweens.add({
        targets: continueBtn,
        scale: 1.1,
        color: 0xffff00,
        duration: 200,
      });
    });

    continueBtn.on('pointerout', () => {
      this.tweens.add({
        targets: continueBtn,
        scale: 1,
        color: 0x00ff88,
        duration: 200,
      });
    });
  }

  private playTransition(callback: () => void): void {
    const flash = this.add
      .rectangle(450, 450, 900, 900, 0x00ff88, 0)
      .setOrigin(0.5)
      .setDepth(5000);

    this.tweens.add({
      targets: flash,
      alpha: 0.6,
      duration: 400,
      ease: 'Power2.easeInOut',
      onComplete: callback,
    });
  }
}

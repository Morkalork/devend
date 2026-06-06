/**
 * ShopScene — the between-levels upgrade lab.
 *
 * Lists upgrades from the boot-parsed `upgrades` registry, spends points from
 * the UpgradeStore, and installs them via GameModifiersStore (which is what the
 * in-game HUD stats and ball-speed actually read). Reachable from the level-win
 * loop (with a pending next level) and directly from the menu for browsing.
 */
import Phaser from 'phaser';
import { upgradeStore, gameModifiersStore } from '../stores';
import { UpgradeConfig, UpgradeTier } from '@/types/upgrade';

const TIER_COLOR: Record<UpgradeTier, number> = {
  Junior: 0x9aa7b4,
  Senior: 0x4aa3ff,
  Principal: 0xb069ff,
  Architect: 0xffb020,
  Wizard: 0x32ffc7,
};

const VIEW_TOP = 170;
const VIEW_BOTTOM = 760;
const CARD_H = 104;
const CARD_GAP = 12;
const CARD_W = 760;

export class ShopScene extends Phaser.Scene {
  private upgrades: UpgradeConfig[] = [];
  private hasNext = false;
  private pointsText!: Phaser.GameObjects.Text;
  private list!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;

  constructor() {
    super({ key: 'ShopScene' });
  }

  create(data: { hasNext?: boolean }): void {
    this.hasNext = !!data?.hasNext;
    this.scrollY = 0;
    this.upgrades = (this.registry.get('upgrades') as UpgradeConfig[]) || [];

    this.add.rectangle(450, 450, 900, 900, 0x0a0a0a).setOrigin(0.5);

    this.add
      .text(36, 70, 'UPGRADE LAB', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#00ff88',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5)
      .setShadow(0, 0, '#00ff88', 12);

    this.pointsText = this.add
      .text(864, 70, '', { fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(1, 0.5);
    this.refreshPoints();

    this.add
      .text(36, 120, 'Spend skill points to install upgrades for your runs.', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#88ffcc',
      })
      .setOrigin(0, 0.5);

    // Scrollable list with a viewport mask
    this.list = this.add.container(70, VIEW_TOP);
    const maskShape = this.make.graphics({});
    maskShape.fillRect(70, VIEW_TOP, CARD_W, VIEW_BOTTOM - VIEW_TOP);
    this.list.setMask(maskShape.createGeometryMask());

    this.renderList();

    // Wheel + drag scrolling
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.applyScroll(this.scrollY - dy * 0.5);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown && p.y > VIEW_TOP && p.y < VIEW_BOTTOM) {
        this.applyScroll(this.scrollY + (p.y - p.prevPosition.y));
      }
    });

    // Continue / Back
    const label = this.hasNext ? 'Continue ›' : '‹ Back to Menu';
    const btn = this.add
      .text(450, 805, label, { fontFamily: 'monospace', fontSize: '22px', color: '#00ff88', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffff00'));
    btn.on('pointerout', () => btn.setColor('#00ff88'));
    btn.on('pointerdown', () => this.scene.start(this.hasNext ? 'GameScene' : 'MenuScene'));

    this.input.keyboard?.on('keydown-ESC', () =>
      this.scene.start(this.hasNext ? 'GameScene' : 'MenuScene')
    );
  }

  private refreshPoints(): void {
    this.pointsText.setText(`◇ ${upgradeStore.getPoints()} pts`);
  }

  private applyScroll(y: number): void {
    this.scrollY = Phaser.Math.Clamp(y, -this.maxScroll, 0);
    this.list.y = VIEW_TOP + this.scrollY;
  }

  private renderList(): void {
    this.list.removeAll(true);

    const owned = new Set(gameModifiersStore.getOwnedUpgradeIds());
    const points = upgradeStore.getPoints();

    this.upgrades.forEach((u, i) => {
      const y = i * (CARD_H + CARD_GAP);
      this.list.add(this.buildCard(u, y, owned, points));
    });

    const contentH = this.upgrades.length * (CARD_H + CARD_GAP);
    this.maxScroll = Math.max(0, contentH - (VIEW_BOTTOM - VIEW_TOP));
    this.applyScroll(this.scrollY);
  }

  private buildCard(
    u: UpgradeConfig,
    y: number,
    owned: Set<string>,
    points: number
  ): Phaser.GameObjects.Container {
    const isOwned = owned.has(u.id);
    const prereqsMet = (u.prerequisites || []).every((p) => owned.has(p));
    const affordable = points >= u.cost;
    const buyable = !isOwned && prereqsMet && affordable;
    const tierColor = TIER_COLOR[u.tier] ?? 0x9aa7b4;

    const card = this.add.container(0, y);

    const borderColor = isOwned ? 0x00ff88 : !prereqsMet ? 0x444444 : buyable ? tierColor : 0x555555;
    const bg = this.add.graphics();
    bg.fillStyle(0x07140e, isOwned ? 0.9 : 0.7);
    bg.fillRoundedRect(0, 0, CARD_W, CARD_H, 8);
    bg.lineStyle(2, borderColor, isOwned ? 0.9 : 0.6);
    bg.strokeRoundedRect(0, 0, CARD_W, CARD_H, 8);
    card.add(bg);

    // Tier chip
    card.add(
      this.add
        .text(16, 14, u.tier.toUpperCase(), { fontFamily: 'monospace', fontSize: '11px', color: rgb(tierColor), fontStyle: 'bold' })
    );
    // Name
    card.add(
      this.add.text(16, 34, u.name, { fontFamily: 'monospace', fontSize: '20px', color: '#e8fff5', fontStyle: 'bold' })
    );
    // Description
    card.add(
      this.add.text(16, 64, u.description, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#9fd9c4',
        wordWrap: { width: CARD_W - 200 },
      })
    );

    // Right-side action / status
    const actionX = CARD_W - 20;
    if (isOwned) {
      card.add(this.add.text(actionX, CARD_H / 2, '✓ INSTALLED', tierTextStyle('#00ff88')).setOrigin(1, 0.5));
    } else if (!prereqsMet) {
      card.add(this.add.text(actionX, CARD_H / 2, '🔒 LOCKED', tierTextStyle('#888888')).setOrigin(1, 0.5));
    } else {
      const btn = this.add
        .text(actionX, CARD_H / 2, buyable ? `BUY · ${u.cost}` : `${u.cost} pts`, tierTextStyle(buyable ? '#00ff88' : '#778'))
        .setOrigin(1, 0.5);
      if (buyable) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setColor('#ffff00'));
        btn.on('pointerout', () => btn.setColor('#00ff88'));
        btn.on('pointerdown', () => this.purchase(u));
      }
      card.add(btn);
    }

    return card;
  }

  private purchase(u: UpgradeConfig): void {
    if (gameModifiersStore.isOwned(u.id)) return;
    if (!upgradeStore.spendPoints(u.cost)) return;
    gameModifiersStore.addUpgrade(u.id);
    this.refreshPoints();
    this.renderList();
  }
}

function rgb(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function tierTextStyle(color: string): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: 'monospace', fontSize: '16px', color, fontStyle: 'bold' };
}

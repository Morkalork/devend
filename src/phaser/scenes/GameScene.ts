/**
 * GameScene — Phase 2: Core gameplay.
 *
 * Instantiates the existing CanvasGameState, uses Matter for ball motion/wall
 * reflection, and keeps spaceGrid + regionOwnership authoritative for capture.
 *
 * Responsibilities:
 *   - Initialize game from level data (via managers)
 *   - Create Matter bodies for balls and walls
 *   - Handle input (cut drawing via pointer events)
 *   - Sync ball state with Matter each frame
 *   - Execute cut pipeline (rasterize, flood-fill, region removal, reassignment)
 *   - Manage WON state and level progression
 */
import Phaser from 'phaser';
import { levelManagerStore, settingsStore, gameModifiersStore, upgradeStore } from '../stores';
import { BOARD_WIDTH, BOARD_HEIGHT } from '@/lib/boardConstants';
import { createInitialGameData, InitialGameData } from '@/lib/initGame';
import { computeGameModifiers } from '@/hooks/useActiveModifiers';
import { LevelConfig } from '@/types/level';
import { Ball, Region, Vector2 } from '@/types/game';
import { Wall, castRayWithReflections } from '@/lib/wallGeometry';
import {
  rasterizeCutToGrid,
  findGridRegions,
  removeRegion,
  getRemainingPercent,
  getRegionCellPositions,
  worldToGridIndex,
  GridRegion,
} from '@/lib/spaceGrid';
import { reassignBallsToRegions, isBallInRegion } from '@/lib/regionOwnership';
import { pointInPolygon } from '@/lib/polygon';
import { playWallHitSound, playBallCollideSound, playFenceBreakSound, playBallLockSound, initAudio } from '@/lib/gameAudio';
import {
  createEffectEmitters,
  emitImpact,
  emitTrail,
  animateWallGrowth,
  playLevelCompleteAnimation,
  type EffectEmitters,
} from '../utils/effects';
import { applyCRTEffect } from '../utils/crt-pipeline';
import { createDataRain, updateDataRain, destroyDataRain, type DataRainLine } from '../utils/data-rain';

// Matter collision categories
const CAT_BALL = 0x0001;
const CAT_WALL = 0x0002;

interface BallView {
  ball: Ball;
  body: MatterJS.BodyType;
  sprite: Phaser.Physics.Matter.Sprite;
}

interface CutInProgress {
  start: Vector2;
  points: Vector2[];
  isActive: boolean;
}

export class GameScene extends Phaser.Scene {
  private gameData!: InitialGameData;
  private currentLevel!: LevelConfig;
  private ballViews: BallView[] = [];
  private wallBodies: MatterJS.BodyType[] = [];
  private regions: Region[] = [];
  private walls: Wall[] = [];
  private regionGroups = new Map<string, number>();
  private nextGroup = 1;

  // Cut tracking
  private cut: CutInProgress = { start: { x: 0, y: 0 }, points: [], isActive: false };
  private cutGraphics: Phaser.GameObjects.Graphics | null = null;
  private cuttingPointer = false;

  // Keyboard cut control
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private keyboardCursor: Vector2 = { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 };
  private keyboardCutStart: Vector2 | null = null;
  private keyboardActive = false;
  private keyboardGraphics: Phaser.GameObjects.Graphics | null = null;

  // Settings snapshot (applied at scene create)
  private particlesEnabled = true;

  // Pooled particle emitters (impacts + ball trails), created once per scene.
  private fx!: EffectEmitters;

  // HUD is event-driven: only rebuilt when gameplay state actually changes,
  // not every frame (text re-rasterization + full-grid scans are expensive).
  private hudDirty = true;

  // Run / objective state
  private regionsFilled = 0;
  private levelWon = false;
  private cutsUsed = 0;
  private lives = 3;
  private lockedBalls = 0;
  private transitioning = false;
  private dataRain: DataRainLine[] = [];

  // HUD
  private hud!: {
    levelText: Phaser.GameObjects.Text;
    lives: Phaser.GameObjects.Graphics;
    cutsText: Phaser.GameObjects.Text;
    spaceText: Phaser.GameObjects.Text;
    lockText: Phaser.GameObjects.Text;
    hint: Phaser.GameObjects.Text;
  };

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // Get stored config
    const gameConfig = this.registry.get('gameConfig');
    const colors = this.registry.get('colors');

    // Get current level from level manager
    const level = levelManagerStore.getCurrentLevel();
    if (!level) {
      console.error('No level loaded');
      this.scene.start('MenuScene');
      return;
    }
    this.currentLevel = level;

    // Reset per-instance state: Phaser reuses the scene object across
    // scene.restart() (level-advance and the R hotkey), so these must be
    // cleared or balls/walls would duplicate and a stale win would re-fire.
    this.ballViews = [];
    this.wallBodies = [];
    this.regionGroups = new Map();
    this.nextGroup = 1;
    this.regionsFilled = 0;
    this.levelWon = false;
    this.cutsUsed = 0;
    this.lockedBalls = 0;
    this.transitioning = false;
    this.lives = 3 + gameModifiersStore.getModifiers().extraLives;

    // Initialize game state
    const modifiers = computeGameModifiers([], new Map());
    this.gameData = createInitialGameData(this.currentLevel, 1, modifiers);
    this.regions = [...this.gameData.regions];
    this.walls = [...this.gameData.walls];

    // Board frame + faint interior (drawn under balls/cuts)
    this.drawBoardFrame();

    // Static walls (board edges + obstacles)
    for (const wall of this.gameData.walls) {
      this.addWallBody(wall);
    }

    // Ball sprites
    for (const ball of this.gameData.balls) {
      this.addBall(ball);
    }

    // Settings snapshot for this scene instance
    const settings = settingsStore.getAll();
    this.particlesEnabled = settings.particlesEnabled;

    // Pooled emitters for impact bursts + ball trails (reused all scene long)
    this.fx = createEffectEmitters(this);

    // Cut visualization layer
    this.cutGraphics = this.add.graphics().setDepth(100);
    this.keyboardGraphics = this.add.graphics().setDepth(101);

    // HUD (styled top bar + objective row + modifiers panel)
    this.buildHud(settings.largeText);

    // Apply CRT post-FX for aesthetic
    if (settings.crtEnabled) {
      applyCRTEffect(this);
    }

    // Add ambient data-rain background effect
    this.dataRain = settings.dataRainEnabled ? createDataRain(this, 10) : [];

    // Input for cut drawing (pointer)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer));
    this.input.on('pointerup', () => this.onPointerUp());

    // Keyboard cut controls: arrows/WASD aim, Space places start then commits,
    // Esc cancels a pending cut, R restarts the level. Reset aim state so a
    // pending cut or stale cursor never survives a scene.restart().
    this.keyboardCursor = { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 };
    this.keyboardCutStart = null;
    this.keyboardActive = false;
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys('W,A,S,D') as
      | Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
      | undefined;
    this.input.keyboard?.on('keydown-SPACE', () => this.onKeyboardCut());
    this.input.keyboard?.on('keydown-ESC', () => {
      this.keyboardCutStart = null;
      this.hudDirty = true;
    });
    this.input.keyboard?.on('keydown-R', () => this.scene.restart());

    // Matter collision events for audio
    this.matter.world.on('collisionstart', (event: any) => {
      for (const pair of event.pairs) {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;

        // Wall hit (ball → wall)
        const isBallWall =
          (bodyA.collisionFilter?.category === CAT_BALL && bodyB.collisionFilter?.category === CAT_WALL) ||
          (bodyA.collisionFilter?.category === CAT_WALL && bodyB.collisionFilter?.category === CAT_BALL);

        if (isBallWall) {
          playWallHitSound(0.7);
          if (this.particlesEnabled) {
            const ballBody = bodyA.collisionFilter?.category === CAT_BALL ? bodyA : bodyB;
            emitImpact(this.fx, ballBody.position, 0x00ff88, 6);
          }
        }

        // Ball collision (ball → ball)
        const isBallBall =
          bodyA.collisionFilter?.category === CAT_BALL && bodyB.collisionFilter?.category === CAT_BALL;

        if (isBallBall) {
          playBallCollideSound(0.5);
          if (this.particlesEnabled) {
            const midpoint = {
              x: (bodyA.position.x + bodyB.position.x) / 2,
              y: (bodyA.position.y + bodyB.position.y) / 2,
            };
            emitImpact(this.fx, midpoint, 0xff88ff, 4);
          }
        }
      }
    });
  }

  private addWallBody(wall: Wall): void {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;

    const angle = Math.atan2(dy, dx);
    const cx = (wall.start.x + wall.end.x) / 2;
    const cy = (wall.start.y + wall.end.y) / 2;

    const body = this.matter.add.rectangle(cx, cy, len + wall.thickness, wall.thickness, {
      isStatic: true,
      angle,
      restitution: 1,
      friction: 0,
      frictionStatic: 0,
    });
    body.collisionFilter = { category: CAT_WALL, mask: CAT_BALL, group: 0 };
    this.wallBodies.push(body);
  }

  /** Bake radius=32 glow-ball texture for a color, cached by key. */
  private ensureBallTexture(colorHex: string): string {
    const key = `ball-base-${colorHex}`;
    if (this.textures.exists(key)) return key;

    const c = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const radius = 32;
    const size = radius * 2 + 32;
    const half = size / 2;

    const g = this.make.graphics({ x: 0, y: 0, add: false });
    // Soft outer glow
    for (let i = 6; i >= 1; i--) {
      g.fillStyle(c, 0.07);
      g.fillCircle(half, half, radius + i * 4);
    }
    // Body + subtle dark rim for depth
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(half, half, radius);
    g.fillStyle(c, 1);
    g.fillCircle(half, half, radius - 2);
    // Specular highlight (large soft + small bright)
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(half - radius * 0.22, half - radius * 0.22, radius * 0.55);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(half - radius * 0.3, half - radius * 0.3, radius * 0.22);

    g.generateTexture(key, size, size);
    g.destroy();
    return key;
  }

  private addBall(ball: Ball): void {
    const colorHex = `#${ball.color}`;
    const texKey = this.ensureBallTexture(colorHex);

    const sprite = this.matter.add.sprite(
      ball.position.x,
      ball.position.y,
      texKey,
      undefined,
      {
        shape: { type: 'circle', radius: ball.radius },
        restitution: 1,
        friction: 0,
        frictionAir: 0,
      }
    ) as any;

    // Texture is baked at radius 32 (plus glow margin); scale to the ball's
    // actual radius so the visual matches the physics body.
    sprite.setScale(ball.radius / 32);
    sprite.setDepth(10);

    const body = sprite.body as MatterJS.BodyType;
    const group = this.groupFor(ball.regionId);
    body.collisionFilter = { category: CAT_BALL, mask: CAT_WALL, group };

    // Initial velocity (divide by 60 to match Phaser's ~16.6ms ticks), scaled
    // by difficulty and the owned ball-speed upgrades (matches the HUD stat).
    const speedMul = settingsStore.getBallSpeedMultiplier() * gameModifiersStore.getModifiers().ballSpeedMultiplier;
    sprite.setVelocity((ball.velocity.x / 60) * speedMul, (ball.velocity.y / 60) * speedMul);

    this.ballViews.push({ ball, body, sprite });
  }

  private groupFor(regionId: string): number {
    let g = this.regionGroups.get(regionId);
    if (g === undefined) {
      g = this.nextGroup++;
      this.regionGroups.set(regionId, g);
    }
    return g;
  }

  // ── Input handling ────────────────────────────────────────────────────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.levelWon) return;

    const wx = pointer.worldX;
    const wy = pointer.worldY;

    // Check if click is inside board
    if (!pointInPolygon({ x: wx, y: wy }, this.gameData.boardPolygon)) {
      return;
    }

    this.cut = {
      start: { x: wx, y: wy },
      points: [{ x: wx, y: wy }],
      isActive: true,
    };
    this.cuttingPointer = true;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.cuttingPointer || !this.cut.isActive) return;

    const wx = pointer.worldX;
    const wy = pointer.worldY;

    if (this.cut.points.length === 0) {
      this.cut.points.push({ x: wx, y: wy });
    } else {
      const last = this.cut.points[this.cut.points.length - 1];
      const dx = wx - last.x;
      const dy = wy - last.y;
      const dist = Math.hypot(dx, dy);

      // Min distance between waypoints
      if (dist > 10) {
        this.cut.points.push({ x: wx, y: wy });
      }
    }

    this.drawCutPreview();
  }

  private onPointerUp(): void {
    if (!this.cuttingPointer || !this.cut.isActive) return;

    this.cuttingPointer = false;
    this.cut.isActive = false;

    // Only process cuts of minimum length
    if (this.cut.points.length > 5) {
      this.completeCut();
    }

    this.cut = { start: { x: 0, y: 0 }, points: [], isActive: false };
    if (this.cutGraphics) {
      this.cutGraphics.clear();
    }
  }

  private drawCutPreview(): void {
    if (!this.cutGraphics || this.cut.points.length < 2) return;

    this.cutGraphics.clear();
    this.cutGraphics.lineStyle(4, 0x00ff88, 0.8);
    this.cutGraphics.beginPath();
    this.cutGraphics.moveTo(this.cut.points[0].x, this.cut.points[0].y);

    for (let i = 1; i < this.cut.points.length; i++) {
      this.cutGraphics.lineTo(this.cut.points[i].x, this.cut.points[i].y);
    }
    this.cutGraphics.strokePath();
  }

  private completeCut(): void {
    const start = this.cut.points[0];
    const end = this.cut.points[this.cut.points.length - 1];
    this.executeCut(start, end);
  }

  /** Shared cut pipeline used by both pointer-drag and keyboard input. */
  private executeCut(start: Vector2, end: Vector2): void {
    // Initialize audio on first user interaction if not done yet
    initAudio();

    this.cutsUsed++;

    // Animate the wall growing
    if (this.particlesEnabled) {
      animateWallGrowth(this, start, end, 400, 0x00ff88);
    }

    // Play fence break sound
    playFenceBreakSound();

    // Rasterize the cut into the grid
    rasterizeCutToGrid(this.gameData.spaceGrid, start, end, 6);

    // Add static Matter wall for the new fence
    const cutWall: Wall = { id: `cut-${Date.now()}`, start, end, thickness: 6 };
    this.walls.push(cutWall);
    this.addWallBody(cutWall);

    // Flood-fill to find new regions
    const gridRegions = findGridRegions(this.gameData.spaceGrid);

    // Drop ball-less regions
    const ballIndices = this.ballViews.map((v) =>
      worldToGridIndex(this.gameData.spaceGrid, v.ball.position.x, v.ball.position.y)
    );
    const kept: GridRegion[] = [];

    for (const gr of gridRegions) {
      const set = new Set(gr.cellIndices);
      if (ballIndices.some((idx) => set.has(idx))) {
        kept.push(gr);
      } else {
        removeRegion(this.gameData.spaceGrid, gr);
        // Play lock sound for each captured ball (fewer balls locked per cut)
        playBallLockSound();
      }
    }

    // Rebuild authoritative Region[]
    this.regions = kept.map((gr) => ({
      id: gr.id,
      polygon: this.gameData.boardPolygon,
      samplePoints: getRegionCellPositions(this.gameData.spaceGrid, gr),
      estimatedArea: gr.cellCount,
    }));

    // Reassign balls and update collision groups
    reassignBallsToRegions(
      this.ballViews.map((v) => v.ball),
      this.regions,
      this.walls
    );

    for (const v of this.ballViews) {
      const group = this.groupFor(v.ball.regionId);
      v.body.collisionFilter = { category: CAT_BALL, mask: CAT_WALL, group };
    }

    // Update objective state
    this.regionsFilled = 100 - Math.round(getRemainingPercent(this.gameData.spaceGrid));
    this.recomputeLockedBalls();

    // Check win condition
    if (this.regionsFilled >= this.currentLevel.sizeThreshold) {
      this.levelWon = true;
    }

    // Cuts/space/locks/hint all changed — refresh the HUD next frame.
    this.hudDirty = true;
  }

  /**
   * Balls confined outside the largest remaining region are "thread-locked"
   * (walled into a pocket). Proxy for the original run-state lock count.
   */
  private recomputeLockedBalls(): void {
    if (this.regions.length === 0) {
      this.lockedBalls = 0;
      return;
    }
    let mainId = this.regions[0].id;
    let mainArea = this.regions[0].estimatedArea;
    for (const r of this.regions) {
      if (r.estimatedArea > mainArea) {
        mainArea = r.estimatedArea;
        mainId = r.id;
      }
    }
    this.lockedBalls = this.ballViews.filter((v) => v.ball.regionId !== mainId).length;
  }

  // ── Board chrome ──────────────────────────────────────────────────────────

  /** Faint interior fill, glowing neon border, and corner brackets. */
  private drawBoardFrame(): void {
    const verts = this.gameData.boardPolygon?.vertices;
    if (!verts || verts.length < 3) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of verts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    // Behind the balls/cuts (which sit at depth >= 10) but above the canvas.
    const g = this.add.graphics().setDepth(-10);
    const pts = verts.map((p) => new Phaser.Geom.Point(p.x, p.y));

    // Interior wash so the play area reads as a lit screen, not void
    g.fillStyle(0x031a12, 0.35);
    g.fillPoints(pts, true);

    // Layered glow border (wide dim → narrow bright)
    g.lineStyle(8, 0x00ff88, 0.08);
    g.strokePoints(pts, true, true);
    g.lineStyle(2, 0x00ff88, 0.7);
    g.strokePoints(pts, true, true);

    // Corner brackets (terminal aesthetic)
    const L = 34;
    g.lineStyle(3, 0x00ff88, 0.9);
    const corner = (x: number, y: number, dx: number, dy: number) => {
      g.beginPath();
      g.moveTo(x + dx * L, y);
      g.lineTo(x, y);
      g.lineTo(x, y + dy * L);
      g.strokePath();
    };
    corner(minX, minY, 1, 1);
    corner(maxX, minY, -1, 1);
    corner(minX, maxY, 1, -1);
    corner(maxX, maxY, -1, -1);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────

  private buildHud(largeText: boolean): void {
    const s = largeText ? 1.3 : 1;
    const DEPTH = 1000;

    // Top strip background (nav row + objective row)
    const top = this.add.graphics().setDepth(DEPTH - 1);
    top.fillStyle(0x00100a, 0.82);
    top.fillRect(0, 0, BOARD_WIDTH, 104);
    top.lineStyle(1, 0x00ff88, 0.16);
    top.lineBetween(0, 52, BOARD_WIDTH, 52);
    top.lineStyle(2, 0x00ff88, 0.28);
    top.lineBetween(0, 104, BOARD_WIDTH, 104);

    const levelText = this.add
      .text(20, 26, '', { fontFamily: 'monospace', fontSize: `${Math.round(24 * s)}px`, color: '#00ff88', fontStyle: 'bold' })
      .setOrigin(0, 0.5)
      .setShadow(0, 0, '#00ff88', 12)
      .setDepth(DEPTH);

    const lives = this.add.graphics().setDepth(DEPTH);

    const objStyle = { fontFamily: 'monospace', fontSize: `${Math.round(17 * s)}px`, color: '#00ff88', fontStyle: 'bold' as const };
    const cutsText = this.add.text(40, 78, '', objStyle).setOrigin(0, 0.5).setDepth(DEPTH);
    const spaceText = this.add.text(BOARD_WIDTH / 2, 78, '', objStyle).setOrigin(0.5, 0.5).setDepth(DEPTH);
    const lockText = this.add.text(BOARD_WIDTH - 40, 78, '', objStyle).setOrigin(1, 0.5).setDepth(DEPTH);

    // Bottom modifiers panel
    const bottom = this.add.graphics().setDepth(DEPTH - 1);
    bottom.fillStyle(0x000000, 0.8);
    bottom.fillRect(0, 828, BOARD_WIDTH, 72);
    bottom.lineStyle(1, 0x00ff88, 0.25);
    bottom.lineBetween(0, 828, BOARD_WIDTH, 828);

    this.add
      .text(BOARD_WIDTH / 2, 838, this.buildModifierLine(), {
        fontFamily: 'monospace',
        fontSize: `${Math.round(13 * s)}px`,
        color: '#66ffbb',
        align: 'center',
        wordWrap: { width: BOARD_WIDTH - 40 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH);

    const hint = this.add
      .text(BOARD_WIDTH / 2, 818, '', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(12 * s)}px`,
        color: '#88ffcc',
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH);

    this.hud = { levelText, lives, cutsText, spaceText, lockText, hint };
  }

  /** One-line summary of active gameplay modifiers (compounded with difficulty). */
  private buildModifierLine(): string {
    const m = gameModifiersStore.getModifiers();
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const bonus = (v: number) => (v > 0 ? `+${v}` : `${v}`);
    const ballSpeed = m.ballSpeedMultiplier * settingsStore.getBallSpeedMultiplier();
    return [
      `Ball Speed: ${pct(ballSpeed)}`,
      `Ball Size: ${pct(m.ballSizeMultiplier)}`,
      `Fence Speed: ${pct(m.fenceGenerationSpeedMultiplier)}`,
      `OT Mult: ${pct(m.scoreMultiplier)}`,
      `Instant Fences: ${bonus(m.instantFencesPerMap)}`,
      `Concurrent: ${bonus(m.additionalConcurrentFences)}`,
      `Bonus Remove: ${pct(m.bonusRemovalChance)} @ ${pct(m.bonusRemovalAmount)}`,
      `Extra Lives: ${bonus(m.extraLives)}`,
      `Interest: ${pct(m.scoreInterestRate)}`,
      `Shop Slots: ${bonus(m.extraShopItems)}`,
      `MicroMgr/Lock: ${pct(m.microManagerPerLock)}`,
    ].join('    ');
  }

  private updateHud(): void {
    if (!this.hud) return;

    this.hud.levelText.setText(`LV${this.currentLevel.level}`);

    // Lives as glowing pips
    const g = this.hud.lives;
    g.clear();
    const n = Math.max(0, this.lives);
    const gap = 24;
    const startX = BOARD_WIDTH / 2 - ((n - 1) * gap) / 2;
    g.fillStyle(0x00ff88, 1);
    for (let i = 0; i < n; i++) {
      g.fillCircle(startX + i * gap, 26, 7);
    }

    // Cuts / par
    const par = this.currentLevel.expectedCuts;
    this.hud.cutsText.setText(`CUTS ${this.cutsUsed}/${par}`).setColor(this.cutsUsed > par ? '#ff6b6b' : '#00ff88');

    // Space remaining / required-remaining (win when remaining <= required)
    const remaining = Math.round(getRemainingPercent(this.gameData.spaceGrid));
    const required = 100 - this.currentLevel.sizeThreshold;
    this.hud.spaceText
      .setText(`SPACE ${remaining}% / ${required}%`)
      .setColor(remaining <= required ? '#00ff88' : '#88ffcc');

    // Thread locks
    const lockReq = this.currentLevel.threadLockRequired ?? 0;
    const lockMet = lockReq > 0 && this.lockedBalls >= lockReq;
    this.hud.lockText
      .setText(lockReq > 0 ? `LOCK ${this.lockedBalls}/${lockReq}` : `LOCK ${this.lockedBalls}`)
      .setColor(lockMet ? '#00ff88' : '#88ffcc');

    // Contextual hint
    this.hud.hint.setText(
      this.levelWon
        ? '★ LEVEL CAPTURED ★'
        : this.keyboardCutStart
          ? 'Aim + SPACE to commit  ·  ESC cancels'
          : 'Drag or Arrows/WASD + SPACE to cut  ·  R to restart'
    );
  }

  // ── Keyboard cut control ────────────────────────────────────────────────────

  /** Move the aim cursor from held arrow/WASD keys and redraw the crosshair. */
  private updateKeyboardCursor(delta: number): void {
    const c = this.cursors;
    const w = this.wasd;
    let dx = 0;
    let dy = 0;
    if (c?.left.isDown || w?.A.isDown) dx -= 1;
    if (c?.right.isDown || w?.D.isDown) dx += 1;
    if (c?.up.isDown || w?.W.isDown) dy -= 1;
    if (c?.down.isDown || w?.S.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      this.keyboardActive = true;
      const speed = 0.45; // px per ms (~27px/frame at 60fps)
      const len = Math.hypot(dx, dy) || 1;
      this.keyboardCursor.x = Phaser.Math.Clamp(
        this.keyboardCursor.x + (dx / len) * speed * delta,
        8,
        BOARD_WIDTH - 8
      );
      this.keyboardCursor.y = Phaser.Math.Clamp(
        this.keyboardCursor.y + (dy / len) * speed * delta,
        8,
        BOARD_HEIGHT - 8
      );
    }

    this.drawKeyboardCursor();
  }

  private drawKeyboardCursor(): void {
    const g = this.keyboardGraphics;
    if (!g) return;
    g.clear();
    if (!this.keyboardActive || this.levelWon) return;

    const { x, y } = this.keyboardCursor;

    // Pending cut line from the placed start to the cursor
    if (this.keyboardCutStart) {
      g.lineStyle(4, 0x00ff88, 0.85);
      g.beginPath();
      g.moveTo(this.keyboardCutStart.x, this.keyboardCutStart.y);
      g.lineTo(x, y);
      g.strokePath();
      g.fillStyle(0x00ff88, 1);
      g.fillCircle(this.keyboardCutStart.x, this.keyboardCutStart.y, 5);
    }

    // Crosshair at the cursor
    g.lineStyle(2, 0xffff00, 0.9);
    g.beginPath();
    g.moveTo(x - 12, y);
    g.lineTo(x + 12, y);
    g.moveTo(x, y - 12);
    g.lineTo(x, y + 12);
    g.strokePath();
    g.strokeCircle(x, y, 6);
  }

  /** Space: first press places the cut start, second press commits the cut. */
  private onKeyboardCut(): void {
    if (this.levelWon) return;
    this.keyboardActive = true;

    if (!pointInPolygon(this.keyboardCursor, this.gameData.boardPolygon)) return;

    if (!this.keyboardCutStart) {
      this.keyboardCutStart = { ...this.keyboardCursor };
      this.hudDirty = true; // hint switches to "Aim + SPACE to commit"
      return;
    }

    const start = this.keyboardCutStart;
    const end = { ...this.keyboardCursor };
    this.keyboardCutStart = null;

    if (Math.hypot(end.x - start.x, end.y - start.y) > 20) {
      this.executeCut(start, end);
    }
  }

  // ── Physics sync ──────────────────────────────────────────────────────────

  update(time: number, delta: number): void {
    // Update data-rain animation
    updateDataRain(this.dataRain, delta);

    // Keyboard aim cursor
    this.updateKeyboardCursor(delta);

    // Sync ball state from Matter bodies. Mutate the existing position/velocity
    // objects in place — allocating fresh objects per ball per frame was steady
    // GC pressure for no benefit (nothing relies on referential immutability).
    for (const v of this.ballViews) {
      v.ball.position.x = v.body.position.x;
      v.ball.position.y = v.body.position.y;
      v.ball.velocity.x = v.body.velocity.x * 60;
      v.ball.velocity.y = v.body.velocity.y * 60;
      v.ball.rotation = v.body.angle;

      // Create occasional motion trails
      if (this.particlesEnabled) {
        const speed = Math.hypot(v.body.velocity.x, v.body.velocity.y);
        if (speed > 2 && Math.random() < 0.15) {
          emitTrail(this.fx, v.ball.position, parseInt(v.ball.color, 16));
        }
      }
    }

    // Update HUD only when gameplay state changed (see hudDirty)
    if (this.hudDirty) {
      this.updateHud();
      this.hudDirty = false;
    }

    // Level complete transition (guarded so it fires once, not every frame)
    if (this.levelWon && !this.transitioning) {
      this.transitioning = true;

      // Award skill points for clearing the level, with a small bonus for
      // finishing at or under par cuts.
      const par = this.currentLevel.expectedCuts;
      const reward = 4 + Math.max(0, par - this.cutsUsed);
      upgradeStore.addPoints(reward);

      playLevelCompleteAnimation(this, () => {
        // Advance the level pointer, then visit the shop before the next level.
        const hasNext = levelManagerStore.nextLevel() != null;
        this.scene.start('ShopScene', { hasNext });
      });
    }
  }
}

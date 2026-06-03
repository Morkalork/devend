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
import { levelManagerStore } from '../stores';
import { BOARD_WIDTH, BOARD_HEIGHT } from '@/lib/boardConstants';
import { createInitialGameData, InitialGameData } from '@/lib/initGame';
import { computeGameModifiers } from '@/hooks/useActiveModifiers';
import { LevelConfig } from '@/types/level';
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

  // HUD
  private hudText: Phaser.GameObjects.Text | null = null;
  private regionsFilled = 0;
  private levelWon = false;

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

    // Initialize game state
    const modifiers = computeGameModifiers([], new Map());
    this.gameData = createInitialGameData(this.currentLevel, 1, modifiers);
    this.regions = [...this.gameData.regions];
    this.walls = [...this.gameData.walls];

    // Static walls (board edges + obstacles)
    for (const wall of this.gameData.walls) {
      this.addWallBody(wall);
    }

    // Ball sprites
    for (const ball of this.gameData.balls) {
      this.addBall(ball);
    }

    // Cut visualization layer
    this.cutGraphics = this.add.graphics().setDepth(100);

    // HUD
    this.hudText = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '14px', color: '#00ff44' })
      .setDepth(1000);

    // Input for cut drawing
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer));
    this.input.on('pointerup', () => this.onPointerUp());

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
        }

        // Ball collision (ball → ball)
        const isBallBall =
          bodyA.collisionFilter?.category === CAT_BALL && bodyB.collisionFilter?.category === CAT_BALL;

        if (isBallBall) {
          playBallCollideSound(0.5);
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

  private addBall(ball: Ball): void {
    // Color as hex string for texture lookup
    const colorHex = `#${ball.color}`;

    const sprite = this.matter.add.sprite(
      ball.position.x,
      ball.position.y,
      `ball-base-${colorHex}`,
      undefined,
      {
        shape: { type: 'circle', radius: ball.radius },
        restitution: 1,
        friction: 0,
        frictionAir: 0,
      }
    ) as any;

    const body = sprite.body as MatterJS.BodyType;
    const group = this.groupFor(ball.regionId);
    body.collisionFilter = { category: CAT_BALL, mask: CAT_WALL, group };

    // Initial velocity (divide by 60 to match Phaser's ~16.6ms ticks)
    sprite.setVelocity(ball.velocity.x / 60, ball.velocity.y / 60);

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
    this.cutGraphics.setLineStyle(4, 0x00ff88, 0.8);
    this.cutGraphics.beginPath();
    this.cutGraphics.moveTo(this.cut.points[0].x, this.cut.points[0].y);

    for (let i = 1; i < this.cut.points.length; i++) {
      this.cutGraphics.lineTo(this.cut.points[i].x, this.cut.points[i].y);
    }
    this.cutGraphics.strokePath();
  }

  private completeCut(): void {
    // Initialize audio on first user interaction if not done yet
    initAudio();

    // Use castRayWithReflections to get the final fence path
    const start = this.cut.points[0];
    const end = this.cut.points[this.cut.points.length - 1];

    // Rasterize the cut into the grid
    rasterizeCutToGrid(this.gameData.spaceGrid, start, end, 6);

    // Add static Matter wall for the new fence
    const cutWall: Wall = { id: `cut-${Date.now()}`, start, end, thickness: 6 };
    this.walls.push(cutWall);
    this.addWallBody(cutWall);

    // Play fence break sound
    playFenceBreakSound();

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

    // Update HUD
    this.regionsFilled = 100 - Math.round(getRemainingPercent(this.gameData.spaceGrid));

    // Check win condition
    if (this.regionsFilled >= this.currentLevel.sizeThreshold) {
      this.levelWon = true;
    }
  }

  // ── Physics sync ──────────────────────────────────────────────────────────

  update(): void {
    // Sync ball state from Matter bodies
    for (const v of this.ballViews) {
      v.ball.position = { x: v.body.position.x, y: v.body.position.y };
      v.ball.velocity = { x: v.body.velocity.x * 60, y: v.body.velocity.y * 60 };
      v.ball.rotation = v.body.angle;
    }

    // Update HUD
    if (this.hudText) {
      const pct = getRemainingPercent(this.gameData.spaceGrid);
      this.hudText.setText(
        [
          `Level ${this.currentLevel.level}  Captured: ${this.regionsFilled}%`,
          `Balls: ${this.ballViews.length}  Regions: ${this.regions.length}`,
          `${this.levelWon ? '★ LEVEL WON ★' : 'Draw to cut!'}`,
        ].join('\n')
      );
    }

    // Level complete transition
    if (this.levelWon) {
      this.time.delayedCall(1000, () => {
        // Advance to next level
        const nextLevel = levelManagerStore.nextLevel();
        if (nextLevel) {
          this.scene.restart();
        } else {
          // Game complete
          this.scene.start('MenuScene');
        }
      });
    }
  }
}

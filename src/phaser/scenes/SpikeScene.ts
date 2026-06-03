/**
 * SpikeScene — Phase 0 hard-gate spike.
 *
 * Proves the riskiest coupling of the migration end-to-end: can Matter.js drive
 * ball motion + wall reflection while the EXISTING region-ownership model
 * (spaceGrid + regionOwnership) stays authoritative for capture and area %?
 *
 * It deliberately reuses the engine-agnostic libs verbatim:
 *   - createInitialGameData  (board, balls, spaceGrid, initial region)
 *   - castRayWithReflections (cut geometry)
 *   - rasterizeCutToGrid / findGridRegions / removeRegion / getRemainingPercent
 *   - reassignBallsToRegions
 *
 * Matter owns only: ball bodies (restitution 1, no friction/gravity), static
 * wall bodies (board edges + the cut), and in-region-only ball↔ball collisions
 * via per-region collision groups.
 *
 * Gate criteria (logged to the browser console as [GATE]); all must pass:
 *   1. Captured-area % comes from spaceGrid and is sane after a known cut.
 *   2. Balls never tunnel out of the board at speed (escape counter stays 0).
 *   3. Cross-region balls do NOT collide; in-region balls DO (filter probe).
 *
 * NOTE: criteria 2 & 3 are runtime/visual and must be confirmed in a browser
 * (`?phaser=1`). Criterion 1's reused pipeline is also asserted headlessly in
 * src/phaser/__tests__/cutPipeline.spike.test.ts.
 */
import Phaser from "phaser";
import { createInitialGameData, InitialGameData } from "@/lib/initGame";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import { Ball, Region } from "@/types/game";
import { Wall, castRayWithReflections } from "@/lib/wallGeometry";
import {
  rasterizeCutToGrid,
  findGridRegions,
  removeRegion,
  getRemainingPercent,
  getRegionCellPositions,
  worldToGridIndex,
  GridRegion,
} from "@/lib/spaceGrid";
import { reassignBallsToRegions } from "@/lib/regionOwnership";
import { pointInPolygon } from "@/lib/polygon";

// Matter collision categories (bit flags).
const CAT_BALL = 0x0001;
const CAT_WALL = 0x0002;

// Minimal self-contained level (Phase 1 replaces this with YAML loading).
const SPIKE_LEVEL: LevelConfig = {
  id: "spike",
  level: 1,
  sizeThreshold: 50,
  expectedCuts: 4,
  points: 100,
  variety: 0,
  randomShapes: 0,
  balls: [
    { id: "b1", initialSpeed: 60, topSpeed: 90, color: "ff4444", startX: 250, startY: 250 },
    { id: "b2", initialSpeed: 60, topSpeed: 90, color: "44ff44", startX: 650, startY: 300 },
    { id: "b3", initialSpeed: 60, topSpeed: 90, color: "4488ff", startX: 450, startY: 650 },
  ],
};

interface BallView {
  ball: Ball;
  body: MatterJS.BodyType;
  gfx: Phaser.GameObjects.Arc;
}

export class SpikeScene extends Phaser.Scene {
  private gameData!: InitialGameData;
  private ballViews: BallView[] = [];
  private wallBodies: MatterJS.BodyType[] = [];
  /** region.id -> Matter collision group (unique positive int per region). */
  private regionGroups = new Map<string, number>();
  private nextGroup = 1;
  /** Authoritative regions (rebuilt on each cut), as used by regionOwnership. */
  private regions: Region[] = [];
  private walls: Wall[] = [];
  private escapeCount = 0;
  private hasCut = false;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "SpikeScene" });
  }

  create(): void {
    const modifiers = computeGameModifiers([], new Map());
    this.gameData = createInitialGameData(SPIKE_LEVEL, 1, modifiers);
    this.regions = this.gameData.regions;
    this.walls = [...this.gameData.walls];

    // Static Matter bodies for every wall (board edges; obstacles if any).
    for (const wall of this.gameData.walls) this.addWallBody(wall);

    // Balls: Matter circle bodies, perfectly elastic, no friction/gravity.
    for (const ball of this.gameData.balls) this.addBall(ball);

    this.hud = this.add
      .text(12, 12, "", { fontFamily: "monospace", fontSize: "16px", color: "#00ff44" })
      .setDepth(1000);

    // Let the balls move, then perform a scripted vertical cut and run checks.
    this.time.delayedCall(1500, () => this.performScriptedCut());
    this.time.delayedCall(3500, () => this.runGateChecks());

    // eslint-disable-next-line no-console
    console.log("[GATE] SpikeScene started. A scripted cut fires at t=1.5s.");
  }

  // ── Body construction ─────────────────────────────────────────────────────

  private addWallBody(wall: Wall): void {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const angle = Math.atan2(dy, dx);
    const cx = (wall.start.x + wall.end.x) / 2;
    const cy = (wall.start.y + wall.end.y) / 2;

    // Extend by thickness so corners overlap and balls can't slip through seams.
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
    const gfx = this.add.circle(
      ball.position.x,
      ball.position.y,
      ball.radius,
      Phaser.Display.Color.HexStringToColor(ball.color).color,
    );

    const go = this.matter.add.gameObject(gfx, {
      shape: { type: "circle", radius: ball.radius },
      restitution: 1,
      friction: 0,
      frictionAir: 0,
      frictionStatic: 0,
    }) as Phaser.GameObjects.Arc & {
      body: MatterJS.BodyType;
      setVelocity: (x: number, y: number) => unknown;
    };

    const body = go.body as MatterJS.BodyType;
    const group = this.groupFor(ball.regionId);
    body.collisionFilter = { category: CAT_BALL, mask: CAT_WALL, group };

    // ball.velocity is world units/sec; Matter integrates per ~16.6ms tick,
    // so divide by ~60 to approximate. Exact PHYSICS_STEP matching is a
    // Phase 2 tuning item (documented in the plan), not a Phase 0 gate.
    go.setVelocity(ball.velocity.x / 60, ball.velocity.y / 60);

    this.ballViews.push({ ball, body, gfx });
  }

  /** Same positive group => Matter always collides (in-region ball↔ball).
   *  Different group => falls back to category/mask; ball mask excludes BALL,
   *  so cross-region balls never collide. */
  private groupFor(regionId: string): number {
    let g = this.regionGroups.get(regionId);
    if (g === undefined) {
      g = this.nextGroup++;
      this.regionGroups.set(regionId, g);
    }
    return g;
  }

  // ── Scripted cut: exercises the real capture pipeline ──────────────────────

  private performScriptedCut(): void {
    // Cast a vertical ray both ways from the board centre (mirror-aware).
    const origin = { x: 450, y: 450 };
    const down = castRayWithReflections(origin, { x: 0, y: 1 }, this.walls);
    const up = castRayWithReflections(origin, { x: 0, y: -1 }, this.walls);
    if (!down || !up) {
      console.warn("[GATE] cut ray missed a wall — aborting scripted cut");
      return;
    }
    const start = up.waypoints[up.waypoints.length - 1];
    const end = down.waypoints[down.waypoints.length - 1];

    // 1) Rasterize the cut into the authoritative grid.
    rasterizeCutToGrid(this.gameData.spaceGrid, start, end, 6);

    // 2) Add a static Matter wall so balls bounce off the new fence.
    const cutWall: Wall = { id: `cut-${Date.now()}`, start, end, thickness: 6 };
    this.walls.push(cutWall);
    this.addWallBody(cutWall);

    // 3) Re-flood the grid into connected regions.
    const gridRegions = findGridRegions(this.gameData.spaceGrid);

    // 4) Drop regions that contain no ball (the capture step).
    const ballIndices = this.ballViews.map((v) =>
      worldToGridIndex(this.gameData.spaceGrid, v.ball.position.x, v.ball.position.y),
    );
    const kept: GridRegion[] = [];
    for (const gr of gridRegions) {
      const set = new Set(gr.cellIndices);
      if (ballIndices.some((idx) => set.has(idx))) kept.push(gr);
      else removeRegion(this.gameData.spaceGrid, gr);
    }

    // 5) Rebuild authoritative Region[] (polygon + samplePoints) for ownership.
    this.regions = kept.map((gr) => ({
      id: gr.id,
      polygon: this.gameData.boardPolygon, // approx for spike; Phase 2 uses contour
      samplePoints: getRegionCellPositions(this.gameData.spaceGrid, gr),
      estimatedArea: gr.cellCount,
    }));

    // 6) Reassign balls to their containing region, then re-key their Matter
    //    collision group so cross-region balls stop colliding.
    reassignBallsToRegions(
      this.ballViews.map((v) => v.ball),
      this.regions,
      this.walls,
    );
    for (const v of this.ballViews) {
      const group = this.groupFor(v.ball.regionId);
      v.body.collisionFilter = { category: CAT_BALL, mask: CAT_WALL, group };
    }

    // Draw the cut line for visual confirmation.
    this.add.line(0, 0, start.x, start.y, end.x, end.y, 0x00ff44).setOrigin(0, 0).setLineWidth(2);

    this.hasCut = true;
    const pct = getRemainingPercent(this.gameData.spaceGrid);
    console.log(
      `[GATE] cut applied: ${gridRegions.length} region(s) found, ${kept.length} kept, ` +
        `remaining area = ${pct.toFixed(1)}%`,
    );
  }

  // ── Gate checks (browser console) ──────────────────────────────────────────

  private runGateChecks(): void {
    // Gate 1: area % is sane (0 < pct < 100 after a real cut).
    const pct = getRemainingPercent(this.gameData.spaceGrid);
    const gate1 = this.hasCut && pct > 0 && pct < 100;
    console.log(`[GATE] 1 area%%: remaining=${pct.toFixed(1)} -> ${gate1 ? "PASS" : "FAIL"}`);

    // Gate 2: no tunneling (escape counter accumulated in update()).
    const gate2 = this.escapeCount === 0;
    console.log(`[GATE] 2 tunneling: escapes=${this.escapeCount} -> ${gate2 ? "PASS" : "FAIL"}`);

    // Gate 3: cross-region balls must not collide; same-region must.
    const groups = this.ballViews.map((v) => v.body.collisionFilter.group);
    const distinct = new Set(groups);
    const hasCrossRegionPair = distinct.size > 1;
    console.log(
      `[GATE] 3 region filters: ball groups=${JSON.stringify(groups)}, ` +
        `${distinct.size} distinct region group(s) -> ` +
        `${hasCrossRegionPair ? "split confirmed (cross-region balls won't collide)" : "still single region"}`,
    );
  }

  update(): void {
    // Sync the authoritative Ball model from Matter bodies and watch for escapes.
    const eps = 2;
    for (const v of this.ballViews) {
      v.ball.position = { x: v.body.position.x, y: v.body.position.y };
      v.ball.velocity = { x: v.body.velocity.x * 60, y: v.body.velocity.y * 60 };

      const inside = pointInPolygon(v.ball.position, this.gameData.boardPolygon);
      // Allow a small epsilon margin around the polygon edge.
      if (!inside) {
        const b = this.gameData.boardPolygon.vertices;
        const minX = Math.min(...b.map((p) => p.x)) - eps;
        const maxX = Math.max(...b.map((p) => p.x)) + eps;
        const minY = Math.min(...b.map((p) => p.y)) - eps;
        const maxY = Math.max(...b.map((p) => p.y)) + eps;
        if (
          v.ball.position.x < minX ||
          v.ball.position.x > maxX ||
          v.ball.position.y < minY ||
          v.ball.position.y > maxY
        ) {
          this.escapeCount++;
        }
      }
    }

    if (this.hud) {
      const pct = getRemainingPercent(this.gameData.spaceGrid);
      this.hud.setText(
        [
          `SPIKE  remaining=${pct.toFixed(1)}%`,
          `cut=${this.hasCut}  escapes=${this.escapeCount}`,
          `regions=${this.regions.length}`,
        ].join("\n"),
      );
    }
  }
}

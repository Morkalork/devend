/**
 * PixiGameRenderer — WebGL port of renderFrame.ts (Stage A).
 *
 * Consumes the SAME game/rctx state as the Canvas-2D renderer and mirrors its
 * draw order with a retained scene graph. The canvas element, its physical-
 * pixel sizing convention (game.screenSize / boardRect / input mapping) and
 * the game loop are unchanged — GameCanvas simply routes its `render` closure
 * here when the renderer flag says 'pixi'.
 *
 * Stage-A simplifications (Stage B finishes them): no ambient data rain, no
 * wall-impact ripple displacement, no damage cracks, simplified level-clear
 * shimmer (whole-board desaturation + wave band) and dissolve (captured-canvas
 * tiles as sprites). shadowBlur glows are replaced by layered strokes and
 * tinted radial sprites; resolution runs at NATIVE device pixels (no 2x cap).
 */
import { Application, Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { CanvasGameState } from "@/types/gameState";
import { RenderContext } from "../types";
import { DissolveState } from "@/types/game";
import { Vector2, Polygon, clipLineAgainstPolygons } from "@/lib/polygon";
import { Wall, WALL_THICKNESS } from "@/lib/wallGeometry";
import { BALL_DANGER_SPEED } from "@/lib/gameConstants";
import { getFrameStats } from "../perfStats";
import { flameTonguesForCount } from "../renderFrame";
import { BallLayer } from "./pixiBalls";
import { EffectsLayer, DissolveLayer, dashedLine } from "./pixiEffects";
import { clearCanvasTextures, clearGlowTextures, glowTexture, textureFor, hashStr, mulberry } from "./textures";

type W2S = (x: number, y: number) => { x: number; y: number };

const MOVER_COLOR = 0xff8800;

export class PixiGameRenderer {
  private app = new Application();
  private ready = false;
  private pendingSize: { w: number; h: number } | null = null;

  // Scene graph (child order = renderFrame section order).
  private root = new Container();
  private boardScope = new Container();   // masked to boardRect
  private boardMask = new Graphics();
  private gridSprite: Sprite | null = null;
  private regionSprite: Sprite | null = null;
  private movers = new Graphics();
  private obstacles = new Graphics();
  private breakables = new Graphics();
  private mirrors = new Graphics();
  private debris = new Graphics();
  private wallGlow = new Graphics();
  private wallCore = new Graphics();
  private wallsScope = new Container();   // fence walls, masked to board polygon minus obstacles
  private fenceMask = new Graphics();
  private edgeWalls = new Graphics();     // board-edge walls (boardScope mask suffices)
  private rim = new Graphics();
  private danger = new Graphics();
  private balls = new BallLayer();
  private effects = new EffectsLayer();
  private activeFence = new Graphics();
  private activeFenceMaskG = new Graphics();
  private tipBlooms: Sprite[] = [];
  private dissolve = new DissolveLayer();
  private perfText: Text | null = null;

  // Cache keys for static layers.
  private staticDirty = true;
  private obstaclesKey = "";
  private mirrorsKey = "";
  private fenceMaskKey = "";
  private wallClipSegs = new WeakMap<Wall, { start: Vector2; end: Vector2 }[]>();

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.app.init({
      canvas,
      width,
      height,
      antialias: true,
      backgroundAlpha: 0,
      resolution: 1,
      autoDensity: false,
      // Lets the game-over dissolve snapshot the last presented frame via
      // ctx.drawImage(canvas) exactly like the 2D path.
      preserveDrawingBuffer: true,
      autoStart: false,
      sharedTicker: false,
      powerPreference: "high-performance",
    });
    this.app.ticker.stop(); // the game loop drives rendering explicitly

    this.wallGlow.blendMode = "add";
    this.wallsScope.addChild(this.wallGlow, this.wallCore);
    this.wallsScope.mask = this.fenceMask;

    this.boardScope.addChild(
      this.movers,
      this.obstacles,
      this.breakables,
      this.wallsScope,
      this.fenceMask, // sibling of the container it masks
      this.edgeWalls,
      this.rim,
      this.danger,
      this.mirrors,
      this.debris,
      this.effects.container,
      this.balls.container,
      this.activeFence,
      this.activeFenceMaskG,
    );
    this.root.addChild(this.boardScope, this.boardMask, this.effects.overlayContainer, this.dissolve.container);
    this.boardScope.mask = this.boardMask;
    this.app.stage.addChild(this.root);

    this.ready = true;
    if (this.pendingSize) {
      this.resize(this.pendingSize.w, this.pendingSize.h);
      this.pendingSize = null;
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  resize(widthPx: number, heightPx: number): void {
    if (!this.ready) {
      this.pendingSize = { w: widthPx, h: heightPx };
      return;
    }
    this.app.renderer.resize(widthPx, heightPx);
    // Scale-keyed bakes are re-baked by their 2D cache modules; drop the GPU
    // copies so textureFor() re-wraps the fresh canvases.
    clearCanvasTextures();
    this.gridSprite = null;
    this.regionSprite = null;
    this.staticDirty = true;
    this.obstaclesKey = "";
    this.mirrorsKey = "";
    this.fenceMaskKey = "";
  }

  /** GameCanvas repainted the board-grid/region OffscreenCanvases. */
  markStaticDirty(): void {
    this.staticDirty = true;
  }

  render(game: CanvasGameState, rctx: RenderContext): void {
    if (!this.ready) return;
    const now = performance.now();

    // ── Game-over dissolve replaces the whole scene ──
    if (game.dissolve) {
      this.boardScope.visible = false;
      this.effects.overlayContainer.visible = false;
      this.dissolve.render(game.dissolve as DissolveState, now);
      this.app.render();
      return;
    }
    if (!this.boardScope.visible) {
      this.dissolve.clear();
      this.boardScope.visible = true;
      this.effects.overlayContainer.visible = true;
    }

    const { boardRect } = game;
    const scale = boardRect.scale;
    const accent = rctx.accentColor;
    const w2s: W2S = (x, y) => ({
      x: boardRect.left + x * scale,
      y: boardRect.top + y * scale,
    });

    // Board mask (also reused as the hard outside-board clear).
    this.boardMask.clear().rect(boardRect.left, boardRect.top, boardRect.width, boardRect.height).fill(0xffffff);

    this.syncStaticSprites(rctx);

    // ── Level-clear shimmer: freeze the scene, animate desaturation + wave ──
    const shimmering = this.effects.syncShimmer(game, this.boardScope, accent, now);
    if (!shimmering) {
      this.syncMovers(game, w2s, scale, now);
      this.syncObstacles(game, w2s, scale, accent);
      this.syncBreakables(game, w2s, scale);
      this.syncMirrors(game, w2s, scale);
      this.syncDebris(game, w2s, scale, now);
      this.syncWalls(game, w2s, scale, accent, now);
      this.syncRim(game, scale, accent, now);
      this.syncDanger(game, scale, now);
      this.balls.sync(game, accent, scale, w2s, flameTonguesForCount(countActive(game)), rctx.showBallSpeeds ?? false, now);
      this.effects.sync(game, rctx, w2s, now);
      this.syncActiveFence(game, w2s, scale, accent, now);
    }

    this.syncPerfText(rctx);
    this.app.render();
  }

  // ── Board grid + region fill (textures over the shared OffscreenCanvases) ──
  private syncStaticSprites(rctx: RenderContext): void {
    const ensure = (sprite: Sprite | null, canvas: OffscreenCanvas, atIndex: number): Sprite => {
      const tex = textureFor(canvas);
      if (!sprite || sprite.texture !== tex) {
        sprite?.destroy();
        sprite = new Sprite(tex);
        this.boardScope.addChildAt(sprite, atIndex);
      }
      return sprite;
    };
    this.gridSprite = ensure(this.gridSprite, rctx.boardGridCanvas, 0);
    this.regionSprite = ensure(this.regionSprite, rctx.regionCanvas, 1);
    if (this.staticDirty) {
      this.staticDirty = false;
      // Re-upload; if the canvas was resized the source picks up new dimensions.
      this.gridSprite.texture.source.update();
      this.regionSprite.texture.source.update();
    }
  }

  // ── Movers (section E; pulse glow approximated with layered strokes) ──────
  private syncMovers(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const g = this.movers;
    g.clear();
    if (game.movers.length === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 320);
    for (const mover of game.movers) {
      const dx = mover.axis === "horizontal" ? mover.offset : 0;
      const dy = mover.axis === "vertical" ? mover.offset : 0;
      const sc = w2s(mover.homeX + dx, mover.homeY + dy);
      const half = mover.range / 2;

      const trackA = mover.axis === "horizontal" ? w2s(mover.homeX - half, mover.homeY) : w2s(mover.homeX, mover.homeY - half);
      const trackB = mover.axis === "horizontal" ? w2s(mover.homeX + half, mover.homeY) : w2s(mover.homeX, mover.homeY + half);
      dashedLine(g, trackA.x, trackA.y, trackB.x, trackB.y, 6 * scale, 5 * scale);
      g.stroke({ width: 2 * scale, color: MOVER_COLOR, alpha: 0.18 });

      const halfW = (mover.shape === "circle" ? (mover.radius ?? 30) : (mover.width ?? 60) / 2) * scale;
      const halfH = (mover.shape === "circle" ? (mover.radius ?? 30) : (mover.height ?? 60) / 2) * scale;
      const body = () => {
        if (mover.shape === "circle") g.circle(sc.x, sc.y, halfW);
        else g.rect(sc.x - halfW, sc.y - halfH, halfW * 2, halfH * 2);
      };
      body(); g.fill({ color: 0xff5000 + Math.round(80 + pulse * 30) * 0x100, alpha: 0.22 });
      body(); g.stroke({ width: (6 + pulse * 6) * scale, color: MOVER_COLOR, alpha: 0.16 + pulse * 0.1 });
      body(); g.stroke({ width: (1.5 + pulse * 1.5) * scale, color: MOVER_COLOR, alpha: 1 });

      const arrowSize = (mover.shape === "circle" ? (mover.radius ?? 30) : Math.min(mover.width ?? 60, mover.height ?? 60) / 2) * 0.55 * scale;
      const adx = mover.axis === "horizontal" ? mover.direction : 0;
      const ady = mover.axis === "vertical" ? mover.direction : 0;
      const tip = { x: sc.x + adx * arrowSize, y: sc.y + ady * arrowSize };
      const base = { x: sc.x - adx * arrowSize * 0.5, y: sc.y - ady * arrowSize * 0.5 };
      const perp = arrowSize * 0.45;
      g.poly([
        tip.x, tip.y,
        base.x - ady * perp, base.y + adx * perp,
        base.x + ady * perp, base.y - adx * perp,
      ]).fill({ color: MOVER_COLOR, alpha: 0.85 });
    }
  }

  // ── Static obstacle outlines (section F) ──────────────────────────────────
  private syncObstacles(game: CanvasGameState, w2s: W2S, scale: number, accent: string): void {
    const key = `${accent}_${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 10000)}_${game.obstaclePolygons.length}`;
    if (this.obstaclesKey === key) return;
    this.obstaclesKey = key;
    const g = this.obstacles;
    g.clear();
    const mirrorSet = new Set(game.mirrorPolygons);
    const breakableSet = new Set(game.destructibles.filter(d => d.kind === "breakable" && d.obstaclePolygon).map(d => d.obstaclePolygon));
    for (const poly of game.obstaclePolygons) {
      if (mirrorSet.has(poly as Polygon) || breakableSet.has(poly as Polygon)) continue;
      const pts: number[] = [];
      for (const v of poly.vertices) {
        const sp = w2s(v.x, v.y);
        pts.push(sp.x, sp.y);
      }
      g.poly(pts).stroke({ width: WALL_THICKNESS * scale * 2.2, color: accent, alpha: 0.18, join: "round", cap: "round" });
      g.poly(pts).stroke({ width: WALL_THICKNESS * scale, color: accent, alpha: 1, join: "round", cap: "round" });
    }
  }

  // ── Breakable obstacles (section G; dents but no fray cracks) ─────────────
  private syncBreakables(game: CanvasGameState, w2s: W2S, scale: number): void {
    const g = this.breakables;
    g.clear();
    let bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
    if (game.boardPolygon) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const v of game.boardPolygon.vertices) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      }
      bounds = { minX, minY, maxX, maxY };
    }
    for (const d of game.destructibles) {
      if (d.kind !== "breakable" || d.destroyed || !d.obstaclePolygon) continue;
      const poly = d.obstaclePolygon;
      const amber = d.objective ? "#ffb454" : "#ffcf7a";
      const dmg = d.maxHits > 0 ? Math.min(1, d.hits / d.maxHits) : 0;
      const pts = dentedOutline(poly.vertices, d.hits > 0 ? 1.5 + dmg * 4 : 0, d.dents ?? [], 16, 34, mulberry(hashStr(`break-${d.id}`)), bounds);
      const flat: number[] = [];
      for (const p of pts) {
        const sp = w2s(p.x, p.y);
        flat.push(sp.x, sp.y);
      }
      g.poly(flat).fill({ color: amber, alpha: d.hits > 0 ? 0.2 * (1 - dmg * 0.7) : 0.12 });
      g.poly(flat).stroke({ width: Math.max(2, WALL_THICKNESS * scale * (1 - dmg * 0.25)), color: amber, alpha: d.hits > 0 ? 0.95 : 1, join: "round", cap: "round" });
    }
  }

  // ── Mirrors (section L; static per level) ─────────────────────────────────
  private syncMirrors(game: CanvasGameState, w2s: W2S, scale: number): void {
    const key = `${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 10000)}_${game.mirrorPolygons.length}`;
    if (this.mirrorsKey === key) return;
    this.mirrorsKey = key;
    const g = this.mirrors;
    g.clear();
    const MIRROR = 0x88ddff;
    for (const poly of game.mirrorPolygons) {
      if (poly.vertices.length < 3) continue;
      const pts: number[] = [];
      for (const v of poly.vertices) {
        const sp = w2s(v.x, v.y);
        pts.push(sp.x, sp.y);
      }
      g.poly(pts).fill({ color: MIRROR, alpha: 0.15 });
      g.poly(pts).stroke({ width: WALL_THICKNESS * scale * 2, color: MIRROR, alpha: 0.2, join: "round" });
      g.poly(pts).stroke({ width: WALL_THICKNESS * scale, color: MIRROR, alpha: 1, join: "round" });
      g.poly(pts).stroke({ width: 1 * scale, color: 0xffffff, alpha: 0.4, join: "round" });
    }
  }

  // ── Debris + falling objects (sections N/O) ───────────────────────────────
  private syncDebris(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const g = this.debris;
    g.clear();

    if (game.objectDebris.length > 0) {
      let anyExpired = false;
      for (const debris of game.objectDebris) {
        const elapsed = now - debris.startTime;
        if (elapsed >= debris.durationMs) { anyExpired = true; continue; }
        const t = elapsed / 1000;
        const prog = elapsed / debris.durationMs;
        const alpha = 1 - prog;
        for (const p of debris.particles) {
          const wx = p.x + p.vx * t;
          const wy = p.y + p.vy * t + 220 * t * t;
          const sp = w2s(wx, wy);
          const size = p.size * scale * (1 - prog * 0.5);
          // Rotation omitted (Graphics rects); the tumbling read survives.
          g.rect(sp.x - size / 2, sp.y - size / 2, size, size).fill({ color: debris.color, alpha });
        }
      }
      if (anyExpired) {
        game.objectDebris = game.objectDebris.filter(dd => now - dd.startTime < dd.durationMs);
      }
    }

    if (game.fallingObjects.length > 0) {
      let expired = false;
      for (const fo of game.fallingObjects) {
        const elapsed = now - fo.startTime;
        if (elapsed >= fo.durationMs) {
          expired = true;
          if (!fo.shattered) {
            fo.shattered = true;
            const finalY = fo.fallSpeed * (fo.durationMs / 1000) + 320 * (fo.durationMs / 1000) ** 2;
            let cx = 0, cy = 0;
            for (const v of fo.vertices) { cx += v.x; cy += v.y; }
            cx /= fo.vertices.length; cy /= fo.vertices.length;
            const particles = fo.vertices.map(v => {
              const dx = v.x - cx, dy = v.y - cy;
              const len = Math.hypot(dx, dy) || 1;
              const speed = 60 + Math.random() * 120;
              return {
                x: v.x, y: v.y + finalY,
                vx: (dx / len) * speed + (Math.random() - 0.5) * 30,
                vy: (dy / len) * speed - 40,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 10,
                size: 5 + Math.random() * 9,
              };
            });
            game.objectDebris.push({ startTime: now, durationMs: 500, color: fo.color, particles });
          }
          continue;
        }
        const t = elapsed / 1000;
        const prog = elapsed / fo.durationMs;
        const fallY = fo.fallSpeed * t + 320 * t * t;
        const alpha = 1 - prog;
        const flat: number[] = [];
        for (const v of fo.vertices) {
          const sp = w2s(v.x, v.y + fallY);
          flat.push(sp.x, sp.y);
        }
        g.poly(flat).fill({ color: fo.color, alpha: alpha * 0.45 });
        g.poly(flat).stroke({ width: 2 * scale, color: fo.color, alpha });
      }
      if (expired) game.fallingObjects = game.fallingObjects.filter(fo => now - fo.startTime < fo.durationMs);
    }
  }

  // ── Completed walls: fences + board edges (section H) ─────────────────────
  private syncWalls(game: CanvasGameState, w2s: W2S, scale: number, accent: string, now: number): void {
    // Fence mask: board polygon minus obstacle holes (static per level).
    const maskKey = `${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 10000)}_${game.obstaclePolygons.length}`;
    if (this.fenceMaskKey !== maskKey) {
      this.fenceMaskKey = maskKey;
      const m = this.fenceMask;
      m.clear();
      if (game.boardPolygon) {
        const flat: number[] = [];
        for (const v of game.boardPolygon.vertices) {
          const sp = w2s(v.x, v.y);
          flat.push(sp.x, sp.y);
        }
        m.poly(flat).fill(0xffffff);
      } else {
        m.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height).fill(0xffffff);
      }
      for (const poly of game.obstaclePolygons) {
        const hole: number[] = [];
        for (const v of poly.vertices) {
          const sp = w2s(v.x, v.y);
          hole.push(sp.x, sp.y);
        }
        m.poly(hole).cut();
      }
    }

    const glow = this.wallGlow;
    const core = this.wallCore;
    const edges = this.edgeWalls;
    glow.clear();
    core.clear();
    edges.clear();

    const getSegs = (w: Wall) => {
      if (game.obstaclePolygons.length === 0) return null;
      let segs = this.wallClipSegs.get(w);
      if (!segs) {
        segs = clipLineAgainstPolygons(w.start, w.end, game.obstaclePolygons);
        this.wallClipSegs.set(w, segs);
      }
      return segs;
    };

    const strokeWall = (gGlow: Graphics, gCore: Graphics, s: { x: number; y: number }, e: { x: number; y: number }, baseWidth: number, glowBoost: number) => {
      // renderWallWithEffects recipe (impact wobble deferred to Stage B).
      gGlow.moveTo(s.x, s.y).lineTo(e.x, e.y)
        .stroke({ width: baseWidth * (2.8 + glowBoost * 2.5), color: accent, alpha: 0.10 + glowBoost * 0.22, cap: "round" });
      gGlow.moveTo(s.x, s.y).lineTo(e.x, e.y)
        .stroke({ width: baseWidth * (1.6 + glowBoost * 1.8), color: accent, alpha: 0.18 + glowBoost * 0.25, cap: "round" });
      if (glowBoost > 0.05) {
        gGlow.moveTo(s.x, s.y).lineTo(e.x, e.y)
          .stroke({ width: baseWidth * (3.5 + glowBoost * 3), color: accent, alpha: glowBoost * 0.18, cap: "round" });
      }
      gCore.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: baseWidth, color: 0xffffff, alpha: 1, cap: "round" });
      gCore.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: baseWidth * 0.7, color: accent, alpha: 1, cap: "round" });
    };

    for (let wi = game.walls.length - 1; wi >= 0; wi--) {
      const w = game.walls[wi];
      const isFence = w.id.startsWith("wall-");
      const isEdge = !w.isMirror && w.id.startsWith("board-");
      if (!isFence && !isEdge) continue;
      const baseWidth = w.thickness * scale;
      const freshness = isFence && w.createdAt ? Math.max(0, 1 - (now - w.createdAt) / 400) : 0;
      const gGlow = isFence ? glow : edges;
      const gCore = isFence ? core : edges;
      const segs = getSegs(w);
      if (segs) {
        for (const seg of segs) {
          strokeWall(gGlow, gCore, w2s(seg.start.x, seg.start.y), w2s(seg.end.x, seg.end.y), baseWidth, freshness);
        }
      } else {
        strokeWall(gGlow, gCore, w2s(w.start.x, w.start.y), w2s(w.end.x, w.end.y), baseWidth, freshness);
      }

      // Ascension durability crumble overlay.
      const damage = isFence && w.maxHits && w.hitsLeft !== undefined ? 1 - w.hitsLeft / w.maxHits : 0;
      if (damage > 0) {
        const drawSeg = (a: Vector2, b: Vector2) => {
          const s = w2s(a.x, a.y);
          const e = w2s(b.x, b.y);
          dashedLine(core, s.x, s.y, e.x, e.y, 4 * scale, (2 + damage * 7) * scale);
          core.stroke({ width: baseWidth * 0.9, color: 0x000000, alpha: 0.25 + 0.45 * damage, cap: "round" });
        };
        if (segs) for (const seg of segs) drawSeg(seg.start, seg.end);
        else drawSeg(w.start, w.end);
      }
    }
  }

  // ── Neon rim light (section J; layered strokes stand in for baked blur) ──
  private syncRim(game: CanvasGameState, scale: number, accent: string, now: number): void {
    const { left, top, width, height } = game.boardRect;
    const pulse = 0.8 + 0.2 * Math.sin(now * 0.0014);
    const g = this.rim;
    g.clear();
    const layers: [number, number][] = [
      [10 * scale, 0.10 * pulse],
      [4 * scale, 0.30 * pulse],
      [1.5 * scale, 0.85 * pulse],
    ];
    for (const [lw, alpha] of layers) {
      g.rect(left, top, width, height).stroke({ width: lw, color: accent, alpha });
    }
    const cornerSz = 6 * scale;
    for (const [cx, cy] of [[left, top], [left + width, top], [left, top + height], [left + width, top + height]] as [number, number][]) {
      g.rect(cx - cornerSz / 2, cy - cornerSz / 2, cornerSz, cornerSz).fill({ color: accent, alpha: 0.9 * pulse });
    }
  }

  // ── Speed danger frame (section K) ────────────────────────────────────────
  private syncDanger(game: CanvasGameState, scale: number, now: number): void {
    const g = this.danger;
    g.clear();
    let maxDanger = 0;
    for (const b of game.balls) {
      if (b.speed > 0) {
        const d = b.speed / BALL_DANGER_SPEED;
        if (d > maxDanger) maxDanger = d;
      }
    }
    if (maxDanger <= 0.55) return;
    const { left, top, width, height } = game.boardRect;
    const dangerT = Math.min(1, (maxDanger - 0.55) / 0.45);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + Math.PI);
    const alpha = dangerT * 0.45 * (0.55 + 0.45 * pulse);
    g.rect(left, top, width, height).stroke({ width: 12 * scale, color: 0xff2244, alpha: alpha * 0.35 });
    g.rect(left, top, width, height).stroke({ width: 5 * scale, color: 0xff2244, alpha });
  }

  // ── Growing fence (section U) ─────────────────────────────────────────────
  private syncActiveFence(game: CanvasGameState, w2s: W2S, scale: number, accent: string, now: number): void {
    const g = this.activeFence;
    g.clear();
    const wall = game.activeWall;
    let bloomIdx = 0;

    if (wall) {
      // Mask: active region minus obstacle holes.
      const m = this.activeFenceMaskG;
      m.clear();
      const activeRegion = game.regions.find(r => r.id === wall.activeRegionId);
      if (activeRegion && activeRegion.polygon.vertices.length > 0) {
        const flat: number[] = [];
        for (const v of activeRegion.polygon.vertices) {
          const sp = w2s(v.x, v.y);
          flat.push(sp.x, sp.y);
        }
        m.poly(flat).fill(0xffffff);
      } else {
        m.rect(game.boardRect.left, game.boardRect.top, game.boardRect.width, game.boardRect.height).fill(0xffffff);
      }
      for (const poly of game.obstaclePolygons) {
        const hole: number[] = [];
        for (const v of poly.vertices) {
          const sp = w2s(v.x, v.y);
          hole.push(sp.x, sp.y);
        }
        m.poly(hole).cut();
      }
      g.mask = m;

      const lw = wall.thickness * scale;
      const arm = (waypoints: Vector2[], segIdx: number, cur: Vector2, width: number, color: number | string, alpha: number) => {
        const o = w2s(waypoints[0].x, waypoints[0].y);
        g.moveTo(o.x, o.y);
        for (let i = 0; i < segIdx; i++) {
          const pt = w2s(waypoints[i + 1].x, waypoints[i + 1].y);
          g.lineTo(pt.x, pt.y);
        }
        const tip = w2s(cur.x, cur.y);
        g.lineTo(tip.x, tip.y);
        g.stroke({ width, color, alpha, cap: "round", join: "round" });
      };
      const bothArms = (width: number, color: number | string, alpha: number) => {
        arm(wall.startWaypoints, wall.startSegmentIndex, wall.startPoint, width, color, alpha);
        arm(wall.endWaypoints, wall.endSegmentIndex, wall.endPoint, width, color, alpha);
      };
      bothArms(lw * 3.5, accent, 0.10);
      bothArms(lw * 2.0, accent, 0.20);
      bothArms(lw * 1.5, 0xffffff, 1);
      bothArms(lw * 1.0, accent, 1);

      // Pulsating tip blooms.
      if (!wall.isComplete) {
        const throb = 0.5 + 0.5 * Math.sin(now * 0.009);
        const shimmer = 0.5 + 0.5 * Math.sin(now * 0.023);
        const coreR = wall.thickness * 0.65 * scale;
        for (const tip of [wall.startPoint, wall.endPoint]) {
          const ts = w2s(tip.x, tip.y);
          let bloom = this.tipBlooms[bloomIdx];
          if (!bloom) {
            bloom = new Sprite(glowTexture("tip"));
            bloom.anchor.set(0.5);
            bloom.blendMode = "add";
            this.boardScope.addChild(bloom);
            this.tipBlooms.push(bloom);
          }
          const bloomR = coreR * (3.5 + throb * 2.5);
          bloom.visible = true;
          bloom.tint = accent;
          bloom.alpha = 0.5 + 0.5 * throb;
          bloom.position.set(ts.x, ts.y);
          bloom.width = bloom.height = bloomR * 2;
          bloomIdx++;
          // White-hot tip core with an accent corona.
          g.circle(ts.x, ts.y, coreR * (1.6 + shimmer * 0.6)).fill({ color: accent, alpha: 0.35 + shimmer * 0.25 });
          g.circle(ts.x, ts.y, coreR).fill({ color: 0xffffff, alpha: 1 });
        }
      }
    } else {
      g.mask = null;
      // Once unassigned as a mask the graphics would render as a plain child;
      // keep it empty so nothing shows.
      this.activeFenceMaskG.clear();
    }
    for (let i = bloomIdx; i < this.tipBlooms.length; i++) this.tipBlooms[i].visible = false;
  }

  // ── Perf HUD (Pixi Text; the 2D drawPerfOverlay is canvas-bound) ──────────
  private syncPerfText(rctx: RenderContext): void {
    const show = rctx.showPerfOverlay ?? false;
    if (!show) {
      if (this.perfText) this.perfText.visible = false;
      return;
    }
    if (!this.perfText) {
      this.perfText = new Text({
        text: "",
        style: new TextStyle({
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          fill: 0x00ff88,
          stroke: { color: 0x000000, width: 3 },
        }),
      });
      this.perfText.position.set(8, 8);
      this.root.addChild(this.perfText);
    }
    const s = getFrameStats();
    this.perfText.visible = true;
    this.perfText.text = `pixi | render avg ${s.renderAvg.toFixed(2)}ms peak ${s.renderPeak.toFixed(2)}ms | phys peak ${s.physPeak.toFixed(2)}ms | n=${s.samples}`;
  }

  destroy(): void {
    this.balls.destroy();
    this.effects.destroy();
    this.dissolve.destroy();
    clearCanvasTextures();
    clearGlowTextures();
    if (this.ready) {
      this.app.destroy(false, { children: true });
    }
    this.ready = false;
  }
}

function countActive(game: CanvasGameState): number {
  let n = 0;
  for (const b of game.balls) if (b.state === "active") n++;
  return n;
}

/**
 * World-space dented outline for breakables — the point-generation math of
 * renderFrame's traceDentedPath (which is ctx-bound), returned as vertices.
 */
function dentedOutline(
  verts: { x: number; y: number }[],
  baseAmp: number,
  dents: { x: number; y: number }[],
  dentDepth: number,
  dentRadius: number,
  rng: () => number,
  bounds?: { minX: number; minY: number; maxX: number; maxY: number },
): { x: number; y: number }[] {
  let cx = 0, cy = 0;
  for (const v of verts) { cx += v.x; cy += v.y; }
  cx /= verts.length; cy /= verts.length;

  const EDGE = 7;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const el = Math.hypot(ex, ey) || 1;
    const px = -ey / el, py = ex / el;
    const sub = Math.max(2, Math.round(el / 20));
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const baseX = a.x + ex * t, baseY = a.y + ey * t;
      let wx = baseX, wy = baseY;

      let dent = 0;
      for (const imp of dents) {
        const dd = Math.hypot(wx - imp.x, wy - imp.y);
        if (dd < dentRadius) dent = Math.max(dent, 1 - dd / dentRadius);
      }
      if (dent > 0) {
        const tox = cx - wx, toy = cy - wy;
        const tl = Math.hypot(tox, toy) || 1;
        wx += (tox / tl) * dentDepth * dent;
        wy += (toy / tl) * dentDepth * dent;
      } else {
        const off = (rng() * 2 - 1) * baseAmp;
        wx += px * off; wy += py * off;
      }
      if (bounds) {
        if (Math.abs(baseX - bounds.minX) < EDGE) wx = bounds.minX;
        else if (Math.abs(baseX - bounds.maxX) < EDGE) wx = bounds.maxX;
        else wx = Math.max(bounds.minX, Math.min(bounds.maxX, wx));
        if (Math.abs(baseY - bounds.minY) < EDGE) wy = bounds.minY;
        else if (Math.abs(baseY - bounds.maxY) < EDGE) wy = bounds.maxY;
        else wy = Math.max(bounds.minY, Math.min(bounds.maxY, wy));
      }
      out.push({ x: wx, y: wy });
    }
  }
  return out;
}

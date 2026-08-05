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
import { Application, ColorMatrixFilter, Container, Filter, Graphics, Rectangle, RenderTexture, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { AdvancedBloomFilter } from "pixi-filters";
import { CanvasGameState } from "@/types/gameState";
import { RenderContext, RainState } from "../types";
import { DissolveState } from "@/types/game";
import { Vector2, Polygon, clipLineAgainstPolygons } from "@/lib/polygon";
import { Wall, WALL_THICKNESS } from "@/lib/wallGeometry";
import { buildFenceChains, buildFenceTaper, taperFactor, chainFlareEnds } from "../wallChains";
import { BALL_DANGER_SPEED, LEVEL_CLEAR_SHIMMER_MS } from "@/lib/gameConstants";
import { chestLootAlpha } from "@/lib/chests";
import { getAbility } from "@/lib/abilities";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { getEffectsAtPoint, hasNearbyImpacts, N_NODES, anyObstacleImpactsActive, obstacleBulgeAt } from "@/lib/wallImpactEffects";
import {
  WALL_CIRCUITS_ENABLED,
  WALL_CORE_ALPHA,
  WALL_CENTERLINE_ALPHA,
  WALL_RENDER_THICKEN,
  buildWallSkeleton,
  circuitPalette,
  clearWallSkeletonCache,
} from "@/lib/rendering/wallSkeleton";
import { areaStyle } from "@/lib/coloredAreas";
import { getRainGlyph } from "../rainGlyphCache";
import { getFrameStats, heapLine } from "../perfStats";
import { flameTonguesForCount } from "../renderFrame";
import { BallLayer } from "./pixiBalls";
import { EffectsLayer, DissolveLayer, dashedLine } from "./pixiEffects";
import { canvasTextureCount, clearCanvasTextures, clearGlowTextures, glowTexture, sweepCanvasTextures, textureFor, hashStr, mulberry } from "./textures";

const RAIN_SYMBOLS = '01{}()=>;./#@*';

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
  private rainLayer = new Container();
  private rainSprites: Sprite[] = [];
  private boardBase = new Container();    // grid + region sprites
  private gridSprite: Sprite | null = null;
  private regionSprite: Sprite | null = null;
  private mirrorCracks = new Graphics();
  private bloom: Filter | null = null;
  private lockZonesContainer = new Container(); // bonus-lock zone + colored-area markings + labels
  private lockZonesG = new Graphics();
  private lockZoneLabels: Text[] = [];
  private lockZonesKey = "";
  private coloredAreasG = new Graphics();
  private coloredAreaLabels: Text[] = [];
  private coloredAreasKey = "";
  private circuitG = new Graphics(); // "Wire the Integration" terminals + vault hint
  private chargeG = new Graphics(); // "Deploy Charge" fuse markers + arm/blast telegraph
  private dataStreamG = new Graphics(); // "Data Stream" seam (dim vein, bright when harvested)
  private movers = new Graphics();
  private obstacles = new Graphics();
  private phasing = new Graphics();   // phasing obstacles (#64), redrawn every frame
  private chains = new Graphics();    // ball/boss chains (#64)
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

  // Level-clear sweep: the frozen scene is snapshotted once (physics is
  // halted), then shown as two slices — drained grey above the wave line,
  // untouched below — with the luminous band on top. Mirrors the 2D
  // _frozenLiveOC/_wakeOC approach.
  private sweep: {
    liveRT: RenderTexture;
    drainedRT: RenderTexture;
    above: Sprite;
    below: Sprite;
    aboveMask: Graphics;
    wave: Graphics;
  } | null = null;
  private sweepKey = 0;
  // GPU-side snapshot for the shatter dissolve (avoids the synchronous
  // canvas readback that caused a visible hitch right at the sweep's end).
  private dissolveRT: RenderTexture | null = null;

  // Cache keys for static layers.
  private staticDirty = true;
  private obstaclesKey = "";
  private obstaclesBulged = false;
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
      // Nothing reads the canvas back (the dissolve snapshots GPU-side via
      // captureForDissolve), so keep the swap chain unconstrained —
      // preserveDrawingBuffer forces copy-on-present on some GPUs and shows
      // up as occasional compositor jank.
      preserveDrawingBuffer: false,
      autoStart: false,
      sharedTicker: false,
      powerPreference: "high-performance",
    });
    this.app.ticker.stop(); // the game loop drives rendering explicitly

    this.wallGlow.blendMode = "add";
    this.wallsScope.addChild(this.wallGlow, this.wallCore);
    this.wallsScope.mask = this.fenceMask;

    this.lockZonesContainer.addChild(this.lockZonesG, this.coloredAreasG, this.circuitG, this.chargeG, this.dataStreamG);
    this.boardScope.addChild(
      this.rainLayer,
      this.boardBase,
      this.lockZonesContainer, // gold floor markings beneath movers/walls
      this.movers,
      this.breakables,
      // Board edge + obstacle outlines sit BELOW the fences, so a fence's green
      // covers the wall's white border at the join and the greens read as one
      // merged organism (the fence's own white already fades out at the join).
      this.obstacles,
      this.phasing,
      this.edgeWalls,
      this.wallsScope,
      this.fenceMask, // sibling of the container it masks
      this.rim,
      this.danger,
      this.mirrors,
      this.mirrorCracks,
      this.debris,
      this.chains,
      this.effects.container,
      this.balls.container,
      this.activeFence,
      this.activeFenceMaskG,
    );
    this.root.addChild(this.boardScope, this.boardMask, this.effects.overlayContainer);
    this.boardScope.mask = this.boardMask;
    // The dissolve is a stage-level sibling: it must stay visible while the
    // rest of the scene (root, sweep slices) is hidden under it.
    this.app.stage.addChild(this.root, this.dissolve.container);

    // The neon look's payoff pass: everything bright in the board scope blooms.
    // Threshold keeps the dark grid/region fills untouched; the baked glows
    // carry most of the halo so the filter stays modest (quality vs mobile GPU).
    this.bloom = new AdvancedBloomFilter({
      threshold: 0.45,
      bloomScale: 0.8,
      brightness: 1.0,
      blur: 6,
      quality: 3,
    });
    this.boardScope.filters = [this.bloom];

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
    // Same-size "resizes" happen on every level re-init (GameCanvas calls
    // resizeCanvas per effect run). Destroying every canvas-backed texture
    // then is pure waste - and any retained sprite that isn't re-textured
    // before the next present would render a destroyed texture (null source,
    // batcher crash). Only a real dimension change pays that cost.
    if (this.app.renderer.width === widthPx && this.app.renderer.height === heightPx) return;
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
    // Evict canvas textures whose bake was dropped (level re-init recreates
    // the grid/region canvases and clears the ball/glyph caches); runs before
    // the syncs so everything still live is re-fetched this same frame.
    sweepCanvasTextures();

    // ── Shatter dissolve replaces the whole scene ──
    if (game.dissolve) {
      if (this.sweep) this.teardownSweep(); // the drained slices become the tiles
      this.root.visible = false;
      this.dissolve.render(game.dissolve as DissolveState, now, this.dissolveRT?.source);
      this.app.render();
      return;
    }
    // No dissolve in flight: release its resources (no-ops when already clear)
    // and restore scene visibility after a sweep / presentEmpty.
    this.dissolve.clear();
    this.clearDissolveRT();
    this.root.visible = true;
    this.boardScope.visible = true;
    this.effects.overlayContainer.visible = true;

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

    // ── Level-clear sweep: snapshot the frozen scene, then just animate it ──
    // shimmerStart can sit in the FUTURE (it waits for lock flashes to play
    // out), so keep live-rendering until the sweep actually begins.
    if (game.shimmerStart > 0 && now >= game.shimmerStart) {
      this.renderSweep(game, accent, scale, now);
      this.app.render();
      return;
    }
    if (this.sweep) this.teardownSweep();

    {
      this.syncRain(game, rctx, scale, now);
      this.syncLockZones(game, w2s, scale);
      this.syncColoredAreas(game, w2s, scale);
      this.syncCircuit(game, w2s, scale, now);
      this.syncCharges(game, w2s, scale, now);
      this.syncDataStream(game, w2s, scale, now);
      this.syncMovers(game, w2s, scale, now);
      this.syncObstacles(game, w2s, scale, accent);
      this.syncPhasing(game, w2s, scale);
      this.syncChains(game, w2s, scale);
      this.syncBreakables(game, w2s, scale);
      this.syncMirrors(game, w2s, scale);
      this.syncMirrorCracks(game, w2s, scale);
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

  // ── Level-clear sweep (renderFrame's renderClearShimmer, snapshot-based) ──
  // Both looks are baked ONCE at sweep start (live scene + drained version);
  // per sweep frame the two slices are plain textured quads whose texture
  // frames are cropped at the wave line - no filters, no masks, no per-frame
  // tessellation, so the wave itself costs almost nothing.
  private renderSweep(game: CanvasGameState, accent: string, scale: number, now: number): void {
    const { left: bl, top: bt, width: bw, height: bh } = game.boardRect;
    const W = this.app.renderer.width;
    const H = this.app.renderer.height;

    if (!this.sweep || this.sweepKey !== game.shimmerStart) {
      this.teardownSweep();
      this.sweepKey = game.shimmerStart;
      // The space bar under the board doesn't outlive the board: exclude it
      // from the snapshot so the sweep takes it too (restored on teardown via
      // the normal render path).
      this.effects.overlayContainer.visible = false;
      // Snapshot the live scene (including the bloom pass) exactly once.
      const liveRT = RenderTexture.create({ width: W, height: H });
      this.app.renderer.render({ container: this.root, target: liveRT });
      // Bake the drained wake once: desaturated + lifted toward white.
      const drainedRT = RenderTexture.create({ width: W, height: H });
      const tmp = new Sprite(liveRT);
      const grey = new ColorMatrixFilter();
      grey.desaturate();
      grey.brightness(1.25, true);
      tmp.filters = [grey];
      this.app.renderer.render({ container: tmp, target: drainedRT });
      tmp.destroy();
      grey.destroy(); // Pixi does not free a display object's filters on destroy()
      // Both sprites are full-frame and pixel-aligned; only the drained one is
      // cropped (rect mask) — the live one simply shows wherever it isn't
      // covered. NB: don't crop by mutating texture.frame — the sprite keeps
      // scaling by the texture's original size, which stretches the slice.
      const below = new Sprite(liveRT);
      const above = new Sprite(drainedRT);
      const aboveMask = new Graphics();
      above.mask = aboveMask;
      const wave = new Graphics();
      wave.blendMode = "add";
      this.app.stage.addChild(below, above, aboveMask, wave);
      this.root.visible = false;
      this.sweep = { liveRT, drainedRT, above, below, aboveMask, wave };
    }

    const raw = now - game.shimmerStart;
    const el = Math.min(raw, LEVEL_CLEAR_SHIMMER_MS);
    const progress = Math.max(0, Math.min(1, el / LEVEL_CLEAR_SHIMMER_MS));
    const waveY = bt + bh * progress;

    const s = this.sweep;
    const split = Math.max(0, Math.min(H, Math.round(waveY)));
    s.above.visible = split > 0;
    if (split > 0) {
      s.aboveMask.clear().rect(0, 0, W, split).fill(0xffffff);
    }

    // Luminous band + bright leading edge, fading as the sweep completes.
    const bandH = 46 * scale;
    const peak = Math.sin(progress * Math.PI);
    s.wave.clear();
    if (progress < 1) {
      s.wave
        .rect(bl, Math.max(bt, waveY - bandH), bw, Math.min(bandH, waveY - bt))
        .fill({ color: accent, alpha: 0.25 * (0.4 + peak * 0.6) })
        .moveTo(bl, waveY)
        .lineTo(bl + bw, waveY)
        .stroke({ width: 3 * scale, color: 0xffffff, alpha: 0.85 })
        .moveTo(bl, waveY)
        .lineTo(bl + bw, waveY)
        .stroke({ width: 9 * scale, color: accent, alpha: 0.35 });
    }
  }

  /**
   * Present a blank frame (the board has shattered away after a level clear).
   * The next real render() restores visibility; initGame resets shimmer state.
   */
  presentEmpty(): void {
    if (!this.ready) return;
    this.teardownSweep();
    this.dissolve.clear();
    this.clearDissolveRT();
    this.root.visible = false;
    this.app.render();
  }

  /**
   * GPU-side snapshot of whatever is currently presented (the drained sweep
   * after a level clear, the live scene on game over) for the shatter tiles.
   * Replaces the ctx.drawImage(canvas) readback, which stalled the frame.
   */
  captureForDissolve(tint?: string): void {
    if (!this.ready) return;
    this.dissolveRT?.destroy(true);
    const W = this.app.renderer.width;
    const H = this.app.renderer.height;
    this.dissolveRT = RenderTexture.create({ width: W, height: H });
    this.app.renderer.render({ container: this.app.stage, target: this.dissolveRT });
    if (tint) {
      const g = new Graphics().rect(0, 0, W, H).fill(tint);
      this.app.renderer.render({ container: g, target: this.dissolveRT, clear: false });
      g.destroy();
    }
  }

  private clearDissolveRT(): void {
    if (this.dissolveRT) {
      this.dissolveRT.destroy(true);
      this.dissolveRT = null;
    }
  }

  private teardownSweep(): void {
    if (!this.sweep) return;
    const s = this.sweep;
    s.above.destroy();
    s.below.destroy();
    s.aboveMask.destroy();
    s.wave.destroy();
    s.liveRT.destroy(true);
    s.drainedRT.destroy(true);
    this.sweep = null;
    this.sweepKey = 0;
    this.root.visible = true;
  }

  // ── Board grid + region fill (textures over the shared OffscreenCanvases) ──
  private syncStaticSprites(rctx: RenderContext): void {
    const ensure = (sprite: Sprite | null, canvas: OffscreenCanvas, atIndex: number): Sprite => {
      const tex = textureFor(canvas);
      if (!sprite || sprite.texture !== tex) {
        sprite?.destroy();
        sprite = new Sprite(tex);
        this.boardBase.addChildAt(sprite, Math.min(atIndex, this.boardBase.children.length));
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

  // ── Ambient data rain (section B; same particle state contract as 2D) ─────
  private syncRain(game: CanvasGameState, rctx: RenderContext, scale: number, now: number): void {
    const rain: RainState = rctx.rain;
    const dtRain = rain.lastTime ? Math.min((now - rain.lastTime) / 1000, 0.05) : 0;
    rain.lastTime = now;
    const { left: bx, top: by } = game.boardRect;
    const fontPx = Math.round(14 * scale);
    for (let i = 0; i < rain.particles.length; i++) {
      const p = rain.particles[i];
      p.y += p.speed * dtRain;
      if (p.y > BOARD_HEIGHT + 20) {
        p.y = -(10 + Math.random() * 60);
        p.x = 15 + Math.random() * (BOARD_WIDTH - 30);
        p.symbol = RAIN_SYMBOLS[Math.floor(Math.random() * RAIN_SYMBOLS.length)];
        p.alpha = 0.03 + Math.random() * 0.04;
        p.speed = 30 + Math.random() * 50;
      }
      let s = this.rainSprites[i];
      if (!s) {
        s = new Sprite();
        s.anchor.set(0);
        this.rainSprites.push(s);
        this.rainLayer.addChild(s);
      }
      const glyph = getRainGlyph(p.symbol, rctx.accentColor, fontPx);
      s.texture = textureFor(glyph.canvas);
      s.alpha = p.alpha;
      s.position.set(Math.round(bx + p.x * scale) - glyph.pad, Math.round(by + p.y * scale) - glyph.pad);
      s.visible = true;
    }
    for (let i = rain.particles.length; i < this.rainSprites.length; i++) {
      this.rainSprites[i].visible = false;
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

      // Black-ball damage cracks (jagged outline follows the live polygon).
      const dmover = game.destructibles.find(d => d.kind === "mover" && !d.destroyed && d.moverId === mover.id);
      if (dmover && dmover.hits > 0) {
        this.strokeCracks(g, mover.polygon.vertices, dmover.hits, `mover-${mover.id}`, w2s, scale, MOVER_COLOR);
      }
    }
  }

  /** drawDamageCracks port: bold jagged outline in the object's colour. */
  private strokeCracks(
    g: Graphics,
    verts: { x: number; y: number }[],
    level: number,
    seedKey: string,
    w2s: W2S,
    scale: number,
    color: number | string,
  ): void {
    if (level <= 0 || verts.length < 3) return;
    const rng = mulberry(hashStr(seedKey));
    const amp = 3 + level * 4;
    const SUB = 3;
    const pts: number[] = [];
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const el = Math.hypot(ex, ey) || 1;
      const px = -ey / el, py = ex / el;
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB;
        const off = (rng() * 2 - 1) * amp;
        const sp = w2s(a.x + ex * t + px * off, a.y + ey * t + py * off);
        pts.push(sp.x, sp.y);
      }
    }
    pts.push(pts[0], pts[1]);
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke({
      width: Math.max(1.5, 2.4 * scale),
      color,
      alpha: Math.min(1, 0.7 + level * 0.2),
      cap: "round",
      join: "round",
    });
  }

  // ── Mirror damage cracks (hits change at runtime, unlike the static fills) ─
  private syncMirrorCracks(game: CanvasGameState, w2s: W2S, scale: number): void {
    const g = this.mirrorCracks;
    g.clear();
    for (const d of game.destructibles) {
      if (d.kind === "mirror" && !d.destroyed && d.hits > 0 && d.mirrorPolygon) {
        this.strokeCracks(g, d.mirrorPolygon.vertices, d.hits, `mirror-${d.id}`, w2s, scale, 0x88ddff);
      }
    }
  }

  // ── Static obstacle outlines (section F) ──────────────────────────────────
  // ── Bonus-lock zones (greed hook) ─────────────────────────────────────────
  // Static per map: a gold floor tint + dashed border + ×N label, rebuilt only
  // when the zone set / boardRect / scale changes.
  private syncLockZones(game: CanvasGameState, w2s: W2S, scale: number): void {
    const zones = game.lockZones ?? [];
    const key = zones.map(z => `${z.x},${z.y},${z.width},${z.height},${z.multiplier}`).join("|")
      + `_${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 1000)}`;
    if (this.lockZonesKey === key) return;
    this.lockZonesKey = key;

    const g = this.lockZonesG;
    g.clear();
    for (const t of this.lockZoneLabels) { t.parent?.removeChild(t); t.destroy(); }
    this.lockZoneLabels = [];

    for (const z of zones) {
      const tl = w2s(z.x, z.y);
      const zw = z.width * scale;
      const zh = z.height * scale;
      g.rect(tl.x, tl.y, zw, zh).fill({ color: 0xffd76b, alpha: 0.10 });
      dashedLine(g, tl.x, tl.y, tl.x + zw, tl.y, 8 * scale, 6 * scale);
      dashedLine(g, tl.x + zw, tl.y, tl.x + zw, tl.y + zh, 8 * scale, 6 * scale);
      dashedLine(g, tl.x + zw, tl.y + zh, tl.x, tl.y + zh, 8 * scale, 6 * scale);
      dashedLine(g, tl.x, tl.y + zh, tl.x, tl.y, 8 * scale, 6 * scale);
      g.stroke({ width: Math.max(1, 2 * scale), color: 0xffd76b, alpha: 0.7 });

      const fontPx = Math.max(12, Math.min(zw, zh) * 0.28);
      const label = new Text({
        text: `×${z.multiplier}`,
        style: new TextStyle({
          fontFamily: "sans-serif",
          fontWeight: "bold",
          fontSize: fontPx,
          fill: 0xffe9a8,
          stroke: { color: 0x78501e, width: Math.max(1, scale) },
        }),
      });
      label.anchor.set(0.5);
      label.position.set(tl.x + zw / 2, tl.y + zh / 2);
      this.lockZonesContainer.addChild(label);
      this.lockZoneLabels.push(label);
    }
  }

  // ── Colored Areas (required win-gate) ─────────────────────────────────────
  // Static per map: a light-coloured zone with its kind (var/let/const) +
  // multiplier at centre. Rebuilt only when the areas / boardRect / scale change.
  private syncColoredAreas(game: CanvasGameState, w2s: W2S, scale: number): void {
    const areas = game.coloredAreas ?? [];
    // `satisfied` is in the key so the (otherwise static) graphics rebuild the
    // instant a ball locks inside and the zone lights up.
    const key = areas.map(a => `${a.x},${a.y},${a.width},${a.height},${a.kind},${a.satisfied ? 1 : 0}`).join("|")
      + `_${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 1000)}`;
    if (this.coloredAreasKey === key) return;
    this.coloredAreasKey = key;

    const g = this.coloredAreasG;
    g.clear();
    for (const t of this.coloredAreaLabels) { t.parent?.removeChild(t); t.destroy(); }
    this.coloredAreaLabels = [];

    for (const a of areas) {
      const st = areaStyle(a.kind);
      const tl = w2s(a.x, a.y);
      const aw = a.width * scale;
      const ah = a.height * scale;
      const lit = !!a.satisfied;
      // Used win-gate: a brighter fill + a solid, glowing border reads as "this
      // zone is filled" vs the dashed, dim "target here" prompt.
      g.rect(tl.x, tl.y, aw, ah).fill({ color: st.color, alpha: lit ? 0.32 : 0.12 });
      if (lit) {
        g.rect(tl.x - 3 * scale, tl.y - 3 * scale, aw + 6 * scale, ah + 6 * scale)
          .stroke({ width: Math.max(1, 2 * scale), color: st.color, alpha: 0.4 });
        g.rect(tl.x, tl.y, aw, ah).stroke({ width: Math.max(2, 3 * scale), color: st.color, alpha: 1 });
      } else {
        dashedLine(g, tl.x, tl.y, tl.x + aw, tl.y, 9 * scale, 6 * scale);
        dashedLine(g, tl.x + aw, tl.y, tl.x + aw, tl.y + ah, 9 * scale, 6 * scale);
        dashedLine(g, tl.x + aw, tl.y + ah, tl.x, tl.y + ah, 9 * scale, 6 * scale);
        dashedLine(g, tl.x, tl.y + ah, tl.x, tl.y, 9 * scale, 6 * scale);
        g.stroke({ width: Math.max(1, 2 * scale), color: st.color, alpha: 0.75 });
      }

      const cx = tl.x + aw / 2, cy = tl.y + ah / 2;
      const labelPx = Math.max(13, Math.min(aw, ah) * 0.2);
      const stroke = { color: 0x000000, width: Math.max(1, scale) };
      const kindText = new Text({
        text: st.label,
        style: new TextStyle({ fontFamily: "monospace", fontWeight: "bold", fontSize: labelPx, fill: st.color, stroke }),
      });
      kindText.anchor.set(0.5, 1);
      kindText.position.set(cx, cy + labelPx * 0.25);
      const multText = new Text({
        text: `×${st.multiplier}`,
        style: new TextStyle({ fontFamily: "monospace", fontWeight: "bold", fontSize: labelPx * 0.6, fill: st.color, stroke }),
      });
      multText.anchor.set(0.5, 0);
      multText.position.set(cx, cy + labelPx * 0.35);
      this.lockZonesContainer.addChild(kindText, multText);
      this.coloredAreaLabels.push(kindText, multText);
    }
  }

  // "Wire the Integration" (#73): each terminal node (dim -> bright once a fence
  // routes through it) with a faint link line to the DORMANT ball it boots, so
  // the player sees which node wakes which sleeper. Redrawn every frame to pulse.
  private syncCircuit(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const g = this.circuitG;
    g.clear();
    const c = game.circuit;
    if (!c) return;

    const LIT = 0x7fe3d4;   // teal, matches the const palette
    const DIM = 0x59b3a3;   // muted teal, still clearly visible when unlit
    const pulse = 0.5 + 0.5 * Math.sin(now / 340); // 0..1 breathing

    for (const t of c.terminals) {
      const p = w2s(t.x, t.y);
      const ball = game.balls.find(b => b.id === t.ballId);
      const booted = !ball || ball.state !== "dormant";
      const color = t.lit ? LIT : DIM;
      // NON-ACTIVE (unlit) nodes pulsate slightly; a lit node holds steady, so the
      // pulse reads as "this one still needs wiring". `br` is the breathe factor.
      const br = t.lit ? 1 : pulse;

      // Link line to its still-sleeping ball (telegraphs which node wakes it).
      if (ball && !booted) {
        const bp = w2s(ball.position.x, ball.position.y);
        dashedLine(g, p.x, p.y, bp.x, bp.y, 8 * scale, 6 * scale);
        g.stroke({ width: Math.max(1, 1.5 * scale), color, alpha: 0.2 + 0.25 * br });
      }

      const rr = Math.max(8, t.radius * scale);
      // Halo: pulses (radius + alpha) while non-active, steady + faint once lit.
      const haloR = rr + (t.lit ? 4 : 4 + 6 * pulse) * scale;
      g.circle(p.x, p.y, haloR).stroke({ width: Math.max(1.5, 2 * scale), color, alpha: t.lit ? 0.4 : 0.4 * (0.35 + 0.65 * pulse) });
      // Solid ring: a slight size + alpha breathe while non-active, steady when lit.
      const ringR = rr + (t.lit ? 0 : 1.5 * pulse * scale);
      g.circle(p.x, p.y, ringR).stroke({ width: Math.max(2.5, 3 * scale), color, alpha: t.lit ? 1 : 0.7 + 0.3 * pulse });
      // Core dot: steady when lit, breathing when not.
      g.circle(p.x, p.y, Math.max(2.5, 3.5 * scale)).fill({ color, alpha: t.lit ? 1 : 0.6 + 0.4 * pulse });
    }
  }

  // ── "Deploy Charge" fuses: a marker on the slab, pulsing while armed ────────
  private syncCharges(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const g = this.chargeG;
    g.clear();
    const charges = game.charges;
    if (!charges || charges.length === 0) return;

    const DIM = 0xffb454;  // amber, matches the breakable slab palette
    const HOT = 0xff5b3d;  // hot orange while armed / about to blow

    for (const c of charges) {
      if (c.blown) continue;
      const p = w2s(c.fuse.x, c.fuse.y);
      const rr = Math.max(7, c.radius * scale);

      if (c.armedAt === null) {
        // Idle fuse: a steady amber ring + a small "spark" core so it reads as
        // interactive (route a fence past it), calmer than the armed state.
        const breath = 0.5 + 0.5 * Math.sin(now / 420);
        g.circle(p.x, p.y, rr).stroke({ width: Math.max(2, 2.5 * scale), color: DIM, alpha: 0.85 });
        g.circle(p.x, p.y, Math.max(2.5, 3.5 * scale)).fill({ color: DIM, alpha: 0.6 + 0.4 * breath });
      } else {
        // Armed: the closer to detonation, the faster + hotter it flashes, and a
        // shrinking countdown ring telegraphs the imminent blast + its radius.
        const frac = Math.min(1, Math.max(0, (game.activePlaySeconds - c.armedAt) / c.delaySeconds));
        const flash = 0.5 + 0.5 * Math.sin(now / (60 + 160 * (1 - frac)));
        // Countdown ring collapsing from the blast radius toward the fuse.
        const blastR = c.blastRadius * scale;
        g.circle(p.x, p.y, blastR * (1 - frac)).stroke({ width: Math.max(1.5, 2 * scale), color: HOT, alpha: 0.25 + 0.35 * flash });
        // The fuse itself, flashing hotter as it winds up.
        g.circle(p.x, p.y, rr).stroke({ width: Math.max(2.5, 3 * scale), color: HOT, alpha: 0.6 + 0.4 * flash });
        g.circle(p.x, p.y, Math.max(3, 4 * scale)).fill({ color: HOT, alpha: 0.7 + 0.3 * flash });
      }
    }
  }

  // ── "Data Stream" seam: a glowing vein, spans brighten once harvested ──────
  private syncDataStream(game: CanvasGameState, w2s: W2S, scale: number, now: number): void {
    const g = this.dataStreamG;
    g.clear();
    const ds = game.dataStream;
    if (!ds || ds.path.length < 2) return;

    const DIM = 0x9b7bff; // violet vein, distinct from the teal circuit + amber fuse
    const HOT = 0xd6c2ff; // brightened once a span is harvested
    const flow = 0.5 + 0.5 * Math.sin(now / 300); // gentle data-flow shimmer

    for (let i = 0; i < ds.path.length - 1; i++) {
      const a = w2s(ds.path[i].x, ds.path[i].y);
      const b = w2s(ds.path[i + 1].x, ds.path[i + 1].y);
      const done = ds.harvested[i];
      const color = done ? HOT : DIM;
      // Harvested spans read solid + bright; unharvested pulse as a dashed lure.
      if (done) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: Math.max(2.5, 3.5 * scale), color, alpha: 0.9, cap: "round" });
      } else {
        dashedLine(g, a.x, a.y, b.x, b.y, 12 * scale, 8 * scale);
        g.stroke({ width: Math.max(2, 3 * scale), color, alpha: 0.4 + 0.4 * flow, cap: "round" });
      }
      // Node dots at each vertex so the seam reads as a routed path.
      g.circle(a.x, a.y, Math.max(2, 2.5 * scale)).fill({ color, alpha: done ? 0.95 : 0.5 + 0.4 * flow });
    }
    const last = ds.path[ds.path.length - 1];
    const lp = w2s(last.x, last.y);
    g.circle(lp.x, lp.y, Math.max(2, 2.5 * scale)).fill({ color: ds.harvested[ds.harvested.length - 1] ? HOT : DIM, alpha: 0.7 });
  }

  private syncObstacles(game: CanvasGameState, w2s: W2S, scale: number, accent: string): void {
    const bulging = anyObstacleImpactsActive();
    const phasingCount = game.phasingObjects?.length ?? 0;
    const key = `${accent}_${Math.round(game.boardRect.left)}_${Math.round(game.boardRect.top)}_${Math.round(scale * 10000)}_${game.obstaclePolygons.length}`;
    // Cached unless the level/layout changed, a bulge is animating, or one just
    // ended (redraw once flat). While bulging, force a redraw every frame. Phasing
    // obstacles are drawn every frame by syncPhasing, so exclude them here.
    if (!bulging && !this.obstaclesBulged && this.obstaclesKey === key) return;
    this.obstaclesBulged = bulging;
    this.obstaclesKey = bulging ? "__bulging__" : key;
    const g = this.obstacles;
    g.clear();
    const mirrorSet = new Set(game.mirrorPolygons);
    const breakableSet = new Set(game.destructibles.filter(d => d.kind === "breakable" && d.obstaclePolygon).map(d => d.obstaclePolygon));
    const phasingSet = phasingCount > 0 ? new Set(game.phasingObjects.map(p => p.polygon)) : null;
    for (const poly of game.obstaclePolygons) {
      if (mirrorSet.has(poly as Polygon) || breakableSet.has(poly as Polygon)) continue;
      if (phasingSet && phasingSet.has(poly as Polygon)) continue;
      // Subdivide edges + sample the bulge so the dome is smooth on low-poly
      // obstacles; away from hits the samples stay collinear (flat outline).
      const pts: number[] = [];
      const verts = poly.vertices;
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i], b = verts[(i + 1) % verts.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const sub = bulging ? Math.max(1, Math.round(Math.hypot(dx, dy) / 10)) : 1;
        for (let s = 0; s < sub; s++) {
          const t = s / sub;
          const wx = a.x + dx * t, wy = a.y + dy * t;
          const sp = w2s(wx, wy);
          if (bulging) {
            const off = obstacleBulgeAt(wx, wy, scale);
            pts.push(sp.x + off.dx, sp.y + off.dy);
          } else {
            pts.push(sp.x, sp.y);
          }
        }
      }
      g.poly(pts).stroke({ width: WALL_THICKNESS * scale * 2.2, color: accent, alpha: 0.18, join: "round", cap: "round" });
      g.poly(pts).stroke({ width: WALL_THICKNESS * scale, color: accent, alpha: 1, join: "round", cap: "round" });
    }
  }

  // ── Phasing obstacles (#64): solid when in, ghost outline when out ─────────
  private syncPhasing(game: CanvasGameState, w2s: W2S, scale: number): void {
    const g = this.phasing;
    g.clear();
    const objs = game.phasingObjects;
    if (!objs || objs.length === 0) return;
    const col = 0x66ccff; // cyan phasing tint, distinct from the green obstacles
    for (const obj of objs) {
      const pts: number[] = [];
      for (const v of obj.polygon.vertices) { const sp = w2s(v.x, v.y); pts.push(sp.x, sp.y); }
      const a = Math.max(0, Math.min(1, obj.alpha));
      // `phase` is the source of truth (#69): solid = tangible block, out = ghost.
      // Rendering off `phase` (not an alpha threshold) means the object reads as a
      // pass-through ghost the instant it stops colliding, never a solid-looking
      // block you still bounce off mid-fade.
      if (obj.phase === "in") {
        // Solid / re-forming: filled block with a bright border, dimming as it forms.
        g.poly(pts).fill({ color: col, alpha: 0.12 * a });
        g.poly(pts).stroke({ width: WALL_THICKNESS * scale, color: col, alpha: 0.4 + 0.6 * a, join: "round" });
      } else {
        // Phased out (intangible): a faint dashed-looking thin ghost so its
        // footprint stays readable while clearly signalling "you pass through".
        g.poly(pts).stroke({ width: WALL_THICKNESS * scale * 0.5, color: col, alpha: 0.12 + 0.28 * a, join: "round" });
      }
    }
  }

  // ── Chains (#64): a rope between two balls ─────────────────────────────────
  private syncChains(game: CanvasGameState, w2s: W2S, scale: number): void {
    const g = this.chains;
    g.clear();
    const chains = game.chains;
    if (!chains || chains.length === 0) return;
    for (const ch of chains) {
      if (ch.nodes.length < 2) continue;
      const scr = ch.nodes.map(n => w2s(n.x, n.y));
      const col = ch.breaksFences ? 0xff5b5b : 0xb7c0d8; // boss chain red-hot, gift chain steel
      const line = (width: number, color: number, alpha: number) => {
        g.moveTo(scr[0].x, scr[0].y);
        for (let i = 1; i < scr.length; i++) g.lineTo(scr[i].x, scr[i].y);
        g.stroke({ width, color, alpha, join: "round", cap: "round" });
      };
      line(6 * scale, 0x000000, 0.5);      // dark rope under-stroke
      line(3.5 * scale, col, 0.95);        // bright core
      for (const sp of scr) g.circle(sp.x, sp.y, 2.4 * scale).fill({ color: col, alpha: 0.9 }); // link nubs
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
      // Chests read as gold treasure; ordinary breakables stay amber.
      const amber = d.chest ? "#ffd76b" : (d.objective ? "#ffb454" : "#ffcf7a");
      // The object stays intact-looking until the final hit breaks it; damage
      // shows ONLY as local dents/craters where the balls actually struck.
      const pts = dentedOutline(poly.vertices, 0, d.dents ?? [], 28, 30, mulberry(hashStr(`break-${d.id}`)), bounds);
      const flat: number[] = [];
      for (const p of pts) {
        const sp = w2s(p.x, p.y);
        flat.push(sp.x, sp.y);
      }
      g.poly(flat).fill({ color: amber, alpha: 0.14 });
      g.poly(flat).stroke({ width: Math.max(2, WALL_THICKNESS * scale), color: amber, alpha: 1, join: "round", cap: "round" });

      // A dark crater dimple + short cracks at each impact, nudged inward off
      // the edge so it reads as a gouge in the object's face, not a floating dot.
      if (d.dents && d.dents.length) {
        let cx = 0, cy = 0;
        for (const v of poly.vertices) { cx += v.x; cy += v.y; }
        cx /= poly.vertices.length; cy /= poly.vertices.length;
        const crng = mulberry(hashStr(`crater-${d.id}`));
        for (const imp of d.dents) {
          let ix = cx - imp.x, iy = cy - imp.y;
          const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
          const sp = w2s(imp.x + ix * 9, imp.y + iy * 9);
          const r = 13 * scale * imp.s; // harder hit → bigger crater
          g.circle(sp.x, sp.y, r).fill({ color: 0x3a2408, alpha: 0.24 });
          g.circle(sp.x, sp.y, r * 0.55).fill({ color: 0x24160a, alpha: 0.45 });
          // Cracks radiate INTO the object (a cone around the inward normal),
          // jagged with a mid kink so they read as fractures, not spokes; their
          // length scales with the force of this hit.
          const baseAng = Math.atan2(iy, ix);
          for (let k = 0; k < 4; k++) {
            const a = baseAng + (crng() - 0.5) * 1.6;
            const len = (18 + crng() * 22) * scale * imp.s;
            const dx = Math.cos(a), dy = Math.sin(a);
            const kink = (crng() - 0.5) * len * 0.28;
            const mx = sp.x + dx * len * 0.55 - dy * kink;
            const my = sp.y + dy * len * 0.55 + dx * kink;
            g.moveTo(sp.x, sp.y)
              .lineTo(mx, my)
              .lineTo(sp.x + dx * len, sp.y + dy * len)
              .stroke({ width: Math.max(1, 1.6 * scale), color: 0x2a1a06, alpha: 0.55 });
          }
        }
      }

      // Treasure chests get a lid seam + clasp so they read as loot, not a block.
      if (d.chest) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const v of poly.vertices) {
          if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
        }
        const tl = w2s(minX, minY), br = w2s(maxX, maxY);
        const x0 = Math.min(tl.x, br.x), x1 = Math.max(tl.x, br.x);
        const y0 = Math.min(tl.y, br.y), y1 = Math.max(tl.y, br.y);
        const lidY = y0 + (y1 - y0) * 0.36;
        const cx2 = (x0 + x1) / 2;
        g.moveTo(x0, lidY).lineTo(x1, lidY)
          .stroke({ width: Math.max(1.5, 2 * scale), color: 0x785014, alpha: 0.85, cap: "round" });
        const cw = Math.max(5, 8 * scale), ch = Math.max(6, 11 * scale);
        g.rect(cx2 - cw / 2, lidY - ch * 0.35, cw, ch).fill({ color: 0xffecaa, alpha: 0.95 });
        g.rect(cx2 - cw / 2, lidY - ch * 0.35, cw, ch).stroke({ width: Math.max(1, 1.2 * scale), color: 0x785014, alpha: 0.9 });
      }
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
          const ang = p.rotation + p.rotSpeed * t;
          const c = Math.cos(ang) * (size / 2), sn = Math.sin(ang) * (size / 2);
          g.poly([
            sp.x - c + sn, sp.y - sn - c,
            sp.x + c + sn, sp.y + sn - c,
            sp.x + c - sn, sp.y + sn + c,
            sp.x - c - sn, sp.y - sn + c,
          ]).fill({ color: debris.color, alpha });
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

    // Treasure-chest loot gems: bouncing diamonds tinted by their reward (#38).
    if (game.chestLoot && game.chestLoot.length > 0) {
      for (const gem of game.chestLoot) {
        const a = chestLootAlpha(gem, game.activePlaySeconds);
        if (a <= 0) continue;
        const sp = w2s(gem.x, gem.y);
        const r = 9 * scale;
        const col = getAbility(gem.reward)?.color ?? "#ffd76b";
        // Pulsing "tap me" ring: the gem must be tapped to collect it (#38 rework).
        const pulse = 0.5 + 0.5 * Math.sin(game.activePlaySeconds * 8);
        g.circle(sp.x, sp.y, r * (1.7 + 0.45 * pulse)).stroke({ width: Math.max(1, 2 * scale), color: col, alpha: a * (0.3 + 0.45 * pulse) });
        g.poly([sp.x, sp.y - r, sp.x + r, sp.y, sp.x, sp.y + r, sp.x - r, sp.y]).fill({ color: col, alpha: a });
        g.poly([sp.x, sp.y - r, sp.x + r, sp.y, sp.x, sp.y + r, sp.x - r, sp.y]).stroke({ width: Math.max(1, 1.2 * scale), color: 0xffffff, alpha: a * 0.5 });
      }
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

    const strokePath = (g: Graphics, pts: number[], width: number, color: number | string, alpha: number, closed = false, cap: "round" | "butt" = "round") => {
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      if (closed) g.closePath();
      g.stroke({ width, color, alpha, cap, join: "round" });
    };

    // Stroke a whole connected wall run (fence chain or the board loop) as ONE
    // continuous path, so shared vertices become clean round joins instead of a
    // pile of per-segment caps. `world` has >= 2 points; pass `closed` for a loop.
    const strokeWallPath = (
      gGlow: Graphics, gCore: Graphics,
      world: Vector2[],
      baseWidth: number, glowBoost: number,
      closed = false,
      taperLen = 0,
      flareEnds: [boolean, boolean] = [true, true],
      greenOnly = false,
      skipGreen = false,
    ) => {
      if (world.length < 2) return;
      // Thicken the drawn line only (physics thickness untouched) so the circuit
      // skeleton has room to read.
      if (WALL_CIRCUITS_ENABLED) baseWidth *= WALL_RENDER_THICKEN;

      const scr = world.map(p => w2s(p.x, p.y));

      // Arc lengths along the run, for the root taper near the ends.
      const cum: number[] = [0];
      for (let i = 1; i < scr.length; i++) {
        cum[i] = cum[i - 1] + Math.hypot(scr[i].x - scr[i - 1].x, scr[i].y - scr[i - 1].y);
      }
      const totalLen = cum[scr.length - 1];
      const rootAt = (pos: number) =>
        taperLen > 0 ? taperFactor(Math.min(pos, totalLen - pos), taperLen) : { w: 1, a: 1 };

      // Impact wobble: resample the run if any sub-segment is near an impact.
      let hasImpact = false;
      for (let i = 0; i < world.length - 1; i++) {
        if (hasNearbyImpacts(world[i], world[i + 1])) { hasImpact = true; break; }
      }
      let pts: number[];
      let maxGlow = 0;
      if (!hasImpact) {
        pts = [];
        for (const p of scr) pts.push(p.x, p.y);
      } else {
        pts = [];
        for (let sIdx = 0; sIdx < world.length - 1; sIdx++) {
          const ws = world[sIdx], we = world[sIdx + 1];
          const ss = scr[sIdx], es = scr[sIdx + 1];
          const sdx = es.x - ss.x, sdy = es.y - ss.y;
          for (let i = sIdx === 0 ? 0 : 1; i <= N_NODES; i++) {
            const t = i / N_NODES;
            const { dx, dy, glow } = getEffectsAtPoint(
              { x: ws.x + (we.x - ws.x) * t, y: ws.y + (we.y - ws.y) * t }, scale,
            );
            pts.push(ss.x + sdx * t + dx, ss.y + sdy * t + dy);
            if (glow > maxGlow) maxGlow = glow;
          }
        }
      }

      // The green-only pass just relays the centerline on top (so fence-to-fence
      // junctions merge — see the second fence pass below); skip glow + skeleton.
      // Fence glow (taperLen > 0) uses butt end-caps so it doesn't bulge past a
      // fence-to-fence end (joins stay round). Wall ends are masked anyway.
      if (!greenOnly) {
        const gcap = taperLen > 0 ? "butt" : "round";
        strokePath(gGlow, pts, baseWidth * (2.8 + glowBoost * 2.5), accent, 0.10 + glowBoost * 0.22, closed, gcap);
        strokePath(gGlow, pts, baseWidth * (1.6 + glowBoost * 1.8), accent, 0.18 + glowBoost * 0.25, closed, gcap);
        if (glowBoost > 0.05) {
          strokePath(gGlow, pts, baseWidth * (3.5 + glowBoost * 3), accent, glowBoost * 0.18, closed, gcap);
        }
        if (maxGlow > 0.05) {
          strokePath(gGlow, pts, baseWidth * (1 + maxGlow * 2), accent, maxGlow * 0.65, closed, gcap);
        }
      }

      // Circuit "skeleton" (see wallSkeleton.ts) drawn per sub-segment into the
      // core Graphics FIRST, so the colored border strokes veil it to a hint.
      const pal = WALL_CIRCUITS_ENABLED ? circuitPalette(accent) : null;
      if (pal && !greenOnly) {
        const n = closed ? world.length : world.length - 1;
        for (let sIdx = 0; sIdx < n; sIdx++) {
          const ws = world[sIdx], we = world[(sIdx + 1) % world.length];
          const ss = scr[sIdx], es = scr[(sIdx + 1) % world.length];
          // Fade + narrow the skeleton near the ends so it doesn't poke past the
          // rooted core.
          const rf = rootAt((cum[sIdx] + cum[(sIdx + 1) % world.length]) / 2);
          if (rf.a < 0.02) continue;
          const skel = buildWallSkeleton(ss.x, ss.y, es.x, es.y, scale, baseWidth / scale, ws.x, ws.y, we.x, we.y);
          if (!skel) continue; // short segments (e.g. a locked pocket's walls) carry no circuit
          for (const tr of skel.traces) strokePath(gCore, tr, Math.max(1, baseWidth * pal.traceWidthFrac * rf.w), pal.trace, pal.traceAlpha * rf.a);
          for (const nd of skel.nodes) {
            gCore.circle(nd.x, nd.y, nd.r * rf.w).fill({ color: pal.via, alpha: pal.viaAlpha * rf.a });
            gCore.circle(nd.x, nd.y, nd.r * rf.w * (nd.kind === 'via' ? 0.5 : 0.58)).fill({ color: pal.spark, alpha: pal.sparkAlpha * rf.a });
          }
        }
      }

      // White-bright core + accent centerline. With a join flare, stroke short
      // pieces so it widens into a splash where it meets the wall at each end.
      const coreAlpha = pal ? WALL_CORE_ALPHA : 1;
      const centerAlpha = pal ? WALL_CENTERLINE_ALPHA : 1;
      if (taperLen > 0) {
        // Overshoot ~1 drawn width so the core end lands past the mask boundary,
        // so the flare fills flush to the wall with no cap.
        const pieces = buildFenceTaper(scr, taperLen, baseWidth, flareEnds);
        // Near the wall the white border smoothly hands off to the wall's own
        // white (over ~1 wall-width, so no blunt notch), and the green centerline
        // widens to fill the flare as the white falls away — so the splash reads
        // as solid green merging in, not an empty glow blob. Away from the wall
        // it's the normal tube: full white core + 0.7x green centerline.
        const whiteFade = baseWidth * 1.0;
        const whiteFracAt = (dw: number) => { const s = Math.max(0, Math.min(1, dw / whiteFade)); return s * s * (3 - 2 * s); };
        if (!greenOnly) {
          for (const pc of pieces) {
            const wf = whiteFracAt(pc.dw);
            if (wf <= 0.002) continue;
            strokePath(gCore, [pc.x1, pc.y1, pc.x2, pc.y2], baseWidth * pc.w, 0xffffff, coreAlpha * wf, false, pc.butt ? "butt" : "round");
          }
        }
        if (!skipGreen) for (const pc of pieces) strokePath(gCore, [pc.x1, pc.y1, pc.x2, pc.y2], baseWidth * pc.w * (1 - 0.3 * whiteFracAt(pc.dw)), accent, centerAlpha, false, pc.butt ? "butt" : "round");
      } else {
        if (!greenOnly) strokePath(gCore, pts, baseWidth, 0xffffff, coreAlpha, closed);
        if (!skipGreen) strokePath(gCore, pts, baseWidth * 0.7, accent, centerAlpha, closed);
      }
    };

    // Fences: one continuous path per connected run (arms joined through the
    // centre) so shared vertices are clean joins, not a chain of caps. Fences
    // stop ON walls without crossing obstacle interiors, so the fenceMask above
    // handles cap overshoot and no per-segment obstacle clipping is needed.
    const fenceChains = buildFenceChains(game.walls).map(chain => ({
      chain,
      freshness: chain.createdAt ? Math.max(0, 1 - (now - chain.createdAt) / 400) : 0,
      // Flare the fence into the board edge at both ends over ~3.5 drawn widths,
      // so it splashes onto the edge and merges instead of butting a point. Only
      // board-edge ends flare; a fence-to-fence OR fence-to-obstacle end stays
      // plain so it doesn't overflow past (INTO) what it meets.
      taperLen: 3.5 * chain.thickness * scale * WALL_RENDER_THICKEN,
      flareEnds: chainFlareEnds(chain.points, game.boardPolygon),
    }));
    // Pass A: glow + white core per fence (green skipped, painted in Pass B).
    for (const f of fenceChains) {
      strokeWallPath(glow, core, f.chain.points, f.chain.thickness * scale, f.freshness, false, f.taperLen, f.flareEnds, false, true);
    }
    // Pass B: every green centerline on top (painted once), so where fences
    // cross (fence-to-fence tees) the green connects over the other fence's
    // white border and the junction reads as merged, not just overlapped.
    for (const f of fenceChains) {
      strokeWallPath(glow, core, f.chain.points, f.chain.thickness * scale, f.freshness, false, f.taperLen, f.flareEnds, true);
    }

    // Board edge: one continuous closed loop from the board polygon so corners
    // are clean joins. Falls back to per-segment if no polygon is available.
    if (game.boardPolygon) {
      strokeWallPath(edges, edges, game.boardPolygon.vertices, WALL_THICKNESS * scale, 0, true);
    } else {
      for (const w of game.walls) {
        if (w.isMirror || !w.id.startsWith("board-")) continue;
        strokeWallPath(edges, edges, [w.start, w.end], w.thickness * scale, 0);
      }
    }

    // Per-segment overlay that can't be chained: the Ascension crumble damage.
    for (let wi = game.walls.length - 1; wi >= 0; wi--) {
      const w = game.walls[wi];
      if (!w.id.startsWith("wall-")) continue;
      const baseWidth = w.thickness * scale;
      const ascDamage = w.maxHits && w.hitsLeft !== undefined ? 1 - w.hitsLeft / w.maxHits : 0;
      // Black-ball / boss-chain fracture (#64): each of the 3 hits deepens the crack.
      const blackDamage = w.blackHits ? Math.min(1, w.blackHits / 3) : 0;
      const damage = Math.max(ascDamage, blackDamage);
      if (damage > 0) {
        const segs = getSegs(w);
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
    const walls = game.activeWalls;
    let bloomIdx = 0;

    if (walls.length > 0) {
      // Mask: the UNION of every active wall's region, minus obstacle holes.
      // Each wall only draws within its own region, so a union mask clips them
      // all correctly without per-wall masks.
      const m = this.activeFenceMaskG;
      m.clear();
      let anyRegion = false;
      for (const wall of walls) {
        const activeRegion = game.regions.find(r => r.id === wall.activeRegionId);
        if (activeRegion && activeRegion.polygon.vertices.length > 0) {
          const flat: number[] = [];
          for (const v of activeRegion.polygon.vertices) {
            const sp = w2s(v.x, v.y);
            flat.push(sp.x, sp.y);
          }
          m.poly(flat).fill(0xffffff);
          anyRegion = true;
        }
      }
      if (!anyRegion) {
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

      for (const wall of walls) {
        const lw = wall.thickness * scale;
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
    // heap + tex: leak canaries. A healthy idle session sawtooths in place;
    // a steady climb in either while idling is a leak worth reporting.
    this.perfText.text = `pixi | render avg ${s.renderAvg.toFixed(2)}ms peak ${s.renderPeak.toFixed(2)}ms | phys peak ${s.physPeak.toFixed(2)}ms | n=${s.samples} | heap ${heapLine()} | tex ${canvasTextureCount()}`;
  }

  destroy(): void {
    this.teardownSweep();
    this.clearDissolveRT();
    this.balls.destroy();
    this.effects.destroy();
    this.dissolve.destroy();
    clearCanvasTextures();
    clearGlowTextures();
    clearWallSkeletonCache();
    // app.destroy(children:true) frees the stage tree but NOT filters attached to
    // it; the bloom allocates internal render targets, so free it explicitly.
    this.bloom?.destroy();
    this.bloom = null;
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
  dents: { x: number; y: number; s: number }[],
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
        if (dd < dentRadius) dent = Math.max(dent, Math.pow(1 - dd / dentRadius, 1.7) * imp.s);
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

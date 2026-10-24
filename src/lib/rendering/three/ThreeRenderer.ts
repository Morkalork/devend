/**
 * ThreeRenderer: the 3D board (RENDER_3D_PLAN.md).
 *
 * The board as a lit scene seen from straight above: a floor, fences and a
 * frame that stand up, extruded obstacles, rolling sphere balls, and real
 * lights with real shadow maps - the monitor, a lamp in every ball, and every
 * flash and explosion - in three.js, on the same WebGL context as the sleek
 * Pixi renderer, which it drives as its flat layers (SleekRenderer's
 * HybridHost). Per frame:
 *
 *   1. sleek draws the board's marks under a flat light into a surface texture
 *      (and works out this frame's light list, as it always has);
 *   2. this draws the 3D scene into an HDR target, every surface coloured from
 *      that texture at its own world position, and tone-maps it into a second
 *      target Pixi can see;
 *   3. sleek composites that frame with everything that sits over it.
 *
 * It implements the same BoardRenderer contract the sleek renderer does, so
 * GameCanvas, the game loop, input and physics are unchanged. The floor lands
 * on exactly the pixels the 2D board did (floorCamera.ts), so input, the
 * layout latch and every screen-space overlay still line up.
 *
 * Render-only, like every renderer here: it reads the game state and writes
 * nothing back. The few things it remembers between frames (a ball's roll, a
 * shard in flight) live in this object, so two-player lockstep cannot see them.
 */
import { simNow } from "@/lib/simClock";
import { canvasAntialias } from "@/lib/rendering/canvasCompat";
import {
  Group, HalfFloatType, Matrix4, PCFShadowMap, Vector3, PerspectiveCamera, Scene, UnsignedByteType,
  WebGLRenderTarget, WebGLRenderer, type ExternalTexture, type Material,
} from "three";
import type { RenderTexture, Texture as PixiTexture, WebGLRenderer as PixiWebGLRenderer } from "pixi.js";
import type { CanvasGameState } from "@/types/gameState";
import type { BoardRenderer } from "@/lib/rendering/boardRenderer";
import type { RenderContext } from "@/lib/rendering/types";
import { SleekRenderer, type HybridFrame, type HybridHost } from "@/lib/rendering/sleek/SleekRenderer";
import { boardAngleFor } from "@/lib/boardTilt";
import { fitScale } from "@/lib/boardConstants";
import {
  getFov, getHeightScale, getLean, getQualitySetting, resolvedTier, setLearnedLimit,
  autoCeiling, deviceEnv, getLearnedLimit, setEarnedTier, cheaperTier,
  type QualityTier,
} from "@/lib/rendering/render3dSettings";
import { boardTiltElements, eyeDistance, floorCamera, leanProjection } from "./floorCamera";
import { FAST_FRAME_MS, FAST_WINDOWS, QUALITY_PRESETS, QualityGovernor, SEVERE_FRAME_MS, stepDown, stepUp, type QualityPreset } from "./quality";
import { createSurfaceShared, makeSurfaceMaterial } from "./surfaceMaterial";
import { createCodeTexture, createUnderlayUniforms, syncUnderlay } from "./codeUnderlay";
import { pixiGlTexture, releasePixiWrap, threeViewOf, wrapForPixi } from "./textureBridge";
import { Floor3D } from "./floor3d";
import { Walls3D } from "./walls3d";
import { Solids3D } from "./solids3d";
import { Fill3D } from "./fill3d";
import { Balls3D } from "./balls3d";
import { LAMP_HEIGHT, Lights3D, monitorPlacement, roomLevel, wantedLights, type BallTone } from "./lights3d";
import { Explosions3D } from "./explosions3d";
import { Props3D } from "./props3d";
import { Zones3D } from "./zones3d";
import { OutputPass } from "./outputPass";
import { CutPreview3D, createPreviewUniforms, shadowOnlyMaterial } from "./cutPreview3d";
import {
  CircuitSparks, POCKET_GOLD, bombLights, chargeLights, phaseCasters, pocketHeat, powerLevel,
} from "./lightMechanics";
import { getLightLook } from "@/lib/lightLook";
import { recordQualityStep, recordShaderError } from "@/lib/rendering/rendererDiag";

/**
 * How much of a solid's own colour shows unlit, on top of the board-wide
 * share every surface gets (surfaceMaterial.ts, SELF).
 *
 * The board's furniture - walls, breakables, glass, movers - is lit by the
 * same room lights as the floor, and those cut a slab's colour roughly in
 * half on screen: an ordinary wall measured 1.4-1.65:1 against the floor and
 * a breakable 2:1, under the 3:1 a shape needs to be seen at all. Reported as
 * "some of the game board is too dark ... people with slightly bad eyesight
 * [must be able to] differ between a wall and a destructable wall". Raising
 * the solids' self-lit share lifts every object together and leaves the
 * floor, its pools of light and the shadows exactly as they were.
 */
export const SOLID_SELF_LIT = 0.42;

/** The longest the board's reveal waits on shader compilation (warmShaders). */
const SHADER_WARM_CAP_MS = 2000;

/** The live scene for one quality tier. Rebuilt whole when the tier changes. */
interface Rig {
  preset: QualityPreset;
  preview: CutPreview3D;
  /** Shadow-only pillars about to turn solid (the phase tell). */
  phaseShadows: Solids3D;
  sparks: CircuitSparks;
  floor: Floor3D;
  walls: Walls3D;
  solids: Solids3D;
  /** Fenced-off ground as a raised block (fill3d.ts). */
  fill: Fill3D;
  balls: Balls3D;
  explosions: Explosions3D;
  props: Props3D;
  zones: Zones3D;
  lights: Lights3D;
  materials: Material[];
}

export class ThreeRenderer implements BoardRenderer, HybridHost {
  private readonly sleek: SleekRenderer;
  private renderer: WebGLRenderer | null = null;
  private pixi: PixiWebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;

  private scene = new Scene();
  private camera = new PerspectiveCamera();
  /** The board: everything that turns with the tilt lives in here. */
  private board = new Group();
  private shared = createSurfaceShared();
  private previewUniforms = createPreviewUniforms();
  /** The code under the floor, lit from below by the balls (codeUnderlay.ts). */
  private underlay = createUnderlayUniforms();
  private rig: Rig | null = null;
  private tier: QualityTier = "medium";
  private auto = true;
  private governor = new QualityGovernor();
  /** A step the governor asked for (down, or up after fast windows), applied between maps. */
  private pendingTier: QualityTier | null = null;
  /** Fast windows in a row at this tier (quality.ts FAST_WINDOWS). */
  private fastWindows = 0;
  private windowsSeen = 0;
  /**
   * Set when the cheapest tier still ran slow: the 2D board is learned for
   * this device, and takes over at the next board (GameCanvas reads it).
   */
  private exhausted = false;
  /**
   * A cap on the 3D frame's pixels per CSS pixel, under the tier's own, put on
   * mid-map when frames are badly slow (resizeScene). Cleared with a rebuild.
   */
  private emergencyRatio = Number.POSITIVE_INFINITY;
  private heightScale = 1;
  private fov = 26;
  /** The three-quarter view's lean (floorCamera.leanProjection). */
  private leanNow = 0;
  private leanM = new Matrix4();

  private sceneRT: WebGLRenderTarget | null = null;
  private outRT: WebGLRenderTarget | null = null;
  private outForPixi: PixiTexture | null = null;
  private output = new OutputPass();
  private surfaceView: ExternalTexture | null = null;
  private surfaceHandle: WebGLTexture | null = null;
  private size = { w: 1, h: 1, scale: 1 };
  private lost = false;
  private tiltNow = 0;
  private keyLight = new Vector3();

  constructor() {
    this.sleek = new SleekRenderer(this);
    this.board.matrixAutoUpdate = false;
    this.scene.add(this.board);
  }

  get gl(): WebGL2RenderingContext {
    if (!this.renderer) throw new Error("ThreeRenderer: no context yet");
    return this.renderer.getContext() as WebGL2RenderingContext;
  }

  /** How far standing things lean back up the screen; sleek lifts the balls' marks to match. */
  get lean(): number {
    return this.leanNow;
  }

  get isReady(): boolean {
    return this.sleek.isReady && !!this.rig;
  }

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    this.canvas = canvas;
    // three makes the context, Pixi borrows it (the PixiJS guide's order).
    // Stencil, because Pixi's masks need it; alpha, because the board's
    // surface is translucent over the page.
    this.renderer = new WebGLRenderer({
      // MSAA, except where the GPU cannot show a multisampled canvas (canvasCompat.ts).
      canvas, antialias: canvasAntialias(), alpha: true, premultipliedAlpha: true, stencil: true,
      depth: true, powerPreference: "high-performance", preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // A shader that will not compile does not throw: that material simply
    // stops drawing. Recorded so Admin can say so (rendererDiag.ts).
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const text = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)]
        .filter(Boolean).join(" | ");
      console.error("[renderer] 3D shader error:", text);
      recordShaderError(text);
    };
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.readSettings();
    this.buildRig(this.tier);
    await this.sleek.init(canvas, width, height);
    await this.warmShaders();
    // A handle for poking at the live scene from the console, dev builds only.
    if (import.meta.env.DEV) (window as unknown as { __board3d?: ThreeRenderer }).__board3d = this;
  }

  /**
   * Compile the scene's shaders before the board is shown, not on its first
   * frame.
   *
   * three compiles a material's program the first time it draws it, so the
   * board's opening frame compiled them all at once, one after another on the
   * main thread. compileAsync hands the scene's materials to the driver up
   * front (in parallel where KHR_parallel_shader_compile is there; measured:
   * the floor, wall, solid and plate materials, 8 programs) and init waits
   * for them, so they are done before the first frame. What only exists once
   * the board is drawn (ball and shard programs, shadow depth) still compiles
   * on that frame, which the loading reveal covers. Capped, so a driver that
   * never reports done cannot hold the board back.
   */
  private async warmShaders(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    try {
      await Promise.race([
        renderer.compileAsync(this.scene, this.camera),
        new Promise(resolve => setTimeout(resolve, SHADER_WARM_CAP_MS)),
      ]);
    } catch {
      /* not fatal: anything left compiles on first draw, as it always did */
    }
    // Pixi shares the context and must not trust its state cache after this.
    renderer.resetState();
    this.pixi?.resetState();
  }

  private onLost = (): void => { this.lost = true; };
  private onRestored = (): void => {
    this.lost = false;
    // Pixi re-creates its textures on demand, including a fresh placeholder
    // behind our wrapped one; the frame targets are re-made and re-wrapped.
    this.surfaceHandle = null;
    this.sleek.resize(this.size.w, this.size.h, true);
  };

  /** Settings are read between maps, not per frame (localStorage is a sync read). */
  private readSettings(): void {
    const q = getQualitySetting();
    this.auto = q === "auto";
    // Auto starts at the device's guess, but never above what an earlier
    // board on this device learned it cannot hold (getLearnedLimit).
    this.tier = resolvedTier();
    this.heightScale = getHeightScale();
    this.fov = getFov();
    this.leanNow = getLean();
  }

  private buildRig(tier: QualityTier): void {
    this.disposeRig();
    const preset = QUALITY_PRESETS[tier];
    this.tier = tier;
    const floorMat = makeSurfaceMaterial(this.shared, {
      tier, translucent: true, roughness: 0.9, preview: this.previewUniforms, underlay: this.underlay,
    });
    const wallMat = makeSurfaceMaterial(this.shared, { tier, sampleSquash: [1, 1, 0.42], roughness: 0.7 });
    const solidMat = makeSurfaceMaterial(this.shared, { tier, inset: true, roughness: 0.75, selfLitExtra: SOLID_SELF_LIT });
    // Plates lie on the floor, so they darken with it under the cut preview.
    const plateMat = makeSurfaceMaterial(this.shared, {
      tier, inset: true, roughness: 0.9, preview: this.previewUniforms,
    });
    const floor = new Floor3D(floorMat);
    const walls = new Walls3D(wallMat);
    const solids = new Solids3D(solidMat);
    // The furniture's material, pushed back in depth: the fill is flush with
    // the fence tops and buried slabs, and where they meet those must win.
    const fillMat = makeSurfaceMaterial(this.shared, { tier, inset: true, roughness: 0.75, selfLitExtra: SOLID_SELF_LIT });
    fillMat.polygonOffset = true;
    fillMat.polygonOffsetFactor = 1;
    fillMat.polygonOffsetUnits = 4;
    const fill = new Fill3D(fillMat);
    this.board.add(floor.mesh, walls.mesh, solids.mesh, fill.mesh);
    const balls = new Balls3D(this.board, preset.sphereSegments);
    const explosions = new Explosions3D(this.board, preset.maxShards);
    const props = new Props3D(this.board, preset.sphereSegments);
    const zones = new Zones3D(this.board, plateMat);
    const lights = new Lights3D(this.scene, this.board, preset);
    const preview = new CutPreview3D(this.board, this.previewUniforms);
    const phaseMat = shadowOnlyMaterial();
    const phaseShadows = new Solids3D(phaseMat);
    phaseShadows.mesh.receiveShadow = false;
    this.board.add(phaseShadows.mesh);
    this.rig = {
      preset, floor, walls, solids, fill, balls, explosions, props, zones, lights,
      preview, phaseShadows, sparks: new CircuitSparks(),
      materials: [floorMat, wallMat, solidMat, fillMat, plateMat, phaseMat],
    };
    this.governor.reset(performance.now());
    this.fastWindows = 0;
    this.windowsSeen = 0;
    this.emergencyRatio = Number.POSITIVE_INFINITY;
    // The frame's resolution and MSAA are part of the tier. Through sleek, so
    // its sprite and surface texture are re-made with the frame.
    if (this.pixi) this.sleek.resize(this.size.w, this.size.h, true);
  }

  private disposeRig(): void {
    const rig = this.rig;
    if (!rig) return;
    this.board.remove(rig.floor.mesh, rig.walls.mesh, rig.solids.mesh, rig.fill.mesh);
    rig.floor.dispose();
    rig.walls.dispose();
    rig.solids.dispose();
    rig.fill.dispose();
    rig.balls.dispose();
    rig.explosions.dispose();
    rig.props.dispose();
    rig.zones.dispose();
    rig.preview.dispose();
    this.board.remove(rig.phaseShadows.mesh);
    rig.phaseShadows.dispose();
    rig.lights.dispose();
    for (const m of rig.materials) m.dispose();
    this.rig = null;
  }

  // ── HybridHost ────────────────────────────────────────────────────────────

  attach(renderer: PixiWebGLRenderer): void {
    this.pixi = renderer;
  }

  resizeScene(widthPx: number, heightPx: number): { texture: PixiTexture; scale: number } {
    const renderer = this.renderer!;
    const pixi = this.pixi!;
    // Pixi has been using the context; three's cache of its state is stale.
    renderer.resetState();
    const preset = this.rig?.preset ?? QUALITY_PRESETS[this.tier];
    // The 3D frame's resolution: no more than the tier's pixels per CSS pixel.
    const css = this.canvas?.clientWidth || 0;
    const ratio = Math.min(preset.maxPixelRatio, this.emergencyRatio);
    const scale = css > 0 ? Math.min(1, (ratio * css) / Math.max(1, widthPx)) : 1;
    const w = Math.max(1, Math.round(widthPx * scale));
    const h = Math.max(1, Math.round(heightPx * scale));
    this.size = { w: widthPx, h: heightPx, scale: w / Math.max(1, widthPx) };

    if (this.outForPixi) releasePixiWrap(pixi, this.outForPixi);
    this.sceneRT?.dispose();
    this.outRT?.dispose();
    const hdr = renderer.extensions.has("EXT_color_buffer_float")
      || renderer.extensions.has("EXT_color_buffer_half_float");
    this.sceneRT = new WebGLRenderTarget(w, h, {
      type: hdr ? HalfFloatType : UnsignedByteType,
      samples: preset.samples,
      depthBuffer: true,
    });
    this.outRT = new WebGLRenderTarget(w, h, { type: UnsignedByteType, depthBuffer: false });
    // Make the output's GL texture exist (and be blank, not whatever the
    // driver left in it) before handing it to Pixi.
    renderer.initRenderTarget(this.outRT);
    renderer.setRenderTarget(this.outRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(null);
    const handle = renderer.properties.get(this.outRT.texture) as { __webglTexture?: WebGLTexture };
    renderer.resetState();
    this.outForPixi = wrapForPixi(pixi, handle.__webglTexture!, w, h);
    pixi.resetState();
    return { texture: this.outForPixi, scale: this.size.scale };
  }

  renderScene(frame: HybridFrame): void {
    const renderer = this.renderer;
    const rig = this.rig;
    const pixi = this.pixi;
    if (!renderer || !rig || !pixi || !this.sceneRT || !this.outRT || this.lost) return;
    const { game, now } = frame;

    // Too slow for this tier? Step down at the next map (auto only, and
    // never up again), and remember it for every board after this one. Not
    // now: a rebuild compiles shaders, which is a hitch, and a hitch mid-map
    // is the thing this is trying to remove. Badly slow, though, and the 3D
    // frame's resolution drops at once: that is only a render target, no
    // shader, and the rest of the map is worth more than its sharpness.
    if (this.auto && !this.pendingTier && !this.exhausted) {
      const slow = this.governor.frame(performance.now());
      if (slow) {
        this.stepDownForSlowFrames(this.governor.lastMedianMs);
      } else if (this.governor.windows !== this.windowsSeen) {
        this.windowsSeen = this.governor.windows;
        this.judgeFastWindow(this.governor.lastMedianMs);
      }
    }

    // The surface texture, seen from three. A resize re-allocates its GL
    // texture behind the same Pixi source, so the handle is checked each frame.
    const handle = pixiGlTexture(pixi, frame.surface.source);
    if (handle !== this.surfaceHandle) {
      this.surfaceView?.dispose();
      this.surfaceView = threeViewOf(pixi, frame.surface);
      this.surfaceHandle = handle;
    }
    renderer.resetState();

    const s = frame.surfaceScale;
    const rect = game.boardRect;
    this.shared.uSurface.value = this.surfaceView;
    this.shared.uSurfRect.value.set(rect.left * s, rect.top * s, rect.scale * s, 0);
    this.shared.uSurfSize.value.set(frame.surface.width, frame.surface.height);

    this.placeCamera(game);
    this.placeBoard(game);

    rig.floor.sync(game);
    const wallMesh = rig.walls.sync(game, this.heightScale);
    if (wallMesh.parent !== this.board) this.board.add(wallMesh);
    rig.solids.sync(game, this.heightScale);
    rig.fill.sync(game, this.heightScale);
    // The key light the balls' glint faces: the lamp over its ball, else the
    // monitor, in the scene's (tilted) space.
    if (frame.lamp) this.keyLight.set(frame.lamp.x, LAMP_HEIGHT, frame.lamp.y).applyMatrix4(this.board.matrix);
    else { const m = monitorPlacement(); this.keyLight.set(m.x, m.y, m.z); }
    rig.balls.sync(game, now, eyeDistance(this.fov), fitScale(this.tiltNow), {
      board: this.board.matrix, view: this.camera.matrixWorldInverse, key: this.keyLight,
      pxPerUnit: game.boardRect.scale * this.size.scale,
    });
    rig.explosions.sync(game, now);
    rig.props.sync(game, now);
    rig.zones.sync(game, now);

    // Light as a mechanic (lightMechanics.ts, cutPreview3d.ts).
    const look = getLightLook();
    rig.preview.sync(game, now, look.cutPreview, this.heightScale);
    rig.phaseShadows.syncSolids(phaseCasters(game, look.phaseTell, this.heightScale));
    const extras = [
      ...chargeLights(game, look.chargeTell), ...bombLights(game, look.chargeTell, simNow()),
      ...rig.sparks.sync(game, now, look.circuitSpark),
    ];
    const tones = new Map<string, BallTone>();
    if (look.pocketGlow > 0.001) {
      for (const [id, t] of pocketHeat(game)) {
        tones.set(id, { gain: 1 + 1.3 * t.heat * look.pocketGlow, tint: POCKET_GOLD, mix: 0.85 * t.gold * look.pocketGlow });
      }
    }
    // The balls' light falling down through the floor onto the code beneath.
    if (!this.underlay.uCode.value) this.underlay.uCode.value = createCodeTexture();
    syncUnderlay(this.underlay, frame.lights, look.underglow, look.underglowReach, now);
    const limit = frame.deadlineLimit;
    const power = limit ? powerLevel(limit - game.activePlaySeconds, limit, look.powerDrain) : 1;

    const centres = new Map<string, { x: number; z: number; y: number }>();
    for (const [id, p] of rig.balls.poses) centres.set(id, { x: p.x, z: p.z, y: p.r * p.sy });
    const wanted = wantedLights(frame.lights, rig.explosions.lights, centres, frame.lamp, extras, tones);
    rig.lights.sync(wanted, frame.monitorLevel, frame.lampLevel, roomLevel(game.mapLight) * power);
    // The lamp, when there is one, is ranked first, so it is point light 0.
    this.shared.uLampSlot.value = wanted[0]?.rank === 0 ? 1 : 0;

    renderer.setRenderTarget(this.sceneRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.camera);
    this.output.render(renderer, this.sceneRT.texture, this.outRT);
    renderer.setRenderTarget(null);
  }

  /** The camera that puts the floor on the board's pixels (floorCamera.ts). */
  private placeCamera(game: CanvasGameState): void {
    const w = this.size.w, h = this.size.h;
    const cam = floorCamera(w, h, game.boardRect, this.fov);
    this.camera.position.set(cam.eye.x, cam.eye.y, cam.eye.z);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(cam.eye.x, 0, cam.eye.z);
    this.camera.updateMatrixWorld();
    this.camera.near = cam.near;
    this.camera.far = cam.far;
    this.camera.projectionMatrix.makePerspective(cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far);
    if (this.leanNow > 0) {
      this.leanM.set(...(leanProjection(this.leanNow, cam.eye.y) as Parameters<Matrix4["set"]>));
      this.camera.projectionMatrix.multiply(this.leanM);
    }
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  /**
   * The board's tilt (issue #77): the same turn-and-shrink about the centre
   * the 2D w2s applies (tiltWorldPoint), as a matrix on the board group, so
   * everything standing on the board turns with it and the lights outside it
   * - the monitor is in the room, not on the board - stay put.
   */
  private placeBoard(game: CanvasGameState): void {
    const tilt = boardAngleFor(game.activePlaySeconds, game.gravityConfig, game.boardTilt);
    this.tiltNow = tilt;
    const k = fitScale(tilt);
    this.board.matrix.fromArray(boardTiltElements(tilt, k));
    this.board.matrixWorldNeedsUpdate = true;
  }

  // ── BoardRenderer ─────────────────────────────────────────────────────────

  resize(widthPx: number, heightPx: number): void {
    this.sleek.resize(widthPx, heightPx);
  }

  render(game: CanvasGameState, rctx: RenderContext): void {
    this.sleek.render(game, rctx);
  }

  markStaticDirty(): void {
    this.sleek.markStaticDirty();
  }

  /**
   * A window closed under budget. FAST_WINDOWS of them in a row at a tier
   * below the device's ceiling, and the next map tries the tier above; it is
   * remembered (setEarnedTier) so the climb is made once per device, not once
   * per map. Never past a learned limit: that cap is what keeps a device from
   * oscillating between a tier it can hold and one it cannot.
   */
  private judgeFastWindow(medianMs: number): void {
    if (medianMs > FAST_FRAME_MS) {
      this.fastWindows = 0;
      return;
    }
    this.fastWindows++;
    if (this.fastWindows < FAST_WINDOWS) return;
    this.fastWindows = 0;
    const up = stepUp(this.tier);
    if (!up) return;
    const learned = getLearnedLimit();
    const cap = learned === null ? autoCeiling(deviceEnv()) : learned === "2d" ? "minimal" : cheaperTier(autoCeiling(deviceEnv()), learned);
    if (cheaperTier(up, cap) !== up) return;
    this.pendingTier = up;
    setEarnedTier(up);
    recordQualityStep(this.tier, up, medianMs);
  }

  /** The governor said this tier is too slow on this device (see renderScene). */
  private stepDownForSlowFrames(medianMs: number): void {
    this.fastWindows = 0;
    const next = stepDown(this.tier);
    if (next) {
      this.pendingTier = next;
      setLearnedLimit(next);
      // Whatever was earned above this is gone with it.
      setEarnedTier(next);
      recordQualityStep(this.tier, next, medianMs);
    } else {
      // Already the cheapest 3D tier: the 2D board, from the next board on.
      this.exhausted = true;
      setLearnedLimit("2d");
      setEarnedTier(null);
      recordQualityStep(this.tier, "2d", medianMs);
    }
    // Something now, not only at the next map: the 3D frame's resolution is
    // a render target, no shader, so it can change mid-map for the price of
    // one reallocation. A quarter off when over budget, straight to one pixel
    // per CSS pixel when badly slow.
    const ratioNow = Math.min(this.rig?.preset.maxPixelRatio ?? 1, this.emergencyRatio);
    const ratioNext = medianMs > SEVERE_FRAME_MS ? 1 : Math.max(1, ratioNow * 0.75);
    if (ratioNext < ratioNow) {
      this.emergencyRatio = ratioNext;
      recordQualityStep(this.tier, "res", medianMs);
      if (this.pixi) this.sleek.resize(this.size.w, this.size.h, true);
    }
  }

  presentEmpty(): void {
    // Between maps: the moment to pick up a changed Admin setting, or a step
    // down the governor asked for during the last one.
    const before = { tier: this.tier, auto: this.auto, h: this.heightScale, fov: this.fov };
    this.readSettings();
    let tier = this.tier;
    if (this.auto && before.auto) tier = this.pendingTier ?? before.tier;
    this.pendingTier = null;
    if (tier !== before.tier || this.auto !== before.auto) this.buildRig(tier);
    else this.tier = before.tier;
    this.sleek.presentEmpty();
  }

  captureForDissolve(tint?: string): void {
    this.sleek.captureForDissolve(tint);
  }

  destroy(): void {
    this.sleek.destroy();
  }

  destroyScene(): void {
    const pixi = this.pixi;
    if (pixi && this.outForPixi) releasePixiWrap(pixi, this.outForPixi);
    this.outForPixi = null;
    this.disposeRig();
    this.surfaceView?.dispose();
    this.surfaceView = null;
    this.sceneRT?.dispose();
    this.outRT?.dispose();
    this.sceneRT = this.outRT = null;
    this.output.dispose();
    this.underlay.uCode.value?.dispose();
    this.underlay.uCode.value = null;
    this.canvas?.removeEventListener("webglcontextlost", this.onLost);
    this.canvas?.removeEventListener("webglcontextrestored", this.onRestored);
    // Not renderer.dispose(): it would lose the context Pixi is about to tear
    // down itself, and the order of the two is Pixi's to decide.
    this.renderer = null;
  }
}

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
import {
  Group, HalfFloatType, PCFShadowMap, Vector3, PerspectiveCamera, Scene, UnsignedByteType,
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
  autoTier, getFov, getHeightScale, getQualitySetting, type QualityTier,
} from "@/lib/rendering/render3dSettings";
import { boardTiltElements, eyeDistance, floorCamera } from "./floorCamera";
import { QUALITY_PRESETS, QualityGovernor, stepDown, type QualityPreset } from "./quality";
import { createSurfaceShared, makeSurfaceMaterial } from "./surfaceMaterial";
import { pixiGlTexture, releasePixiWrap, threeViewOf, wrapForPixi } from "./textureBridge";
import { Floor3D } from "./floor3d";
import { Walls3D } from "./walls3d";
import { Solids3D } from "./solids3d";
import { Balls3D } from "./balls3d";
import { LAMP_HEIGHT, Lights3D, monitorPlacement, roomLevel, wantedLights } from "./lights3d";
import { Explosions3D } from "./explosions3d";
import { OutputPass } from "./outputPass";

/** The live scene for one quality tier. Rebuilt whole when the tier changes. */
interface Rig {
  preset: QualityPreset;
  floor: Floor3D;
  walls: Walls3D;
  solids: Solids3D;
  balls: Balls3D;
  explosions: Explosions3D;
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
  private rig: Rig | null = null;
  private tier: QualityTier = "medium";
  private auto = true;
  private governor = new QualityGovernor();
  /** A step down the governor asked for, applied between maps. */
  private pendingTier: QualityTier | null = null;
  private heightScale = 1;
  private fov = 26;

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

  get isReady(): boolean {
    return this.sleek.isReady && !!this.rig;
  }

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    this.canvas = canvas;
    // three makes the context, Pixi borrows it (the PixiJS guide's order).
    // Stencil, because Pixi's masks need it; alpha, because the board's
    // surface is translucent over the page.
    this.renderer = new WebGLRenderer({
      canvas, antialias: true, alpha: true, premultipliedAlpha: true, stencil: true,
      depth: true, powerPreference: "high-performance", preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.readSettings();
    this.buildRig(this.tier);
    await this.sleek.init(canvas, width, height);
    // A handle for poking at the live scene from the console, dev builds only.
    if (import.meta.env.DEV) (window as unknown as { __board3d?: ThreeRenderer }).__board3d = this;
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
    this.tier = q === "auto"
      ? autoTier({
          coarsePointer: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
          dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
          cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 0 : 0,
        })
      : q;
    this.heightScale = getHeightScale();
    this.fov = getFov();
  }

  private buildRig(tier: QualityTier): void {
    this.disposeRig();
    const preset = QUALITY_PRESETS[tier];
    this.tier = tier;
    const floorMat = makeSurfaceMaterial(this.shared, { tier, translucent: true, roughness: 0.9 });
    const wallMat = makeSurfaceMaterial(this.shared, { tier, sampleSquash: [1, 1, 0.42], roughness: 0.7 });
    const solidMat = makeSurfaceMaterial(this.shared, { tier, inset: true, roughness: 0.75 });
    const floor = new Floor3D(floorMat);
    const walls = new Walls3D(wallMat);
    const solids = new Solids3D(solidMat);
    this.board.add(floor.mesh, walls.mesh, solids.mesh);
    const balls = new Balls3D(this.board, preset.sphereSegments);
    const explosions = new Explosions3D(this.board, preset.maxShards);
    const lights = new Lights3D(this.scene, this.board, preset);
    this.rig = {
      preset, floor, walls, solids, balls, explosions, lights,
      materials: [floorMat, wallMat, solidMat],
    };
    this.governor.reset(performance.now());
    // The frame's resolution and MSAA are part of the tier. Through sleek, so
    // its sprite and surface texture are re-made with the frame.
    if (this.pixi) this.sleek.resize(this.size.w, this.size.h, true);
  }

  private disposeRig(): void {
    const rig = this.rig;
    if (!rig) return;
    this.board.remove(rig.floor.mesh, rig.walls.mesh, rig.solids.mesh);
    rig.floor.dispose();
    rig.walls.dispose();
    rig.solids.dispose();
    rig.balls.dispose();
    rig.explosions.dispose();
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
    const scale = css > 0 ? Math.min(1, (preset.maxPixelRatio * css) / Math.max(1, widthPx)) : 1;
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
    // never up again). Not now: a rebuild compiles shaders, which is a hitch,
    // and a hitch mid-map is the thing this is trying to remove.
    if (this.auto && !this.pendingTier && this.governor.frame(performance.now())) {
      this.pendingTier = stepDown(this.tier);
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
    // The key light the balls' glint faces: the lamp over its ball, else the
    // monitor, in the scene's (tilted) space.
    if (frame.lamp) this.keyLight.set(frame.lamp.x, LAMP_HEIGHT, frame.lamp.y).applyMatrix4(this.board.matrix);
    else { const m = monitorPlacement(); this.keyLight.set(m.x, m.y, m.z); }
    rig.balls.sync(game, now, eyeDistance(this.fov), fitScale(this.tiltNow), {
      board: this.board.matrix, view: this.camera.matrixWorldInverse, key: this.keyLight,
      pxPerUnit: game.boardRect.scale * this.size.scale,
    });
    rig.explosions.sync(game, now);

    const centres = new Map<string, { x: number; z: number; y: number }>();
    for (const [id, p] of rig.balls.poses) centres.set(id, { x: p.x, z: p.z, y: p.r * p.sy });
    const wanted = wantedLights(frame.lights, rig.explosions.lights, centres, frame.lamp);
    rig.lights.sync(wanted, frame.monitorLevel, frame.lampLevel, roomLevel(game.mapLight));
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

  captureSceneCanvas(game: CanvasGameState, rctx: RenderContext): HTMLCanvasElement | null {
    return this.sleek.captureSceneCanvas(game, rctx);
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
    this.canvas?.removeEventListener("webglcontextlost", this.onLost);
    this.canvas?.removeEventListener("webglcontextrestored", this.onRestored);
    // Not renderer.dispose(): it would lose the context Pixi is about to tear
    // down itself, and the order of the two is Pixi's to decide.
    this.renderer = null;
  }
}

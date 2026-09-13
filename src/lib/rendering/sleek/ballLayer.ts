/**
 * Balls, as lamps.
 *
 * They used to be spheres lit BY the monitor: a highlight baked toward one
 * edge, the sprite rotated so that highlight always faced the light, and a dark
 * terminator on the limb curving away from it. That is the correct way to draw
 * an object in a scene with one light, and it is the wrong way to draw the
 * thing the player is tracking on a board everyone called too dark. It made the
 * ball a surface that RECEIVED light, so a third of every ball was the darkest
 * pixel on it.
 *
 * A ball now has a bulb in it. That single decision is what the rest of this
 * file follows from:
 *
 *   NO TERMINATOR   the gradient is brightest in the middle and never goes
 *     dark, because a lamp has no shaded side. This is what makes the ball
 *     easier to see, which was the point.
 *   NO ROTATION     the bulb is centred, so the sprite has no direction to aim.
 *     The whole "rotate the sprite, counter-rotate inside the squash" dance
 *     existed only to keep a baked highlight pointed at the monitor, and it is
 *     gone with the highlight.
 *   NO SPECULAR     a hot spot on the limb facing the monitor says "this object
 *     is lit from over there", which is the opposite of what a lamp says.
 *   A CORONA        an additive bloom hugging the rim, drawn OVER the body and
 *     over whatever the ball is passing. Without it a bright disc reads as a
 *     bright disc; the bleed past its own edge is what reads as emitting.
 *
 * Its shadow stays, softened. A glowing ball is still opaque and still blocks
 * the monitor, and without a shadow it floats off the board - but a lamp fills
 * in its own shadow, and a hard dark ellipse beside a bulb looks like a mistake.
 *
 * The light this ball throws ONTO the board is a separate pass (ballLightPass),
 * because that has to be occluded by walls and this does not.
 *
 * Parts, cheapest first: cast shadow and contact, the baked bulb body, the
 * corona, then the informational overlays (frost, rings, splash) that are not
 * lighting at all.
 */
import { BufferImageSource, Container, Graphics, Mesh, MeshGeometry, Sprite, Texture } from "pixi.js";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { getSquishEffect, getWallHitEffect, getBallHitEffect, isSquishPinned, BOSS_SQUISH_SCALE } from "@/lib/ballEffects";
import { splatOutline, splatMetrics, splatCore, SPLAT_SEGMENTS } from "@/lib/rendering/splatShape";
import { createLiquidImage, rasterizeLiquid, type LiquidImage } from "@/lib/rendering/liquidSplat";
import type { SplatScene } from "@/lib/splatScene";
import {
  heartbeat, heartPhase, heartRate, flightStretch, createLag, stepLag,
  BREATHE, CORONA_FLARE, type Lag,
} from "@/lib/rendering/ballLife";
import { bossSplashFrame } from "@/lib/rendering/bossSplash";
import { getHeadingChevrons } from "@/lib/rendering/headingChevrons";
import { BALL_FALLBACK, PALETTE, mix, withAlpha } from "./palette";
import { CORONA_RADII, bulbStops, coronaStops } from "./bulb";
import { contactFor, shadowFor, type LightScope } from "./light";
import { compassRing } from "./compassRing";
import { ballTrail } from "./ballTrail";
import type { Pt } from "./pixelGrid";
import {
  markFor, markColor, markWidth, MARK_MIN_RADIUS_PX,
} from "@/lib/rendering/sleek/ballMark";

type W2S = (x: number, y: number) => Pt;

/** Baked sphere textures, keyed by colour + rounded radius bucket. */
const sphereCache = new Map<string, Texture>();

/** Radii are bucketed so a ball that grows smoothly doesn't rebake every frame. */
function bucket(r: number): number {
  return Math.max(4, Math.round(r / 2) * 2);
}

function parseColor(c: string): number {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : BALL_FALLBACK;
}

/**
 * Bake a bulb: white-hot in the middle, the ball's colour through the body, and
 * still lit at the rim.
 *
 * Centred, so callers never rotate it. The old bake put the highlight at a
 * fixed offset and rotated the sprite to aim it, which cost nothing but bought
 * an effect this no longer wants.
 *
 * The last stop is the one that matters: it used to be PALETTE.shadow at 0.88,
 * the terminator of a sphere turning away from the light. A lamp has no such
 * edge, so the rim stays the ball's own colour and the corona takes over from
 * there. Nothing on a ball is darker than the board it sits on any more.
 */
/**
 * Transparent padding around the baked ball, as a multiple of its radius. The
 * body mesh's ring sits here, one radius-and-a-bit out, so its straight edges
 * never cross a painted pixel. See sphereTexture.
 */
const SPHERE_MARGIN = 1.14;

function sphereTexture(color: number, radius: number): Texture {
  const key = `${color}:${radius}`;
  const cached = sphereCache.get(key);
  if (cached) return cached;

  // Baked with a transparent MARGIN around the ball. The body is drawn as a
  // mesh whose outer ring sits at the canvas edge, so without a margin the
  // polygon's straight edges would cut across a circle that is fully opaque
  // right to its rim - visible faceting, worst on a big boss ball. With one,
  // the polygon edge lands in transparent pixels and the texture's own round
  // alpha draws the silhouette.
  const half = Math.ceil(radius * SPHERE_MARGIN);
  const size = half * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;

  const grad = ctx.createRadialGradient(half, half, 0, half, half, radius);
  for (const stop of bulbStops(color)) grad.addColorStop(stop.offset, withAlpha(stop.color, stop.alpha));

  ctx.beginPath();
  ctx.arc(half, half, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const tex = Texture.from(canvas);
  sphereCache.set(key, tex);
  return tex;
}

/**
 * How much of its monitor shadow a self-lit ball keeps.
 *
 * Set by looking at it. Half was still too much: a bulb's own pool washes the
 * floor right where its monitor shadow falls, so at anything near full strength
 * the shadow reads as a dark smudge stuck to the ball rather than as shading.
 * Not zero, though - without a shadow the ball floats off the board, and it is
 * still an opaque object between the monitor and the floor.
 */
export const SELF_LIT_SHADOW = 0.35;

/** Corona bake radius, in texture pixels. Mapped onto the ball by the fan UVs. */
const CORONA_BAKE = 96;
let coronaTexture: Texture | null = null;

/**
 * The bloom around a bulb: nothing at the centre, peaking exactly at the ball's
 * edge, gone by the outside. Mapped so the peak lands on the silhouette
 * whatever shape the ball is in - see makeFan.
 *
 * Zero in the middle ON PURPOSE. This is drawn additively OVER the body, so any
 * brightness here would blow the ball out to white and throw away the colour
 * that tells the player which ball it is. The peak sits at 1/CORONA_RADII of
 * the texture, which is exactly where the ball's edge lands.
 *
 * One texture for every ball, tinted per colour: a white radial tinted is
 * exactly the coloured version of itself, which is not true of the body bake.
 */
function coronaTex(): Texture {
  if (coronaTexture) return coronaTexture;
  const size = CORONA_BAKE * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (coronaTexture = Texture.WHITE);

  const g = ctx.createRadialGradient(
    CORONA_BAKE, CORONA_BAKE, 0, CORONA_BAKE, CORONA_BAKE, CORONA_BAKE,
  );
  for (const stop of coronaStops()) g.addColorStop(stop.offset, `rgba(255,255,255,${stop.alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  coronaTexture = Texture.from(canvas);
  return coronaTexture;
}

/** Drop every baked sphere (level change / resize). */
export function clearSphereCache(): void {
  for (const t of sphereCache.values()) t.destroy(true);
  sphereCache.clear();
  coronaTexture?.destroy(true);
  coronaTexture = null;
}

/**
 * One ball's display objects.
 *
 * Two meshes, not two sprites, and that is the whole reason a ball can splat.
 * A sprite can only be scaled and rotated, so the best a squash could ever be
 * was an ELLIPSE - and an ellipse squeezes symmetrically, flattening the far
 * side of the ball exactly as much as the side against the wall. That is a
 * rubber ball under pressure and it reads as one at any setting.
 *
 * A mesh can be any silhouette, so the contact face can go flat and wide while
 * the crown stays round. Both meshes are the same fan, differing only in which
 * texture they carry and how far their ring sits from the mass.
 *
 * Round balls go through the identical path: a splat state of all zeroes gives
 * a circle. There is no second code path to keep in step.
 */
interface BallView {
  /** The body: a triangle fan carrying the baked bulb, warped to the splat. */
  body: Mesh;
  bodyPos: Float32Array;
  /** Additive bloom at the rim, in its own layer above every body. Same shape. */
  corona: Mesh;
  coronaPos: Float32Array;
  /** The liquid splat, made on the first Bug Squash this view draws. See LiquidView. */
  liquid: LiquidView | null;
  /** The filament's spring (ballLife.ts), so the highlight trails the body. */
  lag: Lag;
  /** When this view last drew, for the spring's dt. */
  lastNow: number;
}

/**
 * A STUCK ball's display objects: the liquid splat (liquidSplat.ts).
 *
 * A third way to draw a ball, and the only one that is an image rather than
 * geometry. The mesh can be any silhouette, but it is still ONE silhouette
 * warped from a circle, and a blob that pours over the end of a fence and
 * curls under it is not that: it is a field, with a shape that depends on the
 * solids around the ball. So while a ball is held by Bug Squash its body and
 * corona are two sprites carrying a texture the CPU repaints from the field,
 * and the two meshes are hidden. Ordinary balls and ordinary bounces never
 * come here.
 *
 * The images are in CONTACT SPACE, like the fan; the sprite's rotation and
 * scale carry them onto the board, so the same mapping serves both paths.
 */
interface LiquidView {
  body: Sprite;
  glow: Sprite;
  bodySrc: BufferImageSource;
  glowSrc: BufferImageSource;
  image: LiquidImage;
  /** The world radius the image was allocated for. */
  radius: number;
  /** What was last painted, so a held (unchanging) splat costs nothing per frame. */
  scene: SplatScene | null;
  d: number; v: number; w: number; stretch: number; color: number;
}

/**
 * Build the liquid sprites for a ball of this world radius. The buffers are
 * fixed-size for the radius, so every later frame only rewrites and re-uploads.
 */
function makeLiquid(radius: number): LiquidView {
  const image = createLiquidImage(radius);
  const bodySrc = new BufferImageSource({ resource: image.body, width: image.width, height: image.height });
  const glowSrc = new BufferImageSource({ resource: image.glow, width: image.width, height: image.height });
  const body = new Sprite(new Texture({ source: bodySrc }));
  const glow = new Sprite(new Texture({ source: glowSrc }));
  glow.blendMode = "add";
  // The sprite's origin is the CONTACT POINT, which is where the grid's
  // (0, 0) lies; the anchor is that point as a fraction of the image.
  const ax = -image.x0 / (image.width * image.texel);
  const ay = -image.y0 / (image.height * image.texel);
  body.anchor.set(ax, ay);
  glow.anchor.set(ax, ay);
  body.visible = glow.visible = false;
  return {
    body, glow, bodySrc, glowSrc, image, radius,
    scene: null, d: -1, v: -1, w: -1, stretch: -1, color: -1,
  };
}

/**
 * A fan of SPLAT_SEGMENTS triangles: one centre vertex plus a ring.
 *
 * Indices and UVs never change - only the positions move - so both are built
 * once per view and the per-frame cost is writing a Float32Array.
 *
 * THE CENTRE VERTEX IS WHERE THE TEXTURE'S MIDDLE GOES, and that is how the
 * highlight follows the mass: both bakes are concentric radial gradients, so
 * putting the centre vertex on the ball's deformed CORE slides the bright core
 * down toward the wall as the ball slumps, with no separate highlight to move.
 *
 * The core, not the centroid. The filament is a material point at the middle of
 * the sphere, so it goes through the deformation like every other point of the
 * body (splatCore). A centroid is a property of the silhouette instead: it is
 * pulled about by the footprint spreading, so the bright core wandered inside a
 * ball whose middle had not actually moved that way.
 *
 * The ring's UV radius is 0.5 - the very edge of the texture - for both bakes.
 * Each ring is then pushed out from the core by the factor that its texture's
 * "ball edge" feature is inset by (the sphere's transparent margin, the
 * corona's peak-to-canvas ratio), so in both cases that feature lands exactly
 * on the ball's silhouette. Same construction, one number apart.
 */
function makeFan(): { geometry: MeshGeometry; positions: Float32Array } {
  const n = SPLAT_SEGMENTS;
  const positions = new Float32Array((n + 1) * 2);
  const uvs = new Float32Array((n + 1) * 2);
  uvs[0] = 0.5;
  uvs[1] = 0.5;
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2;
    uvs[(i + 1) * 2] = 0.5 + Math.sin(theta) * 0.5;
    uvs[(i + 1) * 2 + 1] = 0.5 - Math.cos(theta) * 0.5;
  }
  const indices = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    indices[i * 3] = 0;
    indices[i * 3 + 1] = 1 + i;
    indices[i * 3 + 2] = 1 + ((i + 1) % n);
  }
  return { geometry: new MeshGeometry({ positions, uvs, indices }), positions };
}

/**
 * Write one fan's screen positions: centre vertex on the deformed core, ring
 * pushed out from it by `expand` (see makeFan for why each texture wants its
 * own factor).
 */
function writeFan(
  out: Float32Array,
  outline: ReturnType<typeof splatOutline>,
  core: ReturnType<typeof splatCore>,
  expand: number,
  sx: (lx: number, ly: number) => number,
  sy: (lx: number, ly: number) => number,
  coreDx = 0,
  coreDy = 0,
): void {
  // The centre vertex may be displaced from the core (the filament's lag):
  // the ring stays put and the texture's middle slides inside it.
  out[0] = sx(core.x, core.y) + coreDx;
  out[1] = sy(core.x, core.y) + coreDy;
  for (let i = 0; i < outline.length; i++) {
    const pt = outline[i];
    const lx = core.x + (pt.x - core.x) * expand;
    const ly = core.y + (pt.y - core.y) * expand;
    out[(i + 1) * 2] = sx(lx, ly);
    out[(i + 1) * 2 + 1] = sy(lx, ly);
  }
}

/**
 * Stretch a written fan's RING about a centre: longer along (ux, uy), narrower
 * across it. The centre vertex is left where it is. Applied in screen space,
 * after the fan is written, so it composes with whatever silhouette the
 * squash produced.
 */
function stretchFan(
  out: Float32Array, cx: number, cy: number, ux: number, uy: number, along: number, across: number,
): void {
  for (let i = 2; i + 1 < out.length; i += 2) {
    const dx = out[i] - cx, dy = out[i + 1] - cy;
    const a = dx * ux + dy * uy;
    const b = -dx * uy + dy * ux;
    const a2 = a * along, b2 = b * across;
    out[i] = cx + a2 * ux - b2 * uy;
    out[i + 1] = cy + a2 * uy + b2 * ux;
  }
}

export class SleekBallLayer {
  readonly container = new Container();

  /**
   * Motion smears, UNDER the bodies: a trail drawn over its own ball would sit
   * on the lit sphere and flatten it.
   */
  private trails = new Graphics();
  private bodies = new Container();
  /**
   * Every corona, in ONE additive layer above every body.
   *
   * Above, so a ball's bloom spills over the fence or obstacle it is passing,
   * which is what a light does and what a glow drawn underneath cannot. One
   * shared layer rather than a child of each ball, so two balls close together
   * add their blooms together instead of the later one painting over the
   * earlier one's.
   */
  private coronas = new Container();
  /** Frost + fastest-ball ring: informational marks drawn over the bodies. */
  private overlays = new Graphics();
  private views: BallView[] = [];
  /** The renderer's shared floor plane, set each frame in sync(). */
  private shadows!: Graphics;
  private fastestId: string | null = null;
  private now = 0;

  constructor() {
    // No shadow child: cast shadows go to the renderer's shared floor plane.
    this.container.addChild(this.trails, this.bodies, this.coronas, this.overlays);
  }

  sync(
    game: CanvasGameState,
    light: LightScope,
    shadows: Graphics,
    w2s: W2S,
    scale: number,
    now: number,
  ): void {
    this.shadows = shadows;
    this.overlays.clear();
    this.fastestId = game.fastestBallId;
    this.now = now;

    // Dormant balls MUST be drawn. They are the whole point of the circuit maps
    // (#73): an un-booted sleeper reserves space you cannot clear until you
    // route a fence through its terminal to wake it. Filtering them out (as this
    // layer originally did) leaves the player staring at territory that refuses
    // to be captured with nothing on screen explaining why.
    const balls = game.balls;

    // Grow the pool to match; views are reused frame to frame so a steady board
    // allocates nothing.
    while (this.views.length < balls.length) {
      const b = makeFan();
      const body = new Mesh({ geometry: b.geometry, texture: Texture.WHITE });
      this.bodies.addChild(body);

      const c = makeFan();
      const corona = new Mesh({ geometry: c.geometry, texture: Texture.WHITE });
      corona.blendMode = "add";
      this.coronas.addChild(corona);

      this.views.push({
        body, bodyPos: b.positions, corona, coronaPos: c.positions, liquid: null,
        lag: createLag(), lastNow: 0,
      });
    }
    for (let i = balls.length; i < this.views.length; i++) {
      this.views[i].body.visible = false;
      this.views[i].corona.visible = false;
      const liquid = this.views[i].liquid;
      if (liquid) liquid.body.visible = liquid.glow.visible = false;
    }

    this.trails.clear();
    for (let i = 0; i < balls.length; i++) {
      this.drawBall(balls[i], this.views[i], light, w2s, scale, game.activePlaySeconds);
    }
  }

  /**
   * The compass ball's countdown: a ring that unwinds toward its next quarter
   * turn, and leans the way it is going to turn.
   *
   * A ring rather than a numeral because a ball is 18 world units across, which
   * is eight to sixteen screen pixels on a phone: a digit in there is not
   * legible, and for most of a nine-second cycle it would not be actionable
   * either. An arc reads at any size and from across the board.
   *
   * Driven from turnProgress, which is the same function the turn itself uses,
   * so the ring cannot unwind on a different clock from the event it promises.
   * A countdown that disagrees with what it counts down to is worse than none.
   *
   * The geometry lives in compassRing.ts, which hands back the arc's starting
   * point so this cannot forget to open a subpath on it. See the note there.
   */
  private drawTurnRing(
    ball: Ball, c: Pt, r: number, scale: number, activeSeconds: number,
  ): void {
    const ring = compassRing(ball, c.x, c.y, r, scale, activeSeconds);
    if (!ring) return;

    // Stroked as an explicit polyline, NOT with arc(). compassRing.ts has the
    // long version; the short one is that arc() both continues whatever path is
    // open AND leaves a corrupt "last point" behind it (Pixi reads a plain
    // arc's data as if it were an arcToSvg), which every later mark on this
    // SHARED Graphics then inherits. moveTo + lineTo has neither problem, and
    // the ring is flattened to the same steps Pixi used, so it looks identical.
    const pts = ring.points;
    this.overlays.moveTo(pts[0], pts[1]);
    for (let i = 2; i + 1 < pts.length; i += 2) {
      this.overlays.lineTo(pts[i], pts[i + 1]);
    }
    this.overlays
      .stroke({
        width: Math.max(1.5, 2.2 * scale),
        // Reddens as it runs out: the last second should catch the eye of a
        // player who is looking somewhere else entirely, which is exactly when
        // this ball is about to punish them.
        color: ring.urgent ? PALETTE.danger : PALETTE.compassRing,
        alpha: 0.9,
        cap: "round",
      });
  }

  /**
   * The ability mark: what this ball DOES, said without using its colour.
   *
   * Ball identity was hue and nothing else, and hue is the channel that fails
   * in daylight, on the dark maps the game now offers on purpose, and for the
   * ~8% of men with a colour vision deficiency - for whom purple and compass
   * measure 4.6 apart in CIELAB, against the ~15 where two colours stop being
   * confusable. See ballMark.ts for the shapes and why they are so plain.
   *
   * Drawn into `overlays` rather than onto the body mesh, like the frost and the
   * collision halos, so it stays upright while the body squashes and spins.
   * A mark that rolled with the ball would be unreadable exactly when the ball
   * is doing something worth reading.
   */
  private drawMark(ball: Ball, c: Pt, r: number): void {
    // Too small to resolve: a mark that cannot hold its shape is not a faint
    // mark, it is a smudge, and it reads as damage to the ball.
    if (r < MARK_MIN_RADIUS_PX) return;
    const strokes = markFor(ball.ability);
    if (!strokes) return;

    const color = markColor(ball.color);
    const width = markWidth(r);
    for (const st of strokes) {
      if (st.kind === "dot") {
        this.overlays
          .circle(c.x + st.at[0] * r, c.y + st.at[1] * r, st.r * r)
          .fill({ color, alpha: 0.92 });
      } else {
        // moveTo first, for the same reason drawTurnRing does: Pixi continues
        // the current path, so without opening a subpath every mark would be
        // joined to the previous ball's by a line across the board.
        this.overlays.moveTo(c.x + st.pts[0][0] * r, c.y + st.pts[0][1] * r);
        for (let i = 1; i < st.pts.length; i++) {
          this.overlays.lineTo(c.x + st.pts[i][0] * r, c.y + st.pts[i][1] * r);
        }
        if (st.close) this.overlays.lineTo(c.x + st.pts[0][0] * r, c.y + st.pts[0][1] * r);
        this.overlays.stroke({ width, color, alpha: 0.92, cap: "round", join: "round" });
      }
    }
  }

  private drawBall(
    ball: Ball, view: BallView, light: LightScope, w2s: W2S, scale: number,
    activeSeconds: number,
  ): void {
    const { body, bodyPos, corona, coronaPos } = view;
    const p = ball.renderPosition ?? ball.position;
    const c = w2s(p.x, p.y);
    const r = Math.max(2, ball.radius * scale * (ball.assimScale ?? 1));

    // The smear first, so the sphere lands on top of its own blur.
    const trail = ballTrail(ball, c, r, scale, this.now);
    if (trail) {
      this.trails
        .moveTo(trail.from.x, trail.from.y)
        .lineTo(trail.to.x, trail.to.y)
        .stroke({
          width: trail.width,
          color: parseColor(ball.color),
          alpha: trail.alpha,
          cap: "round",
        });
    }

    const dormant = ball.state === "dormant";

    // ── The silhouette, computed FIRST ──────────────────────────────────────
    // Everything the ball draws has to agree about its shape, so the outline is
    // built before anything is laid down. It used to be computed after the
    // shadows and just before a uniformly-scaled corona, which is how a
    // splatted ball ended up as a flattened body under a perfectly round
    // additive bloom on a perfectly round shadow.
    //
    // The shape is a DROPLET, not an ellipse (see splatShape.ts): flat contact
    // face, mass pooled at the wall, domed crown. It is computed in contact
    // space - origin on the wall, +y into it - and mapped onto the board here.
    const squish = getSquishEffect(ball.effects, ball.isBoss ? BOSS_SQUISH_SCALE : 1);
    // ── Life (ballLife.ts) ──────────────────────────────────────────────────
    // The heartbeat swells the BODY, not the marks or the rings, which keep the
    // plain radius. A held ball's heart slows; a sleeper's and a locked one's
    // stop. The fastest ball on the board races.
    const held = ball.frozenUntil !== undefined && this.now < ball.frozenUntil;
    const beating = !dormant && ball.state === "active";
    const heart = beating
      ? heartbeat(this.now, heartPhase(ball.id), heartRate({ fastest: ball.id === this.fastestId, held }))
      : 0;
    const rBody = r * (1 + BREATHE * heart);
    const outline = splatOutline(squish.splat, rBody);
    const shape = splatMetrics(outline);
    // The bulb's filament: the middle of the sphere carried through the same
    // deformation, which is where both textures' bright core belongs. The
    // shadow below stays on the CENTROID, because a shadow is cast by the
    // silhouette and not by a point inside the ball.
    const core = splatCore(squish.splat, rBody);
    // The filament's lag: a spring in world units, kicked by every change of
    // the ball's velocity. Stepped here because this is where the velocity is
    // seen; render-only state, so it lives on the view.
    const dtLife = view.lastNow > 0 ? Math.min(0.05, Math.max(0, (this.now - view.lastNow) / 1000)) : 0;
    view.lastNow = this.now;
    stepLag(view.lag, ball.velocity.x, ball.velocity.y, ball.radius, dtLife);
    const lg0 = w2s(p.x, p.y);
    const lg1 = w2s(p.x + view.lag.x, p.y + view.lag.y);
    const lagDx = lg1.x - lg0.x, lagDy = lg1.y - lg0.y;
    // Stretch along the way it is going, faded out by any squash in progress
    // (the bounce takes over the silhouette) and off entirely while held.
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    const squashing = Math.abs(squish.splat.d) + Math.abs(squish.splat.v) + Math.abs(squish.splat.w);
    const stretchK = (held || !beating || speed < 1e-6)
      ? 0
      : flightStretch(speed) * (1 - Math.min(1, squashing / 0.05));
    let ux = 1, uy = 0;
    if (stretchK > 0) {
      const v1 = w2s(p.x + ball.velocity.x / speed, p.y + ball.velocity.y / speed);
      const vl = Math.hypot(v1.x - lg0.x, v1.y - lg0.y) || 1;
      ux = (v1.x - lg0.x) / vl; uy = (v1.y - lg0.y) / vl;
    }

    // The impact normal is a WORLD direction and the board may be turned, so it
    // is pushed through the same w2s every vertex goes through rather than used
    // as a screen angle directly. (The ellipse did use it directly, which was
    // quietly wrong on every tilting map.)
    const o0 = w2s(p.x, p.y);
    const o1 = w2s(p.x + squish.nx, p.y + squish.ny);
    const dlen = Math.hypot(o1.x - o0.x, o1.y - o0.y) || 1;
    const nx = (o1.x - o0.x) / dlen;
    const ny = (o1.y - o0.y) / dlen;
    const tx = -ny;
    const ty = nx;
    // Where the ball touches: one radius back along the normal from its centre.
    // The BREATHING radius for a free ball, so the swell is about its centre
    // and not about a contact point it left long ago; the plain radius for a
    // held one, whose face is glued to the wall and swells away from it.
    const rc = held ? r : rBody;
    const wx = c.x - nx * rc;
    const wy = c.y - ny * rc;
    /** Contact space -> screen. `ly` is INTO the wall, so it runs against the normal. */
    const sx = (lx: number, ly: number) => wx + tx * lx - nx * ly;
    const sy = (lx: number, ly: number) => wy + ty * lx - ny * ly;
    // The mass, which is where the highlight goes and what the shadow sits under.
    let bx = sx(shape.cx, shape.cy);
    let by = sy(shape.cx, shape.cy);

    // While a lock plays out the ball drains toward the accent, so it visibly
    // becomes part of the territory it just created rather than simply stopping.
    // BUCKET the fade before blending. assimColorFade is a continuous 0->1 clock
    // over the ~2s lock fade, and sphereTexture caches per colour - so an
    // unbucketed blend bakes a fresh texture nearly every frame, per locking
    // ball. 13 steps is visually indistinguishable from continuous and bounds
    // the cache to at most 13 extra bakes for the whole clear.
    const fadeRaw = ball.assimColorFade ?? 0;
    const fade = fadeRaw > 0 ? Math.round(Math.min(1, fadeRaw) * 12) / 12 : 0;
    const bodyColor = fade > 0
      ? mix(parseColor(ball.color), PALETTE.accent, fade)
      : parseColor(ball.color);
    // Locked balls dim toward the captured substrate they now belong to.
    const bodyAlpha = dormant ? 0.5 : ball.state === "won" ? 0.72 : 1;

    // ── Stuck: the liquid splat ─────────────────────────────────────────────
    // A Bug Squash hold with its scene captured draws as a field, not a fan
    // (see LiquidView). The hold flag rather than bugSquashUntil, because the
    // reinflate plays inside the freeze and the liquid has to see it through
    // to round before the mesh takes over again; and the scene, because for
    // one frame after the stick the physics has not yet recorded it.
    //
    // Decided HERE, before the shadow, because the liquid moves the mass:
    // on a corner it flows onto the solid, a radius or so from where the
    // droplet's centroid would have put it, and the shadow, the mark and the
    // light pool all have to sit under the liquid rather than beside it.
    const scene = ball.splatScene;
    const liquid = !!scene && squish.active && ball.effects.squishHoldUntil > 0;
    let lv: LiquidView | null = null;
    if (liquid) {
      lv = view.liquid;
      if (!lv || lv.radius !== ball.radius) {
        if (lv) {
          lv.body.texture.destroy(true);
          lv.glow.texture.destroy(true);
          lv.body.destroy();
          lv.glow.destroy();
        }
        lv = view.liquid = makeLiquid(ball.radius);
        this.bodies.addChild(lv.body);
        this.coronas.addChild(lv.glow);
      }
      // Repaint only when something it depends on moved. A splat spends most
      // of its stick flat and still, and a still splat is free.
      const sp = squish.splat;
      if (lv.scene !== scene || lv.d !== sp.d || lv.v !== sp.v || lv.w !== sp.w
        || lv.stretch !== sp.stretch || lv.color !== bodyColor) {
        rasterizeLiquid(lv.image, scene, sp, ball.radius, bodyColor);
        lv.bodySrc.update();
        lv.glowSrc.update();
        lv.scene = scene;
        lv.d = sp.d; lv.v = sp.v; lv.w = sp.w; lv.stretch = sp.stretch;
        lv.color = bodyColor;
      }
      // Contact space onto the screen, exactly as sx/sy do it for the fan:
      // local +x along the tangent, local +y against the normal. That is a
      // rotation by the tangent's angle (Pixi's local y is the x axis turned
      // a quarter on), scaled by screen pixels per texel.
      const k = (r / ball.radius) * lv.image.texel;
      const rot = Math.atan2(ty, tx);
      for (const sprite of [lv.body, lv.glow]) {
        sprite.position.set(wx, wy);
        sprite.rotation = rot;
        sprite.scale.set(k);
        sprite.alpha = bodyAlpha;
      }
      // The mass is where the liquid put it. In WORLD units for the light
      // pass, which has its own transform; on screen for everything here.
      const { cx: mcx, cy: mcy } = lv.image;
      const wtx = -squish.ny, wty = squish.nx;
      const cwx = p.x - squish.nx * ball.radius, cwy = p.y - squish.ny * ball.radius;
      ball.splatMass = {
        x: cwx + wtx * mcx - squish.nx * mcy,
        y: cwy + wty * mcx - squish.ny * mcy,
      };
      bx = sx(mcx, mcy);
      by = sy(mcx, mcy);
    } else {
      ball.splatMass = undefined;
    }

    // ── Cast shadow + contact ───────────────────────────────────────────────
    // Skipped while dormant: a sleeper is not yet part of the scene, and seating
    // it on the board with a shadow makes it read as a live ball to be locked.
    if (!dormant) {
      // SELF_LIT_SHADOW: a lamp fills in its own shadow. The shadow still has
      // to exist (a glowing ball is still opaque, and without one it floats off
      // the board), but at full strength a hard dark ellipse beside a bulb
      // reads as a mistake rather than as shading.
      // Laid under the mass and sized to the FOOTPRINT, so it widens as the
      // ball spreads. Pixi's ellipse is axis-aligned and cannot follow the
      // impact axis, so it takes the mean of the silhouette's two dimensions
      // rather than pretending to a precision the primitive does not have. A
      // shadow is soft and dark: what matters is that it stays under the ball
      // and grows with the splat, not that its axes are exact.
      const sr = r * (squish.scalePerp + squish.scaleAlong) / 2;
      const cast = shadowFor(light, bx, by, sr);
      this.shadows
        .ellipse(bx + cast.dx * cast.length, by + cast.dy * cast.length, sr * 1.02, sr * 0.72)
        .fill({ color: PALETTE.shadow, alpha: cast.alpha * SELF_LIT_SHADOW });

      const contact = contactFor(light, bx, by, sr);
      this.shadows
        .ellipse(
          bx + contact.dx * contact.length,
          by + contact.dy * contact.length,
          sr * 0.95,
          sr * 0.68,
        )
        .fill({ color: PALETTE.shadow, alpha: contact.alpha * 0.45 * SELF_LIT_SHADOW });
    }

    // ── Dormant: asleep, not gone ───────────────────────────────────────────
    // Dimmed and wrapped in a breathing teal cage, matching the circuit
    // terminals' colour so the link between sleeper and terminal is readable at
    // a glance. It casts no shadow and takes no specular below: it is not yet a
    // participant in the scene, and lighting it like one would make it read as a
    // live ball the player could lock.
    if (dormant) {
      const tp = 0.5 + 0.5 * Math.sin(this.now / 600);
      this.overlays
        .circle(c.x, c.y, r + 5 * scale)
        .stroke({ width: Math.max(1.5, 2 * scale), color: PALETTE.areaConst, alpha: 0.3 + 0.3 * tp });
      this.overlays
        .circle(c.x, c.y, r + 10 * scale)
        .stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.areaConst, alpha: 0.15 + 0.2 * tp });
    }

    // ── Body ────────────────────────────────────────────────────────────────
    if (lv) {
      lv.body.visible = true;
      lv.glow.visible = !dormant && bodyAlpha > 0.01;
      body.visible = false;
      corona.visible = false;
    } else {
      if (view.liquid) view.liquid.body.visible = view.liquid.glow.visible = false;
      body.visible = true;
      body.texture = sphereTexture(bodyColor, bucket(r));
      body.alpha = bodyAlpha;

      // The fan, in screen space. Both meshes are the same silhouette pushed out
      // from the mass by their own texture's inset (see makeFan), so the bulb's
      // edge and the corona's peak both land on the outline.
      writeFan(bodyPos, outline, core, SPHERE_MARGIN, sx, sy, lagDx, lagDy);
      if (stretchK > 0) stretchFan(bodyPos, c.x, c.y, ux, uy, 1 + stretchK, 1 - stretchK * 0.55);
      body.geometry.attributes.aPosition.buffer.update();

      // ── Corona ────────────────────────────────────────────────────────────
      // The bleed past the ball's own edge. A bright disc reads as a bright
      // disc; this is the part that reads as emitting. It follows the body's
      // dimming, so a sleeper is an unlit bulb and a locked ball goes out as
      // it drains.
      corona.visible = !dormant && body.alpha > 0.01;
      if (corona.visible) {
        corona.texture = coronaTex();
        // The bloom takes the body's SHAPE, not just its place. It is additive
        // and it bleeds past the silhouette, so a round one over a splatted
        // ball does not merely fail to help - it erases the splat, which was
        // most of why the squash could not be seen at all.
        writeFan(coronaPos, outline, core, CORONA_RADII, sx, sy, lagDx, lagDy);
        if (stretchK > 0) stretchFan(coronaPos, c.x, c.y, ux, uy, 1 + stretchK, 1 - stretchK * 0.55);
        corona.geometry.attributes.aPosition.buffer.update();
        // Whitened like the light pool, for the same reason: a pure hue bloom
        // over a pure hue ball is invisible, and it is the WHITENING that
        // reads as heat. More so on the beat: the flare is the heartbeat's
        // brightness half, the swell being its size half.
        corona.tint = mix(bodyColor, 0xffffff, 0.4 + CORONA_FLARE * heart);
        corona.alpha = body.alpha;
      }
    }

    // The ability mark rides on top of the body, including on a sleeper: what a
    // dormant ball will be once a fence wakes it is exactly what the player
    // needs to know while deciding whether to route through its terminal. Not
    // on a locked ball, which is draining toward the accent and has stopped
    // being a thing you can act on.
    // At the SUNK centre: the mark is painted on the ball, so it goes where the
    // ball goes. Left at `c` it hovered a few pixels off a splatted ball.
    if (ball.state !== "won") this.drawMark(ball, { x: bx, y: by }, r);

    if (ball.state === "won" || dormant) return;

    // ── Frost: this ball is held by a tap-freeze ────────────────────────────
    // Informational, not decorative - a frozen ball is one the player has spent
    // a charge on and is planning a cut around, so it has to be unmistakable.
    // Not on a Bug Squash hold, which also rides frozenUntil: that ball is
    // telling its own story with its shape, and frost over a splat would say
    // "you spent a freeze here" about a freeze the player never spent.
    const squashed = ball.bugSquashUntil !== undefined && this.now < ball.bugSquashUntil;
    if (!squashed && ball.frozenUntil !== undefined && this.now < ball.frozenUntil) {
      this.overlays
        .circle(c.x, c.y, r * 1.12)
        .stroke({ width: Math.max(1, 1.5 * scale), color: PALETTE.frost, alpha: 0.85 });
      // Crystal spokes, so it reads as frozen rather than merely outlined.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 12;
        this.overlays
          .moveTo(c.x + Math.cos(a) * r * 0.45, c.y + Math.sin(a) * r * 0.45)
          .lineTo(c.x + Math.cos(a) * r * 1.05, c.y + Math.sin(a) * r * 1.05);
      }
      this.overlays.stroke({ width: Math.max(1, scale), color: PALETTE.frost, alpha: 0.55 });
    }

    // ── Heading chevrons: which way a held ball will leave ──────────────────
    // Every hold, not just the tap-freeze: a motionless circle carries no
    // heading, and Cold Boot in particular starts the map with a board of them
    // the player has never seen move. Skipped on a Bug Squash splat, whose
    // "behind" is the wall it is stuck to.
    if (!squashed && ball.frozenUntil !== undefined && this.now < ball.frozenUntil) {
      for (const chevron of getHeadingChevrons(c, ball.velocity, r, this.now)) {
        this.overlays
          .moveTo(chevron.left.x, chevron.left.y)
          .lineTo(chevron.apex.x, chevron.apex.y)
          .lineTo(chevron.right.x, chevron.right.y)
          .stroke({
            width: Math.max(1, 1.4 * scale),
            color: PALETTE.frost,
            alpha: chevron.alpha,
          });
      }
    }

    // ── Collision halos ─────────────────────────────────────────────────────
    // An expanding ring on impact: wall hits and ball-to-ball hits get their own,
    // the latter larger and brighter because it is the rarer, more consequential
    // event. This is feedback, not decoration - it is how a hit you did not see
    // coming announces itself - so it is drawn over the body rather than lit.
    // On the mass while the liquid is up, for the same reason as the shadow:
    // a ring around a position the ball is no longer drawn at reads as a
    // halo left hanging beside it.
    const hx = lv ? bx : c.x, hy = lv ? by : c.y;
    const wallHit = getWallHitEffect(ball.effects);
    if (wallHit.active) {
      this.overlays
        .circle(hx, hy, r * wallHit.ringRadius)
        .stroke({
          width: Math.max(1, wallHit.ringWidth * scale),
          color: parseColor(ball.color),
          alpha: wallHit.glowAlpha,
        });
    }
    const ballHit = getBallHitEffect(ball.effects, this.now);
    if (ballHit.active) {
      this.overlays
        .circle(hx, hy, r * ballHit.ringRadius)
        .stroke({
          width: Math.max(1, 2 * scale),
          color: parseColor(ball.color),
          alpha: ballHit.glowAlpha,
        });
    }

    // ── Fastest ball: the one the trajectory tracks and the danger frame means.
    if (ball.id === this.fastestId && ball.state === "active") {
      this.overlays
        .circle(hx, hy, r + 6 * scale)
        .stroke({ width: Math.max(1, 2 * scale), color: PALETTE.mirror, alpha: 0.55 });
    }

    // ── Boss splash: a minion budding out of the boss ───────────────────────
    // Droplets thrown from the boss rim along the birth direction, so a spawn
    // reads as something being EXPELLED rather than a ball appearing from
    // nowhere. Frame geometry comes from the shared bossSplashFrame.
    if (ball.splitAnimAt !== undefined) {
      const dir = ball.splitDirX !== undefined && ball.splitDirY !== undefined
        ? { x: ball.splitDirX, y: ball.splitDirY }
        : { x: 1, y: 0 };
      const frame = bossSplashFrame(
        r, dir.x, dir.y, ball.splitAnimAt, this.now, scale,
        ball.id.charCodeAt(ball.id.length - 1) || 1,
      );
      if (frame.active) {
        const color = parseColor(ball.color);
        // The rupture ring is the tell that the boss SPLIT rather than that a
        // ball drifted past; droplets alone read as ambient particles.
        if (frame.ringAlpha > 0) {
          this.overlays
            .circle(c.x + frame.ringX, c.y + frame.ringY, Math.max(0.5, frame.ringR))
            .stroke({ width: Math.max(1, frame.ringWidth), color, alpha: frame.ringAlpha });
        }
        for (const d of frame.droplets) {
          this.overlays.circle(c.x + d.x, c.y + d.y, Math.max(0.5, d.r)).fill({ color, alpha: d.alpha });
          this.overlays
            .circle(c.x + d.x + d.hx, c.y + d.y + d.hy, Math.max(0.3, d.r * 0.35))
            .fill({ color: 0xffffff, alpha: d.alpha * 0.6 });
        }
      }
    }

    // The compass countdown, last so it sits over the ball it belongs to.
    this.drawTurnRing(ball, c, r, scale, activeSeconds);
  }

  destroy(): void {
    // The liquid textures are per view, not shared like the sphere bakes, so
    // they go with the layer rather than waiting for a cache clear.
    for (const v of this.views) {
      if (!v.liquid) continue;
      v.liquid.body.texture.destroy(true);
      v.liquid.glow.texture.destroy(true);
    }
    this.container.destroy({ children: true });
  }
}

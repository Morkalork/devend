/**
 * The light model's dials.
 *
 * Rendering settings, not gameplay, so they sit outside the modifiers the same
 * way ballLook.ts does - and separate from it because these are about how the
 * BOARD responds to light rather than how a ball is dressed. Persisted, so a
 * tester's dial survives a reload, and read by the renderer every frame through
 * one cached object.
 *
 * Each has a Playground slider (CLAUDE.md: anything new that changes how the
 * game plays lands with the control that lets a tester reach it), and each is a
 * slider rather than a toggle for the same reason the ball's web is: the right
 * strength is judged in play, and 0 is always one drag away, which makes every
 * one of these a before/after a tester can do without a rebuild.
 */
export interface LightLook {
  /**
   * Bounce light: how brightly a surface answers a ball that is nearly
   * touching it, and how much of that the ball takes back on its near side.
   * 0 is the behaviour before it existed.
   */
  bounce: number;
  /**
   * Second-hand light: a mirror giving a ball's pool back, a portal passing it
   * to the far mouth (derivedLight.ts). 0 is the behaviour before it existed.
   */
  reflected: number;
  /**
   * The bright core a translucent ball focuses into its own shadow
   * (flashLight.ts). 0 is the opaque-stone shadow it had before.
   */
  caustic: number;
  /**
   * How hard a lock flash lights the room around the pocket it just took.
   * 0 leaves it the bright fill it was, lighting nothing.
   */
  flash: number;
  /**
   * How much the light SAYS (ballTell.ts): a countdown beating in a compass
   * ball's pool, and a filament warming up when one switches on. 0 leaves the
   * light a pure decoration, which is what it was.
   */
  tell: number;
  /**
   * Whether balls block each other's light (ballLightPass.ts). A glowing ball
   * is still opaque; before this only walls were in the occluder loop, so one
   * ball's pool shone straight through another.
   */
  ballShadows: number;
  /**
   * The board answering something that just happened: a flash where a ball
   * struck, and the hot tip of a fence being drawn. 0 leaves both dark, which
   * is what they were.
   */
  reaction: number;
  /**
   * How hard a ball's own SPEED drives how brightly it burns (ballTell.ts
   * speedGain). 0 leaves every ball at one output whatever it is doing, which
   * is what it was: only the pool's shape moved with speed.
   */
  energy: number;
  /**
   * Local exposure (exposure.ts): how much a light is rolled off by how
   * crowded the board is where it stands, so four pools in one corner stop
   * summing into a flat white patch. 0 is the uncontrolled sum it was.
   */
  exposure: number;
  /**
   * Directional shading (faceLight.ts): a wall's face answering the light in
   * front of it, graded by which way the face is turned. 0 leaves every
   * surface lit by distance alone, which is the flat-disc look it had.
   */
  facing: number;
  /**
   * Soft shadows (ballLight.ts shadowQuad): the penumbra a ball throws as an
   * AREA source, widening with distance from whatever is casting it. 0 is the
   * hard point-light edge it had.
   */
  softShadows: number;
  /**
   * Motes in the air (motes.ts): how much of the ambient field is present.
   * Scales the COUNT rather than the brightness, because dimming is what the
   * light already means. 0 is a board with no air in it, which is what it was.
   */
  motes: number;
}

const KEY = "devend.lightLook";
export const DEFAULT_LIGHT_LOOK: LightLook = {
  bounce: 0.8, reflected: 1, caustic: 0.9, flash: 1, tell: 1, ballShadows: 1, reaction: 1,
  energy: 0.85, exposure: 1, facing: 0.9, softShadows: 0.9, motes: 0.8,
};

let current: LightLook | null = null;

function unit(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function sanitise(l: LightLook): LightLook {
  return {
    bounce: unit(l.bounce, DEFAULT_LIGHT_LOOK.bounce),
    reflected: unit(l.reflected, DEFAULT_LIGHT_LOOK.reflected),
    caustic: unit(l.caustic, DEFAULT_LIGHT_LOOK.caustic),
    flash: unit(l.flash, DEFAULT_LIGHT_LOOK.flash),
    tell: unit(l.tell, DEFAULT_LIGHT_LOOK.tell),
    ballShadows: unit(l.ballShadows, DEFAULT_LIGHT_LOOK.ballShadows),
    reaction: unit(l.reaction, DEFAULT_LIGHT_LOOK.reaction),
    energy: unit(l.energy, DEFAULT_LIGHT_LOOK.energy),
    exposure: unit(l.exposure, DEFAULT_LIGHT_LOOK.exposure),
    facing: unit(l.facing, DEFAULT_LIGHT_LOOK.facing),
    softShadows: unit(l.softShadows, DEFAULT_LIGHT_LOOK.softShadows),
    motes: unit(l.motes, DEFAULT_LIGHT_LOOK.motes),
  };
}

function load(): LightLook {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LightLook>;
      return sanitise({ ...DEFAULT_LIGHT_LOOK, ...parsed });
    }
  } catch { /* unreadable storage: defaults */ }
  return { ...DEFAULT_LIGHT_LOOK };
}

/** The current dials. Cached: this is read every frame. */
export function getLightLook(): LightLook {
  if (!current) current = load();
  return current;
}

/** Change part of the light model; persisted, and live from the next frame. */
export function setLightLook(patch: Partial<LightLook>): LightLook {
  current = sanitise({ ...getLightLook(), ...patch });
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(current));
  } catch { /* storage full or blocked: the setting still applies this session */ }
  return current;
}

/** Tests: forget the cached dials so the next read comes from storage. */
export function resetLightLookCache(): void {
  current = null;
}

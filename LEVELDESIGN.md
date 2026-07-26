# LEVELDESIGN.md

How to author Dev/End maps that are fun, challenging, and purposeful.
Companion to **ARCHITECTURE.md** (systems and data model) and the map schema in
`src/types/level.ts` (consumed from `public/map.yml`).

---

## The one principle

**A map is only as good as the decisions it forces.**

Everything fun in Dev/End is one thing: risk and tempo decisions around the
**lock economy**, trap balls in truly sealed pockets for money, on a shrinking
clock, where a *superior* lock pays more but demands a tighter, riskier seal.

So the test for every element you place is: *does it change a decision the
player will remember making?* An obstacle that doesn't change a decision is
noise. Cut it. An open field with scattered blocks is boring precisely because
any cut is as good as any other, so skill and greed have nowhere to live.

The three conventions below each attack a different axis: **where** you play
(topology), **why** you'd risk it (the greed hook), and **how** it unfolds (the
turn). A strong non-tutorial map embodies **all three at once**.

---

## Convention 1: Topology with intent (chambers & chokepoints)

**The map is a sealing puzzle, not a field of noise.** Compose obstacles into a
small number of **chambers linked by narrow necks**, not scattered blocks. A
chamber should be sealable in one well-timed cut and pocket-sized enough to
qualify for a lock (ideally a superior one).

- **Why the player cares:** every cut becomes a *read*, "can I close that neck
  before the fast ball reaches it?" The geometry itself is the challenge, so the
  player learns a map's chokepoints and visibly improves. That mastery loop is
  what a scatter-map can never give.
- **Mechanical hooks:** fences + the true-seal lock rule + superior locks +
  `lockMinRegionCells`. A `mover` patrolling a neck makes the timing brutal; a
  `mirror` wall bends a fence around a corner.
- **Authoring recipe:**
  - 2 to 4 chambers; each with 1 to 2 necks about a couple of ball-diameters wide.
  - Include one safe/easy chamber and one greedy/tight one.
  - Guarantee at least one pocket is superior-lock-sized.
  - Leave open *drawing lanes*, never wall the board into a maze with no room to
    draw a fence.
- **YAML:** `entities` of `kind: wall` (rect/polygon/circle) forming the necks;
  set `sizeThreshold` and `expectedCuts` to match the intended number of seals.
- **Example premises:** *Server Racks* (three bays joined by two aisles you pinch
  in sequence); *Airlock* (a big room feeding a tiny vestibule that is a superior
  lock if you time the neck).
- **Pitfalls:** necks wider than needed are trivial; narrower than a ball will
  not seal at all (the "gap too narrow to lock" rule). Tune necks to ball size.

---

## Convention 2: The greed hook (one signature risk/reward per map)

**Every map has exactly one headline opportunity** that pays big but costs risk
or tempo, *plus a legitimate safe way to skip it*. That single hook is the map's
identity and its purpose.

- **Why the player cares:** this is the decision they talk about, "do I crack the
  vault or play safe?" Greed with a real cost is the engine of replayability and
  the stage where build identity expresses itself (a glass-cannon build goes for
  it; a safe build does not). It gives the map a *purpose* beyond "clear 80%."
- **Mechanical hooks:** a `chest` (destruct-up); a superior-lock pocket; a VIP or
  boss ball worth locking; a breakable gate with `reveals` bonus space; a
  designated lock-multiplier pocket.
- **Authoring recipe:**
  - Place ONE focal reward at the map's visual center of gravity.
  - Guard it with a cost: a `breakable` you must smash (spends time, or releases
    balls into your workspace), a hazard lane you must cut across, or a long
    fence drawn over live ball paths.
  - Always leave a real safe path, or it is not a choice.
- **YAML:** a `lockZones` entry (a rect + `multiplier`) marks the pay-more
  pocket; `entities` with `breakable: true` + `chest: true` + `chestRewards`, or
  a `reveals` rect on a breakable gate; a `mover` as the guard.
- **Example premises:** *Bonus Pool* (a central chest behind a breakable;
  smashing it frees two fast balls at you); *Corner Office* (a superior-lock
  pocket guarded by a mover you must time).
- **Pitfall:** exactly ONE hook per map. Two focal points equal no focus.

### Colored Areas (a required win-gate greed hook)

Where `lockZones` is an *optional* bonus pocket, a **Colored Area** is a typed,
labelled zone that is a **required win gate**: you win the map by locking a
TARGET ball inside one, and locking the target *outside* fails the map (lose a
life, restart). Locking inside also pays the kind's multiplier. Three kinds,
easiest to hardest (draw `var` biggest, `const` smallest):

| kind | colour | multiplier |
|------|--------|------------|
| `var` | light pink | 1.5x |
| `let` | light orange | 2x |
| `const` | light teal | 3x |

- **Target ball:** boss map -> the boss ball; otherwise any ball. The area is
  the map's SOLE win path (space-clear does not win a Colored-Area map).
- **Fail:** the target can no longer reach an area (boss trapped outside, or
  every ball locked with none inside) -> lose a life + restart.
- **YAML:** `coloredAreas: [{ x, y, width, height, kind }]`. Shipped example:
  the level-10 boss is defeated by fencing it into a top-right `var` area
  (replacing "trap it 3 times").

---

## Convention 3: The Turn (the board evolves, it does not just shrink)

**Each map gets one scripted beat**, a state change at a threshold (space % or
seconds), so the endgame differs from the opening. Beginning (setup), Turn
(complication), End (scramble).

- **Why the player cares:** it kills the "every map is the same slow squeeze"
  fatigue and creates the *moments* people remember. This is the single biggest
  lever against long-run boredom across 30+ maps.
- **Mechanical hooks:** boss `phases` (spawn adds); a breakable **support that
  topples** to reveal new space or drop a hazard (#38); a `mover` that opens or
  closes a passage mid-map; a scope-creep spike; a map `mutator` (#54); rainbow
  timed spit.
- **Authoring recipe:**
  - One designed beat beyond ambient scope creep.
  - **Telegraph it** (a cracking wall, a warning) so it is fair.
  - Make it *change the plan*: new space to claim, a chamber that opens or
    closes, or a threat the player must have out-earned by then.
- **YAML:** `beats` (available on ANY map) with a trigger (`atSpaceRemaining` /
  `atSeconds`) and effects `spawnAdds` / `breakId` (force-break a support, which
  topples/reveals) / `speedSpike`. **Telegraph** a beat with `announce` (an i18n
  key) + optional `leadMs`: a warning banner shows ahead of a time beat (or as a
  space beat lands), so the Turn is fair, not an ambush. `breakId` self-
  telegraphs (the wall visibly breaks), so it needs no `announce`. Or use
  `boss.phases` on boss maps; a `mover` whose cycle opens a neck. See the topple
  caveat under Interactions when using `breakId` on a stacked support of a
  rotatable map. (Shipped example: level-7 "Crunch Time" speed spike.)
- **Example premises:** *Deadline* (at 40% remaining a support topples and adds
  spill in, lock your money before then); *Migration* (a slow mover cracks open
  a sealed vault halfway through, get there in time).
- **Pitfall:** only ONE turn (constant chaos is noise); never a surprise that
  cheaply destroys an in-progress fence.

---

## Modifiers (opt-in flavor, not every map)

Modifiers sharpen the three conventions. Use them to give specific maps a
character; do not stack all of them, and never turn every map into the same
gimmick (variety is the whole point).

### Fence budget / "WIP Limit"

A per-map cap on the number of fences you may successfully complete
(`fenceBudget` on a level). Running out before the map is finished costs a life
and restarts the map. On-theme: a work-in-progress limit / sprint capacity.
Amplifies Conventions 1 and 2: fences become precious, so *where* you spend them
(necks) and *whether* you spend two on the vault becomes a real decision.

Rules (as implemented):
- **Per-map, opt-in.** Efficiency is a *flavor* of map, not the whole game.
- **Only completed partitions count** (`game.completedCuts`). A fence a ball
  destroys mid-draw never completes, so it is free, no double jeopardy with the
  existing "ball destroys your in-progress fence" tension.
- **Budget = `expectedCuts` + a margin.** Generous early (a soft skill gate),
  tighter on designated efficiency maps. Shipped on level-5 (14) and level-6 (15).
- **Telegraphed** via a HUD fence chip that warns (amber) at 2 or fewer and dims
  at zero.
- Failure reuses the standard map-loss path (`handleGameOverFn`), so lives /
  restart / run-end are handled exactly like any other loss.

### Time limit / "Deadline"

`timeLimit` (active-play seconds). Shares the Ship Early countdown bar. Pairs
naturally with a Turn that lands before the deadline.

### Mutators (#54) and Ascension fence durability

Environmental modifiers and finite-hit fences add pressure; use sparingly so the
core read (topology + timing) stays legible.

---

## Authoring checklist

A map is not done until:

- [ ] It reads as **chambers and necks**, not scattered blocks (Convention 1).
- [ ] There is **exactly one greed hook** with a real cost AND a safe skip
      (Convention 2).
- [ ] There is **one telegraphed Turn** so the end differs from the start
      (Convention 3).
- [ ] At least one pocket is **superior-lock-sized**.
- [ ] `expectedCuts` / `sizeThreshold` match the intended number of seals.
- [ ] There are open **drawing lanes** everywhere a cut is expected.
- [ ] You can state the map's premise in **one sentence** ("this is the one
      where...").

If you cannot name the map in one sentence, it has no identity yet.

---

## Interactions with existing systems

- **Map rotation (`mapRotation.ts`):** Conventions 1 and 2 are purely spatial, so
  they survive rotation and gain free variety in each orientation. Convention 3's
  *topple* beats depend on gravity (down = board bottom), which rotation does not
  turn, so on rotatable maps (L4+) either avoid gravity-cascade stacks or build
  the Turn from non-gravity beats (movers, adds, creep). See the topple caveat in
  ARCHITECTURE / issue #38.
- **Teaching cadence (L1-3):** introduce each convention alone before combining,
  a first-chokepoint map, a first-vault map, a first-turn map. L1-3 never rotate.
- **Economy inflation and build identity:** the greed hook is where builds
  express; as money gets scarce late-run, raise the hook's stakes (bigger vault,
  higher lock multiplier).
- **Procedural slots (#53, L11+):** slots can randomize *which* chamber holds the
  vault or *where* the neck is, giving per-run variety inside the convention while
  staying deterministic on a Daily seed.

---

## Anti-patterns

- **Obstacle confetti:** blocks placed for texture, not to form necks or guard a
  hook. Every obstacle should shape a seal or a decision.
- **Two focal points:** the eye and the strategy need one center of gravity.
- **Unfair surprise:** an untelegraphed Turn that wrecks an in-progress fence.
- **No safe path past the hook:** greed is only a decision if skipping is viable.
- **Maze with no drawing room:** walls so dense the player cannot draw a fence.
- **Same gimmick every map:** modifiers are seasoning; monotony is monotony even
  when it is hard.

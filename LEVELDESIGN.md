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

## The feature schedule: four beats per mechanic

The three conventions above say what makes any single map good. This section
says which mechanic each map is *about*, and it exists because thirty-one good
maps in a row still produced a bad ladder.

**What went wrong.** "One new idea per map" is right for L1-3 and wrong for
everything after it. Applied to the whole ladder it spends the vocabulary by
level 20 and leaves nothing for the back half. The audit that prompted this:

- `dataStream`, `charge`, `threadLockRequired` and `gravityWell` each appeared
  on **exactly one map in the entire game**.
- `mover` carried **eight of the ten maps** in 21-30, `mirror` four of them, and
  nothing else in that band was new at all.
- The difficulty curve **inverted**: levels 31-34 asked for 70-72% of the board
  when level 15 had asked for 95%, and `expectedCuts` fell from 9 to 4.

None of that is visible one map at a time, which is why it survived so long.

### The four beats

A mechanic is not introduced, it is **developed**. A headline mechanic gets up
to four maps inside its act:

| beat | name | what the map does |
|------|------|-------------------|
| 1 | **Meet** | The mechanic alone, safe, legible. Nothing else on the map is new. |
| 2 | **Use** | The mechanic **is** the greed hook (Convention 2). You must operate it deliberately to get paid. |
| 3 | **Fight** | The mechanic as a hazard, crossed with an **older** mechanic, under space or fence pressure. |
| 4 | **Break** | The mechanic inverted, so the lesson it taught is turned against you. |

Seasoning mechanics (mirrors, thread-lock, slots) get one or two beats. Only
headline mechanics earn all four.

**Only beat 1 is solo.** Beats 2-4 must combine with something older. That
constraint is the whole point: it is where a mechanic stops being a feature and
starts being a decision.

Worked example, gravity wells across act III:

| beat | map | what it does |
|---|---|---|
| Meet | 21 "Gravity" | Two chambers, one neck, and a well hanging over the neck. The route between chambers is also where your ball stops going where you aimed it. |
| Use | 22 "Slingshot" | A paying pocket with a mouth you cannot reach on a straight line. Feed a ball through the well and it arcs in. The well becomes the aiming device. |
| Meet' | 23 "Fountain" | An up-well, low over the floor. Everything about a well says things fall here; this one throws them back. |
| Break | 24 "Deferred" | A well drawn from frame one and *asleep*. Bank under it early and it is free money; at 50% it wakes and that pocket fills with balls you did not send. |

### The rules

1. **Every mechanic is a greed hook at least once.** One that is only ever a
   hazard never becomes interesting, it just becomes tax.
2. **Every act ends with a skill check before its boss.** No new toys on that
   map. The boss is never the first test of the act's content.
3. **The inversion is mandatory** for headline mechanics. A dormant well, a
   `reveals` that frees balls instead of gifting space, an obstacle whose
   *absence* is the hazard (L28 "Flaky").
4. **The difficulty spine is independent of features.** Thresholds and cuts
   follow the spine below whatever happens to be on the map.
5. **The code gates are part of the schedule.** A mechanic debuting at level N
   needs its level constant at N. `TILT_MIN_LEVEL`, `PROCEDURAL_MIN_LEVEL`,
   `ROTATION_MIN_LEVEL`, `pickups.start_level`, and each ball's `unlockLevel`
   in `balls.yml`. A gate below its content is the worst case, because nothing
   throws: wells used to sit at 12-14 with the tilt gate at 11, which was ten
   levels of dice rolls that could only ever produce a rotation with nothing to
   break.
6. **Keep what works, move it.** A map with real identity gets relocated, not
   rebuilt. "Code Freeze" moved from 22 to 33 byte-for-byte when act III needed
   the slot.

### The difficulty spine

Space demanded (100 − `sizeThreshold`) climbs within an act, and may only fall
on the map straight after a boss, which is the breather. Bosses sit below the
map before them: a boss is about its objective, not about the clear.

```
Act I    60 -> 84    Act III  86 -> 93
Act II   84 -> 91    Act IV   92 -> 95
```

`expectedCuts` is deliberately **not** required to be monotone: it says how many
seals a map's topology is built around, so a map of fewer, larger chambers
legitimately wants fewer cuts than its neighbour. What is forbidden is a
collapse, so a map may sit at most one cut below its act's high-water mark.

### The acts

| act | levels | identity | owns |
|---|---|---|---|
| I | 1-10 | Onboarding: the basics of sealing | locking, 2 balls, chambers & necks, movers, breakables, the BONUS area |
| II | 11-20 | The Sprint: pressure and space | chests, `reveals`, terminals + dormant balls, WIP limit, mirrors, 4 balls |
| III | 21-30 | Legacy Code: the board fights back | every gravity idea, the tilt, `dataStream`, charges, phasing |
| IV | 31-35 | Crunch: everything at once | no new primitives; combination set-pieces, pinned mutators, and the first maps to state their own win conditions |

**Act IV states its win.** It is the only act whose maps carry a `win:` block
rather than leaning on the implicit clear, and each gate is priced with a
`bonusPercent` (see `winSpec.ts`). Two rules fell out of authoring it:

- **A gate never replaces the clear.** Every authored map still requires
  `space`, so a gate is a second thing to do while doing the first, not a way
  to skip the map.
- **A win that names a ball must pin the roster.** Ball types are otherwise
  picked from `maxBalls` and unlock levels, so a `lockType` clause left to the
  roll can produce a map that is unwinnable through no fault of the player.
  `winSpecProblems` flags it, and the map builder shows the flag.

`src/test/featureSchedule.test.ts` enforces the parts of this that are
machine-checkable: no mechanic debuts before its gate, headline mechanics appear
on enough maps, the spine holds, and every `announce` telegraph resolves in all
three locales (a missing key renders the variable name in a warning banner, at
the exact moment the map is trying to be fair). Acts are migrated one at a time;
its `MIGRATED_ACTS` list may only grow.

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
- **YAML:** a BONUS Colored Area (`coloredAreas` entry with `required: false`)
  marks the pay-more pocket; `entities` with `breakable: true` + `chest: true` +
  `chestRewards`, or a `reveals` rect on a breakable gate; a `mover` as the guard.
- **Example premises:** *Bonus Pool* (a central chest behind a breakable;
  smashing it frees two fast balls at you); *Corner Office* (a superior-lock
  pocket guarded by a mover you must time).
- **Pitfall:** exactly ONE hook per map. Two focal points equal no focus.

### Colored Areas (the one lock-zone primitive: bonus OR gate)

A **Colored Area** is a typed, labelled zone where locking pays the kind's
multiplier. One primitive, two stakes, chosen with `required`:

- **BONUS** (`required: false`) - the optional greed hook. Pays, gates nothing,
  costs nothing to ignore. This is the early-game form.
- **GATE** (the default) - a **required win condition**: you win the map by
  locking a TARGET ball inside one, and locking the target *outside* fails the
  map (lose a life, restart). This is the late-game form.

Teach it in that order: a bonus pocket on an early map trains the player to read
the box, so when L10's boss turns the same box into the only way to ship it, the
symbol is already familiar. Three kinds, easiest to hardest (draw `var` biggest,
`const` smallest):

| kind | colour | multiplier |
|------|--------|------------|
| `var` | light pink | 1.5x |
| `let` | light orange | 2x |
| `const` | light teal | 3x |

- **Target ball (gate only):** boss map -> the boss ball; otherwise any ball. A
  map with any gate area has that as its SOLE win path (space-clear does not win
  it). Bonus areas never affect the win at all.
- **Fail (gate only):** the target can no longer reach a gate area (boss trapped
  outside, or every ball locked with none inside) -> lose a life + restart.
- **Look:** a gate is drawn solid and bright; a bonus pocket is fainter with a
  fine dotted border, so "you must" and "you may" never read the same.
- **YAML:** `coloredAreas: [{ x, y, width, height, kind, required }]`. Shipped
  examples: L1's bonus `var` pocket (the greed hook, no risk), and the level-10
  boss, defeated by fencing it into a top-right `var` GATE.

#### Stacking the area with lock quality (the 6x rung)

The area kind is **not** the only lock multiplier, and the two **multiply**:

| multiplier | comes from | worth |
|---|---|---|
| area kind | locking inside a Colored Area | 1.5x / 2x / **3x** |
| lock quality | a SUPERIOR lock: pocket at most 40% of the base lock threshold | **2x** |

So a tight seal inside a `const` area pays **6x**, the top of the payout curve.
An area alone says *where* you locked; quality says *how well*. A map that asks
for both gets a three-rung decision (skip it / take it loosely / take it tight)
instead of a yes-no, which is the most interesting shape a greed hook has.

**The sizing trap:** the "draw const smallest" convention fights this. A const
box small enough to *look* like the hardest kind is itself superior-sized, so
any lock inside it grades superior automatically and the two multipliers
collapse back into one. To keep both rungs, draw the box **large enough to hold
both a sloppy and a tight seal**, and let obstacles inside it (a shelf, a
back nook) create the tight option. Size the two pockets against the *worst*
denominator for each, not a typical one:

- the roomy pocket must exceed 4% of the **whole board** (else an early seal
  grades superior by accident);
- the tight pocket must fall under 4% of **initial cells / ball count** (the
  smallest denominator the map can reach late).

That range matters because the grade is `cells / denominator` and the
denominator is `max(active cells, initial / active balls)`, which swings about
2x over a map. A pocket sized by eye grades differently at second 5 and second
50. A roomy pocket sized this way will sit *above* the 10% lock threshold late,
so it stops locking by percentage and relies on the "sealed inside an area is a
lock" containment rule instead: that only works if **every** cell of the pocket
is inside the box, so draw the box to cover the whole chamber.

Shipped example: **level-22 "Code Freeze"** (a const alcove with a shelf carving
off a back nook). Its geometry is pinned by `src/test/codeFreezeMap.test.ts`,
which asserts both margins rather than trusting the rects; copy that test when
authoring another stacked hook.
- **Authoring:** the Map Builder and the Playground level editor both have an
  "Areas (win gate)" section: `+ var` / `+ let` / `+ const` drop a kind-sized
  area on the board, which you then drag, resize by its handles, retype, or flip
  between gate and bonus with the "Win gate" checkbox. Deleting the last gate
  area returns the map to the normal clear-the-space win.

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
- **Onboarding map (first run only, `onboardingMap.ts`):** a brand new player's
  very first map is a hardcoded empty board with one ball and nothing else, which
  takes over slot 1 exactly once (it is NOT in `map.yml`, and is skipped on
  seeded Daily runs). It carries the whole "here is the loop" job, so L1-3 do
  NOT have to be teaching set-pieces: from the second run on, every run opens on
  the authored level-1 map. Design L1-3 as easy but real maps.
- **Teaching cadence (L1-3):** introduce each convention alone before combining,
  a first-chokepoint map, a first-vault map, a first-turn map. L1-3 never rotate.
  This is the ONLY band where one-new-idea-per-map applies to every map; from
  L4 on, follow the four-beat schedule above.
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

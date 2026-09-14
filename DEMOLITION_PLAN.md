# DEMOLITION_PLAN.md

The plan for the first **Demolition** map: level 17, the archetype's Meet beat.
The archetype itself is section 11 of `MAP_DESIGN_GUIDELINES.md`; this file is
the map and the build steps, in the shape `FENCE_TYPES_PLAN.md` used.

Status: **BUILT.** The plan below is kept as written, with the places the
build departed from it marked **[CHANGED]** and the reason given. The per-map
rationale now lives in section 5 of the guidelines; this file is the record of
what the plan got wrong and what the sweep measured.

Six departures. The third is the one worth reading, and the sixth replaced the
layout the first five arrived at:

1. **The barrel moved to the top-left corner, angled 12 degrees down.** At
   mid-left, firing straight through the doorway, the volley shattered four
   to six bricks in the first second and the shot was the whole map. From the
   corner the straight shot passes over the wall and comes back to it off the
   right edge; the wall is still the first thing the roster meets, but a
   second later, and aiming at it is a choice.
2. **`smashed: 8` became `smashed: 10`.** Measured with the bot making no
   cuts at all, eight bricks fall to accidents in two to five seconds at a hard
   pull and twelve at a soft one; ten in four to ten. Neither number gates
   anything, so the clause was set to the one that names "most of the wall"
   and leaves slack five, rather than the one that is met before the player
   has drawn a fence.
3. **The wall does not live in a room of its own, and cannot.** Two layouts
   were built and swept to try to make the smash *aimed*: a floor dividing the
   board with the wall in the far room and one neck, then two necks with the
   ring welded to the floor so no straight cut could sever it. Both lost seven
   of eight to `objectiveBuried`, most above 50% remaining, and the reason is
   the guidelines' own rule in section 9: the launcher gathers the whole
   roster in one room, so the other room is ball-free from the first frame and
   any cut that separates the balls from the neck captures it, wall and all.
   A partial roster in the barrel would fix it and is ruled out by the
   launcher's design (the pull is the map because everything is in the cup).
   So the wall sits in the traffic, where the bot never buries it, and the
   smash on this map is a **tempo lever**: an aimed hard volley meets it in
   about a second, accidents take four to ten, and a player who cages the
   roster with the wall sits in between. The archetype's rules in section 11
   were rewritten to say so.
4. **The bot harness was measuring itself.** `runBot` cut during the barrel's
   drain, which the input layer forbids for a player, so every launcher map
   carried a `launcherPrematureLock` loss no player can reach (level 11 on
   one seed, this map on three). `runBot` now honours
   `fencesBlockedByLauncher` and the headless step ticks
   `updateLauncherArming`, which the real loop always did. Level 11 reads 8 of
   8 on the same seeds afterwards.
5. **The ledger reshuffle was not left to the act's owner.** `ladderLedger`
   refuses a mechanic scheduled for a level at or below the ladder's end that
   is on no map, so portal, WIP limit, terminals and rotor could not stay at
   17. Their rows moved to 18 and the ledger's recorded rule 5 says that 18 is
   now a queue, not a map.

6. **The ring became a wall along the top edge, at the author's direction.**
   The ring-around-a-vault layout shipped first (8 of 8 on the bot, no
   buries). The map's owner asked for the Arkanoid shape instead: a wall of
   bricks across the top, so the player is inclined to seal the bottom of the
   board quickly to shorten the balls' bounce and the time between hits.
   That is a better premise than the ring, because it lines the two verbs
   up: clearing space IS speeding up the smash. Built as three rows of
   eleven-and-a-half (the vault takes two slots in the back row), a serve
   fired up from the bottom, `smashed: 16` of 35. Three things it changed:
   - **The count dropped under half the wall.** A vertical cut with every
     ball on one side buries about half of it; at 24 that was fatal, at 16
     it is survivable. The fatal cut is now only the horizontal one above
     every ball, which is the map's rule and is visible before you draw it.
   - **The gap guards learned about occlusion.** Three rows with 8-unit
     seams put rows one and three 38 apart with row two between them, and
     both pairwise guards read that as a ball-width slot. A pair whose gap
     is filled by a third rect with no more than a seam on either side is
     no longer reported.
   - **The serve was aimed at a seam.** Centred on the board, the barrel's
     straight shot hit the seam between two bricks and the first ball logged
     "no valid region" on six of eight seeds. Moved 34 units onto a brick's
     centre: zero.

**Sweep on shipping (the top wall), 8 seeds, 60s:** 3 wins at 19 to 20 cuts
against par 9, 5 `objectiveBuried` by a horizontal cut above the balls, no
violations, one benign ownership recovery. With no cuts at all, accidents
break sixteen bricks in 3 to 14 seconds and twenty-four in 8 to 29. The
scripted seal-from-the-bottom policy written to measure the premise's gain was
too crude to trust (three strips in fifty seconds, since three balls at up to
3x rarely leave a line clear), so the size of that gain for a human is not
measured here; the geometry says a roster held in the top third of the board
hits the wall about three times as often.

---

## 1. The map in one sentence

*The launcher fires the roster at a wall that breaks on touch, and the win
wants eight of its fifteen bricks gone. Fire hard and the wall goes fast, and so
does the map.* **[CHANGED]** ten of fifteen; see departure 2.

## 2. Why level 17, and what it displaces

- 17 is the next slot on the ladder (16 is the last built map; act II runs to
  the boss at 20).
- Section 5 currently briefs 17 as *Meet portal + WIP limit*. A Meet map may
  carry one new thing, and this plan spends it on brittle bricks. So the
  portal and WIP-limit brief moves down one rung, and act II's remaining
  slots (18, 19 skill check, 20 boss) have to absorb that: 18 takes portal +
  WIP limit, and the cage brief either compresses onto 18 or waits for act
  III. **That reshuffle is a decision for whoever owns the act II brief**, not
  something this plan makes on its own; the plan is written so 17 is the only
  row it commits.
- The spine allows it: 16 sits at 87% demanded and 9 cuts, so 17 asks 88% and
  9. Nothing here needs a breather.
- Brittle is a **Compressed** sibling of breakable (met at 5, fought at 6), so
  under the ledger's costing it takes a third of a map, which is what leaves
  room for the launcher's third beat (Meet 11, Use 12, **Fight** here). That
  takes the launcher off the "appears on 11 and 12 only" list in the ledger's
  recorded rule 3.

## 3. The board

900 x 900, `variety: 0`, `randomShapes: 0`: a wall of fifteen bricks has to be
exactly the wall that was drawn.

```
+-------------------------------------------------+
|                                                 |
|                    [==][==][==][==]             |
|                    []            []             |
|  +-----------+     []   +----+   []             |
|  | launcher  |>>>  ==   |chst|   []             |
|  +-----------+     []   +----+   []             |
|                    []            []             |
|                    [==][==][==][==]             |
|                                                 |
|                                     ----  shelf |
|                                        (pocket) |
+-------------------------------------------------+
```

**The launcher.** `x 60, y 395, 240 x 110, facing right, angle 0`, on the left
edge at mid-height, firing straight along y 450 into the wall's doorway.
**[CHANGED]** `y 90, angle 12`, in the top-left corner; see departure 1. The
muzzle is at x 300; the runway rule wants 225 clear ahead of it and breakables
do not count as blocking, so the wall may stand in the path and the next solid
is the right edge. The barrel is axis-aligned, so the bore rule for turned
barrels does not apply.

**The wall.** A square ring of brittle bricks around a chest, 70 units out from
it, 22 thick, with 8-unit seams:

| run | bricks | placement |
|---|---|---|
| top row, `y 318` | 4 | `x 468 / 536 / 604 / 672`, each `60 x 22` |
| bottom row, `y 560` | 4 | same x |
| left column, `x 468` | **2** | `y 340` and `y 492`, each `22 x 68`; the middle brick is omitted |
| right column, `x 710` | 3 | `y 340 / 416 / 492`, each `22 x 68` |

Thirteen bricks plus the chest is fourteen breakables; add one free-standing
brick (`x 800, y 200, 60 x 22`) as a fifteenth and as the odd one out that
teaches "one touch" away from the wall.

Every brick is `breakable: true, brittle: true`. The numbers are set against
the gap rule (a gap is 12 or under or 60 or over): 8-unit seams read as no way
through, the 70-unit moat between wall and chest is a neck, and the omitted
left brick leaves an **84-unit doorway** facing the launcher. The doorway is
not decoration: a wall with no legal way in encloses the moat, and section 7.6
says an enclosed space is captured at load. It is also the map's second
approach, so the chest can be reached without breaking anything.

**The chest.** `x 560, y 410, 80 x 80, chest: true, hitsToBreak: 3`, the one
thing inside the wall. The greed hook (see 5).

**The pocket.** A solid shelf at `x 760, y 770, 95 x 22` makes a
superior-lock-sized pocket under it in the bottom-right corner (95 x 63, about
6k square units, under the roughly 8.7k that 4% of initial cells / 3 balls
comes to, the smallest denominator the map can reach late). It sits far from every brick on purpose: while smashes are
outstanding, the reach guard refuses any pocket that holds a brick's strike
cells, so the map's lockable ground has to be away from the wall.

**Anchors.** The board edge. A cut through the wall's band duds on the bricks
(a fence cannot anchor on a breakable), and a player with the drill fence
finds out here that theirs does not.

## 4. How it plays (the intended line, and the two answers)

1. **The pull.** The barrel holds all three balls. A hard pull is fast balls,
   which is more base pay (the launcher's own rule), more damage per hit (the
   force model), and a faster map. A soft pull is a calm map and a wall that
   takes longer to come down. That is the launcher's wager with a third term
   added, and the third term is what makes this its Fight beat.
2. **Cage the hammer with the wall.** Vertical cuts at about `x 400` and
   `x 780` capture the strips either side (space progress) and confine the
   roster to the column with the wall in it. Every bounce in that column is a
   brick. Aiming and clearing are the same fence.
3. **Rank the balls.** The roster is pinned to `[red, grey, blue]`. Grey is
   heavy (density 1.6) and the obvious hammer, but it winds down over time, so
   it is a hammer that gets worse and a lock that gets easier. Lock it late.
4. **Eight bricks, then seal.** With `smashed: 8` met, the wall stops being
   an objective, the reach guard lets go, and the map is an ordinary clear:
   horizontal cuts across the column lock the balls and the shelf pocket pays
   the superior lock.

**The two answers.** Slack is seven (fifteen breakables against eight), so no
single cut is fatal. Topology: the wall can be eroded from outside or opened
through the doorway and chewed from inside the moat. Build affinity: a speed
or launcher build makes the wall go faster; a freeze or slow build makes the
cage cheaper to draw; a drill fence chews bricks with no ball at all. Three
routes, none required.

**The fail states, and why they are visible.** Lock all three balls with fewer
than eight smashed and the map ends as `lockedOut`, named on the overlay, with
the top-bar chip already amber at one ball left. Wall off enough bricks that
fewer than eight remain reachable and it ends as `objectiveBuried` at that
instant. Neither is silent.

## 5. The greed hook and the Turn

**Hook: the chest.** One ability charge, behind three real hits, inside a wall
that is also the map's requirement. The cost is the ball that opens it: the
fast one you fired hard is the one that gets there, and the moat it sits in
cannot lock until the clause is met, so a ball sent inside is a ball you are
not sealing yet. The safe skip is the whole rest of the map.

**Turn: the `crunch` spike at 30% remaining** (`speedSpike: 0.15`, announced
with the existing `game.beatCrunchTime`). Faster balls hit harder, so the wall
dissolves faster late, and the column you caged the roster in is a different
room by the time you go to seal it. The map's own idea turned on the player.

No `deadline` rescue beat: slack seven does its job, and `lockedOut` covers
the board cleared without smashing.

## 6. Numbers

| field | value | why |
|---|---|---|
| `sizeThreshold` | 12 | 88% demanded, one above 16's 87 |
| `expectedCuts` | 9 | two cage cuts, three seals, four of slack; equals the act's high-water mark |
| `points` | 5 | act II's flat base |
| `maxBalls` | 3 | act II's roster size |
| `ballTypeIds` | `[red, grey, blue]` | one heavy hammer that decays, two plain |
| `pickupChance` | 0 | drops are the Use beat; keep the Meet clean |
| `win.require` | `space 12`, `smashed 10` **[CHANGED]** from 8 | the smash never replaces the clear; ten names most of the wall. "Past what accidents deliver" was wrong: see departure 2 |
| `win.alsoWinIf` | none | act II carries no alternatives |

## 7. Draft YAML

```yaml
  # 17 "Deprecation" - COMPRESSED brittle, FIGHT the launcher, USE the chest.
  - id: level-17
    level: 17
    sizeThreshold: 12
    expectedCuts: 9
    points: 5
    maxBalls: 3
    variety: 0
    randomShapes: 0
    ballTypeIds: [red, grey, blue]
    pickupChance: 0
    win:
      require:
        - kind: space
          threshold: 12
        - kind: smashed
          count: 8
    beats:
      - id: crunch
        atSpaceRemaining: 30
        speedSpike: 0.15
        announce: game.beatCrunchTime
    entities:
      - id: barrel
        kind: launcher
        shape: rect
        x: 60
        'y': 395
        width: 240
        height: 110
        facing: right
        angle: 0
      - id: vault
        kind: wall
        shape: rect
        x: 560
        'y': 410
        width: 80
        height: 80
        chest: true
        breakable: true
        hitsToBreak: 3
      # wall, top row
      - { id: brick-t1, kind: wall, shape: rect, x: 468, 'y': 318, width: 60, height: 22, breakable: true, brittle: true }
      - { id: brick-t2, kind: wall, shape: rect, x: 536, 'y': 318, width: 60, height: 22, breakable: true, brittle: true }
      - { id: brick-t3, kind: wall, shape: rect, x: 604, 'y': 318, width: 60, height: 22, breakable: true, brittle: true }
      - { id: brick-t4, kind: wall, shape: rect, x: 672, 'y': 318, width: 60, height: 22, breakable: true, brittle: true }
      # wall, bottom row
      - { id: brick-b1, kind: wall, shape: rect, x: 468, 'y': 560, width: 60, height: 22, breakable: true, brittle: true }
      - { id: brick-b2, kind: wall, shape: rect, x: 536, 'y': 560, width: 60, height: 22, breakable: true, brittle: true }
      - { id: brick-b3, kind: wall, shape: rect, x: 604, 'y': 560, width: 60, height: 22, breakable: true, brittle: true }
      - { id: brick-b4, kind: wall, shape: rect, x: 672, 'y': 560, width: 60, height: 22, breakable: true, brittle: true }
      # wall, left column (the doorway is where the middle brick is not)
      - { id: brick-l1, kind: wall, shape: rect, x: 468, 'y': 340, width: 22, height: 68, breakable: true, brittle: true }
      - { id: brick-l3, kind: wall, shape: rect, x: 468, 'y': 492, width: 22, height: 68, breakable: true, brittle: true }
      # wall, right column
      - { id: brick-r1, kind: wall, shape: rect, x: 710, 'y': 340, width: 22, height: 68, breakable: true, brittle: true }
      - { id: brick-r2, kind: wall, shape: rect, x: 710, 'y': 416, width: 22, height: 68, breakable: true, brittle: true }
      - { id: brick-r3, kind: wall, shape: rect, x: 710, 'y': 492, width: 22, height: 68, breakable: true, brittle: true }
      # the odd one out: one touch, away from the wall
      - { id: brick-loose, kind: wall, shape: rect, x: 800, 'y': 200, width: 60, height: 22, breakable: true, brittle: true }
      # the superior-lock pocket
      - id: corner-shelf
        kind: wall
        shape: rect
        x: 760
        'y': 770
        width: 95
        height: 22
    balls: []
```

Expand the flow-style brick rows to block style if the builder does not
round-trip them; the values are what matter.

## 8. Work, in order

Each step leaves the build green on its own. Steps 1 and 2 are the critical
path; 3 is the map; 4 is verification. Drops, ball buffs and the targeted
clause are the later beats and are not in this plan.

### Step 1: brittle bricks

- `src/types/level.ts`: `brittle?: boolean` on `WallEntity`, documented as
  "any contact breaks it; implies breakable".
- `src/lib/initGame.ts` (where destructibles are built from entities): carry
  `brittle` onto the `DestructibleState`.
- `src/lib/physics/destructibles.ts`: `registerObjectHit` breaks a brittle
  object on its first debounced contact regardless of damage. The debounce
  stays, so one pass is one hit.
- The drill fence chews a brittle brick like any breakable; nothing to change,
  but add the case to the drill tests.
- Rendering, both renderers (`renderFrame.ts` and `rendering/pixi/`): a glass
  tile, distinct from the dented slab.
- `public/README-modifiers.md`: a `brittle` row beside `hitsToBreak`.
- **Admin, same commit** (CLAUDE.md): a "Brittle" toggle beside "Breakable" in
  `EntityPanel.tsx`; `adminCoverage.test.ts` will want the new field seen.
- `src/lib/admin/mechanicSpread.ts`: a `brittle` mechanic (family A detector
  on `e.brittle`). Check `mechanicSpread.test.ts`'s two-map floor: if it is
  owed at `LADDER_END`, either mark it `headline: false` until the Use beat
  lands, or land it on two maps.
- `MAP_DESIGN_GUIDELINES.md` ledger: `| brittle | A | Compressed | 17 | - | - |`
  and the `LABEL` entry in `ladderLedger.test.ts`, in the **same commit as the
  map** (the ledger test requires a mechanic with `meet > LADDER_END` to be on
  no map, and one with `meet <= LADDER_END` to be exactly right).
- Tests: a destructibles test that a brittle object breaks on a grazing hit
  where a `hitsToBreak: 1` slab does not.

### Step 2: the map's own checks

- `winSpecProblems`: nothing new; `smashed: 8` against fifteen breakables
  passes the existing count check. Consider adding the **slack** warning the
  guidelines ask for (count equal to the breakable count) while here, since
  it is one line and section 1 measures nine maps that break it.
- `smashReach`: confirm `regionHoldsNeededSlab` treats brittle bricks as
  slabs (it reads `breakables(game)`, so it should with no change), and that
  the corner-shelf pocket lies outside every brick's strike cells.

### Step 3: the map

- Add the YAML above to `public/map.yml` after level 16 (a file-level comment
  above the entry only; the rationale goes in section 5 of the guidelines as
  "#### 17 'Deprecation'").
- Section 5's act II table: rewrite the 17 row and shift the 17-19 briefs per
  section 2 of this plan, or leave 18-19 as they are with a note; either way
  the table must agree with the ledger, which `ladderLedger.test.ts` checks.
- Locales: nothing new. The Acceptance Criteria sentence for `smashed` and
  the `lockedOut` / `objectiveBuried` copy already exist in all three.

### Step 4: verify

- `npx tsc --noEmit -p tsconfig.app.json` and `npm run test` clean. The
  structural guards that read `map.yml` (featureSchedule's gap rule and spine,
  mapHookPlacement's self-overlap, launcherBarrel's runway and reachability,
  winSpec, areasGatingWin, mapTuning) all cover level 17 automatically.
- **Bot sweep, 8 seeds**, per section 8 of the guidelines. What to read
  (**[CHANGED]** the readings below assumed accidents would fall short of
  the clause; they do not, see departure 2, so the sweep's job here was the
  violation check, reachability across deals, and the bury rate):
  - `smashed` reached 8 on most seeds without the bot aiming means accidents
    are enough and the clause is too small; raise it toward 10.
  - `lockedOut` on every seed means accidents are never enough; the bot does
    not aim, so this is expected on a content map, but the *rate* of bricks
    broken per run says whether a human who does aim has a real edge. Record
    it beside the win rate.
  - `objectiveBuried` early at high remaining % is the layout burying the
    wall; it should not happen with slack seven.
  - `violations` non-empty is an engine bug, never a map one.
- Playtest with `?level=17`, on all four deals:
  - the opening pulse rings the bricks (they are what the win needs);
  - a cut through the wall's band duds with the `breakableAnchor` message;
  - the chip counts smashes 0/8 and the wall stops ringing at 8;
  - a pocket drawn against the wall is refused until 8 is met, and the
    corner-shelf pocket is not;
  - locking all three with the wall standing loses a life with `lockedOut`;
  - the `crunch` spike lands at 30% with its banner;
  - the shelf pocket grades SUPERIOR late in the map.

## 9. Not in this map

Drops, ball buffs, two-core `objectives` maps, and the protect inversion are
the Use, Fight and Break beats in section 11 of the guidelines. Each is its own
plan once this map has been played.

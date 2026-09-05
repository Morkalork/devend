# MAP_DESIGN_GUIDELINES.md

How to design the Dev/End ladder: what each of the 35 maps is *about*, how a
mechanic is taught, and how two mechanics are combined into a map that is more
than the sum of them.

Supersedes **LEVELDESIGN.md**. Companion to **ARCHITECTURE.md** (systems and
data model) and the map schema in `src/types/level.ts` (consumed from
`public/map.yml`).

---

## 1. The one principle, and the genre trap

**A map is only as good as the decisions it forces.**

Everything fun in Dev/End is one thing: risk and tempo decisions around the
**lock economy**. Trap balls in truly sealed pockets for money, on a shrinking
clock, where a *superior* lock pays more but demands a tighter, riskier seal.
So the test for every element you place is: *does it change a decision the
player will remember making?* An obstacle that does not is noise. Cut it.

### The genre trap

JezzBall had exactly one progression axis: **one more ball per room**. Same
room, more hazard, forever. Qix and Volfied added power-ups and a boss and
stopped there. That is the ceiling of the genre as it was left, and it is worth
naming because it is the cheapest thing to reach for whenever a map is boring:
*add a ball, add a mover, shrink the timer*.

Dev/End has five axes instead, and a good ladder moves along a different one
each map:

| axis | what changes | example |
|---|---|---|
| **Topology** | the shape of the sealing problem | two big chambers vs five small ones |
| **Economy** | what a lock is worth and where | a `const` pocket at 3x; a chest; a delivery box |
| **Mechanic** | a new verb on the board | a mirror, a portal, a gravity well |
| **Tempo** | when you may act | a WIP limit, a deadline, a mover's cycle |
| **Constraint** | what you may not do | fence ground at 45%, a thread lock, a pinned mutator |

**Ball count is the axis of last resort.** If the only difference between map N
and map N+1 is a ball, one of them should not exist.

---

## 2. The grammar: 27 mechanics in 5 families

The engine supports 27 headline mechanics. That is a large vocabulary for 31
non-boss maps, and it is why the ladder kept ending up with `coloredArea` on 19
maps and `cage`, `latch` and `rotor` on none: the easy mechanics keep winning.

Grouping them into families is what makes the vocabulary affordable. **A
family's first member costs a full teaching map. Its siblings cost a third of
one**, because the player already has the family's grammar: once you know a
mirror, a one-way membrane is a half-step, not a new idea.

| family | members | the family's grammar |
|---|---|---|
| **A. Solids that change** | breakable, chest, reveals, deformable, phasing, latch | *this wall will not be the same wall in a minute* |
| **B. Solids that redirect** | mirror, bend, one-way, ball gate, portal | *this wall changes where a thing goes, instead of stopping it* |
| **C. Machines that move balls** | mover, rotor, launcher, bumper, gravity well | *this thing acts on its own schedule, not yours* |
| **D. Rules on the ground** | colored area, fence ground, WIP limit, thread lock, pinned mutator | *the board is not uniform; where and how you cut is priced* |
| **E. The scripted board** | terminals, cage, data stream, charge, delivery box, pickup spots | *something happens that you did not do* |

Family order across the ladder is deliberate: **A and D first** (they change the
sealing problem without changing the physics), **B and C next** (they change
where balls go, which is harder to read), **E last** (the board acting on its
own is the least predictable and needs the most literacy).

### The mechanic ledger

Every mechanic gets a status, and the status decides what it costs.

- **Meet** - earns a full teaching map where it is the only new thing.
- **Compressed** - a family sibling, taught in half a map alongside an older
  mechanic's development beat.
- **Seasoning** - never a map's subject. Texture, or a tuning knob. Must still
  appear on at least 2 maps (`mechanicSpread`'s floor) or be marked
  `headline: false` in `src/lib/admin/mechanicSpread.ts`.

| mechanic | family | status | meet | use | fight | break |
|---|---|---|---|---|---|---|
| colored area (bonus) | D | Meet | 3 | 5 | 8 | 13 |
| mover | C | Meet | 4 | 5 | 7 | 23 |
| breakable | A | Meet | 5 | 7 | 6 | 25 |
| chest | A | Compressed | 7 | 9 | 22 | 32 |
| reveals | A | Compressed | 8 | 19 | - | - |
| mirror | B | Meet | 11 | 12 | 16 | 33 |
| WIP limit | D | Meet | 13 | 18 | 32 | - |
| portal | B | Meet | 14 | 15 | 21 | 34 |
| launcher | C | Meet | 16 | 17 | 25 | 19 |
| bumper | C | Compressed | 17 | 19 | 25 | - |
| terminals | E | Meet | 18 | 29 | 31 | - |
| cage | E | Compressed | 18 | 29 | - | - |
| gravity well | C | Meet | 21 | 22 | 26 | 28 |
| one-way | B | Meet | 23 | 24 | 31 | - |
| ball gate | B | Compressed | 23 | 33 | 34 | - |
| fence ground | D | Meet | 24 | 27 | 28 | - |
| deformable | A | Compressed | 25 | 25 | 32 | - |
| phasing | A | Meet | 26 | 27 | 28 | 34 |
| latch | A | Compressed | 26 | 31 | - | - |
| charge | E | Meet | 27 | 32 | - | - |
| data stream | E | Meet | 28 | 33 | - | - |
| delivery box | E | Meet | 29 | 31 | - | - |
| thread lock | D | Compressed | 29 | 34 | - | - |
| colored area (gate) | D | Meet | 8 | 20 (boss) | 33 | 35 |
| bent shape | B | Seasoning | - | - | - | - |
| the second ball | - | roster | 2 | - | - | - |
| rotor | C | Seasoning | - | - | - | - |
| pickup spots | E | Seasoning | - | - | - | - |
| pinned mutator | D | Seasoning | - | - | - | - |

**18 teachings across 31 playable maps**, so 13 maps carry no new mechanic at
all. Those 13 are not filler: they are where the combinations live, and they are
the reason the vocabulary is worth having.

Introduction rate: **8 new things across maps 1-15** (one per ~1.9 maps), **10
across 16-34**. The back half introduces *faster* and that is correct: by map 16
every new mechanic is a family sibling of something already known, so it costs
less to teach and can arrive on top of a combination.

---

## 3. The teaching unit: Meet, Use, Fight, Break

A mechanic is not introduced, it is **developed**. This is kishotenketsu, the
same four-beat structure Nintendo uses to teach a mechanic, develop it, twist it
and discard it inside a single Mario stage; here the four beats are spread
across an act instead of a level.

| beat | name | what the map does |
|------|------|-------------------|
| 1 | **Meet** | The mechanic alone, safe, legible. Nothing else on the map is new. |
| 2 | **Use** | The mechanic **is** the greed hook. You must operate it deliberately to get paid. |
| 3 | **Fight** | The mechanic as a hazard, crossed with an **older** mechanic, under space or fence pressure. |
| 4 | **Break** | The mechanic inverted, so the lesson it taught is turned against you. |

**Only beat 1 is solo, and "solo" means nothing else is NEW.** A Meet map may
freely be the Fight beat of an older mechanic; that is how 18 teachings fit into
31 maps. What a Meet map may not do is ask the player to learn two things at
once.

### The rules

1. **Every mechanic is a greed hook at least once.** One that is only ever a
   hazard never becomes interesting, it just becomes tax.
2. **Every act ends with a skill check before its boss.** No new toys on that
   map. The boss is never the first test of the act's content.
3. **The inversion is mandatory** for anything with a Meet map. A dormant well,
   a `reveals` that frees balls instead of gifting space, an obstacle whose
   *absence* is the hazard.
4. **The difficulty spine is independent of features.** Thresholds and cuts
   follow the spine below, whatever happens to be on the map.
5. **The code gates are part of the schedule.** See section 7.
6. **A safe first contact.** A Meet map must let the player get the mechanic
   wrong without losing the map. Wrong should cost tempo, not a life.

---

## 4. The combination matrix

This is the tool the back half of the ladder is built from. Lay every mechanic
against every other; each cell is a candidate premise. Most cells are empty or
dull. The interesting ones are worth writing down, because *nobody finds them by
authoring one map at a time* - which is precisely how the ladder ended up with
19 colored-area maps.

### What makes a combination legible

A combination map is only worth building if all three hold:

1. **The player can name both mechanics.** Both have had their Meet, at least
   two maps earlier.
2. **The pair produces a behaviour neither has alone.** If you can describe the
   map without mentioning one of them, it is not a combination, it is a map with
   a decoration on it.
3. **The chain is at most three links.** A breakable hiding a portal into a
   `const` room is three (conceal + transport + price). Four is soup: the player
   cannot attribute an outcome to a cause, and an unattributable outcome teaches
   nothing.

### The filled cells

Read as *row mechanic acting on column mechanic*.

| combination | the behaviour neither has alone | map |
|---|---|---|
| breakable **conceals** portal | a shortcut you must pay to discover, into a room priced at 3x | 15 |
| breakable **supports** reveals | smashing the floor resizes the bonus box you already sized a pocket for | 8 |
| mirror **bends** the only fence line to a chest | the vault whose approach cannot be drawn straight | 12 |
| portal **poisons** a pocket | the cheapest-looking seal on the board pays nothing, because a region holding a live portal cannot lock | 14 |
| launcher **fires into** a mirrored lane | speed is permanent and the lane aims it at you | 16 |
| bumper **brakes** a launched ball | the map's own answer to its own wager, paid for out of a fixed bank | 17 |
| deformable **taxes** a launched ball | the wall that never breaks is the only thing that takes speed back | 25 |
| gravity well **aims** into a pocket you cannot reach straight | the well becomes the aiming device, not the hazard | 22 |
| one-way **drains** into a sealed room | a pocket that fills itself, and then you cannot get out either | 23 |
| terminals **wake** caged balls mid-seal | the fence you spent wiring is the fence you needed for the neck | 18 |
| phasing **uncovers** a charge fuse | the slab will not be there in 1.4 seconds, and neither will the wall you anchored on | 27 |
| fence ground **prices** the cheapest chamber | the easiest pocket on the board is the longest stand-still | 24 |
| WIP limit **vs** a colored area | the bonus is affordable or the map is, not both | 13 |
| ball gate **sorts** a launcher's roster | the barrel fires four types and only one may enter the paying lane | 34 |
| latch **opens** on your own progress | the wall you were using as an anchor leaves when you succeed | 31 |
| data stream **crosses** fence ground | the one lane you must cross is the one that builds slowest | 28 |
| chest **inside** a phasing shell | the vault is only reachable on the half-cycle | 32 |
| delivery box **replaces** the seal | a lock that only counts somewhere specific, and the trip is the map | 29 |
| gravity well **under** a portal mouth | what comes out does not go where it was aimed | 21 |
| mover **patrols** a portal pair | the shortcut is open on a schedule you do not control | 33 |

### Generating new cells

When a map has no premise, do not reach for a ball. Take two mechanics that
have both been met, and ask the four questions in order:

- **Conceal**: can A hide B, so finding B is the reward for operating A?
- **Transport**: can A move a ball into B's reach, or out of it?
- **Price**: can A make B expensive, or free?
- **Invert**: can A turn B's lesson against the player?

Most pairs answer one of the four. A pair that answers none is not a map.

---

## 5. The ladder

Space demanded is `100 - sizeThreshold`. It climbs within an act and may only
fall on the map straight after a boss, which is the breather. Bosses sit below
the map before them: a boss is about its objective, not about the clear.

```
Act I    60 -> 84    Act III  86 -> 93
Act II   84 -> 91    Act IV   92 -> 95
```

`expectedCuts` is deliberately **not** monotone: it says how many seals a map's
topology is built around, so a map of fewer, larger chambers legitimately wants
fewer cuts than its neighbour. What is forbidden is a collapse, so a map may sit
at most one cut below its act's high-water mark.

### Act I - Onboarding (1-10)  *(built)*

*Owns: sealing, the bonus pocket, the solids that change, the first machine.*
Maps 1-3 never rotate. Power-up tokens begin at 8.

Authored at **variety 0 and randomShapes 0** throughout: see section 7.2 for
why, and change it back only once the runtime gap guard measures what ships.

| L | new | develops | premise |
|---|---|---|---|
| 1 | - (the doorway) | - | Two rooms, one doorway, one ball. Locking every ball wins outright, so the corner nook is a button marked "finish now". |
| 2 | the second ball | topology | The same doorway, two schedules. A lock is a decision now rather than an ending. |
| 3 | **Meet** colored area (bonus) | topology | A pink box that pays 1.5x and costs nothing to ignore. |
| 4 | **Meet** mover | Fight topology | A patrol sweeps the doorway: not "can I draw this fence" but "can I draw it NOW". |
| 5 | **Meet** breakable | Use mover, Use colored area | Six hits buy a second doorway the patrol never reaches. |
| 6 | - | Fight breakable | The divider is soft and the balls chip it just by living. Seal the far room while it is still a room. |
| 7 | **Compressed** chest | Use breakable, Fight mover | An open alcove worth two different things, and they compete for the same ball. |
| 8 | **Compressed** reveals, **Meet** colored area (gate) | Break colored area | The box stops being optional: clear to 81% AND lock a ball in it, on ground that does not exist until you pay for it. |
| 9 | - skill check | all of act I | No new toys. Five ideas competing for one attention, at 84%. |
| 10 | BOSS | - | *(out of scope, taken separately)* |

### Act II - The Sprint (11-20)

*Owns: pressure, the redirectors, the machines that add speed.*
Procedural slots unlock at 11. Rainbow 11, white 12, green 13.

| L | new | develops | premise |
|---|---|---|---|
| 11 | **Meet** mirror | Fight mover | Fences bend off a mirror wall: the first map where the cut you drew is not the cut you get. |
| 12 | - | Use mirror + chest | The vault whose only fence line runs off a mirror. |
| 13 | **Meet** WIP limit | Break colored area | Six fences for four pockets. The bonus is affordable or the map is, not both. |
| 14 | **Meet** portal | Fight topology | Two chambers joined without a neck, and the cheapest-looking pocket on the board pays nothing. |
| 15 | - | Use portal + breakable | A breakable conceals the portal mouth; behind it, a `const` room worth 6x. |
| 16 | **Meet** launcher | Fight mirror | A barrel fires the whole roster down a mirrored lane. Speed is permanent. |
| 17 | **Compressed** bumper | Use launcher | The pinball chamber: green bumpers pay an hour and brake, red ones only throw. |
| 18 | **Meet** terminals + **Compressed** cage | Fight WIP limit | Balls asleep in cages. Every fence spent wiring is one you cannot seal with. |
| 19 | - skill check | Break launcher + bumper | Drain the cluster for its hours and it turns on you. |
| 20 | BOSS | - | *(out of scope)* |

### Act III - Legacy Code (21-30)

*Owns: the board acting on its own schedule.*
Board tilt unlocks at 21. Lodestone 21, black 25 (the first map that may ask for
a mirror to be smashed).

| L | new | develops | premise |
|---|---|---|---|
| 21 | **Meet** gravity well | Use portal | The route between chambers is where your ball stops going where you aimed it. |
| 22 | - | Use gravity well + chest | Slingshot: a paying pocket with a mouth no straight line reaches. |
| 23 | **Meet** one-way + **Compressed** ball gate | Fight mover | A membrane balls fall through and cannot climb: a pocket that fills itself. |
| 24 | **Meet** fence ground | Break colored area | Ground that builds fences at 45%. The cheapest pocket is the longest stand-still. |
| 25 | **Compressed** deformable | Fight launcher, Break breakable | The wall that never breaks and drinks 3% a hit. Black ball unlocks here. |
| 26 | **Meet** phasing + **Compressed** latch | Fight gravity well | A wall that is not always there, and one that opens once and stays open. |
| 27 | **Meet** charge | Use phasing | A fuse, a delay, and a slab that will not be there in 1.4 seconds. |
| 28 | **Meet** data stream | Fight fence ground, Break gravity well | The one lane you must cross is the one that builds slowest. |
| 29 | **Meet** delivery box + **Compressed** thread lock | Break terminals | A lock that only counts somewhere specific, and the trip is the map. |
| 30 | BOSS | - | *(out of scope)* |

### Act IV - Crunch (31-35)

*No new primitives. Combination set-pieces, and the only act whose maps state
their own win conditions.*

| L | new | develops | premise |
|---|---|---|---|
| 31 | - | Use latch + delivery box, Fight one-way | The wall you anchored on leaves the moment you succeed. |
| 32 | - | Fight WIP limit + deformable, Use charge | The vault is only reachable on the half-cycle, and you have six fences. |
| 33 | - | Break mirror, Fight ball gate + data stream | A mover patrols the portal pair: the shortcut is open on a schedule you do not control. |
| 34 | - | Break portal + phasing, Fight ball gate | The barrel fires four types and only one may enter the paying lane. |
| 35 | BOSS | - | *(out of scope)* |

**Act IV states its win.** Two rules fall out of that:

- **A gate never replaces the clear.** Every authored map still requires
  `space`, so a gate is a second thing to do while doing the first, not a way to
  skip the map. This costs a `win:` block: a gate area with no authored win
  derives to `[{area, count: 1}]` and the space clause disappears entirely
  (`resolveWinSpec`), so "clear AND lock one in the box" has to be stated. Level
  8 is the first map outside act IV to state one, and that is why.
- **A win that names a ball must pin the roster.** Ball types are otherwise
  picked from `maxBalls` and unlock levels, so a `lockType` clause left to the
  roll can produce a map that is unwinnable through no fault of the player.
  `winSpecProblems` flags it and the map builder shows the flag.

---

## 6. Per-map craft

A map that fits the schedule can still be a bad map. These conventions are what
make any single map good, and **a strong non-tutorial map embodies all of them
at once.**

Conventions 1-3 keep their historical numbering, which is what the
cross-references scattered through `src/` and `public/map.yml` refer to.
Convention 4 was added after bot runs showed that 27 of the 35 maps could be
finished without engaging with anything on them.

### 6.1 Topology with intent  *(Convention 1)*

**The map is a sealing puzzle, not a field of noise.** Compose obstacles into a
small number of **chambers linked by narrow necks**, not scattered blocks.

- 2 to 4 chambers; each with 1 to 2 necks (see section 7 for legal widths).
- One safe/easy chamber and one greedy/tight one.
- At least one pocket must be superior-lock-sized.
- Leave open **drawing lanes**. Never wall the board into a maze with no room to
  draw a fence.

Every cut then becomes a *read*: "can I close that neck before the fast ball
reaches it?" That mastery loop is what a scatter-map can never give.

### 6.2 The greed hook  *(Convention 2)*

**Every map has exactly one headline opportunity** that pays big but costs risk
or tempo, *plus a legitimate safe way to skip it*. That single hook is the map's
identity.

- Place ONE focal reward at the map's visual centre of gravity.
- Guard it with a real cost: a breakable that spends time, a hazard lane to cut
  across, a long fence drawn over live ball paths.
- Always leave a real safe path, or it is not a choice.
- **Exactly one hook.** Two focal points equal no focus.

#### Colored areas: bonus or gate

One primitive, two stakes, chosen with `required`:

- **BONUS** (`required: false`) - the optional greed hook. Pays, gates nothing,
  costs nothing to ignore. The early-game form; drawn faint with a dotted rim.
- **GATE** (default) - a **required win condition**. You win by locking a TARGET
  ball inside one, and locking the target *outside* fails the map. The late-game
  form; drawn solid and bright.

Teach in that order, so when a boss turns the same box into the only way to ship,
the symbol is already familiar. On the built ladder that is **map 3 bonus, map 5
charged for, map 8 gate** - three maps apart, with the same drawing, which is
what makes the third one read as a promotion rather than a new mechanic.

| kind | colour | multiplier |
|------|--------|------------|
| `var` | light pink | 1.5x |
| `let` | light orange | 2x |
| `const` | light teal | 3x |

#### The 6x rung, and the sizing trap

Area kind and lock quality **multiply**: a superior lock (2x) inside a `const`
area (3x) pays **6x**, the top of the curve. A map that offers both has a
three-rung decision (skip / take it loosely / take it tight), which is the most
interesting shape a greed hook has.

The trap is that "draw `const` smallest" fights this. A `const` box small enough
to *look* like the hardest kind is itself superior-sized, so every lock in it
grades superior automatically and the two multipliers collapse into one. Draw
the box **large enough to hold both a sloppy and a tight seal**, and let a shelf
or a back nook inside it create the tight option. Size each pocket against its
*worst* denominator:

- the roomy pocket must exceed **4% of the whole board** (else an early seal
  grades superior by accident);
- the tight pocket must fall under **4% of initial cells / ball count** (the
  smallest denominator the map can reach late).

The grade is `cells / denominator` where the denominator is
`max(active cells, initial / active balls)`, which swings about **2x** over a
map. A pocket sized by eye grades differently at second 5 and second 50.

### 6.3 The Turn  *(Convention 3)*

**Each map gets one scripted beat**: a state change at a threshold (space % or
seconds), so the endgame differs from the opening. Beginning (setup), Turn
(complication), End (scramble). This is the single biggest lever against
long-run boredom across 31 maps.

- **A Turn needs a plan to disrupt.** Maps whose job is teaching the base verb
  do not have one yet, so maps 1 and 2 are exempt; from map 3 on it is
  mandatory. A complication on a map where the player has no plan is just noise
  with a banner over it.
- One designed beat beyond ambient scope creep.
- **Telegraph it** (`announce` + `leadMs`, or a visibly cracking wall) so it is
  fair. `breakId` self-telegraphs.
- Make it *change the plan*: new space to claim, a chamber that opens or closes,
  a threat the player must have out-earned.
- **Only one turn.** Constant chaos is noise. Never a surprise that cheaply
  destroys an in-progress fence.

---

### 6.4 The map states its own win  *(Convention 4)*

**Every map must ask for something its content can uniquely provide.** A map
whose win is only "clear to N%" is not a puzzle, it is a stopwatch, and it was
beatable two ways that ignored the board entirely:

- **The lock rush.** Sealing every ball ended the map. `resolveWinSpec` hands
  every derived map an `allLocked` ALTERNATIVE, so the last lock shipped it
  whatever the board looked like. Measured across acts I and II: `locks ==
  maxBalls` and `0.0%` remaining on every derived map.
- **Blind clearing.** Greedy cutting to the threshold with every ball still
  loose. Measured: maps 1-7 won 3/3 with **zero locks**, never touching a
  breakable, a zone or a mover.

The two are independent, and **removing the `allLocked` alternative fixes
neither.** `captureUnreachableCells` writes off the whole board the instant
nothing is in play, so `remaining` drops to ~0 and any `space` clause is met as
a *consequence* of the last lock. The shortcut does not live in the
alternative; it lives in the space clause.

So: author a `win:` block, and put in it at least one clause **a lock cannot
produce**.

| The map's content | The clause that makes it matter |
|---|---|
| a breakable, a chest | `smashed` |
| a gate colored area | `area` |
| a delivery box | `delivered` |
| a circuit | `terminals` |
| a data stream | `harvested` |
| nothing but walls | `locks` (closes blind clearing; that is all a bare map can ask) |

The five clause families are exactly the five the Engagement axis measures, and
that is the rule for adding a sixth: **a clause must read a counter the game
already keeps.** `terminals` reads `lit`, `harvested` reads the per-segment
`harvested` flags. Mirrors, portals, gravity wells and one-ways get no clause
on purpose - they are terrain, there is no state saying whether you "engaged"
with a wall that bounced a ball, and they earn their keep by changing HOW you
satisfy `space`, `locks` or `area`.

Two rules on top of it:

1. **Never put a `limit` clause in `alsoWinIf`.** `underPar` and `speedClear`
   are met until they are *blown*, so as an alternative they fire before the
   first cut and the map wins instantly. `winSpecProblems` flags this now.
2. **Treat any `alsoWinIf` clause as a way to SKIP the space clear**, because
   that is what it is. It has to be harder than clearing, not merely different,
   or it is a new shortcut wearing a premium. Act I deliberately has none.

**Early breakables cost at most three hits.** `maxHits` is not a count of
contacts: the force model gives a standard ball striking head-on at nominal
speed ~1.0 damage and scales with the closing speed along the normal to the
power 1.6, so a glancing hit does a fraction of that and a crawling graze does
0.15. A slab authored at 6 is a good deal MORE than six touches in practice,
which is how the map that introduces breaking came to read as hardcore. Act I
stays at 3 or under and puts its Meet/Fight escalation inside that range; the
late-ladder set-pieces (level 25's 40-hit plug, which the black ball exists
for) are not covered by this.

**Everything the win requires is announced when the map opens.** The startup
pulse used to ring the floor markings only - colored areas and delivery boxes -
which was right while a win was "clear the board" and became misleading the
moment a map could ask you to break something: on level 5 the slab the win
requires had no announcement while the bonus zone beside it pulsed, so the
board pointed at the optional thing and away from the mandatory one. The set is
derived from `resolveWinSpec` (see `lib/winHighlight.ts`), so it cannot promise
something the gate disagrees with, and required objects ring louder than plain
markings rather than in a second colour - a colour would be a language, and a
language needs more repetition than a 35-map run gives.

There are **two** effects, because they answer different questions. The opening
pulse says "here is what is on this board", once, for six seconds of active
play. The target marker says "this is the one you still have to deal with",
quietly, for as long as that stays true - the opening pulse alone was reported
as simply not noticed, which is what a one-shot flash gets while a player is
still taking the board in. The target set is recomputed every frame, so a
requirement drops out of it the moment it is met: a marker breathing over a
slab that is already rubble is worse than none, being an instruction to do
something already done.

A map that asks for something a lock cannot produce also gains a fail state:
locking every ball with that requirement unmet strands it, and the map ends as
a `lockedOut` failure costing a life. That is the tactical decision the win is
there to create - keep a ball alive to break with - so the top-bar chip turns
to a warning at one ball left, and the failure screen names what was missing.

## 7. Hard constraints the engine imposes

These are not style advice. A map that breaks one of them is rejected by a test,
or worse, ships and plays wrong. They are collected here because they were
previously spread across a dozen test files and comment blocks.

### 7.1 Geometry

| constraint | value | why |
|---|---|---|
| Board | 900 x 900 world units, playable inset to (45,45)-(855,855) | `boardConstants.ts` |
| Ball | radius 18, so **36 across**; the level-11 enlargement makes it **47** | `BASE_BALL_RADIUS` |
| Fence / wall thickness | 6 | `WALL_THICKNESS` |
| Space grid cell | 15 | `spaceGrid.ts` |
| **The gap rule** | a gap between two lined-up wall stubs must be **<= 12** (a seam) or **>= 60** (a neck). **Never between.** | `featureSchedule.test.ts` |
| Self-overlap | nothing a map authors may sit on top of anything else it authors | `mapHookPlacement.test.ts` |
| Launcher runway | **>= 225** units (25% of the board) clear ahead of a muzzle; breakables do not count as blocking | `MIN_LAUNCH_RUNWAY_FRACTION` |
| Reachability | **> 90%** of open cells must stay reachable with every ball loaded, across all deals | `launcherBarrel.test.ts` |
| Tunnelling ceiling | ~5520 units/s; past it an 18-unit ball crosses a 6-unit fence between physics steps | `bouncer.ts` |

**The gap rule is the one that catches people.** A 26-unit slot looks like a way
through in YAML and is not: wide enough to read as a passage, narrow enough that
the ball never takes it, so the space behind it is neither reachable nor
sealable. It also silently changes meaning when the big-ball gift rolls. Both
bugs it was written for (a 26-unit slot on the old level 9, a 40-unit alcove
mouth on the old level 3) were invisible by eye and failed no other test.

### 7.2 Variety, and why authored gaps are not runtime gaps

`applyRectVariation` scales every non-mirror rect's width and height by up to
**+/-variety%** about its centre. So each facing edge of a neck moves by
`variety% x its own extent / 2`, and a neck between two stubs can close by the
sum of both.

Two 300-tall stubs at variety 10 move 15 each: an **authored 60-unit neck
arrives anywhere in [30, 90]**, and half that range is the band section 7.1
forbids. The authored-coordinate guard cannot see any of it.

This is not hypothetical. When it was first measured, **seven shipping maps**
landed in the band at runtime while passing the authored check - level 27 on
nearly every deal, and level 34's typed pipe, documented in map.yml as a
"66-unit corridor only grey balls may enter", measuring 51-60 in practice.

**It cuts both ways, and the seam side is easier to miss.** Level 32's chest
sits 6 units from its vault wall - a seam by any reading - and at variety 14 the
chest's own 156-unit width jitters that edge by up to 11, so the seam lands
anywhere between overlapping and about 18. A seam authored close to the 12-unit
cap drifts over it exactly as a neck authored close to 60 drifts under.

Two ways to author safely, and act I took the second:

1. **Budget for it**, at both ends. A neck must be at least
   `60 + variety% x (extent_a + extent_b) / 2`; a seam at most
   `12 - variety% x (extent_a + extent_b) / 2`. On a wide entity that second
   number goes negative, which is the honest answer: at variety 14 a 156-unit
   chest cannot hold a legal seam at all.
2. **Set `variety: 0`** on any map whose geometry has to be exact. A teaching
   map's job is legibility, and a doorway whose width is a dice roll is the
   opposite of it.

`runtimeGapRule.test.ts` builds each map on 24 **named** deals and measures the
result. Its unmigrated list may only shrink.

The deals are named rather than rolled, and that is not incidental. Both inputs
here - the rotation and the variety draw - key off the run rng, which falls
through to `Math.random` unseeded, so an unseeded sweep measures a different
board every run. For any gap sitting near a threshold that makes the test a coin
toss: this file shipped unseeded and flaked on CI within a day, on exactly the
level-32 seam above. **Any test that asserts on built geometry has to pin the
deal.** It is the same lesson as 7.3 and it has now been learned twice.

### 7.3 Rotation, and why authored coordinates are not runtime coordinates

From **level 4** up, a map is dealt in one of four rotations
(`ROTATION_MIN_LEVEL`). Consequences:

- **Conventions 6.1 and 6.2 are purely spatial and survive rotation**, gaining
  free variety per deal.
- **Gravity-dependent Turns do not.** Down is always the board bottom and
  rotation does not turn gravity, so on a rotatable map either avoid
  gravity-cascade topples or build the Turn from non-gravity beats.
- **Any test that asserts a coordinate must pin the deal**, either by using a
  level number below 4 or by seeding the rotation rng. This has caused two
  separate ~1-in-4 CI flakes; see `corridorNoFalseLock.test.ts`.

### 7.4 The content gates

A mechanic debuting at level N needs its gate at or below N. **A gate below its
content is the worst case, because nothing throws.**

| gate | level | what it unlocks |
|---|---|---|
| `ROTATION_MIN_LEVEL` | 4 | map rotation |
| `pickups.start_level` | 8 | power-up tokens |
| `PROCEDURAL_MIN_LEVEL` | 11 | procedural slots |
| `TILT_MIN_LEVEL` | 21 | board tilt |

Ball roster, from `balls.yml`. A map's premise may not depend on a ball that
cannot appear on it:

| level | ball | ability |
|---|---|---|
| 1 | red | - |
| 2 | blue | - |
| 4 | yellow | variable speed |
| 7 | purple | slows others |
| 10 | grey | winds down |
| 11 | rainbow | rainbow |
| 12 | white | tappable |
| 13 | green | money ball |
| 18 | compass | turn timer |
| 21 | lodestone | attract |
| **25** | **black** | **breaks objects** |

The black ball is the reason "smash the mirror" and "fracture your own fence"
content cannot exist before level 25.

### 7.5 Lock economy numbers

| quantity | value |
|---|---|
| Lock threshold | region <= **10%** of the win denominator |
| Superior lock | pocket <= **40% of that**, i.e. ~4% |
| Superior multiplier | 2x |
| Denominator | `max(active cells, initial cells / active balls)`, swings ~2x over a map |
| Bumper bank | 5 hours, 1 per bump; charged brakes 5%, spent kicks 1.25x, capped at 2.2x the ball's own base speed |
| Deformable | 3% per contact, permanent dent capped at 7 units |

---

### 7.6 Two ways a sealed region bites

Both of these were caught by the bot audit while authoring act I, and neither
is visible in the YAML.

**A breakable that fully encloses a pocket hands it over for free.**
`captureUnreachableCells` writes off any region no ball can reach as
unreachable-hence-captured, so a vault sealed at load starts the map already
claimed. Worse, a ball driven in after the break lands in ground the player
already owns and locks itself with no fence at all. If a breakable is the only
way into a space, that space is not a prize, it is a gift with extra steps.

**A `reveals` area must be genuinely shut.** Its cells start REMOVED and belong
to no region, so a ball that can wander in has no region either - nineteen
"[OWNERSHIP] ball has no valid region" in one 24-seed sweep, against a baseline
of one or two. Seal it with board edges, a jamb and the breakable itself; a
12-unit seam is a wall to a ball and keeps the shape readable.

The two pull in opposite directions, and the difference is what happens to the
cells. A region that is merely unreachable gets captured. A `reveals` region is
explicitly locked and is handed over as new capturable board when it opens,
which is why it may - and must - be completely sealed.

---

## 8. Validation: make the bot play it

`src/lib/bot/runBot.ts` drives a bot through the **real** physics (the same
`updateBall`, `updateFenceWallFn` and `applyCutFn` the browser runs) and returns
`{ won, lost, cuts, locks, remainingPercent, frames, violations }`.

Every new map must be swept before it ships. The sweep answers questions that no
amount of staring at YAML will:

| signal | reading |
|---|---|
| `violations` non-empty | **Stop.** A hard invariant broke: a non-finite position, a ball outside the board, won and lost at once. Never a map-design problem, always an engine one. |
| won on 0 of N seeds | likely unwinnable, or a neck no ball ever takes. Check the gap rule and reachability first. |
| won on N of N seeds with `cuts` well under `expectedCuts` | too easy, or the topology is not the topology you think it is |
| `cuts` far over `expectedCuts` | the map is being brute-forced; the chambers are not readable |
| `locks` = 0 on a map with a greed hook | the hook is not reachable, or the pocket is mis-sized (see 6.2) |
| `remainingPercent` plateaus | a stall. Chase it, do not trust it: the bot's own caution has produced at least one false alarm. |

The bot is a *lead generator*, not a verdict. It cannot tell you a map is fun. It
can tell you a map is impossible, trivial, or shaped differently from how it
reads, and it does that across every deal in seconds.

### Test inventory, for the rebuild

55 test files read `map.yml`. They split in two, and the split matters when a map
is redesigned:

- **Structural guards** apply to every map and must keep passing:
  `featureSchedule`, `mechanicSpread`, `mapHookPlacement`, `mapPins`,
  `launcherBarrel`, `launcherMaps`, `mapBeats`, `winSpec`, `areasGatingWin`,
  `botSoak`, `mapTuning`.
- **Map-specific pins** assert one map's geometry and must be rewritten with the
  map they belong to: `codeFreezeMap`, `launcherRail`, `governorChain`,
  `portalPipe`, `oneWayDrain`, `strandedLock`, `level19Soak`, `loadBalancer`,
  `freezeStranding`.

When an act is redesigned, its map-specific pins are rewritten in the same
change, never deleted to make a failure go away. A pinned test is how a set-piece
stays a set-piece.

---

## 9. Anti-patterns

- **Obstacle confetti.** Blocks placed for texture, not to form necks or guard a
  hook. Every obstacle should shape a seal or a decision.
- **Two focal points.** The eye and the strategy need one centre of gravity.
- **Combination soup.** Four mechanics interacting, so no outcome can be
  attributed to a cause and nothing is learned. Three links, maximum.
- **The uninvited third mechanic.** A combination map that quietly needs a
  mechanic the player has not met. Check the ledger.
- **A family taught out of order.** A sibling before its family opener costs a
  full teaching instead of a third of one, and the player learns two grammars.
- **Unfair surprise.** An untelegraphed Turn that wrecks an in-progress fence.
- **No safe path past the hook.** Greed is only a decision if skipping is viable.
- **Maze with no drawing room.** Walls so dense a fence cannot be drawn.
- **Same gimmick every map.** Modifiers are seasoning. Monotony is monotony even
  when it is hard.
- **Reaching for a ball.** If the only difference from the previous map is ball
  count, the map has no premise. Go back to section 4.

---

## 10. Authoring checklist

A map is not done until:

- [ ] You can state its premise in **one sentence** ("this is the one where...").
      If you cannot, it has no identity yet.
- [ ] It reads as **chambers and necks**, not scattered blocks.
- [ ] It **authors a `win:`** that names its own content, with at least one
      clause a lock cannot produce (section 6.4). A derived spec means the map
      is still beatable by sealing everything or by never sealing anything.
- [ ] There is **exactly one greed hook** with a real cost AND a safe skip.
- [ ] There is **one telegraphed Turn**, so the end differs from the start.
- [ ] At least one pocket is **superior-lock-sized**, measured against the worst
      denominator, not eyeballed.
- [ ] Every gap is **<= 12 or >= 60**.
- [ ] Nothing it authors overlaps anything else it authors.
- [ ] There are open **drawing lanes** everywhere a cut is expected.
- [ ] `expectedCuts` and `sizeThreshold` match the intended seals and the spine.
- [ ] Its new mechanic (if any) is the **only** new thing, and its ledger row is
      updated.
- [ ] Any mechanic it combines has had its Meet **at least two maps earlier**.
- [ ] The **bot sweep** is clean and the numbers read the way section 8 expects.
- [ ] If it replaces a map with a pinned test, that test is **rewritten**, not
      deleted.

# The ball tree: building balls instead of a deck

The plan to replace the card system. Status: **planned, not built**. The
owner's brief, in three sentences from the sessions of 2026-11-21 and 22:

> Every game starts with an empty upgrade tree, then you buy things to upgrade
> your game. Every game and every map starts with one upgraded ball and one
> type of fence. Everything else you buy from the upgrade tree: an extra ball,
> new fences, general upgrades, individual ball upgrades.

> The main two tactics to build are one super ball, or several good, but not
> great, balls. That makes every upgrade a real change.

> No map balls: effectively you could play with only one ball throughout the
> whole game, and the map design has to keep that in mind. Balls always
> return. The idea is to build balls instead of a deck in each run.

The card system (CARDS_PLAN.md) never worked to satisfaction, and the reason
is in the first sentence of the premise below.

## 1. The premise

In this game the balls were the opponent. Every upgrade was therefore a
number applied to something the player did not own: balls slower, fences
faster, locks paying more. The sweep (UPGRADE_SWEEP_REPORT.md) measured
exactly that and found most of the catalogue inside the noise, and the five
verb cards of CARDS_PLAN.md phase 9 were the first upgrades with an owner,
the hand. This plan gives the rest an owner too: **the balls are yours.**

Three rules follow, and everything below is one of them applied:

1. **You own every ball on the board.** A map brings geometry, time, a fence
   budget, obstacles, movers, wells, breakables and goals. It brings no
   balls. What rolls onto the board is your roster, as you built it.
2. **Locking is harvesting.** A ball you bring is income you bring, because
   pay comes from locks. An extra ball is more pay and more risk at once,
   which is the first real decision in the tree.
3. **A ball upgrade is a rule the ball gains, never a percentage it accrues.**
   One super ball and three decent balls must both be able to win the run,
   so every rung on a ball has to be a sentence the player can see on the
   board.

Balls always return. A lost life is a lost life; next map, the roster is
whole, with everything bought for it. Losing a ball for the run is a
contract or a mode for later, not the base rule, because the one-super-ball
tactic has to be a tactic and not a coin flip.

## 2. The two tactics, and what keeps both honest

| | One super ball | A fleet of good balls |
|---|---|---|
| The build | few, expensive rungs on one ball | the second and third ball, cheap first rungs on each |
| How it earns | one lock a map: its lock multiplier, superior pockets, what it breaks on the way | several locks a map: simultaneous locks, the Mutex and Semaphore fences, the lock chain |
| Its risk | that ball through your fence is the life and the map's whole income at once | a life is lost more often, the run is never lost at once |
| The maps that lean its way | breakables, bosses, a single hard pocket | many pockets, a wide board, a lock goal of two or three |

The pricing bends toward the fork rather than away from it:

- **Stacking costs more on one ball.** The third rung on a ball is priced
  above its first. The super ball is a few expensive decisions.
- **Breadth costs more per ball.** A second ball is a flat price and comes
  with no traits. A third is dearer than the second. The fleet is many cheap
  decisions, and never the discount route to the super ball's traits.
- **The board pays each differently**, through systems that already exist:
  `lockMultiplier` and the superior pocket for the one ball;
  `simultaneousLockBonus`, the Semaphore and Mutex fences and the lock chain
  for the many.

Nothing in the tree may flatten the asymmetry of risk. A general upgrade
that makes any ball safer applies to all of them equally (shields, lives,
the Guardrail fence) and says nothing about which tactic you chose.

## 3. The roster

A run carries a roster of one to three balls (`ROSTER_MAX = 3`, a tree
decision rather than a constant to tune by hand). Each ball has a slot
number, a name the player can read ("Ball 1" by default, the type name once
it has a type), and its own list of rungs. The roster is saved with the run
and shown wherever the build was shown before: the between-map stage, the
pause panel, the result screen's recap.

**Spawn.** `initGame` today derives a map's balls from `maxBalls` and the
level's eligible types (balls.yml `unlockLevel`, `spawnChance`). Under the
tree it reads the roster instead: slot one spawns first, at the map's first
spawn point, and so on. A map's `maxBalls`, `ballTypeIds` and `balls:`
become dead under this rule set (section 7 says what happens to them).
Every ball spawns as the catalogue's `red` and then takes its rungs, so the
types in balls.yml become the vocabulary of rungs rather than a roll.

**Start of a run.** One ball with one trait of the player's choosing from the
root rungs (the Sprint Planning moment, kept as a choice of three), the
standard fence, three lives, no hours. The "one upgraded ball" of the brief
is that one trait.

**Start of a map.** The roster as it stands. Nothing resets between maps but
the per-map rations (freeze taps, traps, refactors), as today.

**On the board.** A ball wears its rungs. Weight makes it darker and larger
in stages. Frost gives it a rime. Lock value makes it glow gold. Speed
shows as its trail. A fleet of three must never look like three plain
balls, or the tree has no face. The 3D shell's `pattern` and the 2D ball
layer both read the rungs; the slot number is drawn as a small badge the
player can turn off in Options once they know their balls.

## 4. The tree

Four branches. A node is bought with hours between maps; a node may require
another. Per-ball nodes are bought ON a ball (the stage shows the roster and
the player picks which ball takes the rung). Almost every general node is a
`GameModifiers` key the engine already reads; the per-ball rungs are the one
new scope, applied at spawn to that slot.

### 4.1 Balls (per ball unless said otherwise)

The rungs are ladders of three, and each rung changes what the ball can do.
The numbers are the first guess, to be read by play, never by the sweep.

| Rung | 1 | 2 | 3 |
|---|---|---|---|
| **Weight** (`density`, the break force model that exists) | dents deformables, breaks a brick in one hit | shatters mirrors and shards; ignores an Ice fence | shoves a mover off its patrol for 2s on contact; pays triple when locked, because locking it is hard |
| **Worth** (`lockMultiplier`) | locks pay double | locks pay triple, and a superior lock pays five | the money ball: locking it triples every later lock this map |
| **Frost** | freezes 2s on every third bounce | freezes the ball it collides with, 2s | an Ice fence is a wall to it: it freezes on touching one, 4s |
| **Pace** | 20% slower | holds a steady speed: no yellow, no flare, no bumper changes it | starts every map frozen for 5s, then runs at 70% for 10s more |
| **Sight** | its next bounce is drawn | its next three are drawn (Scrum Master, on one ball) | it glows where it will be in two seconds |
| **Grace** | passes through a fence in its first quarter second of growth (Ghost Protocol, on one ball, where it can be seen) | costs no life the first time it cuts your fence each map | the Guardrail rule: a fence it cuts is lost, never the life |

Roster nodes, not per ball:

- **Second ball**, then **Third ball**: a new slot with no rungs. The third
  costs more than the second.
- **Rename**: free, cosmetic, and worth having, because a ball with a name is
  a ball the player tells stories about.

A rung's price rises with how many rungs that ball already has, by
`stackFactor` (first guess 1.35 a rung). The weight ladder is deliberately
the super ball's spine and the worth ladder the fleet's, but nothing stops
a fleet of three weight-ones, which is a build worth having.

### 4.2 Fences

- The seven fence types as unlock nodes, each a slot in the bar
  (FENCE_TYPES_PLAN.md): Ice, Flare, Tripwire, Guardrail, Redeploy, Mutex,
  Semaphore. A fence node requires the standard fence's second rung so the
  first two maps teach drawing before they teach choosing.
- Build speed in three rungs (`fenceGenerationSpeedMultiplier`), each a step
  the player can see: 1.35, 1.6, 2.0.
- One more fence at a time (`additionalConcurrentFences`), twice.
- The fence payoffs as rungs on their fence: Afterburner on Flare, Crash
  Barrier on Guardrail, Tensioned Wire on Tripwire, Hot Reload on Redeploy.

### 4.3 Hands

What the finger can do, from CARDS_PLAN.md phase 9 and the freeze: freeze
taps (two rungs), Breakpoint, Stash, Refactor, Rate Limiter, and the
abilities (Freeze All, Slow All, Magnet, Shockwave, Rubber Band, Descope,
Clear Fences) as nodes that grant a retainer. Control Freak and its derail
and band. Each is a node with at most one rung after it (two traps, two
refactors).

### 4.4 Office

Lives (two rungs), shields a map (two rungs), pay (`scoreMultiplier` in two
rungs of 1.25), interest on the bank, the push-your-luck and Ship Early
multipliers, the overtime cap. These are the only percentage nodes in the
tree, and they are about hours, which are a number already.

### 4.5 What is deliberately not in it

- Nothing that slows, shrinks or steadies **all** balls. Those were the cards
  the player could not feel (CARDS_PLAN.md phase 10), and under this plan
  they would be upgrades to the opponent that no longer exists.
- No node whose only effect is on a map feature the run may never see,
  unless it is a rung on a thing the player already owns (weight two on
  mirrors is fine; a "mirror card" is not).
- No ladders deeper than three. The tree is wide and shallow so that a run
  of ten maps reads as ten decisions, not one decision made ten times.

## 5. The between-map stage

The pipeline (UI_REDO_PLAN.md) keeps its stages: Debrief, then the tree,
then the next map. The tree stage replaces both the store and the pick:

- **The roster first**: the balls as they stand, each with its rungs drawn
  on it, tappable to see its list. This is the screen's face.
- **The tree below**, by branch, with what is affordable lit. A per-ball node
  asks which ball on tap when the roster has more than one.
- **The next map's line** stays (the draft's `nextMapInfo`): a breakable map
  says so before you buy weight.
- No shelf, no roll, no reroll. The tree is the whole catalogue, always
  visible. What the player cannot afford they can still read, which is the
  planning the store never allowed.

Hours are earned as today. A map's pay is unchanged except that it now
scales with the locks made, which it already did through the lock bonus.

## 6. Bosses

The one exception the brief leaves: a boss is a ball the map brings, and
under rule 1 there are none. Three options, in the order I would try them:

1. **The boss is the board.** The boss maps become objective maps whose
   antagonist is terrain: the chain, the phases, the fence wipe and the
   break-out are already map beats (physics/bossPhases.ts, mapBeats.ts), and
   they can act on YOUR balls rather than from a ball of their own. The win
   is to lock your own ball in the gate, which LevelConfig.boss already
   expresses as a mandatory objective.
2. **The boss is the one map ball**, marked as such, and the rule is "you own
   every ball but the boss". Cheapest, and the first ten maps could ship on
   it while option 1 is built.
3. **The boss is one of yours, possessed**: on a boss map your slot-one ball
   is taken over for the map and has to be won back. Thematically the best
   fit for "build balls"; the most work.

**Decided (2026-11-22): option 1, the boss is the board**, from the first
boss written on the new ladder. The brick ladder has no bosses yet, so there
is nothing to convert; a boss map is an objective map whose antagonist is
terrain and beats acting on the player's balls.

## 7. The map ladder under one ball

The hardest part of the brief: **a map must be playable, and fair, with one
ball, from map 1 to map 45**, because a player may never buy a second.

What changes in MAP_DESIGN_GUIDELINES.md:

- `maxBalls`, `ballTypeIds` and `balls:` stop meaning what they mean. A map
  may keep `maxBalls` as a **cap** (the roster is trimmed to it: a map that
  wants one ball gets one, and the player picks which) but never as a floor.
  The ledger's "balls" column becomes the cap and the lock goal.
- Difficulty comes from the board: time, the fence budget, the capture
  target, movers, breakables, wells, the lock goal. A map that was hard
  because it had six balls has to be hard because of what it is.
- **Lock goals carry the ladder.** A map may require N locks to ship, and
  with one ball N is one, so the lock has to be hard: a small pocket, a
  moving one, a gated one. With three balls the same map can ask for three,
  which is the lean toward the fleet.
- **Every ball type the maps taught becomes a rung the player may own**, so
  the teaching unit (Meet, Use, Fight, Break) now teaches the player's own
  tools: map 8 taught the black ball; under the tree it is the map where
  weight pays, with a brick wall between you and the pocket.
- The pocket probe and the slack rule still hold, read for one ball.

The retune is by act: maps 1 to 10 first, played with one ball and with
three before anything else is touched; then the rest.

## 8. What happens to the card system

- **Decided (2026-11-22): the tree replaces the cards outright on the new
  ladder from phase 1.** The draft, the classic store and Sprint Planning as
  a separate draft stay only as long as the archive maps do, and go with
  them. The verb cards and the fence payoffs carry over as nodes, so nothing
  from the card work is lost but the shelf. Contracts come back later as
  elite maps under the tree if they earn it; they are the natural home for
  "lose a ball for the run".
- Certificates stay: they are the meta layer across runs, and a certificate
  that starts a run with a rung already bought is exactly what they were for.
- The Daily and a pair run play the tree, as they played the draft, and for
  the same reason: one seed, one roster, both phones.
- The sweep (`upgradeSweep.test.ts`) learns to play a roster. It can measure
  weight, worth, pace and the fences; it cannot measure sight, grace or the
  hands, and it should say so as it does today.

## 9. Admin

In the same commit as each piece, as CLAUDE.md requires:

- a **Roster editor** in the Playground: the slots, each with its rungs, so a
  tester can walk onto any map with any build;
- every per-ball rung forceable there, and every general node as the
  modifier knob it already is;
- the tree stage in the gallery with a sample roster;
- `adminCoverage.test.ts` extended for the new class of thing, the per-ball
  rung.

## 10. Phases

| Phase | What | Done when |
|---|---|---|
| 1 | The roster: type, save, spawn from it under `ruleSet: "tree"`, slot badge and the rung marks on the ball; the Playground roster editor | **built** (2026-11-22): `lib/roster.ts`, the `tree` rule set (Admin > Store rules), the roster on the run save, `initGame` spawning it with `maxBalls` as the cap, the fx layer's badge and ticks, Playground > Roster. No store stage yet: the next map follows the debrief. |
| 2 | The per-ball rungs: weight, worth, frost, pace, sight, grace, each a rule in physics with a test; second and third ball | the super ball and the fleet both exist on the board |
| 3 | The tree data (`public/tree.yml`): nodes, prices, requirements, the stack factor; the general branches mapped onto existing modifiers | the tree validates and every node reaches the engine |
| 4 | The tree stage on the canvas: roster first, branches below, the next map's line; the run-start choice of one trait | a run can be played start to finish buying from the tree |
| 5 | Maps 1 to 10 retuned for one ball and for three; bosses on option 2; the lock goals | the bot and a person clear act I with one ball and with three |
| 6 | The sweep plays rosters; prices and the stack factor read from it and from play | the two tactics win about as often, by different routes |
| 7 | Maps 11 to 45, act by act; bosses toward option 1 | the ladder is one-ball fair throughout |
| 8 | The draft, the classic store and Sprint Planning as a draft removed; contracts returned as elite maps if wanted; CLAUDE.md and the plans updated | one store, one rule set |

Phases 1 to 4 are the system and can be built without touching a map; the
rule set switch keeps the draft playable meanwhile. Phase 5 is the first
moment it can be judged, and nothing after it should start before it has
been played.

## 11. Decisions taken, and what is still open

Decided 2026-11-22, all on the recommendation:

- **Both pay.** Bricks and locks both earn hours, by the map's goal, so the
  super ball farms brick maps and the fleet farms lock maps, and most maps
  pay for both.
- **Tools are nodes** in the Hands branch. The ladder places a map where a
  tool is worth buying, never one that requires it; a run must be winnable
  with one ball and the standard fence.
- **The ball cap rule is in MAP_DESIGN_CARD.md and BRICKS_PLAN.md**, so the
  maps being written now are written to it.
- **The boss is the board** (section 6).
- **The tree replaces the cards outright** on the new ladder (section 8).
- The roster cap is three. The run starts with a choice of one trait from
  three, and weight one is always among the three because the ladder is
  bricks. A map's `maxBalls` is a cap and never a floor. A certificate may
  start a run with a rung already bought.

Still open:
- The names: "rung", "trait", "roster" are the plan's words; the game's
  words come with the tree stage's copy.
- Whether a boss should ever be one of your balls (option 3 in section 6),
  as a late map's twist.

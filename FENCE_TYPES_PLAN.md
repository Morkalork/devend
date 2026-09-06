# FENCE_TYPES_PLAN.md

The plan for **fence types**: a row of five slots beneath the board that decides
what kind of fence the next cut draws.

Status: **BUILT**, all seven steps. The plan below is kept as written, with the
places the build departed from it marked **[CHANGED]** and the reason given -
a plan quietly edited to match what happened is a plan that never taught
anybody anything.

Three departures, all in step 7:

1. **"The store" and "the upgrade chains" turned out to be one channel.** The
   upgrade shop IS the store in this game, so four types are ordinary chain
   entries in `upgrades.yml` and a parallel shelf mechanism would have been a
   second way to buy the same thing. The certificate store is genuinely
   separate, because what it sells outlives the run.
2. **No swap screen, and no inventory.** Owning a type IS holding a slot. Five
   acquirable types against four slots means a swap would matter exactly once
   per run and only for a player who bought all five, so a purchase goes
   straight into a slot and the shop stops offering once the four are full.
   That makes the purchase a decision; it costs the player the ability to
   change their mind, which is the trade.
3. **Ice and rebar moved from "store" to upgrade chains** for reason 1, so all
   four run-scoped types hang off lines the player already knows.
4. **Rebar was replaced by `redeploy` before either shipped to players.**
   Durability was the weakest entry in the table: `maxHits` is a number the
   player cannot see, on a fence they are already trying not to have hit, so a
   rebar fence that survived a ball felt like nothing happening. Redeploy is
   the same slot spent on a VERB instead - the one type whose effect the player
   performs rather than waits for. It is also the only one whose price is paid
   twice: 40% slower to build, and a ball left travelling at up to three times
   its speed for the rest of the map, which nothing in the engine damps.

---

## 1. Why this is the right shape for this game

Every mechanic on the ladder so far acts on the **balls** (movers, wells,
bumpers, gates) or on the **space** (breakables, reveals, areas, fence ground).
Exactly one touches the cut itself: `fenceZones`, and its own header says why
that matters -

> "Every other map mechanic acts on the balls or blocks the space. None of them
> touches the cut itself - and the cut is what the game is actually about."

Fence types are that observation turned into a system the player controls
instead of one the map imposes. The map already decides *where* cutting is
expensive; this decides *what kind* of cut you spend there. That is a genuinely
new axis, and it is the axis the game was always about.

It also fixes a standing complaint the ladder cannot currently answer: the
player has no way to change how a map plays, only where they cut. Upgrades
change numbers; abilities are panic buttons on a timer. Nothing changes the
*verb*.

---

## 2. The four decisions, and what was chosen

| decision | chosen | rejected, and why |
|---|---|---|
| **Cost model** | Unlimited once owned, but a special fence **builds slower**, and each type carries its own downside. | Per-map charges turn the bar into a meter to hoard rather than a choice to make. Overtime-per-cut competes with the store for the same hours and makes every cut a purchase. Unlimited with no drawback makes ice dominate every map. |
| **Ice / fire** | A **step per bounce**, debounced, clamped to the existing `minimumSpeed` floor and a ceiling. | A timed effect stops the fence mattering once the ball leaves, so *where* you build it stops mattering. Region-bounded is the most interesting and the most expensive, and the hardest to show on screen. Permanent-on-contact compounds and cannot be undone. |
| **Roster scope** | **Run-scoped**, acquired and swapped in the store. The certificate-bought type is the exception: account-scoped, so it is in the roster at run start. | Account-scoped-and-picked-at-run-start front-loads the decision and kills mid-run adaptation. Freely swappable removes the cost of carrying the wrong four. |
| **The drill** | Anchors on a breakable, damages it over time, and **resumes growing** through the freed space when it dies. | Stopping at the gap loses the chain reaction that makes it worth building. Damage-only makes it a tool rather than a fence. |

**The cost model is the load-bearing one.** "Builds slower" is what keeps the
slot bar tactical: the whole tension of a fence is the race between it finishing
and something hitting it, so a slower fence is a real risk taken on purpose,
every single cut, and it needs no counter on screen to be felt.

---

## 3. What already exists, and is reused rather than rebuilt

This feature is unusually cheap because the codebase has been building toward it
without meaning to.

| need | what already does it |
|---|---|
| A row of buttons under the board, long-press for an explainer | `AbilityBar.tsx`, in the fixed bottom wrapper, `MAX_ABILITY_SLOTS = 5` |
| A config-driven catalogue with `startLevel`, weights, colours, `description`/`howTo` | `abilities.yml` + `abilities.ts` |
| Per-wall variation carried on the wall itself | `Wall` already has `isMirror`, `passRule`, `bouncer`, `blackHits`, `maxHits`/`hitsLeft` |
| A cut that builds at a non-standard speed | `fenceZones.ts` (`cutSpeedFactor`), already folded into `updateFenceWall` |
| "One contact changes a ball's speed once" | `updateBall.ts:861`, the yellow ball's `speedRange` + `lastSpeedStepAt` 90ms debounce |
| Damaging a breakable from something other than a ball | `registerObjectHit(game, d, ballId, now, amount, impact)` |
| Fences that take damage and shatter | `blackHits`, `FENCE_FRACTURE_HITS`, `breakFenceWall.ts` |
| Three separate acquisition channels | the store's ability slot (`abilityOffer.ts`), `upgrades.yml` levels, `certificates.yml` |
| Refusing to anchor a cut on a breakable | `cutAnchorsBreakable` + the `breakableAnchor` game message |

That last row is the happy accident: **the drill is the exception that makes the
existing refusal meaningful.** Today "you cannot start a cut on a breakable" is
an arbitrary-feeling rule. Once one fence type can, the rule becomes "only the
drill bites into slabs", which teaches the drill for free.

---

## 4. The catalogue

`public/fences.yml`, matching the shape of `abilities.yml`. Ships with six so
the roster of four is a real choice from the moment the second is owned.

| id | look | what it does | drawback | source |
|---|---|---|---|---|
| `standard` | the current green | the fence as it is today | none | always in slot 1, cannot be unequipped |
| `ice` | blue, frosted | a ball bouncing off it loses a speed step | builds 30% slower | upgrade chain (Feature Freeze) **[CHANGED]** |
| `flare` | red, hot | a ball bouncing off it gains a speed step | builds 30% slower, and a faster ball is more dangerous to *you* | upgrade chain (Breaking Change) |
| `drill` | black, pulsing | may anchor on a breakable; damages it while touching; resumes growing when it dies | builds 50% slower, and the resumed growth is unprotected | certificate store (account-scoped) |
| `breakpoint` | violet | once a map, the first ball to bounce off a finished one is held still for 2s | builds 15% slower, and the hold is one per MAP however many you draw | upgrade root, the open shelf **[CHANGED]** |
| `redeploy` | rubber pink | a FINISHED one can be grabbed once, pulled back like a rubber band, aimed and released, and it flings the balls in front of it at up to 3x | builds 40% slower, and the ball it throws stays fast for the rest of the map | upgrade chain (Free Fall) **[CHANGED]** |
| `tripwire` | thin yellow | builds 40% FASTER | fractures on the first hit | upgrade chain (Fast Compile) |

`tripwire` is deliberately the inverse of the others: it proves the axis runs
both ways, and it gives the WIP-limit maps (17, 18, 32) something to think about
that is not simply "be better".

**Fence types never change what a fence IS.** They seal, they capture, they
count toward the fence budget, they lock balls. A type that changed that would
not be a fence type, it would be a different mechanic wearing the name.

---

## 5. Build order

Seven steps. Each is shippable on its own and leaves the game working, which is
the point: this is a big feature and it must never be half-landed on `dev`.

### Step 1 - The type exists and does nothing

- `public/fences.yml` with `standard` and `ice`, plus `src/lib/fences.ts`
  (`getFenceType`, `getAllFenceTypes`, `FENCE_TYPE_IDS` from an exhaustive
  Record so a missing entry is a compile error).
- `fenceTypeId` on `GrowingWall` and on `Wall`, set in `cutStart` and copied in
  `applyCut`'s `addSegmentWalls`.
- `game.selectedFenceTypeId`, defaulting to `standard`.
- Renderer: the wall's colour comes from its type.

Nothing plays differently yet. **The test is that a fence remembers its type
through growth, completion, segment splitting and a save/reload.**

### Step 2 - The slot bar

- `FenceSlotBar.tsx` beside `AbilityBar` in the same fixed bottom wrapper.
  Five slots; slot 1 is always `standard` and is not swappable; tap to select;
  long-press for the explainer modal (the house gesture, per CLAUDE.md).
- The selected slot is ringed, the way `armedAbilityId` already rings a button.

**The test is that the bar never moves the board** - the bottom wrapper already
reserves height for exactly this reason, and a second bar is the thing most
likely to break it.

### Step 3 - Ice, and the speed step

- `fenceSpeedStep(ball, wall, now)` in a new `src/lib/physics/fenceTouch.ts`,
  called from `updateBall` where `surfaceHit` is already known. Needs the wall
  that was hit, which the three `surfaceHit = true` sites have in scope.
- Reuses the yellow ball's shape exactly: a 90ms debounce, clamped below by
  `ball.minimumSpeed` and above by a new ceiling.

**The test is the floor and the ceiling**, and that a ball resting against ice
does not ratchet to a stop - the debounce is the whole safety.

### Step 4 - Build speed, and the drawback that makes it fair

- `cutSpeedFactor` gains the fence type's multiplier, folded in beside the zone
  factor, the ability factor and the upgrade factor.
- The Acceptance Criteria modal is untouched: this is a player property, not a
  map property, and the criteria screen describes the map.

**The test is that the factors MULTIPLY** and that a slow fence on slow ground
is slower than either - a bug here would be invisible and would quietly make the
whole system free.

### Step 5 - Flare, rebar, tripwire

Cheap once step 3 and 4 exist: flare is ice with the sign flipped, rebar sets
`maxHits`, tripwire sets it to 1 and takes a speed factor above 1.

### Step 8 - Redeploy replaces rebar  **[CHANGED]**

`slingFence.ts`, and it borrows rather than invents. The Rubber Band ability is
already a band the player stretches, aims and releases; this is that band with
the placement taken away, because the band is a fence you drew earlier. So it
takes the ability's dead zone, full-pull length, power curve and sweep, and
supplies only the two things that are its own: the SPAN (the fence's own length,
which is why `BandShape.halfWidth` moved onto the shape) and the ANCHOR (the
sweep is measured from the fence's resting line, not from the finger).

- **The gesture** lives in `useGameInput`, ahead of the cut path. A press on a
  fence is already refused as "wall in the way", so the grab replaces a refusal
  rather than competing with a cut.
- **Once per CUT**, not per segment: `Wall.cutId` is stamped by `applyCut` so a
  cut that bounced is one fence with one throw.
- **A throw that catches nothing spends nothing**, and the rings drawn during
  the drag are what makes that a change of mind rather than a miss.
- **No destructible damage**, deliberately. The ability does that, and an
  unlimited fence type that also did would make a charged ability pointless and
  hand every smash map a free second answer.

### Step 6 - The drill

The only genuinely new physics, and it gets its own step for that reason.

- Anchoring: `cutAnchorsBreakable` becomes "refuse unless the selected type
  `canAnchorOnBreakable`". The `breakableAnchor` message gains a second form
  that names the drill once the player owns one.
- Damage: a per-frame tick calls `registerObjectHit` with a small `amount`
  for each breakable a drill fence is touching. The debounce is already there
  (`HIT_DEBOUNCE_MS`).
- **Resumed growth**: when a breakable the drill touches is destroyed, the
  drill's completed segment goes back to growing from its blocked end, along
  its original direction, until it meets the next solid thing. This is the
  hard part. It needs:
  - a `blockedBy` back-reference from the wall to the destructible;
  - a re-entry into `updateFenceWall` for a wall that had already completed;
  - and it must respect **`smashReach`**: the drill can bury a slab it just
    freed access to, and the rule shipped for that has to see the resumed
    growth as an ordinary cut.

**The test is the chain**: two slabs in a line, one drill, and both fall.

### Step 7 - Acquisition  **[CHANGED]**

- **Upgrades**: `breakpoint` on the open shelf, and `ice`, `redeploy`, `flare`
  and `tripwire` as the crown of a MAXED family. See Step 9. A fence type is a change of VERB and worth walking to;
  a root would put it on the shelf of a player who has shown no interest in
  the line it belongs to.
- **Certificates**: `drill`, account-scoped, one level. It earns the only
  account-scoped slot because it is the only type that changes what a cut can
  be AIMED at, and because a mechanic you meet once per run and then lose is a
  mechanic nobody learns.
- **No separate store card and no swap UI**, for the reasons at the top.

Deliberately LAST. Every step before it is playable with types granted by a dev
flag, and wiring three economies into an unfinished mechanic is how a feature
ends up half-landed.

---

## 6. The things most likely to go wrong

Written down now, because each of these is a bug that would be silent.

1. **A fence type that changes the lock rules.** It must not. `checkBallWonState`
   already refuses a lock for a portal and for a needed slab; a fence type
   must never become a third reason, or "why did this not lock" stops having an
   answer a player can hold in their head.
2. **The drill burying what it just freed.** It opens ground and then keeps
   growing through it, which is exactly the shape `smashReach` guards. The
   resumed growth has to run the same capture and the same checks.
3. **Ice ratcheting a ball to a standstill.** The floor is `minimumSpeed` and the
   debounce is 90ms; a ball wedged in an ice corner must not tick down every
   frame. This is the one that would make the game unplayable rather than
   merely wrong.
4. **Speed factors adding instead of multiplying.** Silent, and it would make
   every drawback free.
5. **The second bottom bar moving the board.** The wrapper reserves height for
   this reason; a bar that appears when the first type is bought would shift the
   board mid-run.
6. **The bot.** `runBot` draws standard fences and always will. Every sweep
   after this ships measures a player who never uses the feature - which is
   fine, and has to be written into MAP_DESIGN_GUIDELINES beside the note about
   the bot spending 2-4x par, or the next person will read a sweep as evidence
   about a system it never touched.

---

## 7. What this does NOT include

Stated so the scope is arguable rather than assumed:

- **No map authoring against fence types.** No map requires a type, forbids one,
  or asks "clear this with ice". That is a good second feature and a bad first
  one: it would make the ladder depend on a roster the player might not have.
- **No fence type in the win spec.** Same reason.
- **No per-type scoring axis.** The Performance Review has six axes and does not
  need a seventh to say "you used the exotic fence".


---

## Step 9 - Where they come from, take two  **[CHANGED]**

The first cut hung all four off the JUNIOR of a line: two purchases from a
standing start. That is not a commitment, so it could not reward one, and it
sat the fence BESIDE a chain rather than at the end of it.

**Three shelves, for the three things a player can be doing.**

| Shelf | Types | How |
|---|---|---|
| Open | `breakpoint` | A root: no prerequisites, Junior, level 4. Eligible in any shop for any build, never guaranteed. |
| Crown of a maxed family | `ice`, `tripwire`, `flare`, `redeploy` | `unlockAfterChoice`, on the family's top tier, whichever of its two options was taken. |
| Account | `drill` | Certificate, unchanged. |

**Why the open shelf exists.** With everything gated, a player who spreads
their buys finishes a run with a bar of empty slots and no idea what fills
them. They never meet the mechanic at all. One accessible fence is the
introduction; the rest are the reward.

**Why it needed a new field.** Every multi-tier family ends in a `choiceGroup`
of two mutually exclusive options and `prerequisites` is AND, so "maxed,
whichever branch" had no way to be written: naming both makes an upgrade that
can never be bought (the graph validator says so), and naming one makes a
reward a coin flip deletes. `unlockAfterChoice` is eligible once ANY member is
owned. See `lib/upgradeUnlock.ts`.

**The family is chosen for what it does** - except where that would fight what
the player already expects, and then expectation wins:

| Fence | Family maxed | Because |
|---|---|---|
| Tripwire | Runway (L11) | the line about fences finishing sooner |
| Ice | Feature Freeze (L14) | where a player looks for the cold thing |
| Flare | Technical Debt (L14) | "more overtime, faster balls" is flare's deal word for word |
| Redeploy | Severance Package (L18) | paid per lock, crowned by the tool that manufactures one |

Ice is the deliberate override. On the mechanics Load Balancer is the better
fit - ice takes a speed step per bounce and that is the line that slows balls,
while Feature Freeze stops them dead - but an ice fence that is not on the
freeze line reads as a mistake before anyone gets far enough to notice it is
not. A rule about what a mechanic IS loses to a rule about where a player will
go looking for it.

Top tiers across the catalogue land anywhere from L5 to L32; these are picked
from the L11-L18 band so there is half a run left to play with the fence.

**Two things ride along for free.** Maxing a family is three or four upgrades
of one tag, which is the tag-set threshold - so the set bonus and the fence
land in the same purchase. And each fence carries its family's tag, so the
shop's existing weighting (1 + owned upgrades sharing a tag) rolls it at four
or five times baseline for the player who earned it and leaves it rare for
everyone else. That is the whole of "a chance to show up, not a given".

**The visible cost:** most runs will fill two of the four slots. Three empties
is the normal sight, and it is what makes the fourth mean something.

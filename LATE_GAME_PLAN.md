# Late game: continued innovation from map 30 (plan and build record)

Asked for as "From map 30 and forward, what are the five most important fixes
we have to make in order to give it a feeling of continued innovation for the
player?", then "Go with all of them". The five, and what each became:

| # | Problem | Fix |
|---|---|---|
| 1 | No new mechanic after 33 | Two Meets, one per late act: the **Autoscaler** ball (36) and the **Feature Flag** ball (41) |
| 2 | 30, 35 and 45 are one fight (pair + wipe) | 35 becomes the **budget** boss, 40 the **autoscaling** leak, 45 the only pair-and-wipe |
| 3 | The player's toolkit stops growing at 32 | The two balls above, two late mutators (**Traffic Spike** from 31, **Slow Build** from 36), and a late shelf of upgrades (36 and 41) |
| 4 | Three pure recap maps in fifteen | Each skill check carries the act's new thing: 34 pins Traffic Spike, 39 uses the Autoscaler, 44 the Feature Flag |
| 5 | Late acts look and pace like the early ones | Three new arena palettes (31-35, 36-40, 41-45, no more wrap to map 1's colours) and authored tempo: a short map and a long one in each act |

Nothing here is a board object. Both new mechanics are ball types, because a
ball type is a behaviour on something the player already reads (a ball), costs
a handful of files rather than a dozen, and comes with the tutorial page, the
admin pickers and the spawn roll for free (balls.yml is the catalogue).

## 1. The two new mechanics

### Autoscaler (act V, "Scale"; Meet 36, Use 39, the boss on 40)

**Its size follows its room.** On the open board it is huge; every cut that
shrinks the region it is in shrinks it too, down to an ordinary ball. So the
first cuts are the dangerous ones (a huge ball touches a growing fence from
far away), and the map gets easier exactly as fast as you make it smaller. It
is the act's subject in one ball: what you are fighting scales with what you
have left.

- `ability: autoscale` in balls.yml, `autoscaleMax` (radius multiple on the
  open board, default 2.2).
- Radius = base x lerp(1, max, share), where share is its region's fraction of
  the board's starting space. Read after every cut (the region is already
  known then) and eased over half a second, so it visibly deflates.
- It only grows when its room does (a fence breaking, a boss's reverted fence,
  a reveal opening), and it grows by the same ease, so there is no jump into a wall.

### Feature Flag (act VI, "Release"; Meet 41, Use 44, on the minions of 45)

**It blinks on and off.** Four seconds on, three off. While it is off it is
drawn as an outline and it passes through your GROWING fences without breaking
them; finished walls still stop it. While it is on it is an ordinary ball. So it
is the one ball you cut across on purpose, timed to its off window, and the one
you never start a fence beside just before it switches on.

- `ability: featureFlag` in balls.yml, `flagOnSeconds`, `flagOffSeconds`.
- Off: the growing-fence strike ignores it. On: everything as normal. A
  fence that FINISHES with it on the line is a strike either way, and it locks
  whenever it is sealed, on or off.

## 2. Bosses

| Boss | Before | After |
|---|---|---|
| 30 | one ball + wipe | two loose balls (slow, fast) + wipe (built 2026-10-31) |
| 35 | chained pair + wipe | **one build, three traps, inside a fence budget** (act IV's subject). No wipe: every fence you lay stays, and there are not many |
| 40 | three traps + minions | the same, **as an Autoscaler**: it is huge until you cut its room down, and each leak it spits makes it no smaller |
| 45 | chained pair + wipe + minions | the same; its minions are drawn from every ball unlocked by then, so Feature Flags among them |

## 3. Unlocks

- Ball types: Autoscaler (36), Feature Flag (41).
- Mutators: **Traffic Spike** (`spike`, rolled from 31): every 15 seconds the
  board surges to 1.5x speed for 3 seconds, with a warning second first.
  **Slow Build** (`lag`, rolled from 36): fences grow at 0.8x. Both pay the
  standard 1h of hazard pay.
- Upgrades: a late shelf at 36 and 41, one per archetype that has none past 30.

## 4. Skill checks

34 pins Traffic Spike, 39 uses the Autoscaler, 44 the Feature Flag: each still
recaps its act, and each has one thing the player has not had to do before.

## 5. Look and pace

- colors.yml gets three more five-level palettes, so the cycle is 45 long.
- Clocks: each late act gets one short map and one long one, instead of 45s
  everywhere.

## Build record

**First batch (one commit).**
- Both balls: `physics/autoscale.ts`, `physics/featureFlag.ts`, catalogue entries,
  ability marks, names in all four locales. Autoscaler on 36 (Meet, replacing
  the white ball) and 39; Feature Flag on 41 (Meet, replacing the yellow) and 44.
  The Autoscaler is never spat by a rainbow or a boss.
- Both mutators (`spike`, `lag` behaviours in mapMutators.ts); Traffic Spike
  pinned on 34.
- Boss 35 rebuilt as "Burn Rate"; boss 40 an Autoscaler (`bossBall.autoscale`).
- Palettes: three more in colors.yml (and the hook's defaults).
- Clocks: 32 60s, 33 35s, 37 35s, 39 65s, 42 35s, 44 70s.

Bot sweeps, 16 seeds, wins before -> after:

| Map | Before | After | Note |
|---|---|---|---|
| 32 | 6 | 6 | 60s clock |
| 33 | 9 | 5 | 35s clock: the bot is slow on portal maps |
| 34 | 7 | 7 | Traffic Spike pinned |
| 35 | 2 | 2 | budget boss; the box had to grow to 400 |
| 36 | 7 | 7 | Autoscaler |
| 37 | 1 | 1 | 35s clock |
| 39 | 8 | 3 | Autoscaler; 65s clock |
| 40 | 1 | 2 | autoscaling boss |
| 41 | 16 | 16 | Feature Flag |
| 42 | 5 | 5 | 35s clock |
| 44 | 7 | 4 | Feature Flag; 70s clock |

The bot is a floor, not the map's difficulty (MAP_DESIGN_GUIDELINES.md section 8).

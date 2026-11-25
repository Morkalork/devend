# Bot players

Six bot players, each a different way to spend a run under the ball tree, so
every new map can be played by all of them and a map that only suits one
strategy shows up before a person finds it.

- `src/lib/bot/archetypes.ts`: the players (what each buys, its first trait,
  the fence it draws).
- `src/lib/bot/runCampaign.ts`: a whole run, played as the browser plays it.
- `src/test/botArchetypes.test.ts`: always on. Pins each player's choices
  against `public/tree.yml` and plays each through the ladder once.
- `src/test/archetypeSweep.test.ts`: opt-in. Plays every player over many
  seeds and writes a comparison report.

## The players

All six play the board with the same hands (`policy.ts`: where to cut, when to
freeze). What differs is the build.

| Player | Id | Plan |
|---|---|---|
| Fleet | `fleet` | Buys every ball as soon as it can, then spreads rungs evenly across the fleet (weight first, then worth). Saves up for the next ball. |
| Super Ball | `superball` | Never buys a second ball. Every hour goes into ball 1: weight, worth and grace to rank three, then the rest. Saves up for the next rung. |
| Fence Engineer | `fencer` | The fences branch: build speed, fences at once, head starts, then the Guardrail and Tripwire, drawn with once owned. |
| Overtime Earner | `earner` | Pay first: Performance Bonus and its +, Compound Interest, Expense Account. Then a moderate mix: a second ball, low rungs of worth and weight, a fence node, a freeze. |
| Safe Hands | `guardian` | Survival: Feature Freeze, shields, extra lives, grace on every ball, the Guardrail fence. Starts with grace. |
| Casual | `casual` | No plan: buys something affordable at random every visit. The baseline the other five are read against. |

A player names only the nodes it wants; the path to a locked node is bought on
the way (Safe Hands buys Performance Bonus because Defensive Programming hangs
off it). Adding a player is one entry in `ARCHETYPES`: a score for each offer,
a trait order, a fence order, and whether it saves up.

## What a run is

`runCampaign` plays a run the way the browser does:

1. The run-start offer of three traits (weight always among them), from the run seed.
2. Each map in order, with the roster and the build bought so far. Lives carry from map to map, and a lost map costs a life and is played again.
3. The map's pay is banked. At the tree stage, Compound Interest is paid first, then the player shops.
4. The run ends when the lives do or the ladder does.

**Practice** (`endless`) is for comparing strategies while the bot is too weak
to survive a real run:

- lives never end the run;
- each map gets three tries, and a map still lost after them is skipped without pay;
- so every player reaches every map, and builds grow over the whole ladder.

## Running the sweep

```sh
ARCHETYPE_SWEEP=1 ARCHETYPE_OUT=/tmp/players npx vitest run src/test/archetypeSweep.test.ts
```

| Variable | Meaning |
|---|---|
| `ARCHETYPE_OUT` | Where `results.json` and `report.md` go (required) |
| `ARCHETYPE_SEEDS` | Runs per player (default 20) |
| `ARCHETYPE_LADDER` | `ladder` (`public/map.yml`, default) or `archive` (the 45 old maps) |
| `ARCHETYPE_MAPS` | Stop each run after this many maps |
| `ARCHETYPE_ENDLESS=1` | Practice mode |
| `ARCHETYPE_ONLY` | Only these players, e.g. `fleet,fencer` |
| `ARCHETYPE_PAR` | Added to every map's par: `60` takes the over-par cut off the base, so the pay reads as a tidy player's |

The report has a table per player (maps won, lives spent, hours earned,
attempts won, seconds per win, and the build at the end), a table of maps won
per map per player, and each player's most common purchases and where its runs
ended. The ladder's two maps take about a minute for 30 runs each; 15 archive
maps in practice take about seven minutes for 12 runs each.

## The map checklist

The report ends with a checklist per map (`src/lib/bot/mapChecklist.ts`), the
targets in MAP_DESIGN_CARD.md section 7:

| Target | Pass when |
|---|---|
| Band | Casual wins 50-80% of its attempts |
| Build | some player wins 15 points more than Casual |
| Losses | no single cause is over 70% of them |
| Pay | no map Casual finds harder than an earlier one pays less than it |

The first map is the tutorial and is held to no band. Each miss is written out
("too hard: Casual wins 32%", "one knob: timeUp is 96% of losses").

**Read pay with `ARCHETYPE_PAR=60`.** The bot draws a fence every
three-quarters of a second all map long. On a map whose win is bricks it ends
twenty fences over a par of four, and a map's base is cut to a fifth from
three over par. So its own pay is a sloppy player's pay. Par 60 removes that
cut and slightly overstates pay through the under-par bonus.

A fence budget for the bot was tried and dropped. Its fences are random, so
held to par plus two it could not finish map 1, and the budget measured its
aim rather than the map.

## The first retune (2026-11-24)

From the readings below:

- Level 2 now asks for seven of its nine bricks (two spare), is written for one
  ball, and pays more than map 1 (`points` 5 to 18). Its clock stays at 30s.
- `ladderRoster.test.ts` holds every ladder map to one-ball clearability and a
  spare on every smash clause.
- Pay follows difficulty, and every map after the first must test a build
  (MAP_DESIGN_CARD.md).

Practice, 30 runs per player, par +60:

| | Before | After |
|---|---|---|
| Level 2, Casual wins per attempt | 46% | 59% |
| Level 2, best player over Casual | 1 point | 18 points (Fence Engineer: Fast Compile after map 1) |
| Level 2, the clock's share of losses | 65% | 56% |
| Level 2 pay at par | 12h | 25h (map 1: 24h) |
| Real runs that finish the ladder | 57% | 77-80% |

Map 1 then got a tutorial's par: 5 instead of 3, and points 8 instead of 5.
Pay holds while a player is within two fences of par and falls off a cliff at
three over (the base cut to a fifth, the space bonus gone). So at par 3, a
beginner drawing six fences was paid 9h, under the 15h of the cheapest buy;
now it is 17-22h. Map 2's points went to 22 to stay above it. Both maps meet
the checklist (practice, par +60: map 1 27h, map 2 29h).

The balls then went from 30h and 45h to 100h and 150h (tree.yml), on the
owner's word that a ball releases too much power to arrive after map 2.
Practice on 15 archive maps, par +60, 12 runs: Fleet, saving for it, buys its
second ball after map 4 in every run and its third after map 11; the Earner
buys its second around map 13; Casual never saves long enough. Early maps pay
about 24-28h, so 100h is four maps saved whole.

## The ladder to the first boss (2026-11-25)

Maps 3 and 4 and the Monolith (map 5, BOSS_PLAN.md) were tuned against the
checklist, the boss to its own band (Casual 30-60%). Practice, par +60, 30
runs each:

| Map | Casual | Best | Top loss | Pay | Checklist |
|---|---|---|---|---|---|
| 1 Hello World | 100% | all | - | 27h | tutorial |
| 2 Unit Tests | 59% | Fence Engineer 77% | clock 56% | 29h | meets all |
| 3 Code Review | 53% | Super Ball 91% | clock 83% | 33h | one knob (the bot never walls a slab off) |
| 4 Firewall | 76% | Fence Engineer 83% | clock 60% | 38h | no build tested (7 points; 18 at 20 runs) |
| 5 The Monolith | 50% | Super Ball 71% | clock 71% | 56h | one knob (the bot never walls the Core off) |

Map 4 is a Use map that combines the brick and the slab, and both weight and
fence speed help, so the Casual player's mix does about as well as either
specialist. Shorter clocks (45s, 40s) did not change that. It is the open
item on the ladder.

Real runs (three lives for the whole run): 0-10% of runs reach the end of map
5, against 77-80% when the ladder was two maps. Most lives go to the bot's own
fences hitting its ball (ballHitFence), which carry from map to map. A person
draws fewer fences into a ball, but whether five maps on three lives is the
right length is worth watching once people play it.

The bosses: archive 10 is lost almost only to the boss being left outside,
which is how boss maps place their own balls. The new setting, where the boss
is a structure to break, is in BOSS_PLAN.md.

## First readings (2026-11-24, before the retune)

**The ladder (2 maps), real runs, 30 each.** Every player finishes about 57%
of the time, and the endings are the same for all: lives spent on map 2 to
balls into growing fences, the clock, and buried bricks. Map 1 pays about 10h
to 15h, and nothing on the tree that matters costs less than 15h (a ball is
30h), so no build has formed by map 2. The ladder cannot tell the strategies
apart until it is longer or map 1 pays more.

**The ladder in practice, 30 each.** Map 2 is won 87% of the time by every
player but Safe Hands, at 73%. Safe Hands starts with grace instead of weight,
and on a map of bricks weight is the trait that matters.

**The first 15 archive maps in practice, 12 each.** This is a stand-in for a
longer ladder: the old maps were built for the map's own balls, so archive map
2 is lost by everyone with one roster ball. The builds diverge as intended:

| Player | Maps won | Lives spent | Hours earned | Balls / rungs / nodes at the end |
|---|---|---|---|---|
| Fleet | 13.2 of 15 | 24.3 | 238 | 3.0 / 5.5 / 0.0 |
| Super Ball | 12.5 | 23.8 | 228 | 1.0 / 4.2 / 0.0 |
| Fence Engineer | 13.0 | 21.0 | 254 | 1.0 / 1.0 / 6.8 |
| Overtime Earner | 12.2 | 25.3 | 309 | 2.0 / 3.5 / 7.5 |
| Safe Hands | 12.5 | 18.2 | 280 | 1.0 / 2.8 / 6.8 |
| Casual | 12.7 | 21.8 | 298 | 1.2 / 3.9 / 6.6 |

How to read it:

- Fleet wins the most maps. It does best on the two maps that separate anyone (6 and 9).
- The Earner earns the most and wins the fewest.
- Safe Hands spends the fewest lives.
- Casual is within half a map of every specialist.

That last point is the main finding: on this bot, the build changes the
outcome by about one map in fifteen. That is the same thing the upgrade sweep
found for the cards, and it is worth reading again once the ladder has maps
designed for the roster. With 12 runs a share moves by about 14 points from
luck alone, so only the gaps on maps 6 and 9 are clearly larger than noise.

## Limits

The bot never pushes its luck, never holds an object (Control Freak, the
Redeploy throw), and never uses Rate Limiter, Breakpoint, Refactor or Stash.
Nodes that only act through those are bought but do nothing in its hands (see
UPGRADE_SWEEP_REPORT.md for the same list on the cards).

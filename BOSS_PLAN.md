# Bosses: Legacy Systems (plan and build record)

The setting for bosses on the brick ladder. The first, The Monolith, is built
as map 5 (2026-11-25); the build record is at the end.

## Why a new setting

The old bosses were balls the map brought: lock the boss inside the boxes,
survive its spit-outs and fence wipes. Under the ball tree a map brings no
balls, and BALL_TREE_PLAN.md section 6 decided on 2026-11-22 that **the boss is
the board**. The bot players confirmed the old shape does not survive the
roster. Archive 10, the first old boss, is lost on 117 of 120 attempts to "boss
left outside", which is about where the boss ball spawns and not about the
player at all.

So a boss is no longer something you trap. It is something you **break**,
which is what the brick pivot put at the centre of the game, and it **fights
back by changing the board**.

## The setting

Every boss is a **legacy system**: the old code at the heart of the company
that nobody dares touch, and that has to be taken down before release. It
stands in the middle of the board as a fortress:

- **The Core**: one large monolith with many hits (`hitsToBreak` 12 to 30).
  Breaking it is the win.
- **The Shell**: rings of bricks around the Core, one to three hits each. They
  are in the way of the win, not in it: the Core can be reached through any gap.

The system defends itself with **incidents**: telegraphed changes to the board,
each a map beat with a warning banner first. The office words are the
mechanics:

| Incident | What it does | What it tests in a build |
|---|---|---|
| **Patch** | Rebuilds the Shell's broken bricks, except where a ball stands or the ground is claimed | breaking fast: weight, more balls |
| **Rollback** | Cracks the newest fence, or every fence on its line | fences: speed, fences at once, Guardrail, shields |
| **Hotfix** | A speed spike for every ball (`speedSpike`, exists today) | control: pace, frost, Feature Freeze |
| **Code freeze** | The Core is untouchable for a few seconds; hits glance off | timing: a ball held back (freeze) is not wasted |

Incidents are triggered two ways:

- **on the clock**, every N seconds (Patch, Hotfix);
- **on the Core's damage**, at two thirds and one third left (Rollback, Code
  freeze), so the fight escalates as the player gets closer, the three-act
  shape the old phases had.

## The rules a boss keeps

These are the design card's rules applied to a fight:

1. **Fair to one ball.** The Core can be broken with the one ball a run starts
   with and the standard fence, inside the clock. A fleet or a stacked ball
   makes it faster, never possible.
2. **Every incident is telegraphed.** A banner and a lead time, the beat
   machinery's `announce` and `leadMs`. Nothing changes the board without
   warning.
3. **No fail the board does not show.** The only losses are the clock and the
   Core being fenced off from every ball (brick rule 4, "objective buried").
   There is no boss ball, so no "boss outside".
4. **Two answers.** Through the Shell (break a gap, then the Core) or around
   it (fence the ball into a pocket against the Core's open face). The build
   decides which is cheaper.
5. **It pays like a boss.** A high base (`points` around 40) and a bonus for
   breaking the Core early. The tree stage after a boss is the big one: the
   draft's "shop after a boss" rule carries over.

## How each player meets it

The checklist's build target, read for a boss: at least two of the six should
beat Casual by 15 points, each a different way.

| Player | Its route |
|---|---|
| Fleet | More balls on the Shell outrun the Patch; the Core takes hits from several sides |
| Super Ball | Weight 3 goes through Shell bricks in one hit and dents the Core hardest |
| Fence Engineer | Fences the ball against the Core's face; rebuilds fast after a Rollback |
| Safe Hands | Survives Rollback and Hotfix: shields, grace, freezes during the speed spike |
| Overtime Earner | Arrives with the most bought, and the early-break bonus pays it back |
| Casual | The baseline: should win 30-60% of attempts, a lower band than an ordinary map |

## The first one: "The Monolith"

Map 5, closing the brick ladder's first act. It holds one Core, one Shell and
two incidents, so it teaches the setting on its own. As built:

- **Core:** a 95x60 slab of 28 hits, in the middle (first drawn at 16).
- **Shell:** thirteen one-touch bricks round it, with one 68-wide gap, on the
  right as authored and on another side on each of the four deals. (The plan
  said 2-hit bricks; a brick breaks on one touch whatever its count, and that
  is the brick the player already knows.)
- **Patch** every 15 seconds, rebuilding the Shell.
- **Rollback** once, at 14 of the Core's 28 hits: a blast of radius 160 from
  the Core.
- **Clock:** 70 seconds (first drawn at 75).
- **Spawn:** no ball starts inside the fortress (the box round the Core and
  its Shell). Balls start near the board's middle, and on many deals one began
  beside the Core with half the fight already won.
- **Points:** 40, and Hotfix Friday: 10h more for breaking the Core inside 45
  seconds.
- **Win:** smash the Core (`smashed`, 1 of `monoliths`); the Shell counts for
  nothing.

Later systems, one new incident each, in line with "teach one thing at a time":

- **Spaghetti Code** (act II): the Shell is movers wound round the Core, and Rollback is the incident.
- **The Mainframe** (act III): two Cores, and a Code freeze that alternates between them.
- **The God Class** (act IV): the Patch grows the Shell outward each time instead of rebuilding it.

## What it needs from the engine

The pieces are small, because most of the fight is beats and breakables that
already exist:

1. **A beat trigger on damage:** `atCoreHits`, firing when the named
   breakable has taken that many hits.
2. **A Patch effect:** `restore: [brick ids]`, rebuilding broken bricks.
   - A brick is skipped while a ball overlaps it or its ground is claimed, so
     a Patch can never trap a ball or reopen taken ground.
3. **A Rollback effect:** `crackFences: newest | line`, using the fence
   fracture code the old fence wipe already has, sourced from the Core instead
   of from a boss ball.
4. **A Code freeze effect:** `shieldSeconds`, during which the Core takes no
   hits and shows it.
5. **A Core health bar** on the canvas HUD, with an entry in the Admin
   screen gallery.
6. **Admin and tests:**
   - Beats stay YAML-authored, as `adminCoverage.test.ts` records.
   - The Playground opens the boss map like any other.
   - A test holds every incident to having a telegraph.
7. **The bot:** it already avoids burying a needed breakable. A boss band in
   the checklist (Casual 30-60%) for maps marked `boss`.

## Open for the owner

- Map 5 for the first boss, or later once act I is longer?
- Should a won boss hand out something beyond hours (a free rung, a node), as
  the old bosses unlocked features?
- Should the Patch rebuild bricks under claimed ground as solid wall, so
  fencing near the Core has a cost, or never?

## Build record (2026-11-25)

Built with maps 3 and 4 as bridges, at the owner's choice, so the boss sits at
map 5 as asked: 3 "Code Review" meets the slab (a brick of three hits, where
weight pays), 4 "Firewall" puts slabs behind a wall of bricks (break in, then
break them), and 5 is the Monolith.

The engine, all of it map beats and breakables the game already had:

| Piece | Where |
|---|---|
| `everySeconds`: a beat that repeats, warned ahead of each firing | `mapBeats.ts` tickRepeatingBeat |
| `atHitsOn`: a beat on a breakable's damage, telegraphed like a space beat | `mapBeats.ts` |
| `restore`: the Patch. Never on a ball, a buried brick or claimed ground | `mapBeats.ts` restoreBrick |
| `rollback`: the blast, carved and settled by the destroy pass | `mapBeats.ts`, `destructibles.ts` (blastCarve) |
| `boss.core`: the nameplate's health is the Core's hits left | `bossPhases.ts` followCoreHealth, `initGame.ts` |
| Pips that fit any count | `bossBannerModel.ts` pipSize |
| Banner words in four languages | `game.beatPatch`, `game.beatRollback`, `game.beatEffectRestore`, `game.beatEffectRollback` |

The Rollback was planned as "crack the newest fence". On a one-ball board
almost every finished fence holds claimed ground on one side, and the game
never breaks those (Refactor's rule), so it would almost never have fired. A
blast through fences and claimed ground near the Core takes back exactly the
boxing-in the plan meant, and the bombs had already made it safe.

The nameplate's per-hit flash ("REVERTED", "PANIC MODE") stays with the boss
balls: on a Core it would fire on every one of 28 hits.

Tuned with the six bot players through maps 1-5 in practice, par +60, the
checklist holding a boss to Casual 30-60%:

| Variant | Casual | Super Ball | Fence Engineer | Verdict |
|---|---|---|---|---|
| Core 16, 75s | 76% | 87% | 80% | too easy, no build stands out |
| Core 20, 75s | 70% | 83% | 80% | too easy |
| Core 16, Patch every 10s | 80% | 83% | 76% | too easy |
| Core 24, 75s | 64% | 83% | 74% | too easy |
| Core 28, 65s, Patch every 12s (30 runs) | 64% | 68% | 67% | too easy, no build stands out |
| Core 28, 65s (30 runs) | 55% | 79% | 62% | meets all |
| Core 32, 70s (30 runs) | 57% | 79% | 62% | meets all |
| Core 28, 65s, no spawn inside (30 runs) | 48% | 71% | | the clock 72% of losses |
| **Core 28, 70s, no spawn inside (30 runs)** | **50%** | **71%** | | **the clock 71% of losses** |

The spawn rule came last, from looking at the map in a browser: a ball began
inside the Shell beside the Core on many deals, and every row above it was
measured with that luck in it. Keeping spawns out made the boss harder, and
70 seconds is the shipped clock. The one-knob flag that remains is the bot's
blind spot (it never walls the Core off; a person will), recorded on the map.

Fleet, arriving with the second ball it saved 100h for, wins about 36%: two
balls are more fences hit, not more hits on the Core. Safe Hands, without
weight, about 19%. Tests: `legacySystem.test.ts`.

Still open from the plan: the Code freeze incident (`shieldSeconds`), the
three later systems, and the owner's questions above.

# The Performance Review — Dev/End's highscore system

Design doc for the records/highscore system. Phase A is implemented; later
phases are design-complete but not built. See the phase table at the bottom
for status.

## Why this design

Dev/End's economy makes scores *honest*: the flat 80h/map overtime cap means a
run's banked overtime measures consistency × survival × lock skill, never
multiplier stacking. Scores from different runs are genuinely comparable, which
is the property most roguelites lack. Runs also carry an identity (build
archetype, capstone, loadout, ascension depth), so a record is a story, not
just a number.

There is no backend; everything is localStorage. That makes the core rivalry
**you vs. yesterday-you** — which is also the most reliable arcade retention
loop.

Principles:

- **Always a nearby target.** Many small ladders beat one giant one.
- **Tension during the run, not just after.** A record you're racing changes
  every push-your-luck decision; a record you see at the end changes nothing.
- **Every death must print a target.** The result screen converts failure into
  "I was this close".
- **Never pay records in power** beyond the existing 1.25x per-map highscore
  bonus. Records are pride currency; paying overtime re-opens issue #43.

## The score

A run's score is its **banked overtime** (`totalScore`): capped per map,
banked on death and on retirement alike. No composite "career score" — lifetime
totals reward grinding, not playing well, and stay as flavor stats only.

## Components

### 1. Record Pace — race your best run's ghost (Phase A, shipped)

The best run persists its **trajectory**: cumulative banked overtime after each
completed map (`bestRunTrajectory`, indexed by maps-completed so it extends
through ascension). Every level-complete overlay shows a pace row comparing the
current run's cumulative overtime against the best run at the same point:
`Record Pace  +12h` (ahead, green) or `-8h` (behind, red). Past the best run's
length, pace compares against its final score.

The moment a run's cumulative overtime passes the all-time best, the overlay
fires a one-time **"New personal best, and you're still going"** banner — from
then on every map is bonus territory.

Trajectory comparison is indexed by maps-completed (not level number) so runs
using Certificate Head Starts compare fairly: both sides had N maps of income.

### 2. Rank & gap at run end (Phase A, shipped)

The result screen shows where the run landed on the all-time Top 10:

- Made it: "Rank #4 all time" plus the gap up ("11h short of #3");
  rank #1 gets "New all time best run!".
- Missed it: "23h short of the Top 10".
- Deaths below the record that were ahead at some point add the epitaph:
  "You were ahead of your best run through map 17." — proof the record was
  beatable, i.e. the one-more-run trigger.

### 3. The run ledger (Phase A, shipped)

`localStorage: jezzball_hall_v1` — the all-time Top 10 runs, rich rows:
score, maps completed, ascension depth, build archetype (primary/secondary
tag), capstone, loadout ids, date. Plus the best run's trajectory.
Pure ranking/pace logic lives in `src/lib/runLedger.ts`; persistence in
`src/hooks/useHallOfFame.ts`.

**Record eligibility:** runs started via the `?level=` debug jump or an
explicit forceLevel are never record-eligible. Certificate Head Starts are
eligible (earned meta). Resumed runs (the save/continue system) stay eligible;
eligibility and the live trajectory ride along in the run save.

### 4. The Performance Review screen (Phase B viewer, shipped)

Welcome-screen "Records" entry (appears once a run has banked), screen title
"Performance Review" (`src/components/game/HallOfFameScreen.tsx`):

- **All-Time Top 10** as hold-to-inspect rows (the established gesture).
- **Archetype bests** — the six `archetypeBests` records as a grid; empty
  slots ("no Freeze run yet") are quiet quests.
- **Deepest Ascension** — tracked today, shown nowhere.
- **Map records** — the 35 `mapHighscores` as a browsable list. The existing
  1.25x beat-the-record bonus + Benchmarking bar already monetize the chase.
Also shipped: the **Benchmarking** upgrade shows a persistent top-bar chip
with the run-pace delta as of the last completed map, next to its per-map
record bar, and the screen carries a lifetime-stats flavor footer (highest
level, fences drawn, perfect maps, lives lost).

### 5. Employee of the Month (Phase C, shipped)

Monthly-reset best run, past months archived as plaques. All-time bests
eventually calcify and shut lapsed players out; a monthly board means every
1st of the month there's a fresh, winnable crown. Same score, second ledger
keyed by `YYYY-MM` (`monthlyBests` in the hall state). The result screen
celebrates taking the month's crown (suppressed when the run is also the new
all-time #1, which dominates); the Performance Review screen shows the
plaques, newest first.

### 6. Daily Stand-up (Phase D, shipped)

A date-seeded run (UTC day, so the whole world shares one run per day with no
server): the Daily Stand-up button on the main menu starts today's seed. Its
best score files on a per-day ledger plus the all-time/monthly ones, and
banking a daily on consecutive days grows an **attendance streak** (flame chip
on the menu button, celebrated on the result screen, shown with the recent
days on the Performance Review screen).

Determinism model (`src/lib/runRng.ts`): the run seed is armed module-wide;
every content roll draws a FRESH mulberry32 generator keyed by seed + a stable
context ("levels", "shop:5", "doors:10", "obstacles:level-3",
"pickups:level-3:roll:7"), which makes rolls replayable, order-independent and
StrictMode-safe. Seeded: level lineup, loadout/door/capstone offers, shop
shelves + restocks, random obstacles + variety geometry, pickup spawn timing
and effect. Ball types were already deterministic per map id. NOT seeded (by
design): live physics (spawn angles, yellow-ball speeds, fork targets) and
anything downstream of player choices - a daily shares CONTENT, not fate.
Daily runs always start at level 1 (no cert Head Start) so the run really is
the same for everyone; meta power (certs, achievement bonuses) still differs.

### 7. Share card (Phase E, shipped) + real leaderboards (optional)

The result screen's Share button renders the run as a 1080x1350 PNG
(`src/lib/shareCard.ts`): CRT-styled card with the score as the hero, build
line, capstone, depth, gold rank line, and the Daily Stand-up tag. Delivered
via the Web Share sheet where supported (mobile), else downloaded. No server:
the card IS the leaderboard post.

Still open (optional): Google Play Games Services leaderboards on Android /
small API on the web — strictly opt-in if ever.

## Deliberately excluded

- Composite career score (grind metric).
- XP levels / battle-pass rails — Certificates own long-term progression.
- Global-first leaderboards — vs. strangers most players feel nothing;
  vs. yourself every run matters.

## Phase status

| Phase | Contents | Status |
|---|---|---|
| A | Ledger + trajectory, Record Pace row, PB banner, rank/gap + epitaph on result | **shipped** |
| B | Performance Review screen + Benchmarking run-pace chip + lifetime footer | **shipped** |
| C | Employee of the Month | **shipped** |
| D | Daily Stand-up (seeded runs, daily ledger, attendance streak) | **shipped** |
| E | Share card | **shipped** (real leaderboards remain optional) |

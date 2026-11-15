# CARDS_PLAN.md

The redo of the upgrades as a card draft. Status: **phases 1 to 4 built**,
phase 5 open. Why: the owner's report that "the upgrades don't change the game
enough" and that the feeling of being handed just the right card (Slay the
Spire) was missing, and the sweep that measured it (UPGRADE_SWEEP_REPORT.md):
of 145 upgrades, 20 changed a map clearly, and the ones that did added a rule,
not a number.

## What was wrong with the classic store

1. Most upgrades were a stat nudge of 15% or less, below what play can feel.
2. 145 cards were 57 ideas cut into Junior / Senior / Principal rungs, so most
   store visits offered "a bit more of what you have".
3. Nothing cost anything but hours: no limit, no downside, so there was no
   wrong card, and so no right one.
4. Synergy counted tags ("+4% per other bank upgrade") instead of pairing a
   card with the card that makes it good.
5. Cards that only work on some maps were bought blind.

## The draft rules (`src/lib/cardRules.ts`)

A run plays ONE rule set, fixed when it starts and saved with it (`ruleSet` on
the run save), because the two read different catalogues:

| | classic | draft |
|---|---|---|
| Catalogue | `public/upgrades.yml` | `public/cards.yml` |
| After a map | buy what the hours afford | **take one card free**, or skip it for `SKIP_HOURS` |
| Build | no limit | `CARD_SLOTS` cards; one more means giving one up |
| Hours buy | cards | a second card, a reroll (`REROLL_HOURS`, rising per visit), abilities |
| Ladders | Junior to Wizard | a card and at most one upgrade, its "+" |

New solo runs play the draft. **Admin > "Classic store for new runs"** switches
back, for comparing the two. A pair run and the Daily stay classic: both phones
(and every Daily player) must read one catalogue, and the pair's shared store
has no draft screen yet.

A "+" (`upgradeOf: <card>`) requires its card, rides on it and takes no slot;
it turns up on the shelf once the card is held. Giving a card up gives up its
"+" with it. The store shows the next map's features (balls, boss, movers,
gravity well, breakables, syntax areas), so a card that needs one is never a
blind pick.

## The catalogue (`public/cards.yml`)

46 cards and 15 "+", one idea each, on the classic schema and the same modifier
pipeline. `tier` is rarity (Junior common, Senior uncommon, Principal rare).
Rules it is held to (`src/test/cards.test.ts`):

- no multiplier moves its number by less than 15%;
- a strong card says what it costs (`downside:`, drawn in red): Technical
  Debt, Crunch Time, the Semaphore, Flare, Tripwire and Redeploy fences;
- every key is one the engine reads; every fence type and certificate exists.

The engines, each an enabler and the card that pays it off:

| Engine | Enablers | Payoffs |
|---|---|---|
| Freeze | Feature Freeze, Cold Boot, Cron Job, Bug Squash | Frozen Assets (frozen locks pay triple), Thaw Cycle (a lock refunds a freeze), Deep Freeze (no cooldown) |
| Ice | Ice Fence | Permafrost (Ice freezes the ball it slows), then every freeze payoff |
| Lock chain | Containment (a lock holds the nearest ball) | Frozen Assets, Batch Commit, Golden Handshake, Knowledge Transfer |
| Multi-lock | Semaphore Fence, Batch Commit | Golden Handshake, Loose Coupling |
| Tempo | Fast Compile, Hot Start, Scaffolding | Multithreading, Continuous Delivery, Ship Early |
| Bank | Performance Bonus, Technical Debt | Stock Options, Compound Interest, Expense Account |

Two keys are new, each with a Playground knob: `iceFreezeSeconds` (Permafrost)
and `freezeUsesPerLock` (Thaw Cycle).

Certificates still chase classic ids, so a card names the chase it counts
toward (`certCredit:`). Sprint Planning and Tenure read the draft catalogue as
it is: a chain is a card and its "+", and the jackpot pays a rare card.

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | Rule sets, the catalogue switch, the run save, the Admin toggle | built |
| 2 | The draft store: free card, skip, reroll, slots and the replace modal, the next-map line | built |
| 3 | `cards.yml`, the two new mechanics, Tenure and Sprint Planning on cards | built |
| 4 | The sweep run on `cards.yml` and the catalogue tuned from it; card text in es, sv and bn | built |
| 5 | Bosses and elite maps that test a build; the pair's draft; the "Sprint" panel's wording in the draft | open |

## Build record

**Phases 1 to 3.** The store is still `UpgradeShop`, given a `draft` prop: the
free card is a price of zero on the first card picked (`draftStoreModel.ts`),
the slot rule opens `ReplaceCardModal` before a pick that would not fit, and
`DraftBar` carries the visit's rules, the reroll and the next map. The shelf
is `rollShelf` with no locked teaser. Gallery: `UpgradeShop-draft`,
`ReplaceCardModal`. Tests: `cards.test.ts`, `draftStore.test.ts`,
`cardMechanics.test.ts`. Analytics: `draft_choice` (take, skip, reroll, drop).

**Phase 4.** The sweep reads the draft catalogue (`UPGRADE_SWEEP_CATALOG=cards`)
and plays named builds (`UPGRADE_SWEEP_BUILDS=a+b`), which is how a payoff card
is read: alone it has nothing to pay off. Same method and noise floor as
UPGRADE_SWEEP_REPORT.md (15 maps, 16 seeds, each "+" on top of its card).

| | classic (145) | draft (61) |
|---|---|---|
| Clear (over 2x the noise) | 20 (14%) | 28 (46%) |
| Weak (1x to 2x) | 26 | 7 |
| Within the noise | 55 | 15 (Moonshot among them: the bot never pushes its luck) |
| Never changed a run, though the bot plays it | 7 | 0 |
| Not measurable by the bot alone | 37 | 11: five payoffs read in builds below, Fault Tolerance, Scrum Master, Control Freak and the three store cards |

What it changed:
- **Loose Coupling** read as nothing, because the lock limit was widened only in
  GameCanvas; the bot now applies it too. Measured, it is among the strongest
  cards (+39% pay, 13% faster clears), so it moved from common to uncommon.
- **The freeze payoffs are small for this bot** (Frozen Assets +5.6% pay on top
  of Feature Freeze, Thaw Cycle and Deep Freeze under 2%): its only freeze
  habit is saving a fence, never setting up a frozen lock. Frozen Assets went
  from triple to four times; the other two are left for play to judge.
- Permafrost changes nearly every run it is in (233 of 240) but nets out near
  the noise for the bot, like the Ice fence it rides on.
- Compression, Containment, Cron Job, Ghost Protocol and Knowledge Transfer
  sit in the noise for the bot. Left as they are: each is a rule a player can
  build on, and the bot plays no build.

Card text is in es, sv and bn under `content.cards` (its own namespace: eleven
card ids are also classic ids with other numbers on them), and `cards.test.ts`
holds the numbers in every language to the English.

Known gaps (phase 5): the classic store's "Sprint" panel wording is unchanged
in the draft; a pair run has no draft; no map yet asks a question that one
build answers better than another.

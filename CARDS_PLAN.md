# CARDS_PLAN.md

The redo of the upgrades as a card draft. Status: **phases 1 to 6 built**;
what is still open is listed at the end. Why: the owner's report that "the upgrades don't change the game
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
| After a map | buy what the hours afford | buy what the hours afford, at **an ordinary map's pay a common card**; a won contract's store deals one free |
| Build | no limit | `CARD_SLOTS` cards; one more means giving one up |
| Hours buy | cards | cards, a reroll (`REROLL_HOURS`, rising per visit), abilities |
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

49 cards and 15 "+", one idea each, on the classic schema and the same modifier
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
| 5 | Contracts (the draft's elite maps), payoff cards for the Flare, Guardrail and Tripwire fences, the draft's own panel wording | built |
| 6 | The earned store: no free card, every card priced at an ordinary map's pay, a won contract deals one | built |

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

**Phase 5.**

*Contracts* (`src/lib/contracts.ts`, the `contracts:` block of `cards.yml`) are
the draft's elite maps. From the store before map 4 on, and never before a
boss, the draft bar offers one hard rule for the NEXT map only: Hotfix Friday
(balls 30% faster), Scale-Up (balls 30% bigger) or Legacy Code (fences 35%
slower), in turn by map number, so each comes round and none needs forcing.
Take it and win the map, and the store after it deals **two free cards from
the uncommon and rare ones**. Each asks a different question, so a build
answers some better than others: slow and freeze for the fast balls, shields
and Compression for the big ones, tempo for the slow fences. The rule rides
the ordinary modifier merge for that map (`activeContractId` in the session),
is saved with the run, and survives a Continue on the same map.

*Fence payoffs.* Three cards, each with a new key and a Playground knob:
Afterburner (`fastLockBonus`: a ball locked while running faster than its base
speed pays triple, which is what a Flare fence sets up), Crash Barrier
(`guardrailExtraShields`: two more Guardrail shields a map) and Tensioned Wire
(`fenceExtraHits`: a Tripwire survives two more touches). The Mutex and
Semaphore fences already had theirs (Golden Handshake, Batch Commit).
Measured in builds: Afterburner +22% pay on top of the Flare fence; Tensioned
Wire +5%; Crash Barrier near nothing for the bot, which rarely loses two
fences on one map.

*Wording.* In the draft the store's panel reads "Your picks" and "Cards", and
the button says what it takes.

**Phase 6: the earned store.** The draft opened as "take one card free a map,
or skip it for hours", and played, that was too many cards too early: with
the free card and a second bought when the hours allowed, the build of six was
full by map 4 and every store after it was a swap, which is a decision about
what to lose rather than what to build. The owner's rule for the redo: *a
normal run affords one card a map, and more has to be earned on the board.*

So nothing is free at an ordinary store any more. `SKIP_HOURS` is gone with
the free card (there is nothing to skip), `freePicks` defaults to none, and the
contract's payout is **one** free card from the rarer ones rather than two:
with the ordinary free card gone, one is the whole reward and the only free
card a store deals. The run's one free card is the Sprint Planning offer
before map 1, which stays as it was.

The price is what makes the rule true. `cards.yml`'s anchor is **23h** (the
classic store's is 48): `upgradePricing.ts` measured, through `calculateScore`,
flawless 47h, good 34h, ordinary 16h, scrappy 6h, and 23 x 0.7 puts a common
card at 16h, an uncommon at 22h and a rare at 30h. An ordinary map buys one
common, a good map two, a flawless map three; a scrappy map buys nothing and
banks toward the next. `blockInflation` is unchanged, so prices still climb
15% per five maps as a build's pay does. `draftStore.test.ts` pins the common
card's price to the ordinary figure.

What the bar says changed with it: "Every card costs hours. A good map pays
for more than one." at an ordinary store, and the contract's line at the one
after a won contract. In every language.

Still open:
- the price anchor is set from the pricing note's measured pays, not from a
  sweep of the draft itself; a sweep that reads hours banked per map under
  the draft's own cards would settle whether 23 is right;
- a contracted map does not yet say so on the board itself (the store is the
  only place it is named);
- a pair run has no draft;
- no boss or authored map has been changed: contracts are the build test, and
  the ladder's own maps are as they were;
- the Redeploy fence has no payoff card.

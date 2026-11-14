# Upgrade sweep report

Run 2026-11-14, on `dev` at the time of `16c8092`. Rerun with
`src/test/upgradeSweep.test.ts` (opt-in, `UPGRADE_SWEEP=1`; see its header).

## The question

Does any single upgrade change how a map plays enough to matter? The owner's
complaint was that upgrades "don't change the game enough"; this measures it.

## Method

- Every upgrade in `public/upgrades.yml` (145), **on its own**, is played by the
  headless bot on 15 maps across the ladder (2, 4, 6, 8, 10, 12, 15, 18, 20,
  23, 26, 29, 32, 36, 40; bosses included), 16 seeds each: 240 runs per card,
  about 36,000 runs in all.
- Each run is paired with the same map and seed played without the card.
- Measured: wins, lives lost per map, clear time (median, on runs both sides
  won) and overtime paid (on runs both sides won).
- **The noise floor.** The sim is chaotic: any change at all reshuffles every
  seed. Six placebo builds (balls 0.05% to 0.2% slower or faster) give seven
  rolls of "no change" with the baseline. Each card is read against their mean,
  and "noise" is two standard deviations of their spread:
  **wins 4.1pp, lives 0.07 per map, clear time 2.8%, pay 5.0%**.
- "vs noise" is the card's largest metric as a multiple of that floor.
  Above 2x is a clear effect; 1x to 2x is weak.
- Context for conditional cards: map number and the map's own features, 3
  lives, 60h banked.
- A rung is tested alone, so its numbers are what **buying that rung adds**
  (Ghost Protocol Senior is its +50ms, not the 150ms total).

## Headline

- **6 of 145 cards have a clear effect.** The largest change to how a map plays
  is about 7% faster clears and 4pp more wins, against a noise floor of 2.8% and
  4.1pp. No card moves the bot's win rate by more than about 6pp.
- **55 more** the bot can use are within or barely above the noise.
- **9 are identical to the baseline in every one of their 240 runs**, though
  the bot plays the thing they act on (below). Three are the bug below. Ghost
  Protocol's +50ms rungs never changed a single run. Code Review's 3% lock
  margin never decided one. Sticky Situation only lengthens a squash, so alone
  it has nothing to lengthen, and Ghost Protocol's Principal B and Free Fall's
  Principal B need map features (3+ balls, a gravity well) that their maps here
  did not switch on.
- **75 could not be measured**: taps, fence types, the store, the purse,
  power-ups, and effects applied outside the engine the bot runs. A card in
  this group is not shown to be weak, only unmeasured here.

## Bug: Performance Bonus pays nothing

`scoreMultiplier` multiplies only the map's **base** (`points: 5` on every map)
and the result is floored (`src/lib/scoring.ts`, `multipliedBase`):
5 x 1.05, 5 x 1.10 and 5 x 1.15 all floor to 5. So Performance Bonus Junior,
Senior and Principal add **0h on every map**, and Technical Debt Senior (+20%)
and Principal (+35%) add at most 1h while keeping their faster balls. The
Certificate "Overtime +5%" and the desperation multiplier ride the same key.
Not fixed here: fixing it is an economy decision (multiply the whole map pay,
or turn the cards into flat hours), so it is the owner's call.

## Caveats

- The bot is a weak player (61% of these maps won) that cuts where it sees
  room. It measures how a card changes play, not how a card feels, and a
  player who builds around a card may get more out of it.
- Cards are tested alone, never in a build; combos are not measured.
- Bot-only quirks show up: slower balls (Runtime Optimisation) make the bot
  clear *slower*, because its cuts wait for gaps and fewer gaps open.

## Results

### Clear (more than 2x the noise)

| Card | Tier | Win (pp) | Lives lost / map | Clear time | Pay | vs noise | Says |
|---|---|---|---|---|---|---|---|
| `technical_debt_architect` | Architect | +0.2 | -0.01 | -4.3% | +29.9% | 6.0x | +5h to this run's per-map overtime ceiling. Balls move 25% faster. |
| `runtime_optimisation_junior` | Junior | -2.7 | +0.01 | +8.8% | -3.8% | 3.2x | Reduce ball speed by 5%. |
| `horizontal_scaling` | Wizard | +2.3 | -0.03 | -0.8% | +15.0% | 3.0x | Every lock counts as one more ball for the simultaneous-trap multiplier, on top of anything else. |
| `hot_start_principal` | Principal | -0.2 | -0.03 | -7.1% | -2.1% | 2.6x | First two fences in each map generate instantly. |
| `fast_compile_principal` | Principal | +3.6 | -0.08 | -7.0% | +2.6% | 2.5x | Increase fence generation speed by 30%. |
| `onboarding_principal_b` | Principal | -3.9 | +0.00 | -5.6% | -4.7% | 2.0x | Fast Track: 13% captured, and 1% more per 2 other tempo upgrades (max 5). |

### Within or near the noise (under 2x)

| Card | Tier | Win (pp) | Lives lost / map | Clear time | Pay | vs noise | Says |
|---|---|---|---|---|---|---|---|
| `load_balancer_principal` | Principal | +1.1 | -0.03 | -0.8% | -9.4% | 1.9x | The fastest ball is slowed 15% instead of 10%. |
| `load_balancer_architect_a` | Architect | +1.1 | -0.03 | -0.8% | -9.4% | 1.9x | Round Robin: the fastest ball is slowed 20% instead of 15%. |
| `fast_compile_principal_b` | Principal | +1.9 | -0.09 | -5.1% | -3.1% | 1.8x | Incremental Build: fences start 10% faster, +5% per fence finished this map. |
| `onboarding_junior` | Junior | +1.5 | -0.05 | -5.0% | -6.4% | 1.8x | Every map starts with 8% of the board already captured. |
| `runtime_optimisation_principal_a` | Principal | -6.4 | -0.00 | +1.0% | -6.5% | 1.6x | All balls move 15% slower. 2% slower again per other safety upgrade (max 4). |
| `continuous_delivery` | Principal | -0.2 | -0.07 | -4.2% | -3.9% | 1.5x | Each fence you complete speeds up the next one by 4% for the rest of the map. |
| `deadline_extension_principal_b` | Principal | +2.3 | -0.03 | -0.8% | +7.6% | 1.5x | On maps with 3+ balls: +1s per ball on Ship Early windows, and 2.2x Tempo. |
| `hot_start_junior` | Senior | +1.1 | +0.01 | -0.8% | -7.5% | 1.5x | First fence in each map generates instantly. |
| `fast_compile_senior` | Senior | +2.7 | -0.05 | -3.9% | -3.9% | 1.4x | Increase fence generation speed by 20%. |
| `chaos_engineering_principal_b` | Principal | +2.7 | -0.05 | -0.8% | -6.1% | 1.2x | Game Day: every map with shards has at least 2 shard bombs, on top of the 20%. |
| `runtime_optimisation_senior` | Senior | -0.6 | -0.08 | +1.4% | -2.8% | 1.2x | Reduce ball speed by 10%. |
| `chaos_engineering_principal_a` | Principal | +4.8 | -0.06 | -0.8% | -2.6% | 1.2x | Fault Injection: shards are 40% more likely to carry a bomb. |
| `hot_start_architect_b` | Architect | +2.3 | -0.02 | -0.8% | -5.7% | 1.1x | From level 20: two instant fences each map, and one more growing at a time. |
| `chaos_engineering_junior` | Junior | +3.2 | -0.05 | -0.8% | -5.6% | 1.1x | Shards are 10% more likely to carry a bomb. |
| `chaos_engineering_senior` | Senior | +3.2 | -0.05 | -0.8% | -5.6% | 1.1x | Shards are 20% more likely to carry a bomb. |
| `ghost_protocol_junior` | Junior | +2.3 | -0.03 | -0.8% | -5.3% | 1.1x | A new fence passes through balls for the first 0.1s of its growth. |
| `fast_compile_junior` | Junior | +1.1 | -0.04 | -0.8% | -5.1% | 1.0x | Increase fence generation speed by 10%. |
| `padded_estimate_principal_b` | Principal | +2.3 | -0.03 | -0.8% | -5.1% | 1.0x | Overdelivery: par stays at two extra fences, but beating par pays double. |
| `performance_bonus_principal_b` | Principal | +2.3 | -0.03 | -0.8% | -5.1% | 1.0x | Stock Options: only 5% more overtime, but Space Optimization bonuses pay double. |
| `tech_evangelist` | Principal | +2.3 | -0.03 | -0.8% | -5.1% | 1.0x | Space Optimization bonuses pay double. +8% per other risk upgrade (max 5). |
| `micro_manager_principal` | Principal | +2.3 | -0.03 | -0.8% | -5.1% | 1.0x | Each locked ball slows every ball by 1%, down to a 50% floor. |
| `padded_estimate_junior` | Junior | +2.3 | -0.03 | -0.8% | -5.1% | 1.0x | Every map is scored against one extra fence of par. |
| `padded_estimate_senior` | Senior | +2.3 | -0.03 | -0.8% | -5.1% | 1.0x | Every map is scored against two extra fences of par. |
| `padded_estimate_principal` | Principal | +2.3 | -0.03 | -0.8% | -5.1% | 1.0x | Sandbagging: +3 fences of par, 4 at 4 other tempo upgrades. |
| `free_fall_junior` | Junior | +2.3 | -0.03 | -0.8% | -4.9% | 1.0x | Under gravity, in a live well, or on a gravity map: locks pay double. |
| `free_fall_senior` | Senior | +2.3 | -0.03 | -0.8% | -4.9% | 1.0x | Gravity locks now pay triple. |
| `free_fall_principal` | Principal | +2.3 | -0.03 | -0.8% | -4.9% | 1.0x | Terminal Velocity: gravity locks pay 4x. +0.25x per other lock upgrade (max 4). |
| `bug_squash_senior` | Senior | +4.0 | -0.04 | -0.8% | -0.0% | 1.0x | Squash odds rise to 8%, and a stuck ball stays put for 3s. |
| `severance_package_principal_b` | Principal | +2.3 | -0.03 | -0.8% | -4.8% | 1.0x | On maps with a syntax highlighting area, +11 overtime for every superior lock. |
| `runtime_optimisation_principal_b` | Principal | -3.9 | -0.06 | +0.0% | -3.2% | 1.0x | Reduce ball speed by 5%, and one random ball runs 50% slower each map. |
| `technical_debt_senior` | Senior | +2.7 | -0.00 | -2.5% | -0.5% | 0.9x | 20% more overtime per map, but balls move 8% faster. Short-term gain, long-term pain. |
| `memory_footprint_principal` | Principal | -1.0 | -0.01 | +2.5% | +3.7% | 0.9x | Reduce ball size by 15%. |
| `load_balancer_senior` | Senior | -3.1 | +0.02 | +2.2% | +4.4% | 0.9x | The map's fastest ball moves 10% slower. Only that one. |
| `breaking_change_junior` | Junior | +3.6 | -0.03 | -0.8% | -2.8% | 0.9x | Destructibles need one less hit to break. |
| `breaking_change_senior` | Senior | +3.6 | -0.03 | -0.8% | -2.8% | 0.9x | Destructibles need one hit less, so most come apart on the first solid contact. |
| `deadline_extension_junior` | Junior | +2.3 | -0.03 | -0.8% | -3.9% | 0.8x | Every Ship Early bonus window lasts 2s longer per ball on the map. |
| `deadline_extension_senior` | Senior | +2.3 | -0.03 | -0.8% | -3.9% | 0.8x | Ship Early windows now last 4s longer per ball. |
| `deadline_extension_principal` | Principal | +2.3 | -0.03 | -0.8% | -3.9% | 0.8x | Ship Early windows now last 6s longer per ball. |
| `memory_footprint_junior` | Junior | -3.1 | +0.00 | -0.2% | +1.9% | 0.8x | Reduce ball size by 5%. |
| `knowledge_transfer_senior` | Senior | +1.5 | -0.03 | -0.8% | -3.6% | 0.7x | Each lock speeds fence generation 4% for the rest of the map. |
| `load_balancer_architect_b` | Architect | +2.3 | -0.05 | -0.8% | -1.5% | 0.7x | Autoscaling: 16%, and 1% more per 2 other safety upgrades (max 4). |
| `memory_footprint_senior` | Senior | -2.7 | +0.02 | -0.7% | -3.4% | 0.7x | Reduce ball size by 10%. |
| `severance_package_junior` | Junior | +2.3 | -0.03 | -0.8% | +0.1% | 0.6x | Each lock pays 1 bonus hour, counted under the map cap. |
| `breaking_change_principal` | Principal | +2.3 | -0.03 | -0.8% | +0.2% | 0.6x | Write-Off: each object you smash compounds the demolition payout by 30%, not 15%. |
| `severance_package_senior` | Senior | +2.3 | -0.03 | -0.8% | +0.1% | 0.6x | Locked balls now pay 2 bonus overtime hours each. |
| `breaking_change_principal_b` | Principal | +2.3 | -0.03 | -0.8% | -0.8% | 0.6x | On breakable maps, smashing costs no lock multiplier and each break pays 15% more. |
| `severance_package_principal_a` | Principal | +2.3 | -0.03 | -0.8% | +0.1% | 0.6x | Golden Handshake: every ball you lock away pays 3 bonus overtime hours. |
| `technical_debt_principal` | Principal | +1.9 | -0.01 | -0.8% | +1.9% | 0.5x | Earn 35% more overtime per map - but balls move 15% faster. |
| `hot_start_architect` | Architect | +0.2 | -0.03 | -0.8% | -0.4% | 0.4x | First three fences in each map generate instantly. |
| `defensive_programming_architect_b` | Architect | -0.2 | -0.03 | -0.8% | +0.9% | 0.4x | Nanobots: on maps with 3 or more balls, balls are 25% smaller. |
| `onboarding_senior` | Senior | -1.4 | +0.02 | -0.6% | +2.0% | 0.4x | Start with 12% of the board captured instead of 8%. |
| `onboarding_principal_a` | Principal | -1.4 | +0.02 | -0.6% | +1.9% | 0.4x | Probation Waived: start with 16% of the board captured instead of 12%. |
| `bug_squash_junior` | Junior | +0.2 | -0.02 | -0.8% | +1.6% | 0.3x | Every wall hit has a 5% chance to squash the ball flat and stick it for 2s. |
| `memory_footprint_principal_b` | Principal | -0.2 | +0.00 | -0.8% | -1.0% | 0.3x | On maps with a mover, balls 5% smaller, and the lock threshold widens by 8. |
| `bug_squash_principal_a` | Principal | -0.6 | -0.01 | -0.8% | -0.3% | 0.3x | Splat Rate: squash odds rise to 12%, and a stuck ball stays put for 3.5s. |

### Identical to the baseline in every run, though the bot could reach them

- `performance_bonus_principal`: 15% more overtime per map. +4% per other bank upgrade (max 5).
- `bug_squash_principal_b`: Sticky Situation: odds stay at 8%, but a stuck ball stays put for 6s.
- `ghost_protocol_principal_a`: Your fences now pass through balls for their first 0.2s.
- `ghost_protocol_principal_b`: On maps with 3+ balls, fences pass through balls for 0.25s. Elsewhere 0.15s.
- `performance_bonus_junior`: Gain 5% more overtime per map.
- `performance_bonus_senior`: Gain 10% more overtime per map.
- `code_review`: A pocket up to 3% over the lock limit still locks its ball.
- `free_fall_principal_b`: On maps with a gravity well, the pull bends your ball half as hard.
- `ghost_protocol_senior`: Your fences now pass through balls for their first 0.15s.

### Not measured: the bot cannot exercise them

- **needs a tap or hold the bot never makes** (17): `venture_capital_architect`, `feature_freeze_principal_a`, `control_freak_principal_a`, `cascade_freeze_principal`, `frozen_assets_senior`, `feature_freeze_principal_b`, `control_freak_principal_b`, `cascade_freeze_principal_b`, `frozen_assets_principal`, `feature_freeze_junior`, `control_freak_junior`, `cascade_freeze_junior`, `frozen_assets_principal_b`, `feature_freeze_senior`, `control_freak_senior`, `cascade_freeze_senior`, `hot_standby`
- **applied outside the engine the bot runs (session, canvas or loop)** (13): `defensive_programming_senior`, `cron_job_architect`, `fault_tolerance_junior`, `defensive_programming_principal`, `cold_boot`, `cron_job_architect_b`, `benefits_package_principal_b`, `fault_tolerance_senior`, `defensive_programming_architect_a`, `cron_job_senior`, `fault_tolerance_architect`, `defensive_programming_junior`, `cron_job_principal`
- **acts in the store or across runs** (11): `expense_account`, `procurement_senior`, `open_source_contribution`, `golden_parachute`, `procurement_principal`, `system_architect`, `procurement_principal_b`, `augmentation_wizard`, `procurement_junior`, `talent_scout`, `release_train`
- **needs a purse or spending between maps** (9): `budget_cycle_principal_a`, `venture_capital_architect_b`, `war_chest`, `budget_cycle_principal_b`, `venture_capital_senior`, `budget_cycle_junior`, `clean_release`, `venture_capital_principal`, `budget_cycle_senior`
- **acts on power-up tokens, off in the bot** (7): `benefits_package_principal`, `total_compensation_principal`, `total_compensation_principal_b`, `benefits_package_junior`, `total_compensation_junior`, `benefits_package_senior`, `total_compensation_senior`
- **a fence type the bot never picks** (7): `cold_storage_ice`, `raise_the_semaphore`, `rolling_redeploy`, `hotfix_tripwire`, `incident_flare`, `add_guardrails`, `acquire_the_mutex`
- **only draws something** (5): `scrum_master_1`, `scrum_master_6_b`, `scrum_master_2`, `scrum_master_4`, `scrum_master_6`
- **more fences at once; the bot draws one at a time** (2): `ultrathreading_principal`, `multithreading_principal`
- **condition off at the start of a map (lives)** (2): `fault_tolerance_architect_b`, `technical_debt_architect_b`
- **acts on push-your-luck, which the bot never takes** (2): `moonshot`, `risk_appetite`

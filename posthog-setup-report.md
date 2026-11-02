# PostHog post-wizard report

The wizard completed a targeted analytics integration for **Dev/End** (Vite + React 18 + TypeScript). PostHog was already partially instrumented — `posthog-js` was installed and `initAnalytics()` was wired in `main.tsx`. The wizard filled in the remaining gaps: environment variables were written to `.env.local`, three new event types were added to the `analytics` module, and a silent bug (retire path not firing `run_ended`) was fixed. No existing code was removed or restructured.

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `run_started` | A run began (mode: new/daily/resume/playAgain, daily flag) | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `level_completed` | A map was cleared (level, overtime, perfect, daily) | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `level_failed` | Ran out of lives on a map | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `continue_spent` | Spent a Continue to retry the current level | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `upgrade_purchased` | Bought an upgrade in the shop | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `capstone_selected` | Picked the run's Promotion capstone | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `run_ended` | Run is over - win or final death (also fixed: now fires on retire) | `src/hooks/useGameSession.ts` *(pre-existing + retire fix)* |
| `offer_selected` | Player took or skipped a Sprint Planning offer at the run start (offerId, pool, grantedIds; replaced `loadout_selected`) | `src/hooks/useGameSession.ts` |

### Added 2026-11-02 (player behaviour, keep-or-drop)

`level_completed` now also carries `seconds` (active play), `livesLost`,
`fences` and `mutator`; `run_ended` carries `reason` (won / outOfLives /
restarted), `minutes` and the Sprint Planning card (`offerId`, `offerPool`);
`run_started` has a `restart` mode.

| Event name | Properties | Raised in |
|---|---|---|
| `life_lost` | level, reason (MapFailKind: timeUp, ballHitFence, bossOutside, ...), seconds, livesLeft, mutator, daily | `src/lib/gameTelemetry.ts` (from applyCut / fenceStrike) |
| `cert_store_opened` | - | `useGameSession.ts` |
| `cert_bought` | certId, level | `useGameSession.ts` |
| `ability_used` | abilityId (an ability-bar id, or featureFreeze / freezeCharge), level | `useGameSession.ts`, `net/commands.ts` |
| `fence_type_used` | fenceTypeId, level; non-standard types, once per type per map | `gameTelemetry.ts` |
| `shop_skipped` | level, overtimeBanked | `useGameSession.ts` |
| `pair_session` | method, role, transport, connected, maps, problem | `usePairSession.ts`, `PairLobby.tsx` |
| `screen_viewed` | screen | `useScreenNavigation.ts` |
| `setting_changed` | setting (language, musicVolume, effectsVolume, tutorialsReEnabled, totalReset), value | `OptionsScreen.tsx`, `useGameSession.ts` |
| `quality_dropped` | from, to (tier, res or 2d), fps, reason (slowFrames / startFailed) | `rendering/rendererDiag.ts` |

Opening any Admin screen mutes analytics for the rest of that launch (a
tester's play is not players' data). Admin > Analytics lists every event the
launch raised, sent or not, and can unmute to check one lands in PostHog.

## Files changed

- `src/lib/analytics.ts` — added `loadoutSelected` (and `ascensionStarted`, since removed with Ascension) event definitions
- `src/hooks/useGameSession.ts` — called the three new events from their handlers; fixed `handleRetire` to emit `run_ended`
- `.env.local` — wrote `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST`

## Next steps

We've built a dashboard and five insights to monitor player behaviour:

- **Dashboard:** https://eu.posthog.com/project/226295/dashboard/829014
- **Daily run starts:** https://eu.posthog.com/project/226295/insights/w4ExkZiO
- **Run completion funnel:** https://eu.posthog.com/project/226295/insights/EQsPPVhN
- **Run starts by mode:** https://eu.posthog.com/project/226295/insights/tAWeaWBq
- **Upgrade purchases per day:** https://eu.posthog.com/project/226295/insights/lvhDf583
- **Win rate:** https://eu.posthog.com/project/226295/insights/PUot5Uxm

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite (`npm run test`) — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` to `.env.example` (the wizard already updated `.env.local`; collaborators and CI need to know these vars exist).
- [ ] Wire source-map upload (`posthog-cli sourcemap` or Vite's upload step) into CI so production stack traces de-minify in PostHog error tracking.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

# PostHog post-wizard report

The wizard completed a targeted analytics integration for **Dev/End** (Vite + React 18 + TypeScript). PostHog was already partially instrumented — `posthog-js` was installed and `initAnalytics()` was wired in `main.tsx`. The wizard filled in the remaining gaps: environment variables were written to `.env.local`, three new event types were added to the `analytics` module, and a silent bug (retire path not firing `run_ended`) was fixed. No existing code was removed or restructured.

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `run_started` | A run began (mode: new/daily/resume/playAgain, daily flag) | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `level_completed` | A map was cleared (level, overtime, perfect, ascensionDepth, daily) | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `level_failed` | Ran out of lives on a map | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `continue_spent` | Spent a Continue to retry the current level | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `upgrade_purchased` | Bought an upgrade in the shop | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `capstone_selected` | Picked the run's Promotion capstone | `src/hooks/useGameSession.ts` *(pre-existing)* |
| `run_ended` | Run is over - win or final death (also fixed: now fires on retire) | `src/hooks/useGameSession.ts` *(pre-existing + retire fix)* |
| `door_selected` | Player picked a contract assignment from the 1-of-3 draft | `src/hooks/useGameSession.ts` *(new)* |
| `loadout_selected` | Player picked or skipped a loadout at the run-start draft | `src/hooks/useGameSession.ts` *(new)* |
| `ascension_started` | Player chose to ascend after beating the final level | `src/hooks/useGameSession.ts` *(new)* |

## Files changed

- `src/lib/analytics.ts` — added `doorSelected`, `loadoutSelected`, `ascensionStarted` event definitions
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

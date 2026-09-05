# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**Dev/End** — a browser game built with Vite + React 18 + TypeScript, packaged
for Android via Capacitor. Game content (levels, upgrades, scoring, loadouts,
etc.) is data-driven from YAML files in `public/`.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` (see note below) |
| Lint | `npm run lint` |
| Run tests | `npm run test` |
| Watch tests | `npm run test:watch` |
| Android sync / open | `npm run android:sync` / `npm run android:open` |

Before committing, run **`npx tsc --noEmit -p tsconfig.app.json`** and
**`npm run test`**; both should pass clean.

> **Typecheck gotcha:** plain `npx tsc --noEmit` is a no-op here. The root
> `tsconfig.json` has `"files": []` plus project `references`, and in
> non-build mode `tsc` does not traverse references, so it checks zero files
> and always "passes." Use `npx tsc --noEmit -p tsconfig.app.json` to
> actually typecheck `src` (pure check, no build artifacts). `npx tsc -b`
> also works but writes `*.tsbuildinfo`.

## Layout

- `src/components/` — React components (`game/`, `admin/`, `ui/`).
- `src/hooks/` — game-loop, input, level-manager and related hooks.
- `src/lib/` — game logic: `physics/`, `rendering/`, `scoring.ts`, `initGame.ts`.
- `src/types/` — shared TypeScript types.
- `src/i18n/` — `react-i18next` setup and `locales/{en,es,sv}.json`.
- `src/test/` — Vitest tests.
- `public/*.yml` — runtime game config (`map.yml`, `upgrades.yml`,
  `scoring-config.yml`, `loadouts.yml`, `certificates.yml`, `balls.yml`, …),
  loaded at runtime with `js-yaml`.

See **ARCHITECTURE.md** for the game design and data model,
**MAP_DESIGN_GUIDELINES.md** for how the ladder is designed (the mechanic
ledger, the combination matrix, the per-map conventions and the engine
constraints a map must satisfy), and **ANDROID.md** for Capacitor/Play-Store
packaging.

## Conventions

- **TypeScript everywhere**; prefer explicit types for shared structures
  (`src/types/`). Path alias `@/` maps to `src/`.
- **Match the surrounding style** — this codebase uses concise inline comments,
  `framer-motion` for animation, Tailwind utility classes, and `lucide-react`
  for icons. Don't introduce new icon assets; use `lucide-react`.
- **Config-driven content**: gameplay tuning (points, costs, levels, upgrades)
  lives in `public/*.yml`, not hardcoded. When adding game content, edit the
  YAML and the matching type in `src/types/`.
- **i18n**: user-facing strings go through `react-i18next`; add keys to all
  locale files under `src/i18n/locales/`.
- **Tap-and-hold for explanations.** Press-and-hold (~450ms) is the game's
  standard gesture for revealing an info/explainer modal on an interactive or
  status element (e.g. upgrade cards, the closed-store banner). Prefer it over
  always-visible help text or a plain click; add a small `Info` hint icon so the
  element reads as holdable, and dismiss the modal on backdrop tap or an X.
- **No em-dashes in UI text.** Never use the em-dash character (`—`) in
  user-facing strings — this means the locale files in `src/i18n/locales/` and
  the `name`/`description`/other displayed fields in `public/*.yml`. Use a
  comma, colon, parentheses, or a spaced hyphen (`-`) instead. (Code comments
  are not UI text and are exempt.)

## Closing recap

End every reply with a short recap, after the work, as a markdown blockquote so
it stands apart from the answer itself:

> **You asked:** the prompt, quoted, or tightly paraphrased when it was long.
> **I read it as:** the task I actually acted on.

Keep it to a couple of lines. Its job is to surface a misread while it is still
cheap to fix, so state the interpretation I really worked from, not a tidied-up
version of it. Anything I assumed, any ambiguity I resolved on my own, any part
of the ask I deliberately left out or deferred belongs in the second line.

When the prompt was a screenshot, a file or a link, say what I took FROM it,
since that reading is the most likely thing to be wrong.

**If CI failed at any point and I fixed it, say so when I wrap up.** Not only in
the turn where it broke: a red build that got fixed three turns ago is still
something the recap should carry, because the alternative is a summary that
reads as though the work went cleanly. Name what failed and what the fix was, in
a line.

## Git

- Default working branch is `dev`; the release branch is `main`.
- Push to `dev` automatically once work is committed; no need to ask.
- `main` is the release branch: merging or pushing there still needs an
  explicit ask.

## After a push: wait for the deploy, then say it is testable

A push to `dev` starts two INDEPENDENT things, and the useful one is not the
one people watch:

| | trigger | takes | where to read it |
|---|---|---|---|
| GitHub Actions CI | push to `dev` / `main` | ~3.5 min | `actions_list` / `get_job_logs` |
| Heroku deploy | push to `dev` | ~80 s | GitHub **Deployments** API |

The Heroku deploy is what makes a build testable, and it is **not gated on
CI** - it starts within ~20s of the push and finishes before CI does. A commit
whose CI went red still deployed (`eb3d344` deployed `success` at 11:13:32
while its CI failed at 11:15:24), so a live staging site is not evidence of a
green build, and both have to be reported.

Do not end a turn on "pushed". Wait for BOTH, then say so:

```sh
# Heroku: the deployment record, newest first, and its statuses
curl -s "https://api.github.com/repos/Morkalork/devend/deployments?per_page=1"
curl -s "https://api.github.com/repos/Morkalork/devend/deployments/<id>/statuses"
```

`state: success` on the newest deployment for the pushed SHA means staging is
live at the `environment_url` it carries
(`https://dev-end-staging-*.herokuapp.com/`). The site itself cannot be fetched
from this sandbox - the egress proxy refuses `herokuapp.com` - so the
deployment status is the authority, not a page load.

Report the SHA, the deploy state, and the CI conclusion. If either is still
running, wait rather than guessing; if the deploy succeeded but CI failed, say
exactly that, because the thing being tested is then a build with a known
failure in it.

## Github

- If working on an issue, always add a comment there with what you've done
- Don't ever add the "Co-authored-by" in the commit message
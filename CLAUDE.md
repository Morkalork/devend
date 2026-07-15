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
| Typecheck | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Run tests | `npm run test` |
| Watch tests | `npm run test:watch` |
| Android sync / open | `npm run android:sync` / `npm run android:open` |

Before committing, run **`npx tsc --noEmit`** and **`npm run test`**; both
should pass clean.

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

See **ARCHITECTURE.md** for the game design and data model, and **ANDROID.md**
for Capacitor/Play-Store packaging.

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

## Git

- Default working branch is `dev`; the release branch is `main`.
- Commit or push only when asked.

## Github

- If working on an issue, always add a comment there with what you've done
- Don't ever add the "Co-authored-by" in the commit message
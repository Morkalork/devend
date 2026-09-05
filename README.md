# Balls of Fire and Ice

A browser-based arcade game inspired by JezzBall. Draw fences to shrink the play area while avoiding bouncing balls.

**New to the codebase? Read [ARCHITECTURE.md](ARCHITECTURE.md) first** — it explains the screen flow, the hooks layer, the modifier pipeline and the canvas game loop, with a cookbook for common tasks (add a level, add an upgrade, tune scoring, …).

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS + framer-motion
- Fonts: Orbitron, JetBrains Mono, Space Grotesk
- No backend: content is YAML in `public/`, persistence is localStorage

## Local development

```sh
# Install dependencies
npm install

# Start dev server (localhost:8080)
npm run dev

# Type check (note: must use -b; bare `tsc --noEmit` is a no-op with project references)
npx tsc -b --noEmit

# Lint
npm run lint

# Unit tests
npm test

# Production build
npm run build
```

## Deployment (Heroku)

```sh
npm run build
npm start   # runs: node server/index.js
```

Requires Node 20.x (`"engines": {"node": "20.x"}` in `package.json`).

`server/index.js` serves `dist` (SPA fallback, hashed assets cached hard,
`map.yml` never cached) and adds one endpoint: `PUT /api/map`. It has no
dependencies - Node 20 has `http`, `fs` and `fetch`, and pulling in Express to
serve a folder and proxy one PUT would be more surface than the feature.

### Saving maps from the deployed builder

The map builder is reachable on the deployed build (tap the welcome ball ten
times), and its Save button used to have nowhere to write, so building a map
meant running locally and committing `public/map.yml` by hand every time.

`PUT /api/map` **commits the file to the repo** rather than writing it to disk.
Two reasons:

- A dyno's filesystem is ephemeral. A write would appear to work and vanish on
  the next restart or deploy, which is worse than refusing, because it looks
  like success.
- `map.yml` is the file every map test reads. The gap rule, the win-spec
  authoring guard, the mechanic spread and the bot sweep all guard the ladder in
  CI. A map edited down a path that skips them is a map nothing checks.

So a save pushes to `dev`, CI runs, Heroku redeploys, and the change is live in
about ninety seconds having been checked on the way.

| Config var | | |
|---|---|---|
| `GITHUB_TOKEN` | **required** | Fine-grained PAT, **Contents: read and write**, scoped to this repo only. Nothing else. |
| `MAP_EDIT_SECRET` | **required** | Any long random string. The builder asks for it on the first save and keeps it in `localStorage`. |
| `MAP_COMMIT_BRANCH` | `dev` | Where saves land. |
| `MAP_COMMIT_REPO` | `Morkalork/devend` | |
| `MAP_COMMIT_PATH` | `public/map.yml` | |

```sh
heroku config:set GITHUB_TOKEN=github_pat_... MAP_EDIT_SECRET="$(openssl rand -hex 24)"
```

With either of the first two unset the endpoint refuses every write and says
which one is missing - it never half-works. The secret is **never** in the
client bundle: the bundle is public, so a secret shipped in it would gate
nothing. It is compared in constant time, so it cannot be found a character at
a time by timing the reply.

> **The token is the thing to be careful with.** Anyone holding it can commit to
> the repo. Scope it to contents-write on this repo alone, and rotate it if the
> app is ever shared. `MAP_EDIT_SECRET` is what stops a player who finds the
> builder from using it; the token is what makes the commit.

> ⚠️ **Do not track binary assets (mp3s, images) with Git LFS.** Heroku deploys
> from a GitHub source tarball that contains LFS *pointer* files, not the real
> content, so LFS-tracked audio ships as 132-byte text and browsers reject it
> with `NotSupportedError` (music goes silent on the deployed site while local
> dev works). Keep `public/assets/**` as normal git blobs — there is
> intentionally no `*.mp3 filter=lfs` rule in `.gitattributes`.

---

## Admin / Playground mode

The Admin button appears on the welcome screen under two conditions:

| Environment | How to access |
|-------------|--------------|
| **Dev** (`npm run dev`) | Admin button is always visible |
| **Production** | Add `?admin=true` to the URL — e.g. `https://your-app.com/?admin=true` |

> **Note:** the deployed build DOES render these screens. Admin is on
> automatically in local dev; on the deployed build it is unlocked by a secret
> gesture (tap the welcome-screen ball ten times) - see `adminUnlocked` in
> `src/pages/Index.tsx`. This note used to say the screens never render in
> production, which stopped being true and matters: it is why `PUT /api/map`
> needs a secret rather than trusting that nobody can reach the builder.

From the Admin screen you can navigate to:
- **Map Builder** — visual map editor
- **Animation Test / Playground** — live modifier testing panel (all 15 `GameModifiers` adjustable in real time, apply and restart)

---

## Starting at a specific level

Append `?level=N` to the URL to start the game at level N:

```
http://localhost:8080/?level=5
```

The game starts immediately on page load, then strips the param from the URL. The level number corresponds to the `level:` field in `public/map.yml`.

When multiple map variants share the same level number (e.g. `level-2` and `level-2b`), one is picked at random each run. There is no URL param to force a specific map variant `id`.

### In-game level picker

After reaching a checkpoint, a `>` arrow appears next to the "Continue" button on the welcome screen. Clicking it opens a level picker that lets you start from any level up to your checkpoint.

---

## Map definitions

Maps are defined in `public/map.yml`. Each entry has:

- `id` — unique string (e.g. `level-3b`)
- `level` — integer level number (multiple maps can share a number as variants)
- Obstacle, ball, and modifier configuration

See `public/README-modifiers.md` for a full reference of all modifier keys, certificate effects, achievement stats, and map fields, and `public/LEVEL_CONSTRUCTION.md` for level-design guidance.

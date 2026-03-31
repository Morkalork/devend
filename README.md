# Balls of Fire and Ice

A browser-based arcade game inspired by JezzBall. Draw fences to shrink the play area while avoiding bouncing balls.

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS + framer-motion
- Fonts: Orbitron, JetBrains Mono, Space Grotesk

## Local development

```sh
# Install dependencies
npm install

# Start dev server (localhost:5173)
npm run dev

# Type check
npx tsc --noEmit

# Production build
npm run build
```

## Deployment (Heroku)

```sh
npm run build
npm start   # runs: serve -s dist -l $PORT
```

Requires Node 20.x (`"engines": {"node": "20.x"}` in `package.json`).

---

## Admin / Playground mode

The Admin button appears on the welcome screen under two conditions:

| Environment | How to access |
|-------------|--------------|
| **Dev** (`npm run dev`) | Admin button is always visible |
| **Production** | Add `?admin=true` to the URL — e.g. `https://your-app.com/?admin=true` |

> **Note:** The actual Admin and Playground screens are only rendered in dev builds (`import.meta.env.DEV`). The `?admin=true` param makes the button visible in production, but the screens themselves will not render in a production build.

From the Admin screen you can navigate to:
- **Map Builder** — visual map editor
- **Animation Test / Playground** — live modifier testing panel (all 15 `GameModifiers` adjustable in real time, apply and restart)

---

## Starting at a specific level

Append `?level=N` to the URL to start the game at level N:

```
http://localhost:5173/?level=5
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

See `public/README-modifiers.md` for a full reference of all modifier keys, certificate effects, achievement stats, and map fields.

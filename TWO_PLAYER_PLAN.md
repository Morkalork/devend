# TWO_PLAYER_PLAN.md

The plan for **Pair Programming**: two players, two phones, one board. Both
players see the same map and both can draw fences; every fence appears on both
phones. The two players sit next to each other.

Status: **BUILT**, all nine steps. The plan below is kept as written, with the
places the build departed from it marked **[CHANGED]** and the reason given: a
plan quietly edited to match what happened is a plan that never taught anybody
anything.

The investigation was made against commit `f85ded6`; where the doc says
"today" it means that commit, before any of this existed.

Seven departures, and the three that matter most were forced by tests rather
than noticed by reading:

1. **The resync has to REWIND, not paste.** The plan said a drifted guest
   adopts the host's motion "before the next tick". It cannot: by the time the
   snapshot lands the guest is several ticks past the one it describes, and
   pasting positions onto a later tick leaves the hashes still disagreeing,
   which is exactly what the first version did. The guest now rewinds to the
   host's tick and replays forward out of a retained command window.
2. **Positions are not the whole of the state.** The plan's snapshot carried
   balls and movers. Three things the simulation needs live outside the game
   state: the clock, the seeded streams' cursors and the region and wall id
   counters. Without the last of those the next split names a region the host
   has never heard of. `src/lib/net/simState.ts` gathers all three, and the
   same file explains why two simulations in one process have to take turns
   with them, which is a property of the test bench and not of two phones.
3. **The audit's list of six unseeded rolls was two short.** The scan written
   to guard the fix found `pickups.ts` choosing which ball turns rainbow and
   which ball a split forks from, both of which decide where balls are for the
   rest of a map. Written down in `determinism.test.ts`, which may only shrink.

The other four: the pairing QR became a LINK with a mailbox for the answer
rather than two scans (section 3 and step 5); step 8's room relay folded into
step 5 because it is the base flow's return path; the in-progress swipe stayed
local rather than becoming per-player state, because nothing in a tick reads
it; and the plugin is Java rather than Kotlin, because the Android project is
Java and adding the Kotlin Gradle plugin would have been a build change for
one file.

### The hardening pass

An audit of the shipped code, before any two phones had met, found ten things
that would have gone wrong. None of them could have been reproduced without two
devices and several would have read as "the mode is broken" rather than as a
bug, which is why they are listed rather than quietly fixed. All ten are closed
and pinned in `pairHardening.test.ts`.

Four would have broken the first session:

1. **Nearby elected two hosts.** The election read the partner's device id from
   a ref the hello had not filled yet, so on a first connect both phones read
   null and both concluded they were the host. The election now happens inside
   the handshake, after the id has arrived, and two identical ids are refused
   rather than tie-broken: it means a cloned install, and both devices would be
   player 0.
2. **Abilities bypassed the command layer.** Firing reached into the game state
   from the component that noticed the press, so an ability moved one board and
   not the other, which no snapshot can repair. There are now three ability
   commands, one per shape the game has, and the charge is spent where the
   command applies so both devices' mirrors of the run agree.
3. **The run synced once.** Enough for map one and wrong from map two: between
   maps the two phones walked their own shop, drafts and assignment screens and
   arrived at the next board with different upgrades. The host now publishes its
   run at every map start and the guest adopts it whole.
4. **Between-map decisions were not host-owned.** The guest could shop, answer
   the push prompt and spend a continue, settling questions about one run twice.
   The guest is now gated out of them, with a screen naming what the host is
   deciding. It blocks rather than mirrors, which is the honest first version:
   a read-only shop would mean teaching every screen a disabled mode.

Three would have shown up quickly:

5. **A stall banked time.** The accumulator filled while nothing drained it, so
   a two-second wait ran two hundred ticks in the frame the partner came back
   and every ball teleported. Held to one step during a stall.
6. **A sleeping phone stalled its partner for ever.** A locked screen stops
   sending and nothing about the socket says so. Twelve seconds of silence now
   ends the link, which is what lets the other player choose between pairing
   again and carrying on alone.
7. **Per-device unlocks fed the physics.** Certificates, achievements and
   loadout bonuses come from each phone's own storage and none of them travel in
   the run record, so two players with different unlocks computed different
   fence speeds from the first tick, on a board that looked identical. Both
   phones now declare a modifier hash at each map start and the map refuses to
   begin on a mismatch, because that is not drift and no snapshot carries it
   away.

And three rough edges: haptics fired for the partner's actions, a pair run filed
on the solo ladder where two players cutting twice as fast would have taken it
over within an evening, and Nearby could be raced into two connections.

### The relay, for public Wi-Fi  **[CHANGED]**

The first real test away from home failed at every cafe: the pairing link
opened, the answer reached the mailbox, and the two phones never connected.
Public Wi-Fi (cafes, hotels, offices, most guest networks) runs **client
isolation**: every device may reach the internet and none may reach another,
so the host candidates the direct link is built on (section 3) knock on
addresses that will not answer. The section-3 premise, "same network means the
phones can see each other", is true at home and false almost everywhere else.

Both phones CAN reach the server the game was loaded from, so that server now
carries the game when the direct link cannot:

- **`server/relay.js`**, a WebSocket relay on the same port as the site
  (`/api/relay/<room>?role=host|guest`). Heroku routes HTTP and its upgrade and
  nothing else, so TURN (UDP) cannot run on a dyno, and a hosted TURN service is
  billed by the gigabyte; a WebSocket on the dyno the game already runs on costs
  nothing extra. Zero dependencies, like the rest of the server: the handshake,
  masking, fragmentation, ping and close of RFC 6455 are about a hundred lines,
  and `ws` would have been the production server's first dependency. It
  forwards frames byte for byte and never parses a game message.
- **`src/lib/net/relay.ts`**, `RelayTransport`, the fourth implementation of
  the transport interface. The lockstep cannot tell it from the others.
- **The route choice.** Both phones take a relay seat in the room the QR names
  as soon as they know it, in parallel with the direct link. The HOST gives the
  direct link four seconds (`DIRECT_GRACE_MS`) once the answer is in, then
  settles on the relay; it says hello on the link it picked, and the guest
  answers on whichever link that hello arrived by. One side decides, so the two
  can never end up on different links. A relay that is unreachable (an older
  server, no WebSocket) leaves the direct link its full ten seconds, exactly the
  behaviour before the relay existed.
- **What it costs in play:** one extra trip to the server and back, which the
  adaptive input delay already absorbs (it reads the round trip from the same
  heartbeat), and a dependence on the dyno staying up for the run. A daily
  dyno restart or a deploy drops every live relay; the pair save and resume
  flow (step 6b) covers that the same way it covers a phone leaving Wi-Fi.
  Rooms live in memory, so the app must run on ONE web dyno.
- **Is the server awake?** An eco dyno sleeps after thirty idle minutes and
  takes several seconds to boot on the next request, which on this screen
  looked like the mode being broken. `/api/health` reports the process uptime;
  `src/lib/net/serverNap.ts` pings it when the 2-Player screen opens and reads
  a slow answer (over 1.5 s) or a young process (under 60 s) as a nap. The
  screen says so in a line, with a tap-and-hold explainer about the server's
  slippers. The ping is also what wakes it.
- **Admin:** "Force 2-Player relay" (the relay otherwise never runs at a desk,
  because the direct link wins at home) and "Server nap readout", which cycles
  the readout through each state. The desk rig serves the relay and the health
  check from `vite.config.ts`, as it does the mailbox.

Android is untouched: it pairs over Nearby Connections, which needs no network
at all, so client isolation never reaches it.

**The invitation as a link.** The QR has always been a link (step 5); the host
screen now also offers **Copy link** and, where the phone has a share sheet,
**Share link**, so the invitation can go through a message instead of a
camera. A link can be opened minutes later, so the host waits up to ten minutes
for an answer (`INVITE_WAIT_MS` in `webrtc.ts`, polling slower after the first
minute) and the relay holds a waiting seat as long (`RELAY_WAIT_MS`). The
"taking a while" hint starts when the partner answers, not when the code
appears, since waiting for somebody to open a message is not a slow link. The
two phones still need to be within reach of each other or of the relay: on
different networks, it is the relay that carries them.

### Where it all lives

| | |
|---|---|
| Sim clock | `src/lib/simClock.ts` |
| Commands | `src/lib/net/commands.ts` |
| Transport interface, in-memory pipe | `src/lib/net/transport.ts` |
| Lockstep | `src/lib/net/lockstep.ts` |
| Hashes and the resync snapshot | `src/lib/net/stateHash.ts`, `simState.ts` |
| WebRTC link, minimal SDP | `src/lib/net/webrtc.ts`, `sdp.ts` |
| Nearby link | `src/lib/net/nearby.ts`, `android/.../NearbyPlugin.java` |
| Device and pair identity | `src/lib/net/deviceId.ts` |
| The 2-Player screens | `src/components/game/PairLobby.tsx`, `PairDecision.tsx`, `PairLinkBanner.tsx` |
| The run and the pair save | `src/hooks/usePairSession.ts`, `usePairRunSave.ts` |
| The answer mailbox | `server/pairRooms.js`, and the same route in `vite.config.ts` |
| The public Wi-Fi relay | `server/relay.js`, `src/lib/net/relay.ts` |
| Is the server awake | `server/health.js`, `src/lib/net/serverNap.ts` |
| Admin | Pair Loopback, Nearby Diagnostics, Force 2-Player relay, Server nap readout |
| Tests | `determinism`, `commands`, `lockstep`, `pairing`, `pairRelay`, `serverNap` |

The question that prompted it: **can this be done without a server in the
middle?** Short answer, yes. The long answer is section 3.

**Decisions so far**, from review with the author:

- Players are on the same network, in the same room or at least the same
  location.
- This is a **mobile-only game**. The web build exists for development, the
  staging site and the desk rig, not as a player target.
- Pairing starts with one QR that is a link plus the answer mailbox on the
  existing server (step 5), because it is thirty lines and works everywhere.
- The end state on Android is **Google Nearby Connections** (step 9): both
  players open 2-Player, the phones find each other, one tap joins. No QR, no
  Wi-Fi network, no server at any point. The QR path stays for the web build.

---

## 1. The mode in one paragraph

Co-op, not versus. One run, one board, shared lives and shared score, exactly
the run one player would have, except there are two fingers on it. The host
phone starts the run and owns the between-map decisions (shop, push-your-luck,
continue); the guest phone is a second hand during the map. Each player's
fences carry their own accent colour, and each player can have one fence
growing at a time, so a pair cuts twice as fast and loses lives twice as
easily. The ladder is the same 18 maps; nothing about a map changes because
two people are on it. The point of the mode is the conversation across the
table ("you take the left half"), which is why the first version deliberately
does not add per-player scoring, roles or a rivalry.

A versus mode (same seed, two boards, race for the score) is the cheap cousin:
it needs only score sync, not shared state. It is listed in section 9 as not
this plan, because it is a different game and the ask was a shared board.

---

## 2. The architecture decision: lockstep, not state streaming

Two ways to keep two phones showing one board:

| | Deterministic lockstep | Host-authoritative streaming |
|---|---|---|
| What crosses the wire | Player **commands** only (a cut, a tap, a grab), stamped with the tick they apply on. Both phones run the full simulation. | The host runs the simulation and streams **state** (balls, fences, regions); the guest renders it and sends raw input. |
| Bandwidth | Under 1 KB/s. | 50-200 KB/s at a useful rate, plus a topology dump on every cut. |
| Needs the engine to be deterministic | Yes, completely. | No. |
| Needs the state to be serialisable | Only a small "motion" slice, for resync. | The whole render-relevant state, every frame. |
| Guest's own fence | Appears after the input delay (tens of ms). | Appears after a round trip unless predicted. |
| Free side effects | Replays (seed + command log), reproducible bug reports, a bot that plays from the same commands. | None. |

**Lockstep.** Streaming looks simpler until you look at what would have to be
serialised: `CanvasGameState` is a 734-line type with `Map<Polygon, ...>`
members keyed by object identity, a `Uint8Array` space grid, region polygons,
and dozens of absolute timestamps that mean nothing on another phone's clock.
A serialiser for that is a second, brittle copy of the state model, and it
buys nothing the engine cannot already give.

Lockstep asks for determinism, and the engine is most of the way there:

- The physics already runs on a **fixed step** (`PHYSICS_STEP = 1/120`,
  `src/lib/gameConstants.ts`) behind an accumulator, so a tick is a tick
  whatever the frame rate.
- Run randomness already goes through **named seeded streams**:
  `getRunRng(context)` for one-shot deals (board, shop, mutator, objective,
  tilt, slots, about two dozen contexts today) and `runStream(context)` for sequences
  during play (bug squash, rainbow spit), both in `src/lib/runRng.ts`. The
  Daily Stand-up mode arms one seed for everyone with
  `setRunSeedText(dailySeedText(key))`; a pair arms `coop:<room>` the same way.
- The **headless harness** (`src/lib/bot/headlessGame.ts`) already runs the
  entire engine on a virtual clock and a seed, thousands of ticks a second, and
  `harnessMatchesLoop.test.ts` pins it to the real loop. That harness is the
  proof that the engine tolerates a substituted clock, and it is the test rig
  for everything below: two sims, one command log, compare hashes.

What still breaks determinism, found by reading `useGameLoop.ts`,
`useGameInput.ts` and every `Math.random` / `performance.now` under `src/lib`:

### 2a. Wall clock inside the tick

The tick reads `performance.now()` in over fifty places (22 in `useGameLoop.ts`, the rest across `src/lib/physics`): fence growth
(`wall.startTime`), freeze and thaw (`frozenUntil`, `freezeReadyAt`), the
auto-freeze interval, cages, chains, boss phases, the breakpoint hold, the
frozen-ball release, ball effects, the lock glide, launcher dematerialise, the
dud stamp, `destructibles.ts:735`. Two phones have two clocks, so the same tick
would compute different elapsed times. The harness works around this by
monkeypatching `performance.now` (its `installClock`); the product form is a
**sim clock**: `game.nowMs`, advanced by `PHYSICS_STEP * 1000` per tick, read
by everything that stores or compares a timestamp on `game`. Render-only
timing (particle ages, the parallax, perf stats) stays on the wall clock, with
one rule: a timestamp that lives on `game` is sim time, and the renderer reads
`game.nowMs` when it compares against one.

### 2b. Unseeded rolls that touch gameplay

Six, and they are the whole list. Everything else random is cosmetic
(particles, debris, ball spin phase, gem pop velocity) and may stay random as
long as it never feeds physics.

| where | what it decides | fix |
|---|---|---|
| `useGameLoop.ts:339` | which ball Cron Job freezes | `runStream("autoFreeze")` |
| `initGame.ts:1060` | which ball Runtime Optimisation cripples | `getRunRng("slowOne:" + level.id)` |
| `physics/circuit.ts:68` | the direction a woken circuit ball leaves in | `runStream("wake:" + ball.id)` |
| `physics/charge.ts:112` | push direction when a ball sits exactly on a blast centre | `runStream("charge")` |
| `physics/phasing.ts:124` | same, for a phasing object | `runStream("phasing")` |
| `initGame.ts:116` | a ball's starting spin | cosmetic today; seed it anyway, it is one line |

### 2c. Input writes the state directly

Today a pointer handler mutates `game` on the spot: `handlePointerDown` sets
`game.swipeStart`, `handlePointerUp` pushes onto `game.activeWalls` with
`startTime: performance.now()`, a freeze tap stamps `frozenUntil` from the
wall clock, a mover grab writes `game.moverDrag`. There is one swipe slot, one
`swipePointerId`, and a second pointer cancels the first (the deliberate
second-finger cancel). None of that can be replayed on another phone.

Lockstep needs every player action to be a **command**: a small plain object,
stamped with a player and a tick, applied inside the tick by one function that
runs identically for a local and a remote command. The pointer handlers stop
being the place where fences are made and become the place where commands are
produced. This is the largest piece of work in the plan and the one with the
biggest payoff outside two-player: seed + command log is a replay.

### 2d. Two phones, two speeds

Lockstep runs tick T only when both players' commands for T are known. With an
input delay of D ticks (six ticks, 50 ms, is invisible in this game: a fence
takes seconds to grow), a command sent at tick T applies at T + D, and the
other phone has D ticks of slack to receive it. On a same-room link (RTT 2 to
30 ms) that is generous. When the remote is late the local sim waits, which is
a stutter, never a divergence. The slower phone sets the pace for both; a
phone that cannot run 120 physics ticks a second in single-player already
cannot, so this is not new.

### 2e. Floating point

Both Android phones run the same engine (the system WebView is Chromium, one
V8 per version), and V8's `Math.sin`, `cos`, `atan2`, `hypot` and `pow` are its
own fdlibm port, deterministic across same-version builds. Different WebView
versions on the two phones is the realistic risk. The guard is cheap: every 30
ticks each side hashes the motion state (ball positions, velocities and
states; mover rail offsets; active-wall endpoints; a checksum of the space
grid cells) and sends the hash; a mismatch triggers the resync in section 5,
step 4.

---

## 3. Without a server: yes, over WebRTC on the local network

Confirmed by the author: players are on the same network, in the same room or
at least the same location, and QR-code pairing is the intended flow. The
design below takes both as given; the room-code relay in step 8 stays
optional.

The only peer-to-peer channel a WebView can open to another phone is a
**WebRTC data channel**. Bluetooth is out: Web Bluetooth is central-only, a
web page cannot advertise as a peripheral, so two web layers cannot find each
other over it. A native Nearby Connections plugin (Google Play Services,
Bluetooth + Wi-Fi Direct, no network at all) works and needs no server, but it
is Kotlin work in a custom Capacitor plugin and it is Android-only. **[CHANGED]**
Since the game is mobile-only, Nearby is the chosen end state (step 9); WebRTC
is the first version and remains the path for the web build. The rest of this
section describes the WebRTC path.

The recipe, and where "no server" bends:

1. **Same network.** Both phones on the same Wi-Fi, or one phone's hotspot. With
   `iceServers: []` the peer connection gathers only host candidates (the phone's
   own LAN address). No STUN, no TURN, nothing outside the room. Two phones on
   mobile data cannot reach each other without STUN, and often not without
   TURN, and those are servers. Same room means same network in practice, and
   a hotspot always works: the host phone is the router, and Android hotspots
   do not isolate clients.

2. **Signalling by QR code.** WebRTC needs the two sides to swap one offer and
   one answer before the channel exists, and that swap is what a signalling
   server normally carries. Without one, the offer travels as a QR code.
   **[CHANGED]** The first draft had two in-app scans (host shows, guest scans,
   guest shows, host scans). After review the base flow is one QR that is a
   plain **link**: the guest scans it with the phone's own camera app, the
   link opens the game, and the answer travels back through a two-minute
   mailbox on the existing server (step 5). No in-app scanner on either side,
   nothing to install for the guest. The two-scan flow survives as the fully
   offline fallback. Either way, gather all ICE candidates before making the
   code (no trickle: wait for `icegatheringstatechange` to reach `complete`),
   and strip the SDP to what the other side needs to rebuild it (ice-ufrag,
   ice-pwd, DTLS fingerprint, the host candidates: about 200 bytes instead of
   the 1.5 KB of boilerplate), so the QR stays small and scans first time.

3. **Scanning needs the camera.** Chrome on Android ships `BarcodeDetector`
   built in, so no decoder library is needed there; the web build on other
   browsers falls back to `jsQR`. The Android manifest gains `CAMERA` (today
   it has only `INTERNET`). A useful side effect: Chromium hides LAN addresses
   behind mDNS `.local` names in ICE candidates **unless** the page holds a
   camera or microphone permission, in which case it exposes the real address.
   Both phones scan, so both hold the permission, so neither side depends on
   mDNS resolution working on that Wi-Fi. This is Chromium's documented rule;
   step 5 confirms it on the WebView before relying on it.

4. **What fails, and what to tell the player.** Guest Wi-Fi with client
   isolation (hotels, offices, cafes) blocks phone-to-phone traffic entirely.
   The pairing screen detects a connection that does not come up within ten
   seconds and says the one thing that fixes it: turn on a hotspot on either
   phone and join it with the other. A dropped channel cannot be revived
   without a new offer/answer swap, so a disconnect mid-map pauses both sides
   and offers a re-pair, and the host's run continues single-player if the
   guest does not come back.

**The relay, now the mailbox.** **[CHANGED]** Two QR scans is the truly
server-free version and remains the offline fallback. A room code ("tell your
friend: FENCE") is nicer, and needs somewhere to park an offer for a minute.
The production server already exists (`server/index.js`, zero dependencies,
serves the app and the map-save endpoint); a `/api/room` that stores an offer
under a four-letter code and hands back the answer is sixty lines of plain
HTTP, no WebSocket. It carries the two handshake messages and then nothing:
gameplay traffic is still phone to phone, never through Heroku. That is
"without a server in the middle" in the sense that matters. It requires both
phones to have internet at pairing time, which the QR path does not, so the
plan keeps QR as the base and the relay as step 8.

Numbers for the link:

| | |
|---|---|
| Physics tick | 120 Hz |
| Input delay | 6 ticks (50 ms) |
| Command size | 40 to 120 bytes JSON; a bent-fence path up to 2 KB once |
| Drag streams (mover, sling) | pointer position at 30 Hz, about 1 KB/s while held |
| Hash exchange | every 30 ticks, 16 bytes |
| Resync snapshot | balls + movers + active walls, 1 to 4 KB |
| Typical same-room RTT | 2 to 30 ms |

---

## 4. What already exists, and is reused rather than rebuilt

- **Fixed step and accumulator** in `useGameLoop.ts`; becomes the tick the
  scheduler drives.
- **`runRng.ts`**: `getRunRng` (fresh per context) and `runStream` (advancing
  per context), `setRunSeedText`. The pair seed is one more caller.
- **The daily-seed plumbing** in `useGameSession.ts` (arm a seed at run start,
  clear it at run end, restore it on resume): the pair run follows the same
  three hooks.
- **`headlessGame.ts` + `createBotGame`**: the determinism test bench. Two
  sims, one seed, one command list, compare hashes every tick. Its
  `installClock` monkeypatch is retired by step 1.
- **`harnessMatchesLoop.test.ts`**: the guard that the harness and the real
  loop tick the same things in the same order; it grows to cover the command
  drain.
- **`concurrentFenceLimit`** in `useGameInput.ts`: becomes per player.
- **`GameStateInfo`** (`GameCanvas.tsx`): the React mirror. Unchanged: both
  phones run the sim, so both have the numbers locally.
- **The Playground** (`src/components/admin/PlaygroundScreen.tsx`): home of the
  loopback rig in step 4.
- **`server/index.js`**: home of the optional room-code relay in step 8.

---

## 5. Build order

Each step lands green on its own, with the admin control that lets a tester
reach it, per CLAUDE.md. Steps 1 to 3 are worth shipping even if two-player
never follows: they turn every bug report into a replay.

### Step 1 - The sim clock  (M)

`game.nowMs`, advanced once per physics tick. Every `performance.now()` read
inside the tick, and every place that stamps a timestamp onto `game` from
input, reads it instead. The renderer reads `game.nowMs` wherever it compares
against a `game` timestamp (lock glide, freeze frost, fence growth easing) and
keeps the wall clock for its own effects. The harness's `installClock` goes
away; the harness sets `game.nowMs` like the loop does.

Test: `harnessMatchesLoop` still holds; a seeded headless run produces the
same final hash on two runs, one stepped with a 5 ms sleep between ticks,
which the monkeypatch made true by accident and this makes true by design.

Admin: nothing new; the existing bot sweep in the Playground is the control.

### Step 2 - Seed the six  (S)

The table in 2b. Plus a test, `determinism.test.ts`, that scans
`src/lib/physics/**`, `src/lib/initGame.ts` and `src/hooks/useGameLoop.ts`
for `Math.random(` and `performance.now(` and fails on any hit outside an
allowlist of cosmetic call sites with a reason each. The list may only shrink.

### Step 3 - Commands  (L)

`src/lib/net/commands.ts`: the command union and `applyCommand(game, cmd)`.

```
cut          { player, origin, direction, path?, fenceTypeId, regionId }
tapFreeze    { player, at }
tapRemove    { player, ballId }
slingGrab / slingRelease   { player, wallId, pull }
moverGrab / moverMove / moverRelease   { player, moverId, pointer }
abilityUse   { player, abilityId, target? }
selectFence  { player, fenceTypeId }
pushDecision { player, choice }          // host only
```

The pointer handlers keep all their refusal logic (captured start, wall in the
way, fence limit, breakable anchor) because a refused gesture should be
refused where the finger is, with the message the player sees today; what
changes is that the accepted gesture produces a command into `game.pending`
instead of mutating `game`. The loop drains `game.pending` at the top of each
tick, in tick order, then player order, and applies each through
`applyCommand`. In single-player the delay is zero ticks and nothing about
the feel changes.

Per-player swipe state: `game.swipes: Swipe[]` indexed by player, replacing
the single `swipeStart` / `swipePointerId` group; the second-finger cancel
becomes per player. `concurrentFenceLimit` is evaluated per player.

The headless harness's direct `activeWalls.push` (`headlessGame.ts:569`) goes
through `applyCommand` too, so the bot and a human make fences the same way,
and `harnessMatchesLoop` grows a check that the drain runs in both.

Admin: Playground **Record commands** toggle. While on, the command log for
the current map is kept and can be copied as JSON; **Replay** loads one and
plays it against the same seed. This is also the bug-report format from here
on.

### Step 4 - Lockstep and the loopback rig  (L)

`src/lib/net/transport.ts`: `Transport { send(msg), onMessage(cb), close() }`
with two implementations, `MemoryTransport` (two sims in one page, with
adjustable latency, jitter and loss) and, in step 5, `WebRtcTransport`.

`src/lib/net/lockstep.ts`: `LockstepSession`. Holds the local player's
commands for future ticks, sends them tagged with their tick, and releases
tick T to the loop only when both players' command sets for T have arrived
(an empty set is a message too, sent every tick so silence is never
ambiguous). Every 30 ticks it hashes the motion state and swaps hashes.

Resync, in three escalating steps, all visible in the admin rig:

1. Hash mismatch on motion only: the host sends its motion snapshot (balls,
   movers, active walls, `runStream` cursors) and the guest adopts it before
   the next tick. This corrects a one-ulp drift before a cut can turn it into
   a different region.
2. Topology hash mismatch (space grid or walls differ): the guest re-creates
   the map from the seed and replays the command log to the current tick. The
   harness does 7,200 ticks (a minute of play) in well under a second, so this
   is a hitch, not a wait. If the replay lands on the host's hash, play
   continues.
3. Still different: both phones restart the map from the same seed with a
   "lost sync" notice. Rare, visible, honest, and the run is intact.

Admin: Playground **Pair loopback**. Two `GameCanvas` instances side by side
in one page, connected through `MemoryTransport`, with sliders for latency
(0 to 500 ms), jitter and packet loss, a **Force desync** button that nudges
one ball on one side, and a readout of tick, hash agreement and resyncs. This
is the control that makes the mode testable on one desktop with no phones,
and it is the rig the tests run against.

### Step 5 - Pairing  (M)  **[CHANGED]**

The flow the author asked for, and the quickest one to build:

1. Player one taps **2-Player** on the welcome screen and gets a big QR code
   with **Cancel** under it. Nothing else on the screen.
2. Player two points the phone's camera app at it. The QR is a link to the
   deployed game with the pairing data in the URL fragment:
   `https://<host>/#pair=v1.<room>.<offer>`. The fragment never reaches any
   server. The link opens the web build in the browser, so the second player
   needs nothing installed; if the Android app is installed and the link is
   registered as an App Link, it opens there instead. Same code either way.
3. The guest's app reads the fragment, creates its peer connection, answers
   the offer and posts the answer to `PUT /api/room/<room>` on the server
   the game was loaded from. The host has been polling
   `GET /api/room/<room>` since it showed the code; it gets the answer,
   completes the connection, and both screens go to the map. Cancel stops the
   polling, closes the connection and deletes the room.

Why the answer needs a mailbox at all: the offer can ride in the link because
the guest is about to read the link. The answer has to reach the host, and
the host is not going to read anything the guest shows unless it scans it.
So the choice is one in-app scan on the host, or a mailbox. The mailbox wins
on the author's constraint that the guest only has to visit the link. The
mailbox is thirty lines on `server/index.js` (zero dependencies, already
serving the app and the map-save endpoint): an in-memory map from room to
answer, two-minute expiry, nothing persisted, nothing about the game in it.
It carries one message per pairing and is never on the path during play.
In the dev server the same route is a sibling of the `/api/map` plugin, which
is what makes the desk rig below work without a camera.

Offline fallback: when the mailbox is unreachable (no internet at the table),
the host screen offers **Scan their code instead**, the guest shows the
answer as a QR, and the host scans it once with the in-app scanner
(`BarcodeDetector`, `jsQR` fallback; `CAMERA` in the Android manifest). This
is the only place the camera appears, and only on the host.

The offer in the link is the minimal-SDP form from section 3: ice-ufrag,
ice-pwd, DTLS fingerprint, host candidates, around 200 bytes before base64.
The whole URL stays under 400 characters, a QR that scans first time from a
phone screen at arm's length. The room id is eight random characters from the
host; the guest's answer is accepted only once and only within two minutes.

Cross-build versions: the host may be the Android app and the guest the web
build, and the web build is always the newest. The hello message carries a
protocol version and the app's build hash; a mismatch shows "update the app"
on the older side rather than a desync ten seconds into the map.

A ten-second connect timeout after the answer arrives means the two phones
cannot reach each other on this network; the message names the hotspot fix.

Admin: the lobby is reachable from the Playground with the `MemoryTransport`
substituted, so the whole flow can be walked without a second device; the
Playground also shows the decoded contents of the QR the host is displaying.

### The desk rig: a phone and a computer  (part of steps 4 and 5)

The author's own test setup is one phone plus a computer running the game in
Chrome with DevTools device mode. It works, and it is worth designing for,
because it is the harshest realistic determinism test there is: an x86
desktop V8 against an ARM phone V8, almost always on different Chrome
versions. If the hashes agree across that pair for a full map, two phones
are easy. Basic IEEE 754 arithmetic is identical on both (V8 uses scalar
double ops on both architectures, and JavaScript forbids fused multiply-add),
and V8's transcendental functions are its own software port on both, so they
should agree; the hash readout is where that claim gets tested.

What is the same as two phones: same LAN, host candidates only, the fixed
tick, the input delay. DevTools device mode emits touch pointer events, and
each device has one finger in this mode, so its lack of independent
multi-touch does not matter. The computer's rate (60, 120 or 144 Hz) is
irrelevant to a fixed-step sim; the phone paces the pair.

What differs, and how each is handled:

1. **The phone loads the game from the dev server.** Vite already listens on
   every interface (`host: "::"` in `vite.config.ts`), so the phone opens
   `http://<computer LAN address>:5173` today. But a plain-http LAN origin is
   not a secure context, and `getUserMedia` refuses outside one, so the phone
   **cannot scan a QR** from that URL. `RTCPeerConnection` itself is not gated
   on a secure context in Chrome, so the data channel works; only the camera
   is out.
2. **So the dev server carries the answer.** The `/api/map` dev-only plugin in
   `vite.config.ts` gets a sibling, `/api/room`, the same mailbox step 5 puts
   on the production server. The computer hosts and shows its QR; the phone,
   already on the dev server's origin, scans it with the camera app and the
   link opens there. No camera permission on either side, since the guest
   never scans in-app.
3. **The camera on the computer.** With the staging site on both devices (an
   https origin, so both are secure contexts), the QR flow works at the desk
   too: the phone scans the laptop screen, the laptop webcam scans the phone.
   `BarcodeDetector` is not available in desktop Chrome on Windows or Linux,
   which is why step 5 carries the `jsQR` fallback.
4. **The computer's network interfaces.** A desktop gathers host candidates
   for every interface: Docker bridges, WSL, a VPN adapter. ICE tries them
   all and settles on the one that answers, at the cost of a second or two.
   A VPN that blocks LAN traffic breaks the link; the ten-second timeout
   message in step 5 names it next to the hotspot advice.
5. **A third option needs no phone at all.** Two Chrome windows on the
   computer (one normal, one incognito, or two profiles) pair with each other
   over a real `RTCPeerConnection` on the loopback interface. It complements
   the Playground rig in step 4: the in-memory transport exercises the
   lockstep logic with fake latency; two windows exercise the real WebRTC
   stack; the phone-plus-computer pair exercises cross-architecture
   determinism. Three rigs, each cheap, each answering a different question.

### Step 6 - The run around the map  (M)

The host owns run state. Before each map the host sends `runState` (level
index, owned upgrades, ability charges, fence slots, lives, score, ascension
depth) and the guest's `useGameSession` adopts it, so both compute the same
`activeModifiers` and both `getRunRng` contexts line up. Between maps the
guest sees the shop the host sees, read-only, with the host's selection
highlighted live; the push-your-luck prompt and the continue prompt are host
decisions carried as commands. Level-complete and game-over overlays render on
both from local state, since both have it.

Certificate Hours: both phones bank the run's hours, each into their own
meta-progression, and the run is flagged `pair` in the records so it lands on
its own ladder (`HIGHSCORES.md` keeps solo records honest by not mixing them).

### Step 6b - Saving and continuing a pair run  (S)

The run save already exists and already has the right shape. `useRunSave`
writes a `RunSave` at the start of every map (level sequence by id, level
index, score, upgrades, lives, continues, carries, door and capstone by id,
block stats) and the welcome screen offers Continue while one exists. Resume
granularity is one map, which is also the only granularity a pair can resume
at: the mid-map state is the thing this plan deliberately never serialises.

A pair save is that record plus a pair identity, kept on **both** phones under
its own key (`jezzball_pair_run_v1`), separate from the solo save so a pair
run never overwrites a solo one:

```
pair: { pairId, runId, seed, devices: [idA, idB], savedAt }
run:  RunSave          // the same object the solo Continue uses
```

**Binding it to the hardware.** A web page has no hardware identity (no
IMEI, no MAC, nothing that survives a data clear), so the binding is a
**device id** the app mints once and keeps: in the Android app,
`Device.getId()` from `@capacitor/device`, which is Android's own per-app
identifier and survives reinstalls of the same signed app; on the web, a
random UUID in `localStorage` (with `navigator.storage.persist()` requested,
so the browser is less inclined to evict it). Both phones send their device
id in the hello. `pairId` is a hash of the two ids in sorted order, so it is
the same pair whichever phone hosts next time. This is identity, not
security: nothing about a couch co-op run needs protecting from a forged id.

**On reconnect.** Both phones look up `pairId`. If either has a pair save,
it says so in the hello, with `runId` and `currentLevelIndex`. Then:

- both have the same `runId`: offer **Continue** and **New Game**. Highest
  `currentLevelIndex` wins if they differ (one phone was closed before the
  other's save landed); the phone that has it sends the full record.
- only one has it: that copy is offered. This is why the save is kept on both
  phones: one player clearing site data, or coming back on a different phone
  with the app reinstalled, does not lose the run.
- neither has one: straight to a new game.

The host decides; the guest sees the same two buttons greyed with "waiting
for your partner". Continue arms `coop:<seed>` and resumes at the start of
the saved map through the same path the solo Continue uses. New Game deletes
the pair save on both. The save is written by both phones at every map start
from the `runState` message in step 6, so the two copies cannot disagree by
more than one map. A pair run that ends (win, retire, loss) clears it, as the
solo save does.

The welcome screen's 2-Player button shows "Resume with <partner>" when a pair
save exists locally, so the choice is visible before anyone scans anything;
the actual decision still waits for the connection, because it needs both.

### Step 7 - Presentation  (M)

Second accent colour for the guest's fences and swipe trail; the other
player's finger as a small ring with their drag preview so a pair can see what
the other is about to do; "Fences: you 3, them 2" on the level-complete card
as the one per-player stat; the disconnect pause with re-pair or continue
solo; sound plays for both players' events on both phones (it already would,
since both sims run every event).

### Step 8 - Room codes  (folded into step 5)  **[CHANGED]**

The mailbox that step 8 proposed as an optional extra is the base flow's
return path, so it lands in step 5. What remains optional is a typed code as
an alternative to the QR ("tell your friend: FENCE"), which is the same
endpoint keyed by a shorter id.

### Step 9 - Nearby Connections, the Android end state  (L)  **[CHANGED]**

What the player sees: both open 2-Player. Each phone shows "Looking for your
partner" and, within a few seconds, the other phone's name. Tap it, and both
phones show the same four digits for a moment (Nearby's authentication
token, which doubles as the "yes, that is the phone across the table" check)
while the connection comes up. Then the Continue / New Game choice from step
6b, or straight to the map. No QR, no camera, no Wi-Fi network, no server, and
no host/guest choice: whoever's device id sorts lower hosts.

What it is: Google Play Services' Nearby Connections API, driven from a small
Capacitor plugin written for this app. Both phones advertise and discover at
once under one service id with the `P2P_POINT_TO_POINT` strategy, which starts
over Bluetooth and upgrades itself to Wi-Fi Direct or the shared LAN for
bandwidth. Payloads are reliable byte messages up to 32 KB, which is far
above anything the lockstep sends; the lockstep messages carry tick numbers,
so delivery order is not something the transport has to promise.

Once this exists, WebRTC and the mailbox are not used on Android at all. The
transport interface from step 4 gets its third implementation,
`NearbyTransport`, and the lockstep does not know which one it is on. The
plugin's web stub reports "unavailable", which is how the web build and the
desk rig keep the WebRTC path.

The plugin (`android/app/src/main/java/.../NearbyPlugin.kt`, one file):

```
startAdvertising(name)      startDiscovery()       stop()
connect(endpointId)         accept(endpointId)     disconnect()
send(bytes)
events: endpointFound, endpointLost, connectionInitiated(digits),
        connected, payload, disconnected
```

Permissions, which is the part that takes the time: Android 12 and up need
`BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN`; Android 13
adds `NEARBY_WIFI_DEVICES`; Android 11 and below need
`ACCESS_FINE_LOCATION` with location services switched on, which is the one
prompt that surprises people, so the 2-Player screen explains it before the
system dialog appears. Plus `play-services-nearby` in the Gradle
dependencies. The plugin exposes `permissionState()` so the app can show
which one is missing instead of a silent "nobody found".

Input delay: the Bluetooth phase before the bandwidth upgrade has a higher
round trip than Wi-Fi (tens of ms, occasionally over a hundred). The lockstep
measures the round trip continuously and sets the input delay from it,
clamped between 6 ticks (50 ms) and 24 ticks (200 ms). A fence takes seconds
to grow, so even the top of that range reads as a slight lag on the start of
a cut, not as a broken game, and the upgrade normally lands within seconds.

Reconnect: Nearby reports a disconnect promptly. The map pauses on both
phones with "Reconnecting", discovery restarts, and the same partner reconnects
without a tap. After thirty seconds the host may continue solo; the pair save
from step 6b holds the run for next time either way.

The pair identity from step 6b is unchanged: the advertised name carries the
device id, so `pairId` is computed the same way it is over WebRTC.

Testing: Nearby does not work in the emulator (no Bluetooth), so this step is
the one that needs two physical phones from the start. Everything above the
transport is already tested by the Playground rig, so what two phones test is
the plugin and the permissions. Admin gets a **Nearby diagnostics** panel:
permission states, advertising and discovery state, endpoints seen with
signal, the connection's medium (Bluetooth or Wi-Fi) and measured round trip.
"Did not find anyone" and "does not work" look the same from the outside,
which is exactly the case the CLAUDE.md rule is about.

---

## 6. Things most likely to go wrong

- **A future `Math.random` or `performance.now` inside the tick.** The most
  likely regression, because it is the natural thing to type. The
  `determinism.test.ts` scan from step 2 is the fence; the loopback rig's hash
  readout is the tell.
- **React state that feeds the sim differing between phones.** `activeModifiers`
  is computed from the owned-upgrade list, fence slots, ability charges and
  certificate bonuses. Step 6 syncs the run state, but a per-phone setting that
  leaks into the sim (a Playground knob left on, an options toggle) would
  diverge silently. The hash catches it; the fix is to hash the modifier set
  once at map start too, and refuse to start on a mismatch with a message that
  names the field.
- **Nearby's permission maze.** The permission set differs by Android version
  and the location prompt on older phones reads as unrelated to a game. The
  diagnostics panel in step 9 and an explainer before the system dialog are
  the mitigations; the mailbox path stays as the fallback when a phone
  refuses.
- **Mixed devices disagreeing.** A desktop and a phone are the most likely
  pair to differ in Chrome version, and therefore the most likely to trip the
  hash. Treat the first desk-rig session as a determinism audit, not a
  playtest: any mismatch there is a bug in the engine's determinism, not in
  the phone.
- **mDNS on the guest Wi-Fi.** Covered in section 3 and gated by the step 5
  spike. The hotspot message is the safety net.
- **The slower phone.** Lockstep runs at the pace of the slower sim. On a phone
  that already drops below 120 ticks the co-op stutters for both. Acceptable
  for a first version; the fix, if needed, is a lower shared tick rate for
  pair runs, which the fixed-step design makes a one-constant change.
- **Cosmetic randomness that turns out not to be cosmetic.** Debris from a
  broken block, gems popping out of a chest: today they use `Math.random` and
  the plan leaves them unseeded. If any of them ever collides with a ball, the
  hash finds it on the first map with a breakable. The scan's allowlist is
  where the claim "this is cosmetic" is written down.
- **The command log getting big.** A bent fence carries a sampled path (up to
  256 points). Replays of long maps are still tens of KB. Fine.
- **Pointer semantics that were global.** `pointerleave` ends the swipe;
  the hold-to-explain timer; the ability target tap. Each is per player now,
  and the guest's explainer modals are local (they do not need to be
  commands). Worth a checklist pass through `useGameInput.ts` in step 3.

---

## 7. What it costs

Rough sizes, in the plan's own units: S is a session, M a few, L a week of
sessions.

| step | size | worth doing alone? |
|---|---|---|
| 1 sim clock | M | yes: retires the harness monkeypatch |
| 2 seed the six | S | yes: seeded runs become fully seeded |
| 3 commands | L | yes: replays and reproducible bug reports |
| 4 lockstep + loopback rig | L | no |
| 5 pairing, with the answer mailbox | M | no |
| 6 run sync | M | no |
| 6b pair save and continue | S | no |
| 7 presentation | M | no |
| 8 typed room codes | S, optional | no |
| 9 Nearby Connections plugin | L | no |

---

## 8. Open decisions for the author

- **Guest's shop.** Read-only mirror (proposed) or a veto/suggest button? The
  mirror keeps the host as the single owner of run state, which is what makes
  step 6 small.
- **Per-player fence limit** (proposed: each player gets the solo limit) or a
  shared pool (the pair gets the solo limit between them)? Per player is a
  pair cutting twice as fast, which is the fun; the maps' par values will read
  low for pairs, and the pair ladder absorbs that.
- **Records.** A separate pair ladder (proposed) keeps solo records
  comparable. The alternative, no records for pair runs, is simpler and
  probably fine for a first version.

---

## 9. What this does NOT include

- **Versus / race.** Same seed, separate boards, only scores exchanged; a
  fifth of the work of this plan and a different game.
- **More than two players.** Lockstep generalises; the QR pairing does not.
- **Internet play.** The relay (above) would technically carry two phones in
  different cities, but the pairing still starts with a QR held up to the
  other phone, and the input delay is tuned for the same room. Playing apart
  would need a way to invite without a camera and a delay tuned for 100 ms
  round trips.
- **Spectating, or a phone as a second screen.**
- **iOS.** WKWebView has WebRTC and would work the same way; there is no iOS
  build to put it in. Nearby Connections has no iOS counterpart in the same
  API, so an iOS build would keep the WebRTC path.
- **A web build for players.** The game is mobile-only; the web build's job is
  development, the staging site and the desk rig, so the WebRTC path is kept
  working for those and not polished beyond them.

# TWO_PLAYER_PLAN.md

The plan for **Pair Programming**: two players, two phones, one board. Both
players see the same map and both can draw fences; every fence appears on both
phones. The two players sit next to each other.

Status: **PROPOSED**, nothing built. This is an investigation of the engine as
it stands (commit `f85ded6`) and a build order that gets to a shippable mode.
Where the doc says "today", it means that commit.

The question that prompted it: **can this be done without a server in the
middle?** Short answer, yes. The long answer is section 3.

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
Bluetooth + Wi-Fi Direct, no network at all) would work and needs no server,
but it is Kotlin work in a custom Capacitor plugin and it is Android-only,
which leaves the web build with nothing. WebRTC works in both builds.

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
   server normally carries. Without one, the offer travels as a QR code. Host
   shows a code, guest scans it, guest shows a code, host scans it, connected.
   Two scans, once per session. Gather all ICE candidates before making the
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

**The optional relay.** Two QR scans is the truly server-free version and it is
fine for a mode two friends set up once an evening. A room code ("tell your
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

### Step 5 - Pairing  (M)

A `pairLobby` screen off the welcome menu ("Pair Programming"). Host taps
Host, gets a QR; guest taps Join, scans, shows the answer QR; host scans;
both see "Connected" with the other phone's name and a latency figure. The
minimal-SDP encode/decode from section 3; `BarcodeDetector` with `jsQR`
fallback; `CAMERA` in the Android manifest and the Capacitor permission
prompt. A ten-second connect timeout that names the hotspot fix.

The spike that gates the step: two real phones, one home Wi-Fi, one hotspot,
one office network. Confirm the mDNS-vs-camera-permission behaviour on the
WebView. If the WebView does not expose real addresses with the permission,
the fallback is a candidate filter that keeps only IPv4 host candidates and a
note that the mode needs mDNS-capable Wi-Fi or a hotspot.

Admin: the lobby is reachable from the Playground with the `MemoryTransport`
substituted, so the whole flow can be walked without a camera.

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
2. **So the dev server does the signalling.** The `/api/map` dev-only plugin in
   `vite.config.ts` gets a sibling, `/api/room`: park an offer under a code,
   fetch it, post the answer, poll. The computer hosts, the phone taps Join
   and types the four-letter code (or the lobby offers "join the host on this
   server", since there is exactly one). No camera on either side. This is
   step 8's relay written early in dev-only form, so step 8 is later a move
   into `server/index.js` rather than new code. In the lobby it appears as a
   third pairing option, shown only when the origin has the endpoint.
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

### Step 7 - Presentation  (M)

Second accent colour for the guest's fences and swipe trail; the other
player's finger as a small ring with their drag preview so a pair can see what
the other is about to do; "Fences: you 3, them 2" on the level-complete card
as the one per-player stat; the disconnect pause with re-pair or continue
solo; sound plays for both players' events on both phones (it already would,
since both sims run every event).

### Step 8 - Room codes  (S, optional)

The dev-only `/api/room` from the desk rig, moved onto the production server.
`/api/room` on `server/index.js`: POST an offer, get a four-letter code; the
guest GETs it and POSTs an answer; the host polls for the answer. Entries
expire after two minutes and hold nothing but SDP. The lobby offers "Show
code" next to "Show QR". Gameplay traffic never touches it.

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
| 5 pairing | M | no |
| 6 run sync | M | no |
| 7 presentation | M | no |
| 8 room codes | S | no |

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
- **Internet play.** Needs STUN at minimum and TURN in practice, which are
  servers, and an input delay tuned for 100 ms round trips.
- **Spectating, or a phone as a second screen.**
- **iOS.** WKWebView has WebRTC and would work the same way; there is no iOS
  build to put it in.

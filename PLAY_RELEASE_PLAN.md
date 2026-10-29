# Play Store: the first release (an invite-only beta)

The goal: a closed-testing build on Google Play that a handful of invited
players install from the Play Store, and that works on every phone they own.
This page is the checklist, the decisions (made and still open), and the
drafts (privacy policy, Data safety answers, listing copy) the Play Console
asks for.
ANDROID.md covers the Capacitor project itself.

"Invite only" maps to Play's **closed testing** track: an email list or a
Google Group of testers, an opt-in link, and installs from the real Play
Store, reviewed by Google like any release. (Internal testing is faster and
unreviewed but capped at 100 testers and meant for the team; it is a good
place for the very first upload, see step 5.)

## 1. Where it stands

| | state |
|---|---|
| App id `com.morkalork.devend`, name `Dev/End` | set (the id is permanent once uploaded) |
| Target SDK 36, min SDK 24 | meets Play's current target-API rule |
| Signed release bundle (.aab) | **workflow ready** (`.github/workflows/android-release.yml`); needs the upload key and the analytics key as secrets |
| Version code / name | passed to the build by the workflow; must rise every upload |
| 16 KB page sizes | checked on every release build (`scripts/check-16kb.mjs`) |
| Release manifest | checked: not debuggable, no Test Lab launch, right version |
| Android 15+ edge-to-edge | fixed in code (the HUD no longer goes under the status/gesture bars); **not yet seen on a 15+ phone** |
| App icon, 512 store icon, 1024x500 feature graphic | done (`assets/`, `assets/play/`) |
| Phone screenshots (2-8) | to do: section 6 |
| Privacy policy page | drafted below; needs a permanent public URL |
| Analytics and crash reports | **on for the beta** (decided 2026-10-29); a signed build refuses to go without the key and checks it is in the bundle |
| Admin (ten taps on the menu ball) | **kept for the beta** (decided 2026-10-29); decide again before production |
| Data safety answers | final for analytics on (section 4); PostHog stores no IP and derives no location (section 2, step 3) |
| Content rating (IARC) | answers drafted below |
| Music licence | every shipped track credited (Pixabay); the uncredited maps_36-40.ogg removed (it never played in a run); new music for it to come from the owner |

## 2. What only the owner can do

1. **Play Console account: done.** Personal account "Morkalork" (developer
   account id 5892458869560659629), created before November 2023, so the
   rule that new personal accounts must run a 12-tester, 14-day closed test
   before production does **not** apply: the beta can have as many or as few
   testers as wanted, and production is open whenever it is ready.
2. **Upload key.** Made once, on your own computer, kept forever. Never paste
   the file or its passwords into a chat, an issue or a commit.
   1. *Make the key.* `keytool` comes with Android Studio. On Windows, in
      PowerShell, from a folder outside the repo (e.g. `Documents`):
      ```powershell
      & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkey -v `
        -keystore devend-upload.keystore -alias devend -keyalg RSA -keysize 2048 -validity 10000
      ```
      (macOS/Linux: `keytool -genkey -v -keystore devend-upload.keystore
      -alias devend -keyalg RSA -keysize 2048 -validity 10000`.) It asks for a
      keystore password, then name and organisation questions (any honest
      answers; they are not shown to players), then "Is this correct?": type
      `yes`. If it asks for a separate key password, press Enter to reuse the
      keystore password.
   2. *Back it up now:* `devend-upload.keystore` and its password into a
      password manager or another safe place. Lost, the key can be reset
      through Play support (Play App Signing holds the real signing key),
      but that takes days.
   3. *Turn it into text for GitHub.* Windows PowerShell, same folder:
      ```powershell
      [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\devend-upload.keystore")) | Set-Clipboard
      ```
      (macOS: `base64 -i devend-upload.keystore | pbcopy`; Linux:
      `base64 -w0 devend-upload.keystore`.) The key is now on the clipboard
      as one long line of text.
   4. *Add the secrets.* <https://github.com/Morkalork/devend/settings/secrets/actions>
      (repository > Settings > Secrets and variables > Actions) > **New
      repository secret**, once for each:

      | Name | Secret |
      |---|---|
      | `ANDROID_KEYSTORE_BASE64` | paste the clipboard (step 3) |
      | `ANDROID_KEYSTORE_PASSWORD` | the password from step 1 |
      | `ANDROID_KEY_ALIAS` | `devend` |
      | `ANDROID_KEY_PASSWORD` | the same password (unless you gave the key its own) |

      GitHub never shows a secret again once saved; a wrong one is fixed by
      saving it again under the same name.
3. **Analytics key and IP setting.**
   - Add a fifth repository secret, `POSTHOG_KEY`: the same project key the
     staging site uses (Heroku config var `VITE_POSTHOG_KEY`), or a separate
     PostHog project for the app if its numbers should stay apart from the
     web's. A signed build fails without it.
   - In PostHog, Project settings > Privacy: **Discard client IP data** on
     (done 2026-10-29, with the organisation default on for new projects),
     so no IP address is stored. That setting alone still lets PostHog's
     GeoIP step derive a city and country from the IP before dropping it, so
     the app also sends `$geoip_disable` with every event
     (`src/lib/analytics.ts`), and no location is derived at all.
4. **Merge `dev` into `main`: done** (2026-10-29, `main` at `25de74d`), so
   the workflow's "Run workflow" button exists. Bring `main` up to date
   again before each release build: the button builds what is on the branch
   it is run from.
5. **Run the workflow** (Actions > Android release > Run workflow) with a
   versionName, e.g. `0.9.0-beta.1`. Download the `.aab` artifact.
6. **First upload by hand** (the Play API cannot create an app's first
   release): Play Console > Create app (Game, Free) > Testing > Internal
   testing > upload the .aab, add yourself, install from the opt-in link,
   run section 7's checks. Then promote the same bundle to Closed testing,
   add the testers' list or Google Group, fill the listing (section 5) and
   submit for review.
7. **Answers to the open decisions** in section 3.

## 3. Decisions

1. **Analytics and crash reports in the beta: YES** (decided 2026-10-29).
   Anonymous gameplay events and uncaught errors go to PostHog (EU cloud)
   from every signed build (`POSTHOG_KEY`). The Data safety form declares it
   (section 4) and the privacy policy keeps its analytics paragraph.
   Before production: PostHog keeps a random install id on the phone, and
   under EU ePrivacy rules storing an identifier for analytics normally needs
   consent. Invited testers can be told in the opt-in invitation; a public
   release should have a "share anonymous usage data" switch in Options (or
   PostHog in memory-only mode, which keeps no id between launches).
2. **Admin in Play builds: KEPT for the beta** (decided 2026-10-29). Off on a
   Play install, opened by ten taps on the menu ball (`adminAccess.ts`,
   Index). It carries the device check and the touch trace, which is why it
   stays; it also carries the Playground, infinite lives and map editing,
   which a tester could find. Decide again before production.
3. **maps_36-40.ogg: REMOVED** (2026-10-29). Its source was never recorded,
   so it is out of every build; the ladder's 29 maps never reached its band,
   so only the Jukebox lost a track. The owner is finding new music; it goes
   in with its full credit in `public/music.yml` (the catalogue test now
   allows no uncredited track at all).
4. **Where the privacy policy lives.** Play needs a public URL that stays up.
   Options: a production web host (is there one besides staging?), GitHub
   Pages, or the staging host (works, but tied to staging staying up).
   Once chosen, the draft below becomes `public/privacy.html`.
5. **Audience.** Recommended: target age **13+**, no ads, no in-app purchases.
   Including under-13s brings in the Families policy and its extra review.
6. **Contact email** for the listing (public, required).

## 4. Data safety (answers, analytics on)

What the app does with data, checked in code:

- Progress, settings, run history and highscores stay **on the phone**
  (localStorage in the WebView). There are no accounts and no online
  leaderboards; the share card is an image the player shares themselves.
- **Two-player** pairs over Nearby Connections (Bluetooth and Wi-Fi Direct,
  phone to phone, no server). The name each phone advertises is "Player".
  Location permission is requested only on Android 11 and below, where
  Bluetooth discovery requires it, and it is never read.
- **Analytics:** anonymous gameplay events (run started, map cleared or
  failed, upgrade bought, offer picked, run ended) and uncaught errors, to
  PostHog's EU cloud, with the browser-level device details PostHog attaches
  (OS, screen size, WebView version). No accounts, no names, no identifiers
  the player gives, no autocapture, no session recording. The client IP is
  discarded and no location is derived from it (section 2, step 3).

Answers:

| Play's question | answer |
|---|---|
| Does the app collect or share user data? | Yes |
| Encrypted in transit? | Yes (HTTPS) |
| Can users request deletion? | Data is anonymous and not linked to a user; say so in the policy |
| App activity > App interactions | Collected; not shared; purpose: analytics; processed ephemerally: no; required: yes (no in-app opt-out yet) |
| App info and performance > Crash logs, Diagnostics | Collected, not shared, analytics |
| Device or other IDs | Collected (PostHog's anonymous install id), analytics |
| Location, Personal info, Financial, Messages, Photos, Contacts | Not collected (no IP stored, no GeoIP: section 2, step 3) |

### Privacy policy (text for `public/privacy.html`, once decision 4 is made)

> **Dev/End privacy policy**
>
> Dev/End is a game. It has no accounts and asks for no personal
> information.
>
> **On your phone.** Your progress, settings, run history and records are
> stored on your device only. Uninstalling the app deletes them.
>
> **Two-player.** Pair Programming connects two phones directly over
> Bluetooth and Wi-Fi (Google Nearby Connections). Nothing goes through a
> server. On Android 11 and below, Android requires the location permission
> for Bluetooth discovery; the game never reads your location.
>
> **Anonymous analytics.** To find bugs and see how the game is played, the
> app sends anonymous gameplay events (such as a run starting or a map being
> cleared) and error reports to PostHog, hosted in the EU. They carry a
> random identifier for the installation, not your name, email or any
> account. We do not sell or share this data, and do not use it for
> advertising.
>
> **Children.** The game is not directed at children under 13.
>
> **Contact.** [contact email]. Last updated [date].

### Content rating (IARC questionnaire, draft answers)

Category: Game. Violence: none (balls are sealed in or burst; no characters,
no blood). Fear, sex, nudity, crude humour, drugs, alcohol, tobacco: none.
Language: none. Gambling: **no**. Sprint Planning deals a "gamble" card: a
price in the run (a life, hours) for a strong upgrade. Which prize is on the
card is drawn when the cards are dealt (the jackpot is 5% of deals), but the
player sees the exact price and prize before choosing, nothing is rolled
after paying, and there is no money and nothing of value outside the game. It
is not casino-style simulated gambling.
Users interacting or exchanging content: no (two-player is a shared board
between two phones in the same room, no chat). Shares location: no. Digital
purchases: no. Expected rating: PEGI 3 / Everyone.

## 5. Store listing (drafts)

- **Name:** Dev/End
- **Short description (80):** Slice the board, trap the bugs, ship before the deadline.
- **Full description:**

  > Dev/End is a fence-drawing arcade puzzler with a developer's sense of
  > humour. Swipe to build a fence across the board; seal the bouncing balls
  > into ever smaller pockets and claim the ground they leave behind. One ball
  > through a fence still being built and it breaks.
  >
  > - 29 maps across an escalating ladder: moving blocks, breakables, portals,
  >   gravity that turns the board, bombs that blast it open.
  > - A run, not a level select: spend your hours in the store between maps
  >   on upgrades, certificates and fence types, and plan each run's
  >   Specialisation.
  > - The Daily Stand-up: the same seeded run for everyone, once a day.
  > - Pair Programming: two phones, one board, taking turns, over Bluetooth
  >   with no account and no internet.
  > - A real 3D board with lights and shadows, and a 2D mode for older phones.
  >
  > No ads. No in-app purchases. Plays offline.

  (Checked against the code on 2026-10-27: 29 maps in public/map.yml.
  Re-check before submitting.)
- **Category:** Game > Puzzle. **Tags:** arcade, puzzle, casual.
- **Graphics:** `assets/play/icon-512.png`, `assets/play/feature-graphic.png`,
  phone screenshots (section 6).

## 6. Screenshots

Play wants 2 to 8 phone screenshots, 16:9 or 9:16, each side 320-3840 px.
Best from a real phone (the 3D board looks its best on a GPU): the menu, a
map mid-fence, a captured board, the store, Sprint Planning, two-player.
They can also be produced from a headless browser at 1080x1920 on request.

## 7. Before every release: on real phones

From the Play internal track, not a sideloaded APK:

- [ ] **Android 15 or 16 phone:** the top bar and the bottom controls are
      fully clear of the status bar, camera cutout and gesture bar; the bars
      show light icons on the dark background.
- [ ] An Android 12-14 phone, and the oldest/slowest available (the device
      lab covers 2022 phones; DEVICE_LAB.md).
- [ ] First launch: splash, menu music starts, language follows the phone.
- [ ] Back button on every screen: in play it opens the pause menu, on the
      menu it leaves the app, never a blank page.
- [ ] Home and back into the app mid-map: the map is paused, not lost.
- [ ] A fence drawn slowly, quickly, and with a press-and-hold first.
- [ ] Two-player on two phones: permission prompts (Android 12+ and 11-),
      pairing, a full map, one phone leaving.
- [ ] Airplane mode: everything except two-player discovery works.
- [ ] **Progress survives an update:** play on beta N, install beta N+1 over
      it, the run and the records are still there.
- [ ] Play Console > Pre-launch report for the build: no crashes, no ANRs.

## 8. After the beta

- Production needs: decision 2 settled again, an analytics consent switch or memory-only mode
  (decision 1), the privacy policy final, a production listing.
- Optional: upload to Play from the workflow (a service account and the
  Play Developer API), once the first upload has been made by hand.

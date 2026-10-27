# Device lab: does it work on a four-year-old phone?

Asked for as "I need to know that it works on phones as old as four years."
Three layers answer it. They all run the same in-app **device check**, and
each tests something the others cannot.

| Layer | Where | When | What it can tell |
|---|---|---|---|
| **Device check** | in the app (Admin > Device check) | by hand, on any phone in front of you | everything below, on that exact phone and browser |
| **Emulated tiers** | CI (`ci.yml`, job `device-check`) | every push | boot, menu and boards visible, fences taken, no errors, on 2022 phone screens with the CPU slowed to their class |
| **Device lab** | Firebase Test Lab (`device-lab.yml`) | nightly, by hand, or a push that asks | the same, plus the real frame rate, on real 2022 phones with their own GPUs and drivers |

The emulated tiers cannot judge frame rate. Chromium there draws WebGL on a
software GPU, at about two frames a second on any CPU, so the rate is reported
but never judged. Nor can they find a GPU-driver bug like the one Opera hit on
a PowerVR phone, where the whole menu was drawn and none of it was shown. Only
real hardware shows those, which is what the device lab is for.

## The device check

`src/lib/deviceCheck/` and `src/components/admin/DeviceCheckScreen.tsx`.

1. **The menu.** Once it has loaded and the splash is gone, the interface
   canvas is drawn and its pixels are read back. A menu that draws nothing
   visible fails.
2. **Four maps, light to heavy** (`DEVICE_CHECK_LEVELS` in `model.ts`): one
   ball (1); 22 obstacles (6); moving obstacles and three balls (9); four balls
   (27). None of them is a launcher map, because those wait for the player's
   pull and would measure the wait.

   Each map is the real board (GameScreen, as the Playground mounts it), not
   the headless bot. Per map, the check:
   - lets it settle for 3s, then reads the board's pixels back right after the
     game loop renders (`boardFrameHook.ts`);
   - draws a fence across it with touch events, through the board's real input
     path;
   - measures 12s of frames.
3. **The verdict** (`verdict` in `model.ts`). It fails on:
   - a boot over 20s;
   - an invisible menu or board;
   - a map that did not load;
   - a fence not taken;
   - a median frame slower than 20 fps;
   - any error on the page.

   It warns when a quarter of the frames are slower than 30 fps. The report
   also lists the renderer's quality steps and any shader error from that run.

It starts three ways, all through `launch.ts`:

- **Admin > Device check.** It goes back to the menu first, so the menu it
  measures is the player's.
- **`window.__devendStartDeviceCheck({ judgeFrames })`**, the hook the CI tiers
  call; the result appears on `window.__devendDeviceCheck`.
- **A Firebase Test Lab launch of the APK.** Test Lab sends a `TEST_LOOP`
  intent, `TestLoopPlugin.java` tells the web layer, and the check runs. Its
  report is written to Test Lab's results file and logcat, and then the app
  closes.

## Running it on real phones (one-time setup)

Firebase Test Lab is Google's lab of real phones. The free (Spark) plan runs
five physical-device tests a day, which is why the nightly run uses four.

1. **Make a Firebase project.** Go to https://console.firebase.google.com and
   use "Add project". Any name will do (say `devend-lab`); Analytics is not
   needed. Open **Test Lab** in its menu once, which switches it on.
2. **Turn on the APIs.** In https://console.cloud.google.com, with the same
   project selected, enable the **Cloud Testing API** and the **Cloud Tool
   Results API** (APIs & Services > Library).
3. **Make a service account** for GitHub. In IAM & Admin > Service Accounts >
   Create:
   - name: `github-device-lab`;
   - roles: **Firebase Test Lab Admin** and **Editor** (Basic > Editor).
     Editor because of where Test Lab keeps its files. The run uploads the
     APK into Test Lab's default bucket (`test-lab-*`) and reads the results
     back from it, and that bucket is not in your project: it sits in a
     project Google owns, and its access list admits your project's Editors.
     So no storage role on your own project reaches it; both Storage Object
     Viewer and Storage Object Admin were refused with
     `storage.objects.create` denied. (Pointing Test Lab at a bucket in your
     own project instead needs billing on the project, the paid Blaze plan.)
     Editor can change anything in the project, which is one more reason the
     key lives only in the GitHub secret, and a reason to keep the lab in a
     project of its own if the project also holds something that matters.

   Then open it, go to Keys > Add key > JSON, and keep the file that downloads.
4. **Add two repository secrets** in GitHub: the repository's Settings >
   Secrets and variables > Actions > New repository secret.
   - `GCP_SA_KEY`: the whole JSON file's contents.
   - `GCP_PROJECT_ID`: the project id (shown on the Firebase project's
     settings page, for example `devend-lab-1a2b3`).
5. **Run it.**
   - Once `device-lab.yml` is on `main`, it runs every night, and the Actions
     tab has **Device lab > Run workflow**. GitHub only offers scheduled and
     hand-started runs for workflows on the default branch, `main`.
   - Before that, a push to `dev` that touches the Android project or the check,
     with `[device-lab]` in its commit message, runs it on the phones.

   Any other push to `dev` touching those files only builds the APK, which
   catches a broken build without spending the day's quota.

Until the secrets exist, the workflow still builds the APK and says in its
summary what is missing, without failing.

## Reading the results

The run's summary has a table per phone:
- the GPU, the screen and the boot time;
- per map: the median fps, the 95th-percentile frame, the share of frames
  under 30 fps, the board pixels, whether the fence was taken, and the renderer
  tier it ran at;
- then every failure and warning.

The job fails when any phone fails. The reports are kept as the run's
`device-lab-results` artifact. Each run's video is in the Firebase console
under Test Lab, which is the place to look when a phone has "No report",
meaning the check never finished.

## Which phones

`device-lab.json` lists 2022 phones by priority, spread across GPU makers:
- Mali-G52: Galaxy A13;
- PowerVR: moto g22 or Galaxy A04;
- Mali-G68: Galaxy A33 or A53;
- Mali-G78: Pixel 6a;
- Adreno: Galaxy S22.

Each wish names Test Lab model ids or pieces of catalogue names, because the
catalogue changes. `scripts/device-lab-pick.mjs` takes the first match the
catalogue has, at the newest Android it offers. If fewer than `min` are found,
it fails and lists every physical phone Test Lab has, so the wishlist can be
fixed from the job log.

## Tests

`src/test/deviceCheck.test.ts`:
- the verdict's rules;
- frame statistics;
- the board hook;
- the maps chosen (no launcher);
- the three ways in;
- the device picker and the report reader;
- the governor fix below.

## Found by it

**The governor's step-down threw on every slow device.** When a 3D board ran
too slow, the quality governor stepped down mid-map and re-allocated the 3D
frame. It did so from inside the 2D layer's render, after that layer's sprites
had taken this frame's textures, so the frame drew destroyed textures and threw
`Cannot read properties of null (reading 'alphaMode')`. The resize now waits
for the frame to finish (`ThreeRenderer.resizeAfterFrame`).

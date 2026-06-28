# Android / Google Play

This app ships to Android by wrapping the existing Vite web build in a
[Capacitor](https://capacitorjs.com/) native shell. Capacitor serves the
bundled `dist/` assets from a local `http://localhost` origin inside the system
WebView, so absolute fetch paths (`/map.yml`, etc.) and `BrowserRouter` work
unchanged — no web-side rewrites were needed.

- **App ID:** `com.morkalork.devend`
- **App name:** `Dev/End`
- **Native project:** `android/` (committed; build artifacts are gitignored)
- **Web config:** [capacitor.config.ts](capacitor.config.ts)

## Prerequisites (one-time)

| Tool | Version | Notes |
|------|---------|-------|
| Node | 20.x | already used by the web build |
| Android Studio | latest | provides the Android SDK + emulator |
| JDK | **21** | Capacitor's Android libraries compile with Java 21. A current Android Studio bundles a JBR 21 (`jbr/`) that satisfies this — older Studio releases shipped JBR 17, which fails with `invalid source release: 21`. If you're on an older Studio, install a standalone JDK 21 (e.g. Temurin). |

Point Gradle at JDK 21 — in Android Studio: **Settings → Build, Execution,
Deployment → Build Tools → Gradle → Gradle JDK → 21** (the bundled JBR is fine).
For CLI builds, set `JAVA_HOME` to a JDK 21 — the one bundled with Android
Studio works:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
```

(We deliberately do *not* hardcode the JDK path in `android/gradle.properties`,
since that file is committed and the path is per-developer.)

`android/local.properties` (gitignored) must contain the SDK path, e.g.
`sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`.

## Everyday workflow

After any change to the web app:

```bash
npm run android:sync   # vite build + cap sync android  (copies dist/ into android/)
npm run android:open   # opens the project in Android Studio
```

Then Run ▶ from Android Studio onto an emulator or USB device. CLI equivalents:

```bash
cd android
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" ./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

## Release build (signed AAB for Google Play)

### 1. Generate an upload keystore (ONE TIME — back it up!)

> ⚠️ If you lose this keystore you can never publish an update to the same
> listing. Store it and its passwords in a password manager / secure backup.
> **Never commit it.**

```bash
keytool -genkey -v -keystore devend-upload.keystore \
  -alias devend -keyalg RSA -keysize 2048 -validity 10000
```

Keep `devend-upload.keystore` outside the repo (or rely on `.gitignore`).

### 2. Wire signing into Gradle

Create `android/keystore.properties` (gitignored — add it if not already):

```properties
storeFile=/absolute/path/to/devend-upload.keystore
storePassword=********
keyAlias=devend
keyPassword=********
```

Then in `android/app/build.gradle`, load it and add a `release` signing config
(standard Capacitor/Android pattern):

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

### 3. Build the AAB

```bash
cd android
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" ./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
```

### 4. Bump the version for each release

In `android/app/build.gradle` increment `versionCode` (integer, must rise every
upload) and set `versionName` (human string, e.g. `1.0.0`).

## Google Play submission

1. **Developer account** — one-time $25 at <https://play.google.com/console>.
2. **Create app** — name `Dev/End`, category Game, free.
3. **Upload the AAB** to a release track. Start with **Internal testing**, then
   Closed → Production.
4. **Store listing assets:**
   - App icon 512×512 (replace the default Capacitor icon in
     `android/app/src/main/res/` — use `@capacitor/assets` to generate all
     densities from one source image).
   - Feature graphic 1024×500.
   - ≥ 2 phone screenshots (portrait).
   - Short (80 char) + full (4000 char) description.
5. **Privacy policy URL** — required even for games. A one-page site (e.g.
   GitHub Pages) is fine.
6. **Content rating** — complete the IARC questionnaire (~10 min).
7. **Data safety form** — declare what data the app collects (this app stores
   only local `localStorage` progress; nothing leaves the device).
8. Submit. First review typically takes 1–3 days.

## TODO before first public release

- [ ] Replace placeholder app icon + splash. Drop a 1024×1024 source at
      `assets/icon.png` (and optionally `assets/splash.png`) and run
      `npx @capacitor/assets generate --android`. No suitable source logo exists
      in the repo yet — `public/favicon.ico` is only 256×256.
- [x] `index.html` author/OG tags de-Lovable'd (author → `Morkalork`, stale
      `lovable.dev` image tags removed). Re-add an `og:image` once a share image
      exists.
- [x] Admin/map-builder screens are gated — `Index.tsx` only mounts them when
      `import.meta.env.DEV` is true, so they are absent from a production build.
- [x] **`?admin=true` backdoor removed.** `isAdminEnabled` in
      `src/pages/Index.tsx` is now `import.meta.env.DEV` only — admin screens are
      unreachable in a production/Play build. The admin code is still lazy-loaded
      as a separate chunk but no code path loads it in production.
- [x] `versionCode 1` / `versionName "1.0"` set in `android/app/build.gradle`
      (bump both for each subsequent release).

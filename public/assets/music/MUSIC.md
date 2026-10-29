# Music for this game

**The catalogue now lives in [`public/music.yml`](../../music.yml)**, which is
what the in-game Jukebox (main menu > Music) reads. Edit that file when a track
is added, replaced or re-credited; `src/test/musicCatalogue.test.ts` checks it
against the tracks actually on disk, so a track that ships without a row fails the
build.

This page is kept as the human-readable copy.

## Format

The tracks ship as **Opus in Ogg at 64 kbps** (`.ogg`), encoded from the
Pixabay MP3s with `ffmpeg -c:a libopus -b:a 64k -vbr on -application audio`.
They were 128 kbps MP3, 24 MB in all, and every byte of `public/` goes into the
Android APK; Opus at 64k is about the same quality as MP3 at 128k and the set
is 13 MB. The MP3 originals are in git history (before the Opus commit) and at
the Pixabay pages below. Chrome, Android WebView, Firefox and Edge play Ogg
Opus; Safari does from 17.4.

## Acquired from Pixabay

License: https://pixabay.com/service/license-summary/

## Song references

- main.ogg: 80's Energy, by Playasound: https://pixabay.com/music/synthwave-80s-energy-176577/
- maps_1-5.ogg: 80s-retrowave-synthwave-retro-synthpop-futuristic-electro-pop-music, by REDproductions: https://pixabay.com/music/synthwave-80s-retrowave-synthwave-retro-synthpop-futuristic-electro-pop-music-20596/
- maps_6-10.ogg: neon-odyssey-short-1, by Grand Project: https://pixabay.com/music/synthwave-neon-odyssey-short-1-399909/
- maps_11-15.ogg: Lady of the 80's, by Grand Project: https://pixabay.com/music/synthwave-lady-of-the-80x27s-128379/
- maps_16-20.ogg: machiavellian-nightmare-electronic-dystopia-ai-robot-machine, by melodyayresgriffiths: https://pixabay.com/music/video-games-machiavellian-nightmare-electronic-dystopia-ai-robot-machine-139385/
- maps_21-25.ogg: no-copyright-cyberpunk, by HumanStudioEDM: https://pixabay.com/music/dance-no-copyright-cyberpunk-527641/
- maps_26-30.ogg: cyberpunk-futuristic-music, by Poradovskyi: https://pixabay.com/music/phonk-cyberpunk-futuristic-music-514973/
- maps_31-35.ogg: cyber-sport-no-copyright-dj-music, by MiroMaxMusic: https://pixabay.com/music/dance-cyber-sport-no-copyright-dj-music-507206/
- maps_36-40.ogg: **removed** before the first Play build (2026-10-29). Its
  title, author and source were never recorded, so its licence could not be
  shown. The ladder has 29 maps, so this band never played in a run, only in
  the Jukebox. A new track for maps 36-40 goes in with its full credit in
  `public/music.yml`.
- end-credits.ogg: fun-8-bit-video-game-music-boss, by Keyframe Audio: https://pixabay.com/music/video-games-fun-8-bit-video-game-music-boss-133663/

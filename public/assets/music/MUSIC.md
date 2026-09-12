# Music for this game

**The catalogue now lives in [`public/music.yml`](../../music.yml)**, which is
what the in-game Jukebox (main menu > Music) reads. Edit that file when a track
is added, replaced or re-credited; `src/test/musicCatalogue.test.ts` checks it
against the mp3s actually on disk, so a track that ships without a row fails the
build.

This page is kept as the human-readable copy.

## Acquired from Pixabay

License: https://pixabay.com/service/license-summary/

## Song references

- main.mp3: 80's Energy, by Playasound: https://pixabay.com/music/synthwave-80s-energy-176577/
- maps_1-5.mp3: 80s-retrowave-synthwave-retro-synthpop-futuristic-electro-pop-music, by REDproductions: https://pixabay.com/music/synthwave-80s-retrowave-synthwave-retro-synthpop-futuristic-electro-pop-music-20596/
- maps_6-10.mp3: neon-odyssey-short-1, by Grand Project: https://pixabay.com/music/synthwave-neon-odyssey-short-1-399909/
- maps_11-15.mp3: Lady of the 80's, by Grand Project: https://pixabay.com/music/synthwave-lady-of-the-80x27s-128379/
- maps_16-20.mp3: machiavellian-nightmare-electronic-dystopia-ai-robot-machine, by melodyayresgriffiths: https://pixabay.com/music/video-games-machiavellian-nightmare-electronic-dystopia-ai-robot-machine-139385/
- maps_21-25.mp3: no-copyright-cyberpunk, by HumanStudioEDM: https://pixabay.com/music/dance-no-copyright-cyberpunk-527641/
- maps_26-30.mp3: cyberpunk-futuristic-music, by Poradovskyi: https://pixabay.com/music/phonk-cyberpunk-futuristic-music-514973/
- maps_31-35.mp3: cyber-sport-no-copyright-dj-music, by MiroMaxMusic: https://pixabay.com/music/dance-cyber-sport-no-copyright-dj-music-507206/
- **maps_36-40.mp3: NOT RECORDED.** The file ships and plays, but its title,
  author and source page were never written down. The Jukebox shows it as
  "Artist not recorded" rather than hiding it or guessing. If you know where it
  came from, fill in the `maps_36-40.mp3` entry in `public/music.yml` and remove
  the file from `CREDIT_MISSING` in `src/test/musicCatalogue.test.ts`.
- end-credits.mp3: fun-8-bit-video-game-music-boss, by Keyframe Audio: https://pixabay.com/music/video-games-fun-8-bit-video-game-music-boss-133663/

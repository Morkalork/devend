# Music

Background music, served at `/assets/music/*` and played by `src/lib/gameMusic.ts`.

## Files

- `main.mp3` — the shared loop. Plays as the default and as the fallback when a
  band track is missing or fails to load.
- `maps_1-5.mp3`, `maps_6-10.mp3`, `maps_11-15.mp3`, … — one track per 5-level
  band. Levels 1-5 use `maps_1-5.mp3`, levels 6-10 use `maps_6-10.mp3`, and so on
  (`maps_{lo}-{hi}.mp3` where `lo = 5*band + 1`, `hi = lo + 4`).

Tracks loop, and switch only at band boundaries, so music runs continuously
through a 5-level stretch.

## Notes

- MP3 works everywhere the game runs (browser + Android WebView). MP3 looping has
  a tiny gap from encoder padding; if a seamless loop matters for a track,
  prefer a cleanly-trimmed file (or re-encode as OGG).
- Keep a record of each track's source, artist, and license (e.g. Pixabay:
  attribution optional, no standalone redistribution).

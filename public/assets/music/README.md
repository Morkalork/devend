# Music

Background music, served at `/assets/music/*` and played by `src/lib/gameMusic.ts`.

## Files

- `main.ogg`: the shared loop. Plays on the menus and as the fallback when a
  band has no track or its file fails to load.
- `maps_1-5.ogg`, `maps_6-10.ogg`, ..., `maps_41-45.mp3`: one track per 5-level
  band (`maps_{lo}-{hi}.<ext>` where `lo = 5*band + 1`, `hi = lo + 4`). A band
  may be `.ogg` or `.mp3`: `public/music.yml` names the file, and gameMusic plays
  what its row says (before the catalogue loads it tries `.ogg`, then `.mp3`).
- `end-credits.ogg`: the credits roll.

Every file needs a row in `public/music.yml` with its credit; the catalogue test
fails on a file without one, or a row without a file.

Tracks loop, and switch only at band boundaries, so music runs continuously
through a 5-level stretch.

## Notes

- Ogg Opus at 64 kbps is the house format: a quarter of an MP3's size, and it
  loops without the encoder-padding gap MP3 has. MP3 plays everywhere the game
  runs (browser and Android WebView), so a track dropped in as `.mp3` works as is.
- Keep a record of each track's source, artist, and license (e.g. Pixabay:
  attribution optional, no standalone redistribution) in `MUSIC.md`.

/** One entry in the music catalogue (public/music.yml). */
export interface MusicTrack {
  /** File name under public/assets/music, e.g. "maps_1-5.mp3". */
  file: string;
  /** Served path, derived: "/assets/music/<file>". */
  src: string;
  title: string;
  /** Absent when the credit was never recorded; the screen says so out loud. */
  artist?: string;
  /** Where it was acquired, e.g. "Pixabay". */
  source?: string;
  /** Link to the track's page at the source. */
  url?: string;
  /** Translation key suffix under `music.usedFor.*`: menu | band | credits. */
  usedFor: "menu" | "band" | "credits";
  /** First and last level of the band, when `usedFor` is "band". */
  bandFrom?: number;
  bandTo?: number;
}

/** The whole catalogue: the tracks plus the licence they all ship under. */
export interface MusicCatalogue {
  tracks: MusicTrack[];
  license: { name: string; url: string };
}

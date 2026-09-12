/**
 * The music catalogue is the credits AND the playlist, so the two things that
 * can rot are a track that ships without a row and a row that points at nothing.
 * Both are checked against the files actually on disk.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { parseMusicDoc } from "@/lib/musicCatalogue";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";

const MUSIC_DIR = resolve(__dirname, "../../public/assets/music");
const doc = yaml.load(readFileSync(resolve(__dirname, "../../public/music.yml"), "utf8")) as Record<string, unknown>;
const catalogue = parseMusicDoc(doc);
const filesOnDisk = readdirSync(MUSIC_DIR).filter((f) => f.endsWith(".mp3")).sort();

/**
 * The one track whose provenance was never written down (MUSIC.md jumps from
 * 31-35 to the end credits). It is listed with the gap stated rather than
 * hidden or guessed at. This list may SHRINK, never grow: a second undocumented
 * track means somebody added music without recording where it came from.
 */
const CREDIT_MISSING = ["maps_36-40.mp3"];

describe("music catalogue", () => {
  it("lists every mp3 that ships, and only those", () => {
    expect(catalogue.tracks.map((t) => t.file).sort()).toEqual(filesOnDisk);
  });

  it("gives every track a distinct file and a title", () => {
    const files = catalogue.tracks.map((t) => t.file);
    expect(new Set(files).size).toBe(files.length);
    for (const track of catalogue.tracks) expect(track.title.trim()).not.toBe("");
  });

  it("serves each track from the path gameMusic actually plays", () => {
    for (const track of catalogue.tracks) {
      expect(track.src).toBe(`/assets/music/${track.file}`);
    }
  });

  it("credits an artist, a source and a link on every track but the known gap", () => {
    const uncredited = catalogue.tracks.filter((t) => !t.artist).map((t) => t.file);
    expect(uncredited).toEqual(CREDIT_MISSING);
    for (const track of catalogue.tracks) {
      expect(track.source).toBeTruthy();
      if (!CREDIT_MISSING.includes(track.file)) {
        expect(track.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("says where each track is used, and the bands tile the ladder", () => {
    const bands = catalogue.tracks
      .filter((t) => t.usedFor === "band")
      .sort((a, b) => (a.bandFrom ?? 0) - (b.bandFrom ?? 0));
    expect(bands.length).toBeGreaterThan(0);
    let expected = 1;
    for (const band of bands) {
      // Same 5-level banding gameMusic.musicFileForLevel derives from the name,
      // so a row cannot claim a range the player will never hear it in.
      expect(band.bandFrom).toBe(expected);
      expect(band.bandTo).toBe(expected + 4);
      expect(band.file).toBe(`maps_${band.bandFrom}-${band.bandTo}.mp3`);
      expected += 5;
    }
    expect(catalogue.tracks.filter((t) => t.usedFor === "menu")).toHaveLength(1);
    expect(catalogue.tracks.filter((t) => t.usedFor === "credits")).toHaveLength(1);
  });

  it("carries a licence with a link", () => {
    expect(catalogue.license.name).toBeTruthy();
    expect(catalogue.license.url).toMatch(/^https:\/\//);
  });

  it("has its screen strings in every locale", () => {
    for (const [lang, dict] of [["en", en], ["es", es], ["sv", sv]] as const) {
      const music = (dict as Record<string, unknown>).music as Record<string, unknown>;
      expect(music, `${lang} is missing the music block`).toBeTruthy();
      for (const key of ["title", "subtitle", "play", "pause", "byArtist", "artistUnknown", "viaSource", "licenseNote", "licenseLink", "back"]) {
        expect(music[key], `${lang}.music.${key}`).toBeTruthy();
      }
      const usedFor = music.usedFor as Record<string, string>;
      for (const key of ["menu", "band", "credits"]) {
        expect(usedFor[key], `${lang}.music.usedFor.${key}`).toBeTruthy();
      }
      expect(((dict as Record<string, Record<string, string>>).welcome).music, `${lang}.welcome.music`).toBeTruthy();
    }
  });

  it("keeps em-dashes out of its displayed fields", () => {
    for (const track of catalogue.tracks) {
      for (const field of [track.title, track.artist, track.source]) {
        expect(field ?? "").not.toContain("—");
      }
    }
  });
});

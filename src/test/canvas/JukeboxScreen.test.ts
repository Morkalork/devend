/**
 * The canvas Jukebox's playback and text (src/ui/screens/jukeboxPlayer.ts),
 * carried over from jukeboxScreen.test.tsx. jsdom has no audio pipeline, so
 * HTMLMediaElement.play is stubbed; everything below the stub is real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { TFunction } from "i18next";
import i18n from "@/i18n";
import type { MusicCatalogue } from "@/types/music";
import { clock, jukeboxLinks, trackCredit, trackReadout, usedForLabel, useJukeboxPlayer } from "@/ui/screens/jukeboxPlayer";

const t = i18n.getFixedT("en") as unknown as TFunction;

const catalogue: MusicCatalogue = {
  license: { name: "Pixabay Content License", url: "https://pixabay.com/service/license-summary/" },
  tracks: [
    {
      file: "main.mp3", src: "/assets/music/main.mp3", title: "80's Energy",
      artist: "Playasound", source: "Pixabay", url: "https://pixabay.com/music/x-1/", usedFor: "menu",
    },
    {
      file: "maps_1-5.mp3", src: "/assets/music/maps_1-5.mp3", title: "Retrowave",
      artist: "REDproductions", source: "Pixabay", url: "https://pixabay.com/music/x-2/",
      usedFor: "band", bandFrom: 1, bandTo: 5,
    },
    {
      file: "maps_36-40.mp3", src: "/assets/music/maps_36-40.mp3", title: "Unknown",
      source: "Pixabay", usedFor: "band", bandFrom: 36, bandTo: 40,
    },
  ],
};
const [energy, retro, unknown] = catalogue.tracks;

let played: string[] = [];
let paused = 0;

beforeEach(() => {
  played = [];
  paused = 0;
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    played.push(this.src);
    return Promise.resolve();
  });
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => { paused++; });
});

// Unmount first, so the cleanup pause still hits the stub.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("what the jukebox says", () => {
  it("credits each track with its author and source", () => {
    expect(trackCredit(energy, t)).toMatch(/Playasound/);
    expect(trackCredit(energy, t)).toMatch(/Pixabay/);
    expect(trackCredit(retro, t)).toMatch(/REDproductions/);
  });

  it("says outright when an author was never recorded, rather than leaving a blank", () => {
    expect(trackCredit(unknown, t)).toMatch(/Artist not recorded/);
  });

  it("says where each track is used", () => {
    expect(usedForLabel(energy, t)).toBe("Main menu");
    expect(usedForLabel(retro, t)).toBe("Levels 1-5");
    expect(usedForLabel(unknown, t)).toBe("Levels 36-40");
  });

  it("shows the clock while a track plays, and where it is used otherwise", () => {
    expect(trackReadout(retro, true, 65, 200, t)).toBe("1:05 / 3:20");
    expect(trackReadout(retro, false, 65, 200, t)).toBe("Levels 1-5");
    expect(clock(Number.NaN)).toBe("-:--");
  });

  it("links a track to its source page, and only when there is one, plus the licence", () => {
    const links = jukeboxLinks(catalogue);
    expect(links).toContain("https://pixabay.com/music/x-1/");
    expect(links).toContain("https://pixabay.com/music/x-2/");
    expect(links.filter(h => h.includes("pixabay.com/music"))).toHaveLength(2);
    expect(links).toContain("https://pixabay.com/service/license-summary/");
  });
});

describe("playback", () => {
  it("plays the track you press", () => {
    const { result } = renderHook(() => useJukeboxPlayer());
    act(() => result.current.toggle(retro.file, retro.src));
    expect(played).toHaveLength(1);
    expect(played[0]).toContain("/assets/music/maps_1-5.mp3");
    expect(result.current.playing).toBe(retro.file);
  });

  it("pressing the same track again stops it", () => {
    const { result } = renderHook(() => useJukeboxPlayer());
    act(() => result.current.toggle(retro.file, retro.src));
    act(() => result.current.toggle(retro.file, retro.src));
    expect(paused).toBeGreaterThan(0);
    expect(result.current.playing).toBeNull();
  });

  it("reuses one element rather than leaving the last track buffering", () => {
    const { result } = renderHook(() => useJukeboxPlayer());
    act(() => result.current.toggle(retro.file, retro.src));
    act(() => result.current.toggle(energy.file, energy.src));
    expect(played).toHaveLength(2);
    expect(played[1]).toContain("/assets/music/main.mp3");
    expect(paused).toBeGreaterThan(0);
  });

  it("takes the speakers on the way in and hands them back on the way out", () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const view = renderHook(() => useJukeboxPlayer(onEnter, onExit));
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    // A re-render with fresh callbacks must not hand the speakers back and forth.
    view.rerender();
    expect(onEnter).toHaveBeenCalledTimes(1);
    // Unmount, not the Back button: a back GESTURE has to restore it too.
    view.unmount();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

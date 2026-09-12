/**
 * The Jukebox: credits you can read and tracks you can play.
 *
 * jsdom has no audio pipeline, so HTMLMediaElement.play is stubbed. Everything
 * below the stub is real: which element gets pointed where, and what the screen
 * says about a track nobody wrote down the author of.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n';
import { JukeboxScreen } from '@/components/game/JukeboxScreen';
import type { MusicCatalogue } from '@/types/music';

const catalogue: MusicCatalogue = {
  license: { name: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/' },
  tracks: [
    {
      file: 'main.mp3', src: '/assets/music/main.mp3', title: "80's Energy",
      artist: 'Playasound', source: 'Pixabay', url: 'https://pixabay.com/music/x-1/', usedFor: 'menu',
    },
    {
      file: 'maps_1-5.mp3', src: '/assets/music/maps_1-5.mp3', title: 'Retrowave',
      artist: 'REDproductions', source: 'Pixabay', url: 'https://pixabay.com/music/x-2/',
      usedFor: 'band', bandFrom: 1, bandTo: 5,
    },
    {
      file: 'maps_36-40.mp3', src: '/assets/music/maps_36-40.mp3', title: 'Unknown',
      source: 'Pixabay', usedFor: 'band', bandFrom: 36, bandTo: 40,
    },
  ],
};

let played: string[] = [];
let paused = 0;

beforeEach(() => {
  played = [];
  paused = 0;
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    played.push(this.src);
    return Promise.resolve();
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => { paused++; });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderScreen = (props: Partial<React.ComponentProps<typeof JukeboxScreen>> = {}) =>
  render(<JukeboxScreen catalogue={catalogue} onBack={() => {}} {...props} />);

describe('JukeboxScreen', () => {
  it('lists every track with its author and source', () => {
    renderScreen();
    expect(screen.getByText("80's Energy")).toBeTruthy();
    expect(screen.getByText(/Playasound/)).toBeTruthy();
    expect(screen.getAllByText(/Pixabay/).length).toBeGreaterThan(0);
    expect(screen.getByText('Retrowave')).toBeTruthy();
    expect(screen.getByText(/REDproductions/)).toBeTruthy();
  });

  it('says outright when an author was never recorded, rather than leaving a blank', () => {
    renderScreen();
    expect(screen.getByText(/Artist not recorded/)).toBeTruthy();
  });

  it('says where each track is used', () => {
    renderScreen();
    expect(screen.getByText('Main menu')).toBeTruthy();
    expect(screen.getByText('Levels 1-5')).toBeTruthy();
    expect(screen.getByText('Levels 36-40')).toBeTruthy();
  });

  it('links a track to its source page, and only when there is one', () => {
    renderScreen();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('https://pixabay.com/music/x-1/');
    expect(links).toContain('https://pixabay.com/music/x-2/');
    // The uncredited track has no page to open, so it gets no dead link.
    expect(links.filter((h) => h?.includes('pixabay.com/music'))).toHaveLength(2);
  });

  it('links the licence', () => {
    renderScreen();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('https://pixabay.com/service/license-summary/');
  });

  it('plays the track you press', () => {
    renderScreen();
    fireEvent.click(screen.getByLabelText(/Play Retrowave/));
    expect(played).toHaveLength(1);
    expect(played[0]).toContain('/assets/music/maps_1-5.mp3');
  });

  it('pressing the same track again stops it', () => {
    renderScreen();
    fireEvent.click(screen.getByLabelText(/Play Retrowave/));
    fireEvent.click(screen.getByLabelText(/Pause Retrowave/));
    expect(paused).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Play Retrowave/)).toBeTruthy();
  });

  it('reuses one element rather than leaving the last track buffering', () => {
    renderScreen();
    fireEvent.click(screen.getByLabelText(/Play Retrowave/));
    fireEvent.click(screen.getByLabelText(/Play 80's Energy/));
    expect(played).toHaveLength(2);
    expect(played[1]).toContain('/assets/music/main.mp3');
    expect(paused).toBeGreaterThan(0);
  });

  it('takes the speakers on the way in and hands them back on the way out', () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const view = renderScreen({ onEnter, onExit });
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    // Unmount, not the Back button: a back GESTURE has to restore it too.
    view.unmount();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('goes back', () => {
    const onBack = vi.fn();
    renderScreen({ onBack });
    fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

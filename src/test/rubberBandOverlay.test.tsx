/**
 * The Rubber Band's drag surface, and the hand that teaches it.
 *
 * The geometry is covered in rubberBand.test.ts; what this file guards is the
 * part that only exists inside the component:
 *
 *  - a tap must NOT spend the charge (the release is a commitment, and a stray
 *    touch while reading the board is not one),
 *  - the pointer path must reach the effect as WORLD units, because the shape
 *    the player sees ringed and the shape the effect reads have to be the same
 *    one,
 *  - the tutorial hand is retired by a band that actually fired, never by a
 *    cancelled tap, and never comes back once it has been earned.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@/i18n';
import { RubberBandOverlay, type BandTarget } from '@/components/game/RubberBandOverlay';
import { BOARD_WIDTH, BOARD_HEIGHT } from '@/lib/boardConstants';
import type { BandShape } from '@/lib/rubberBand';

const KEY = 'devend_rubberband_tutorial_seen';

// jsdom has neither of these; both are pure plumbing for the drag.
beforeEach(() => {
  localStorage.clear();
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0, left: 0, top: 0, right: BOARD_WIDTH, bottom: BOARD_HEIGHT,
      width: BOARD_WIDTH, height: BOARD_HEIGHT, toJSON: () => ({}),
    } as DOMRect;
  };
});
afterEach(cleanup);

function mount(targets: BandTarget[] = []) {
  const onFire = vi.fn();
  const onCancel = vi.fn();
  const { container } = render(
    <RubberBandOverlay
      // 1:1 with the board, so client pixels ARE world units and a wrong
      // conversion shows up as a wrong number rather than a wrong scale.
      canvasWidth={BOARD_WIDTH}
      canvasHeight={BOARD_HEIGHT}
      canvasOffsetTop={0}
      canvasOffsetLeft={0}
      targets={targets}
      onFire={onFire}
      onCancel={onCancel}
    />,
  );
  const surface = container.firstElementChild as HTMLElement;
  return { surface, onFire, onCancel };
}

/**
 * jsdom's PointerEvent drops clientX/clientY, which would make every gesture in
 * this file land on (NaN, NaN) and "pass" by cancelling. A MouseEvent carrying
 * the pointer type keeps the coordinates and still reaches React's synthetic
 * onPointer* handlers.
 */
function pointer(type: string, x: number, y: number) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
}

function drag(surface: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent(surface, pointer('pointerdown', from[0], from[1]));
  fireEvent(surface, pointer('pointermove', to[0], to[1]));
  fireEvent(surface, pointer('pointerup', to[0], to[1]));
}

describe('rubber band overlay', () => {
  it('spends nothing on a tap: too short a pull disarms instead of firing', () => {
    const { surface, onFire, onCancel } = mount();
    drag(surface, [400, 400], [404, 402]);
    expect(onFire).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('fires a band that throws back the way the finger came', () => {
    const { surface, onFire } = mount();
    // Press at (300,400), pull right to (500,400): the balls between the band
    // and the press point should be thrown LEFT, back towards the press.
    drag(surface, [300, 400], [500, 400]);
    expect(onFire).toHaveBeenCalledTimes(1);
    const shape = onFire.mock.calls[0][0] as BandShape;
    expect(shape.heading.x).toBeCloseTo(-1, 5);
    expect(shape.heading.y).toBeCloseTo(0, 5);
    // The band sits under the finger, not at the press point.
    expect(shape.centre.x).toBeCloseTo(500, 5);
    expect(shape.centre.y).toBeCloseTo(400, 5);
  });

  it('reads the pointer in world units, so the drag survives a scaled board', () => {
    const onFire = vi.fn();
    // Half-size board: a 100px drag on screen is a 200-unit pull in the world,
    // which is the number the power curve and the dead zone are written in.
    const { container } = render(
      <RubberBandOverlay
        canvasWidth={BOARD_WIDTH / 2}
        canvasHeight={BOARD_HEIGHT / 2}
        canvasOffsetTop={0}
        canvasOffsetLeft={0}
        targets={[]}
        onFire={onFire}
        onCancel={() => {}}
      />,
    );
    const surface = container.firstElementChild as HTMLElement;
    drag(surface, [100, 200], [200, 200]);
    const shape = onFire.mock.calls[0][0] as BandShape;
    expect(shape.centre.x).toBeCloseTo(400, 5);
    expect(shape.centre.y).toBeCloseTo(400, 5);
  });

  it('rings what it would catch while the band is still being pulled', () => {
    // A ball sitting between the band and the press point is inside the sweep;
    // one behind the band is not.
    const targets: BandTarget[] = [
      { x: 460, y: 400, radius: 18, kind: 'ball' },
      { x: 560, y: 400, radius: 18, kind: 'ball' },
    ];
    const { surface } = mount(targets);
    fireEvent(surface, pointer('pointerdown', 300, 400));
    fireEvent(surface, pointer('pointermove', 500, 400));
    const rings = surface.querySelectorAll('[data-band-catch]');
    expect(rings.length).toBe(1);
    expect(rings[0].getAttribute('data-band-catch')).toBe('ball');
  });
});

describe('rubber band tutorial hand', () => {
  it('teaches the gesture the first time the ability is armed', () => {
    mount();
    expect(screen.getByText(/pull back through them/i)).toBeTruthy();
  });

  it('says real words, not a raw i18n key', () => {
    mount();
    expect(document.body.textContent ?? '').not.toContain('rubberBand.');
  });

  it('keeps teaching after a tap that fired nothing', () => {
    const { surface } = mount();
    drag(surface, [400, 400], [404, 402]);
    expect(localStorage.getItem(KEY)).toBeNull();
    cleanup();
    mount();
    expect(screen.getByText(/pull back through them/i)).toBeTruthy();
  });

  it('retires once a band has really been thrown, and stays retired', () => {
    const { surface } = mount();
    drag(surface, [300, 400], [500, 400]);
    expect(localStorage.getItem(KEY)).toBe('1');
    cleanup();
    mount();
    expect(screen.queryByText(/pull back through them/i)).toBeNull();
  });
});

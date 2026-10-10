/**
 * Who owns a touch: the canvas interface or the board under it.
 *
 * The interface canvas covers the whole screen with `pointer-events: none`, and
 * Pixi listens for pointers on the page root instead (UiHost). So a touch on
 * the board reaches BOTH the interface (which finds nothing there) and the
 * board canvas (which starts a fence). A touch on a button that happens to sit
 * over the board must not start a fence too, so the board asks here first.
 */
type Tester = (clientX: number, clientY: number) => boolean;

let tester: Tester | null = null;

export function setUiHitTester(t: Tester | null): void {
  tester = t;
}

/** True when an interactive part of the canvas interface is under this point. */
export function uiCovers(clientX: number, clientY: number): boolean {
  return tester ? tester(clientX, clientY) : false;
}

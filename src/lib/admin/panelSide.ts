/**
 * Which side of the map builder the side panel sits on.
 *
 * A workspace preference, not a setting about the game. Which hand you keep
 * your tools under is the kind of thing a person has an opinion about and does
 * not want to re-state every session, so it is remembered on the device.
 *
 * Its own module rather than a useState inside MapBuilder because the key has
 * to be named in two places - here and in totalReset's allowlist - and a
 * storage key spelled out twice is a storage key that will eventually be
 * spelled two ways. Reading it through a function also means the fallback for a
 * browser that refuses localStorage is written once.
 */

export type PanelSide = "left" | "right";

/** Colon-namespaced like the other device preferences (devend:renderer, ...). */
export const PANEL_SIDE_KEY = "devend:admin.panelSide";

/**
 * Right, matching where the panel has always been.
 *
 * A default that moved the panel would silently rearrange the workspace of
 * anyone who never asked for this.
 */
export const DEFAULT_PANEL_SIDE: PanelSide = "right";

/** Anything that is not a side we know about is the default, not a crash. */
export function parsePanelSide(raw: string | null | undefined): PanelSide {
  return raw === "left" || raw === "right" ? raw : DEFAULT_PANEL_SIDE;
}

export function readPanelSide(): PanelSide {
  try {
    return parsePanelSide(localStorage.getItem(PANEL_SIDE_KEY));
  } catch {
    // Private mode, or storage disabled. A preference is never worth an error.
    return DEFAULT_PANEL_SIDE;
  }
}

export function writePanelSide(side: PanelSide): void {
  try {
    localStorage.setItem(PANEL_SIDE_KEY, side);
  } catch { /* preference lost for this session; nothing else breaks */ }
}

/** The other one, for a toggle. */
export function otherSide(side: PanelSide): PanelSide {
  return side === "left" ? "right" : "left";
}

/**
 * Tailwind classes for the layout, derived here so the two halves cannot
 * disagree.
 *
 * Both are `lg:` only. Below that breakpoint the builder stacks - map on top,
 * panel underneath - and reversing THAT would put the tools above the thing
 * they edit on a phone, which is not what "left" was ever asked for.
 *
 * The border has to move with the panel or it draws on the outside edge of the
 * screen and the seam between map and tools disappears.
 */
export function panelSideClasses(side: PanelSide): { row: string; panel: string } {
  return side === "left"
    ? { row: "lg:flex-row-reverse", panel: "lg:border-r" }
    : { row: "lg:flex-row", panel: "lg:border-l" };
}

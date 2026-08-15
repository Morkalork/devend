/**
 * Back-gesture routing — maps a screen to what the Android/browser BACK command
 * should do, so a back gesture navigates WITHIN the game instead of popping the
 * page/app (see the popstate guard in Index.tsx).
 *
 * Kept pure and separate so the mapping is unit-tested and stays exhaustive
 * over the GameScreen union.
 */
import { GameScreen } from '@/types/game';

export type BackAction =
  | 'exit'     // root screen: let the back proceed (leave the app/page)
  | 'welcome'  // return to the main menu
  | 'admin'    // return to the admin screen
  | 'hall'     // Performance Review: return to wherever it was opened from
  | 'game'     // in-game: open/close the pause menu (handled by GameScreen)
  | 'consume'; // mid-run flow screens: swallow the back so it can't exit

/** What a BACK command should do from the given screen. */
export function backActionForScreen(screen: GameScreen): BackAction {
  switch (screen) {
    case 'welcome':
      return 'exit';
    case 'game':
      return 'game';
    case 'tutorial':
    case 'options':
    case 'certificateStore':
    case 'loadouts':
    case 'achievements':
    case 'result':
    case 'admin':
      return 'welcome';
    case 'hallOfFame':
      return 'hall';
    case 'mapBuilder':
    case 'animationTest':
    case 'upgradeAtlas':
      return 'admin';
    // Mid-run flow screens have no meaningful "back" (going back would skip the
    // forced progression), so we just swallow the gesture to prevent an exit.
    case 'upgradeShop':
    case 'tenureDraft':
    case 'doorDraft':
    case 'capstoneDraft':
    case 'runDraft':
    case 'ascensionDraft':
      return 'consume';
  }
}

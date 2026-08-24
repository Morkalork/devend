/**
 * The last thing between a render throw and a white screen.
 *
 * There was no error boundary anywhere in the app. The game LOOP has a
 * try/catch safety net, so a physics throw is survivable, but React had none:
 * anything thrown while rendering a HUD, a results overlay or a draft screen
 * unmounted the whole tree and left a blank page, on a phone, mid-run, with no
 * way back. For a player that is not a bug, it is the end of the session.
 *
 * Two of these are mounted, not one. The inner boundary wraps the game screen,
 * so a crash there drops you to the menu with the run intact; the outer one
 * catches anything the menu itself throws, which is the case that would
 * otherwise still be a blank page. A single boundary at the root would mean
 * every crash costs you the whole app.
 *
 * It saves before it offers a way out. Whatever threw, the run up to the
 * current map is recoverable, and losing it to a rendering bug would compound
 * one failure into a worse one.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /**
   * Where this boundary sits, for the message and for telemetry. The player is
   * told something different by "the board crashed, your run is saved" than by
   * "the app crashed".
   */
  scope: 'app' | 'game';
  /**
   * Persist whatever is worth keeping, before the recovery UI is offered.
   * Called inside a try/catch: a save that throws must not take the boundary
   * down with it, or the blank page comes back by another route.
   */
  onCrash?: () => void;
  /** Drop back to a working screen without a reload, when the caller can. */
  onRecover?: () => void;
}

interface State {
  error: Error | null;
}

export class GameErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged before anything else runs: if the save or the render below throws
    // too, this is the only record of what actually happened.
    console.error(`[crash:${this.props.scope}]`, error, info.componentStack);
    try {
      this.props.onCrash?.();
    } catch (saveError) {
      console.error('[crash] the save failed as well', saveError);
    }
  }

  private recover = (): void => {
    if (this.props.onRecover) {
      this.setState({ error: null });
      this.props.onRecover();
      return;
    }
    // No handler: a reload is the only honest option, and the run was saved
    // above, so it costs the current map rather than the session.
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isGame = this.props.scope === 'game';
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border-2 border-destructive/50 bg-card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-7 h-7 shrink-0 text-destructive" strokeWidth={1.5} />
            <h2 className="text-base font-bold text-foreground">
              {isGame ? 'The board stopped' : 'Something broke'}
            </h2>
          </div>

          <p className="text-sm text-muted-foreground">
            {isGame
              ? 'Your run is saved up to the current map. You can pick it up from the menu.'
              : 'The app hit an error it could not recover from. Reloading will bring you back to your saved run.'}
          </p>

          {/* The message, not a stack: enough to report it, not a wall of
              minified frames on a phone screen. */}
          <pre className="text-[11px] leading-snug text-destructive/90 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
            {error.message || String(error)}
          </pre>

          <button
            onClick={this.recover}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            {this.props.onRecover ? 'Back to the menu' : 'Reload'}
          </button>
        </div>
      </div>
    );
  }
}

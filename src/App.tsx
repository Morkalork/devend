import { TooltipProvider } from "@/components/ui/tooltip";
import { GameErrorBoundary } from "@/components/GameErrorBoundary";
import { flushRunSave } from "@/lib/runSaveFlush";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

/**
 * Application root. The game is a single-page app: every screen (welcome,
 * game, shop, …) is rendered by the Index page and switched via internal
 * state — see src/hooks/useScreenNavigation.ts. The router only exists to
 * show a 404 page for unknown URLs.
 *
 * The outer error boundary is the backstop. A crash in the game screen is
 * caught closer in (see Index) so it costs the map rather than the app; this
 * one exists for everything else, which without it was a blank page.
 */
const App = () => (
  <GameErrorBoundary scope="app" onCrash={flushRunSave}>
  <TooltipProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </TooltipProvider>
  </GameErrorBoundary>
);

export default App;

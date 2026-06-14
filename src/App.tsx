import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

/**
 * Application root. The game is a single-page app: every screen (welcome,
 * game, shop, …) is rendered by the Index page and switched via internal
 * state — see src/hooks/useScreenNavigation.ts. The router only exists to
 * show a 404 page for unknown URLs.
 */
const App = () => (
  <TooltipProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;

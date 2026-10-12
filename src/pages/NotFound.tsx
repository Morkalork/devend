import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { CanvasLayer } from "@/ui/CanvasLayer";
import { CanvasUiRoot } from "@/ui/CanvasUiRoot";
import { NotFoundScreen } from "@/ui/screens/NotFoundScreen";

/**
 * A route that does not exist. Drawn on the interface canvas like every other
 * screen; the DOM holds only the page's background.
 */
const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <div style={{ minHeight: "100dvh", background: "hsl(var(--background))" }} />
      <CanvasLayer id="screen-NotFound" z={10}>
        <NotFoundScreen onHome={() => window.location.assign("/")} />
      </CanvasLayer>
      <CanvasUiRoot />
    </>
  );
};

export default NotFound;

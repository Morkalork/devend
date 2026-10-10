import { useEffect, useState } from "react";

export interface ViewportSize {
  width: number;
  height: number;
}

function readViewport(): ViewportSize {
  if (typeof window === "undefined") return { width: 390, height: 844 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The window's size in CSS pixels, following resizes. */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState(readViewport);
  useEffect(() => {
    const on = () => setSize(readViewport());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}


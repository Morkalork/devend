import { describe, it, expect, beforeEach } from "vitest";
import { getRenderer, setRenderer } from "@/lib/rendering/rendererSettings";

describe("rendererSettings", () => {
  beforeEach(() => {
    localStorage.removeItem("devend:renderer");
    window.history.replaceState(null, "", "/");
  });

  it("defaults to canvas2d", () => {
    expect(getRenderer()).toBe("canvas2d");
  });

  it("round-trips through localStorage", () => {
    setRenderer("pixi");
    expect(getRenderer()).toBe("pixi");
    setRenderer("canvas2d");
    expect(getRenderer()).toBe("canvas2d");
  });

  it("ignores garbage stored values", () => {
    localStorage.setItem("devend:renderer", "vulkan");
    expect(getRenderer()).toBe("canvas2d");
  });

  it("honours and persists the ?renderer= query override", () => {
    window.history.replaceState(null, "", "/?renderer=pixi");
    expect(getRenderer()).toBe("pixi");
    // Sticky: the override was written back to localStorage.
    window.history.replaceState(null, "", "/");
    expect(getRenderer()).toBe("pixi");
  });
});

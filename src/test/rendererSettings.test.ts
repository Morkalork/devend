import { describe, it, expect, beforeEach } from "vitest";
import { getRenderer, setRenderer } from "@/lib/rendering/rendererSettings";

describe("rendererSettings", () => {
  beforeEach(() => {
    localStorage.removeItem("devend:renderer");
    window.history.replaceState(null, "", "/");
  });

  it("defaults to pixi (WebGL)", () => {
    expect(getRenderer()).toBe("pixi");
  });

  it("round-trips through localStorage", () => {
    setRenderer("canvas2d");
    expect(getRenderer()).toBe("canvas2d");
    setRenderer("pixi");
    expect(getRenderer()).toBe("pixi");
  });

  it("ignores garbage stored values", () => {
    localStorage.setItem("devend:renderer", "vulkan");
    expect(getRenderer()).toBe("pixi");
  });

  it("honours and persists the ?renderer= query override", () => {
    window.history.replaceState(null, "", "/?renderer=canvas2d");
    expect(getRenderer()).toBe("canvas2d");
    // Sticky: the override was written back to localStorage.
    window.history.replaceState(null, "", "/");
    expect(getRenderer()).toBe("canvas2d");
  });
});

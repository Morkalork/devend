import { describe, it, expect, beforeEach } from "vitest";
import { getRenderer, setRenderer } from "@/lib/rendering/rendererSettings";

describe("rendererSettings", () => {
  beforeEach(() => {
    localStorage.removeItem("devend:renderer");
    window.history.replaceState(null, "", "/");
  });

  it("defaults to sleek (the lit, device-pixel-exact board)", () => {
    expect(getRenderer()).toBe("sleek");
  });

  it("round-trips through localStorage", () => {
    setRenderer("canvas2d");
    expect(getRenderer()).toBe("canvas2d");
    setRenderer("pixi");
    expect(getRenderer()).toBe("pixi");
    setRenderer("sleek");
    expect(getRenderer()).toBe("sleek");
  });

  it("ignores garbage stored values", () => {
    localStorage.setItem("devend:renderer", "vulkan");
    expect(getRenderer()).toBe("sleek");
  });

  // A stored choice always beats the default, which is why changing the default
  // does not migrate anyone who has ever loaded ?renderer=...
  it("keeps a stored non-default choice over the new default", () => {
    setRenderer("pixi");
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

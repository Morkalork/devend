/**
 * The Playground's modifier fields can be emptied.
 *
 * They could not: the input was controlled by the parsed number, "" parsed to
 * NaN and was dropped, and React put the old 0 back on the same keystroke. To
 * type a value you had to edit around the 0. An empty field now stays empty
 * on screen and counts as 0 underneath.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseModifierInput } from "@/lib/modifierInput";
import { ModifierInput } from "@/components/admin/ModifierInput";

afterEach(cleanup);

describe("parseModifierInput", () => {
  it("reads an empty field as zero", () => {
    expect(parseModifierInput("")).toBe(0);
    expect(parseModifierInput("   ")).toBe(0);
  });
  it("reads numbers, including decimals and negatives", () => {
    expect(parseModifierInput("25")).toBe(25);
    expect(parseModifierInput("0.5")).toBe(0.5);
    expect(parseModifierInput("-3")).toBe(-3);
  });
  it("leaves half-typed text alone", () => {
    expect(parseModifierInput("-")).toBeNull();
    expect(parseModifierInput("abc")).toBeNull();
  });
});

describe("ModifierInput", () => {
  it("shows an empty field when cleared and reports zero", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<ModifierInput value={40} onChange={onChange} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("40");
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("lets a fresh value be typed over an emptied field", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<ModifierInput value={0} onChange={onChange} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "25" } });
    expect(input.value).toBe("25");
    expect(onChange).toHaveBeenLastCalledWith(25);
  });

  it("shows the number again once the field loses focus", () => {
    const onChange = vi.fn();
    const { getByRole, rerender } = render(<ModifierInput value={40} onChange={onChange} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    rerender(<ModifierInput value={0} onChange={onChange} />);
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(input.value).toBe("0");
  });

  it("follows an outside reset when it is not being edited", () => {
    const onChange = vi.fn();
    const { getByRole, rerender } = render(<ModifierInput value={40} onChange={onChange} />);
    rerender(<ModifierInput value={0} onChange={onChange} />);
    expect((getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
  });
});

describe("the Playground uses it", () => {
  it("has no bare number input left for the modifier values", () => {
    const src = readFileSync(resolve(__dirname, "../components/admin/PlaygroundScreen.tsx"), "utf8");
    expect(src).toMatch(/<ModifierInput/);
    expect(src).not.toMatch(/onChange=\{e => setValue\(key, e\.target\.value\)\}/);
  });
});

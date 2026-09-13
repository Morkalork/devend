/**
 * The Playground's modifier fields clear when entered and can be emptied.
 *
 * They could not be emptied at all: the input was controlled by the parsed
 * number, "" parsed to NaN and was dropped, and React put the old 0 back on
 * the same keystroke. To type a value you had to edit around the 0. Now the
 * field clears on focus, takes what is typed, and if nothing new is entered
 * by the time it is left, the value it had on entry comes back.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseModifierInput } from "@/lib/modifierInput";
import { ModifierInput } from "@/components/admin/ModifierInput";

afterEach(cleanup);

describe("parseModifierInput", () => {
  it("reads numbers, including decimals and negatives", () => {
    expect(parseModifierInput("25")).toBe(25);
    expect(parseModifierInput("0.5")).toBe(0.5);
    expect(parseModifierInput("-3")).toBe(-3);
  });
  it("treats an empty field and half-typed text as no value", () => {
    expect(parseModifierInput("")).toBeNull();
    expect(parseModifierInput("   ")).toBeNull();
    expect(parseModifierInput("-")).toBeNull();
    expect(parseModifierInput("abc")).toBeNull();
  });
});

describe("ModifierInput", () => {
  function mount(value: number) {
    const onChange = vi.fn();
    const utils = render(<ModifierInput value={value} onChange={onChange} />);
    const input = utils.getByRole("spinbutton") as HTMLInputElement;
    return { ...utils, onChange, input };
  }

  it("clears when entered, so a value is typed straight in", () => {
    const { input, onChange } = mount(40);
    expect(input.value).toBe("40");
    fireEvent.focus(input);
    expect(input.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports each value as it is typed", () => {
    const { input, onChange } = mount(0);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "25" } });
    expect(input.value).toBe("25");
    expect(onChange).toHaveBeenNthCalledWith(1, 2);
    expect(onChange).toHaveBeenLastCalledWith(25);
  });

  it("puts the old value back when left with nothing entered", () => {
    const { input, onChange } = mount(40);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.value).toBe("40");
    // Nothing had moved, so nothing is reported.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("puts the old value back even after typing and then clearing", () => {
    const { input, onChange, rerender } = mount(40);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith(5);
    rerender(<ModifierInput value={5} onChange={onChange} />);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(40);
    rerender(<ModifierInput value={40} onChange={onChange} />);
    expect(input.value).toBe("40");
  });

  it("keeps a typed value on blur", () => {
    const { input, onChange, rerender } = mount(40);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12" } });
    rerender(<ModifierInput value={12} onChange={onChange} />);
    fireEvent.blur(input);
    expect(input.value).toBe("12");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("follows an outside reset when it is not being edited", () => {
    const { input, onChange, rerender } = mount(40);
    rerender(<ModifierInput value={0} onChange={onChange} />);
    expect(input.value).toBe("0");
  });
});

describe("the Playground uses it", () => {
  it("has no bare number input left for the modifier values", () => {
    const src = readFileSync(resolve(__dirname, "../components/admin/PlaygroundScreen.tsx"), "utf8");
    expect(src).toMatch(/<ModifierInput/);
    expect(src).not.toMatch(/onChange=\{e => setValue\(key, e\.target\.value\)\}/);
  });
});

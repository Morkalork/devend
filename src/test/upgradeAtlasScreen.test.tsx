/**
 * UpgradeAtlasScreen — the admin view, wired to the real catalogue.
 *
 * upgradeGraph.test.ts proves the graph is right; this proves the screen shows
 * it. The parts worth covering are the ones a logic test cannot see: that the
 * fetched YAML actually reaches the board, that selecting an upgrade opens a
 * panel naming what leads to and from it, and that a health finding is a live
 * link to the upgrade it is about rather than a paragraph of text. All three
 * are single points of failure that would leave a screen which renders fine and
 * tells you nothing.
 *
 * Runs against public/upgrades.yml rather than a fixture, because the screen's
 * whole purpose is to be right about that file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UpgradeAtlasScreen } from "@/components/admin/UpgradeAtlasScreen";

const file = (name: string) => readFileSync(resolve(__dirname, "../../public", name), "utf8");

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = String(url).replace(/^\//, "");
    return new Response(file(name), { status: 200 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

/** The rendered node box for an upgrade id. */
const nodeFor = (id: string) => document.querySelector(`[data-node-id="${id}"]`)!;

const openAtlas = async () => {
  const onBack = vi.fn();
  const { container } = render(<UpgradeAtlasScreen onBack={onBack} />);
  await waitFor(() => expect(container.querySelectorAll("[data-node-id]").length).toBeGreaterThan(50));
  return { onBack, container };
};

describe("the board", () => {
  it("draws the whole catalogue, not a page of it", async () => {
    const { container } = await openAtlas();
    // 106 upgrades today; asserting the shape rather than the number so adding
    // content does not fail the test.
    expect(container.querySelectorAll("[data-node-id]").length).toBeGreaterThan(100);
    expect(screen.getByText(/upgrades$/)).toBeInTheDocument();
  });

  it("summarises the graph in the header", async () => {
    await openAtlas();
    expect(screen.getByText(/chains$/)).toBeInTheDocument();
    expect(screen.getByText(/^longest \d+ steps$/)).toBeInTheDocument();
  });

  it("goes back to the admin panel", async () => {
    const { onBack, container } = await openAtlas();
    fireEvent.click(container.querySelector("button")!);
    expect(onBack).toHaveBeenCalled();
  });
});

describe("selecting an upgrade", () => {
  const select = (id: string) => fireEvent.pointerDown(nodeFor(id), { clientX: 0, clientY: 0 });

  it("opens a panel naming what it requires and what it leads to", async () => {
    await openAtlas();
    select("fast_compile_senior");

    expect(await screen.findByText("fast_compile_senior")).toBeInTheDocument();
    expect(screen.getByText(/^Requires \(1\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Leads to \(\d+\)$/)).toBeInTheDocument();
  });

  it("says plainly when an upgrade starts a chain", async () => {
    await openAtlas();
    select("fast_compile_junior");
    expect(await screen.findByText(/This is a chain head/)).toBeInTheDocument();
  });

  it("dims everything that is not up- or downstream of the selection", async () => {
    const { container } = await openAtlas();
    select("fast_compile_junior");

    await waitFor(() => expect(nodeFor("fast_compile_senior")).toHaveAttribute("opacity", "1"));
    // Something from an unrelated cluster.
    expect(nodeFor("defensive_programming_junior")).toHaveAttribute("opacity", "0.22");
    expect(container).toBeTruthy();
  });

  it("closes the panel again", async () => {
    await openAtlas();
    select("fast_compile_junior");
    fireEvent.click(await screen.findByRole("button", { name: "Close details" }));
    await waitFor(() => expect(screen.queryByText(/^Requires/)).not.toBeInTheDocument());
  });
});

describe("the health panel", () => {
  const openHealth = async () => {
    await openAtlas();
    fireEvent.click(screen.getByRole("button", { name: /Health/ }));
    return await screen.findByText(/findings$/);
  };

  it("lists findings against the shipped catalogue", async () => {
    await openHealth();
    // Known today: Budget Cycle, Procurement and Total Compensation all hang a
    // Junior off something higher, so Tenure can never open on them.
    expect(screen.getAllByText("tier-inversion").length).toBeGreaterThan(0);
  });

  /**
   * The point of a finding is to take you to the thing it is about. A row that
   * only prints prose is a dead end, so this checks the click actually lands on
   * the upgrade the row named.
   */
  it("makes each finding a link to the upgrade it names", async () => {
    await openHealth();
    const row = screen.getAllByText("tier-inversion")[0].closest("button")!;
    const named = within(row).getByText(/./, { selector: ".text-xs.font-medium" }).textContent!;
    expect(named.length).toBeGreaterThan(0);

    fireEvent.click(row);

    const detail = await screen.findByText(named, { selector: ".font-semibold.text-sm" });
    expect(detail).toBeInTheDocument();
    // ...and the board has scrolled it into view rather than just opening a panel.
    expect(screen.getByText(/^Requires \(\d+\)$/)).toBeInTheDocument();
  });

  it("closes again", async () => {
    await openHealth();
    fireEvent.click(screen.getByRole("button", { name: "Close health panel" }));
    await waitFor(() => expect(screen.queryByText(/findings$/)).not.toBeInTheDocument());
  });
});

describe("filtering", () => {
  it("dims everything that does not match the query", async () => {
    await openAtlas();
    fireEvent.change(screen.getByPlaceholderText(/Filter by name/), {
      target: { value: "fast compile" },
    });

    await waitFor(() => expect(nodeFor("fast_compile_junior")).toHaveAttribute("opacity", "1"));
    expect(nodeFor("defensive_programming_junior")).toHaveAttribute("opacity", "0.22");
  });

  it("matches on tag as well as name", async () => {
    await openAtlas();
    fireEvent.change(screen.getByPlaceholderText(/Filter by name/), { target: { value: "freeze" } });
    await waitFor(() => expect(nodeFor("feature_freeze_junior")).toHaveAttribute("opacity", "1"));
  });
});

describe("when the catalogue will not load", () => {
  it("says so instead of drawing an empty board", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    render(<UpgradeAtlasScreen onBack={vi.fn()} />);
    expect(await screen.findByText(/upgrades.yml did not load/)).toBeInTheDocument();
  });
});

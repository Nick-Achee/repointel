import { describe, it, expect } from "vitest";
import { personalizedPageRank, type RankEdge } from "./rank.js";

// page -> a, page -> b, a -> util, b -> util ; lonely is unconnected
const NODES = ["page", "a", "b", "util", "lonely"];
const EDGES: RankEdge[] = [
  { from: "page", to: "a" },
  { from: "page", to: "b" },
  { from: "a", to: "util" },
  { from: "b", to: "util" },
];

describe("personalizedPageRank", () => {
  it("ranks a shared dependency above its single-path siblings", () => {
    const rank = personalizedPageRank(NODES, EDGES, ["page"]);
    // util is reached through both a and b, so it accumulates more mass.
    expect(rank.get("util")!).toBeGreaterThan(rank.get("a")!);
    expect(rank.get("util")!).toBeGreaterThan(rank.get("b")!);
  });

  it("gives the seed the largest share and unreachable nodes ~zero", () => {
    const rank = personalizedPageRank(NODES, EDGES, ["page"]);
    expect(rank.get("page")!).toBeGreaterThan(rank.get("util")!);
    expect(rank.get("lonely")!).toBeLessThan(rank.get("util")!);
  });

  it("is deterministic across runs", () => {
    const a = personalizedPageRank(NODES, EDGES, ["page"]);
    const b = personalizedPageRank(NODES, EDGES, ["page"]);
    for (const n of NODES) expect(a.get(n)).toBe(b.get(n));
  });

  it("weights an edge that imports many bindings above a single-binding edge", () => {
    const rank = personalizedPageRank(
      ["s", "heavy", "light"],
      [
        { from: "s", to: "heavy", weight: 4 },
        { from: "s", to: "light", weight: 1 },
      ],
      ["s"]
    );
    expect(rank.get("heavy")!).toBeGreaterThan(rank.get("light")!);
  });

  it("falls back to a uniform personalization when no seed is a node", () => {
    const rank = personalizedPageRank(NODES, EDGES, ["does-not-exist"]);
    // every node still gets some mass; nothing throws or returns NaN.
    for (const n of NODES) {
      expect(Number.isFinite(rank.get(n)!)).toBe(true);
      expect(rank.get(n)!).toBeGreaterThan(0);
    }
  });
});

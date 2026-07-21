import { describe, it, expect } from "vitest";
import { buildDrift, renderDrift } from "./drift.js";
import { buildReorientation, renderReorientation } from "./reorient.js";

const ROOT = process.cwd();

describe("guide protocols on repointel itself", () => {
  it("drift since HEAD~1 reports real structural changes, non-invasively", async () => {
    const drift = await buildDrift("HEAD~1", { root: ROOT });
    expect(drift.error).toBeFalsy();
    const total =
      drift.diff.addedFiles.length + drift.diff.removedFiles.length +
      drift.diff.addedEdges.length + drift.diff.removedEdges.length +
      drift.diff.addedExports.length + drift.diff.removedExports.length;
    expect(total).toBeGreaterThan(0);
    expect(renderDrift(drift)).toMatch(/# Drift since HEAD~1/);
  });

  it("reorient grounds current state and asks the classification", async () => {
    const r = await buildReorientation(
      "guard check reports a false smell",
      ["src/core/guard.ts"],
      { root: ROOT }
    );
    expect(r.current.guard).toHaveProperty("ok");
    expect(r.current.impact.affected.length).toBeGreaterThan(0);
    expect(r.questions.length).toBeGreaterThan(0);
    expect(renderReorientation(r)).toMatch(/## Current state \(measured\)/);
  });
});

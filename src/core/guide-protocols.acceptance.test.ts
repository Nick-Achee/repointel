import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { buildDrift, renderDrift } from "./drift.js";
import { buildReorientation, renderReorientation } from "./reorient.js";

const ROOT = process.cwd();

function porcelain(): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString();
}

describe("guide protocols on repointel itself", () => {
  it("drift runs on the real repo, well-formed and non-invasive", async () => {
    // Use HEAD, which always resolves — even on a fetch-depth-1 CI clone, and
    // regardless of whether a given commit range happens to change graph-visible
    // source. This exercises the git-archive → snapshot → diff mechanism end to
    // end; asserting a specific range is non-empty is fragile (test files are
    // excluded from the index, so a test-only commit yields an empty diff).
    const before = porcelain();
    const drift = await buildDrift("HEAD", { root: ROOT });

    expect(drift.error).toBeFalsy();
    expect(drift.provenance).toBe("measured");
    expect(Array.isArray(drift.diff.addedFiles)).toBe(true);
    expect(renderDrift(drift)).toMatch(/# Drift since HEAD/);

    // Non-invasive: comparing against a ref must not touch the working tree.
    expect(porcelain()).toBe(before);
  });

  it("reorient grounds current state and asks the classification", async () => {
    const r = await buildReorientation(
      "guard check reports a false smell",
      ["src/core/guard.ts"],
      { root: ROOT }
    );
    expect(r.current.guard).toHaveProperty("ok");
    // guard.ts is imported by commands/guard.ts and mcp/server.ts, so >0.
    expect(r.current.impact.affected.length).toBeGreaterThan(0);
    expect(r.questions.length).toBeGreaterThan(0);
    expect(renderReorientation(r)).toMatch(/## Current state \(measured\)/);
  });
});

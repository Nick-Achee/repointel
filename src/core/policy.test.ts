import { describe, it, expect } from "vitest";
import { resolveLabels, type ArchitecturePolicy } from "./policy.js";
import { compileRule } from "./policy.js";

const POLICY: ArchitecturePolicy = {
  version: "1.0.0",
  labels: [
    { label: "core", include: ["src/core/**"], provenance: "declared" },
    { label: "cli", include: ["src/commands/**", "src/bin/**"], provenance: "declared" },
  ],
  forbidden: [],
  entrypoints: [],
};

describe("resolveLabels", () => {
  it("maps each file to its label and reports unlabeled files", () => {
    const files = ["src/core/utils.ts", "src/commands/scan.ts", "src/bin/cli.ts", "src/rogue.ts"];
    const { labelOf, unlabeled } = resolveLabels(POLICY, files);

    expect(labelOf.get("src/core/utils.ts")).toBe("core");
    expect(labelOf.get("src/commands/scan.ts")).toBe("cli");
    expect(labelOf.get("src/bin/cli.ts")).toBe("cli");
    expect(unlabeled).toEqual(["src/rogue.ts"]);
  });
});

describe("compileRule", () => {
  it("expands a label->label edge rule into edge-forbidden expectations over globs", () => {
    const exps = compileRule(POLICY, {
      from: "core", to: "cli", kind: "edge", ratified: true,
    });
    // core has 1 glob, cli has 2 globs -> 2 edge-forbidden expectations
    expect(exps).toHaveLength(2);
    expect(exps.every((e) => e.kind === "edge-forbidden")).toBe(true);
    expect(exps).toContainEqual({ kind: "edge-forbidden", from: "src/core/**", to: "src/commands/**" });
  });

  it("compiles a path rule into a single path-forbidden per glob pair", () => {
    const exps = compileRule(POLICY, {
      from: "cli", to: "core", kind: "path", ratified: true,
    });
    expect(exps).toHaveLength(2);
    expect(exps.every((e) => e.kind === "path-forbidden")).toBe(true);
  });
});

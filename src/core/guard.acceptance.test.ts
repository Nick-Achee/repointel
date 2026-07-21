import { describe, it, expect } from "vitest";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { derivePolicy } from "./policy.js";
import { evaluateGuard } from "./guard.js";
import type { ArchitecturePolicy } from "./policy.js";

const ROOT = process.cwd();

describe("architecture fitness on repointel itself", () => {
  it("derives a policy whose ratified declared invariants hold on the real graph", async () => {
    const index = await generateIndex({ root: ROOT });
    const graph = await buildDepGraph({ root: ROOT });

    // Derive, then RATIFY + DECLARE a known-true invariant: core must not
    // import commands (the CLI layer depends on core, never the reverse).
    const derived = derivePolicy(index, graph);
    const policy: ArchitecturePolicy = {
      ...derived,
      labels: derived.labels.map((l) =>
        l.label === "core" || l.label === "commands"
          ? { ...l, provenance: "declared" }
          : l
      ),
      forbidden: derived.forbidden.map((r) =>
        r.from === "core" && r.to === "commands" ? { ...r, ratified: true } : r
      ),
    };

    const report = evaluateGuard(policy, index, graph);
    // The invariant is real, so guard must pass (no error-level violation).
    expect(report.ok).toBe(true);
    const coreToCommands = report.violations.find(
      (v) => v.rule.startsWith("core must not import commands")
    );
    expect(coreToCommands?.classification).toBe("convergent");
  });

  it("catches an injected violation", async () => {
    const index = await generateIndex({ root: ROOT });
    const graph = await buildDepGraph({ root: ROOT });
    // Synthesize a forbidden edge in the graph copy: commands -> mcp forbidden,
    // but inject a core->commands edge to prove detection.
    const injected = {
      ...graph,
      edges: [...graph.edges, { from: "src/core/utils.ts", to: "src/commands/scan.ts", type: "static" as const }],
    };
    const policy: ArchitecturePolicy = {
      version: "1.0.0",
      labels: [
        { label: "core", include: ["src/core/**"], provenance: "declared" },
        { label: "commands", include: ["src/commands/**"], provenance: "declared" },
      ],
      forbidden: [{ from: "core", to: "commands", kind: "edge", ratified: true }],
      entrypoints: [],
    };
    const report = evaluateGuard(policy, index, injected);
    expect(report.ok).toBe(false);
    const v = report.violations.find((x) => x.severity === "error");
    expect(v!.matches).toContain("src/core/utils.ts -> src/commands/scan.ts");
  });
});

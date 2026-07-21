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

import { describe as d2, it as i2, expect as e2 } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { derivePolicy } from "./policy.js";

d2("derivePolicy", () => {
  i2("proposes labels from directories and forbidden rules the code already satisfies", async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-derive-"));
    try {
      const w = (rel: string, c: string) => {
        const abs = path.join(r, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, c);
      };
      w("package.json", JSON.stringify({ name: "p", version: "1" }));
      // ui -> core, and core never imports ui: "core must not import ui" is satisfied.
      w("src/ui/page.ts", 'import { u } from "../core/util";\nexport const p = u;');
      w("src/core/util.ts", "export const u = 1;");

      const index = await generateIndex({ root: r });
      const graph = await buildDepGraph({ root: r });
      const policy = derivePolicy(index, graph);

      e2(policy.labels.map((l) => l.label).sort()).toEqual(["core", "ui"]);
      e2(policy.labels.every((l) => l.provenance === "inferred")).toBe(true);
      // proposes the satisfied invariant core -> ui, unratified
      const rule = policy.forbidden.find((f) => f.from === "core" && f.to === "ui");
      e2(rule).toBeDefined();
      e2(rule!.ratified).toBe(false);
      // does NOT propose ui -> core (that edge exists, so it is not an invariant)
      e2(policy.forbidden.find((f) => f.from === "ui" && f.to === "core")).toBeUndefined();
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { evaluateGuard } from "./guard.js";
import type { ArchitecturePolicy } from "./policy.js";

let root: string;
async function gi() {
  return { index: await generateIndex({ root }), graph: await buildDepGraph({ root }) };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-guard-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  // core imports ui -> violates "core must not import ui"
  w("src/core/util.ts", 'import { p } from "../ui/page";\nexport const u = p;');
  w("src/ui/page.ts", "export const p = 1;");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const rule = (provenance: "declared" | "inferred"): ArchitecturePolicy => ({
  version: "1.0.0",
  labels: [
    { label: "core", include: ["src/core/**"], provenance },
    { label: "ui", include: ["src/ui/**"], provenance },
  ],
  forbidden: [{ from: "core", to: "ui", kind: "edge", ratified: true }],
  entrypoints: [],
});

describe("evaluateGuard", () => {
  it("reports a declared-label violation as an error", async () => {
    const { index, graph } = await gi();
    const report = evaluateGuard(rule("declared"), index, graph);
    const v = report.violations.find((x) => x.classification === "divergent");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(v!.matches).toContain("src/core/util.ts -> src/ui/page.ts");
  });

  it("caps an inferred-label violation at warning (never fails CI)", async () => {
    const { index, graph } = await gi();
    const report = evaluateGuard(rule("inferred"), index, graph);
    const v = report.violations.find((x) => x.classification === "divergent");
    expect(v!.severity).toBe("warning");
  });

  it("reports unlabeled files in the coverage channel", async () => {
    const { index, graph } = await gi();
    const policy = rule("declared");
    policy.labels = [{ label: "core", include: ["src/core/**"], provenance: "declared" }];
    const report = evaluateGuard(policy, index, graph);
    expect(report.coverage.unlabeled).toContain("src/ui/page.ts");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { inferBoundaries } from "./understand.js";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-understand-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  // core is depended-on (stable); ui depends outward (unstable)
  w("src/ui/page.ts", 'import { u } from "../core/util";\nexport const p = u;');
  w("src/core/util.ts", "export const u = 1;");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("inferBoundaries", () => {
  it("groups files by top-level src directory with instability and cross-edges", async () => {
    const index = await generateIndex({ root });
    const graph = await buildDepGraph({ root });
    const boundaries = inferBoundaries(index, graph);

    const byLabel = Object.fromEntries(boundaries.map((b) => [b.label, b]));
    expect(Object.keys(byLabel).sort()).toEqual(["core", "ui"]);
    // ui imports core: ui has efferent coupling, core has afferent
    expect(byLabel.ui.instability).toBe(1); // Ce=1, Ca=0 -> 1
    expect(byLabel.core.instability).toBe(0); // Ce=0, Ca=1 -> 0
    expect(byLabel.ui.crossEdges).toContainEqual(
      expect.objectContaining({ from: "src/ui/page.ts", to: "src/core/util.ts" })
    );
    expect(byLabel.ui.provenance).toBe("inferred");
  });
});

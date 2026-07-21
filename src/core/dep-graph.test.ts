import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildDepGraph, buildDepGraphFromSeeds, findDependents, findSCCs } from "./dep-graph.js";

let repoRoot: string;

function writeFixture(relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-depgraph-"));
  writeFixture("src/a.ts", 'import { b } from "./b";\nexport const a = b;');
  writeFixture("src/b.ts", "export const b = 1;");
  writeFixture(
    "src/page.ts",
    'import { Button } from "./components";\nexport const page = Button;'
  );
  writeFixture("src/components/index.ts", 'export * from "./button";');
  writeFixture("src/components/button.ts", "export const Button = 1;");
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("buildDepGraphFromSeeds directory seeds", () => {
  it("expands a trailing-slash directory seed to the files inside it", async () => {
    const graph = await buildDepGraphFromSeeds(["src/"], { root: repoRoot });
    const ids = graph.nodes.map((n) => n.id);

    expect(ids).toContain("src/a.ts");
    expect(ids).toContain("src/b.ts");
    expect(ids).not.toContain("src/");
  });

  it("expands a directory seed without a trailing slash", async () => {
    const graph = await buildDepGraphFromSeeds(["src"], { root: repoRoot });
    const ids = graph.nodes.map((n) => n.id);

    expect(ids).toContain("src/a.ts");
    expect(ids).not.toContain("src");
  });

  it("traverses through barrel re-exports to reach real modules", async () => {
    const graph = await buildDepGraphFromSeeds(["src/page.ts"], {
      root: repoRoot,
    });
    const ids = graph.nodes.map((n) => n.id);

    expect(ids).toContain("src/components/index.ts");
    expect(ids).toContain("src/components/button.ts");
  });
});

describe("findDependents (impact analysis)", () => {
  let impactRoot: string;

  beforeAll(() => {
    impactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-impact-"));
    const write = (rel: string, content: string) => {
      const abs = path.join(impactRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    // util <- helper <- feature ;  util <- direct ;  unrelated stands alone
    write("src/util.ts", "export const util = 1;");
    write("src/helper.ts", 'import { util } from "./util";\nexport const helper = util;');
    write("src/feature.ts", 'import { helper } from "./helper";\nexport const feature = helper;');
    write("src/direct.ts", 'import { util } from "./util";\nexport const direct = util;');
    write("src/unrelated.ts", "export const unrelated = 1;");
  });

  afterAll(() => {
    fs.rmSync(impactRoot, { recursive: true, force: true });
  });

  it("finds direct importers of a file", async () => {
    const graph = await buildDepGraph({ root: impactRoot });
    const impact = findDependents(graph, ["src/util.ts"]);

    expect(impact.direct.sort()).toEqual(["src/direct.ts", "src/helper.ts"]);
  });

  it("finds transitive importers and excludes unrelated files", async () => {
    const graph = await buildDepGraph({ root: impactRoot });
    const impact = findDependents(graph, ["src/util.ts"]);

    expect(impact.transitive).toContain("src/feature.ts");
    expect(impact.transitive).not.toContain("src/unrelated.ts");
    expect(impact.transitive).not.toContain("src/util.ts");
  });

  it("returns an empty impact set for a file nothing imports", async () => {
    const graph = await buildDepGraph({ root: impactRoot });
    const impact = findDependents(graph, ["src/unrelated.ts"]);

    expect(impact.direct).toEqual([]);
    expect(impact.transitive).toEqual([]);
  });
});

describe("symbol-scoped impact", () => {
  let symRoot: string;

  beforeAll(() => {
    symRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-symbol-"));
    const write = (rel: string, content: string) => {
      const abs = path.join(symRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    write(
      "src/utils.ts",
      "export function matchesPattern() {}\nexport function formatBytes() {}"
    );
    write(
      "src/matcher.ts",
      'import { matchesPattern } from "./utils";\nexport const m = matchesPattern;'
    );
    write(
      "src/display.ts",
      'import { formatBytes } from "./utils";\nexport const d = formatBytes;'
    );
    write(
      "src/app.ts",
      'import { m } from "./matcher";\nexport const app = m;'
    );
  });

  afterAll(() => {
    fs.rmSync(symRoot, { recursive: true, force: true });
  });

  it("records which bindings each import edge carries", async () => {
    const graph = await buildDepGraph({ root: symRoot });
    const edge = graph.edges.find(
      (e) => e.from === "src/matcher.ts" && e.to === "src/utils.ts"
    );

    expect(edge?.symbols).toEqual(["matchesPattern"]);
  });

  it("narrows impact to files that actually use the changed symbol", async () => {
    const graph = await buildDepGraph({ root: symRoot });
    const impact = findDependents(graph, ["src/utils.ts"], {
      symbol: "matchesPattern",
    });

    expect(impact.direct).toEqual(["src/matcher.ts"]);
    expect(impact.direct).not.toContain("src/display.ts");
    // Transitive consumers of the affected file still count.
    expect(impact.transitive).toContain("src/app.ts");
  });

  it("follows intra-file delegation: consumers of a wrapper are affected too", async () => {
    // utils.ts also exports a wrapper that calls the changed symbol; a file
    // importing only the wrapper still breaks when the inner symbol changes.
    const write = (rel: string, content: string) => {
      const abs = path.join(symRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    write(
      "src/utils.ts",
      [
        "export function matchesPattern() {}",
        "export function formatBytes() {}",
        "export function matchesPatterns(list) {",
        "  return list.some((p) => matchesPattern(p));",
        "}",
      ].join("\n")
    );
    write(
      "src/wrapperUser.ts",
      'import { matchesPatterns } from "./utils";\nexport const w = matchesPatterns;'
    );

    const graph = await buildDepGraph({ root: symRoot, includeTests: true });
    const impact = findDependents(graph, ["src/utils.ts"], {
      symbol: "matchesPattern",
    });

    expect(impact.direct).toContain("src/wrapperUser.ts");
    expect(impact.direct).toContain("src/matcher.ts");
    // A consumer of an unrelated export is still excluded.
    expect(impact.direct).not.toContain("src/display.ts");
  });

  it("explains each affected file: depth, the edge it came through, and line", async () => {
    const graph = await buildDepGraph({ root: symRoot, includeTests: true });
    const impact = findDependents(graph, ["src/utils.ts"], {
      symbol: "matchesPattern",
    });

    const matcher = impact.details.find((d) => d.file === "src/matcher.ts");
    expect(matcher).toMatchObject({ depth: 1, via: "src/utils.ts" });
    expect(matcher?.symbols).toContain("matchesPattern");
    expect(matcher?.line).toBeGreaterThan(0);

    // app.ts only imports matcher.ts, so it is one hop further out.
    const app = impact.details.find((d) => d.file === "src/app.ts");
    expect(app).toMatchObject({ depth: 2, via: "src/matcher.ts" });
  });

  it("orders details by depth so the closest blast radius comes first", async () => {
    const graph = await buildDepGraph({ root: symRoot, includeTests: true });
    const depths = findDependents(graph, ["src/utils.ts"]).details.map(
      (d) => d.depth
    );

    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it("falls back to all importers when no symbol is given", async () => {
    const graph = await buildDepGraph({ root: symRoot });
    const impact = findDependents(graph, ["src/utils.ts"]);

    expect(impact.direct).toContain("src/display.ts");
    expect(impact.direct).toContain("src/matcher.ts");
  });
});

describe("tsconfig path alias resolution", () => {
  let aliasRoot: string;

  beforeAll(() => {
    aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-alias-"));
    const write = (rel: string, content: string) => {
      const abs = path.join(aliasRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    // JSONC on purpose: comments and a trailing comma, no src/ directory.
    write(
      "tsconfig.json",
      [
        "{",
        "  // path aliases",
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@/*": ["./*"],',
        '      "@lib/*": ["lib/*"],',
        "    },",
        "  },",
        "}",
      ].join("\n")
    );
    write(
      "app/page.ts",
      [
        'import { Button } from "@/widgets/button";',
        'import { helper } from "@lib/helper";',
        "export const page = [Button, helper];",
      ].join("\n")
    );
    write("widgets/button.ts", "export const Button = 1;");
    write("lib/helper.ts", "export const helper = 1;");
  });

  afterAll(() => {
    fs.rmSync(aliasRoot, { recursive: true, force: true });
  });

  it("resolves @/* using tsconfig paths, not a hardcoded src/ rewrite", async () => {
    const graph = await buildDepGraphFromSeeds(["app/page.ts"], {
      root: aliasRoot,
    });
    expect(graph.nodes.map((n) => n.id)).toContain("widgets/button.ts");
  });

  it("resolves custom aliases like @lib/* as internal edges", async () => {
    const graph = await buildDepGraphFromSeeds(["app/page.ts"], {
      root: aliasRoot,
    });
    expect(graph.nodes.map((n) => n.id)).toContain("lib/helper.ts");
  });
});

describe("cycle detection (Tarjan SCC)", () => {
  let cycleRoot: string;

  beforeAll(() => {
    cycleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-cycle-"));
    const write = (rel: string, content: string) => {
      const abs = path.join(cycleRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    // The documented counterexample the naive one-pass DFS fails:
    // a->b, a->c, b->d, c->d, d->a. Two elementary cycles (a-b-d, a-c-d);
    // the old code reported one and never marked c circular.
    write("src/a.ts", 'import "./b";\nimport "./c";\nexport const a = 1;');
    write("src/b.ts", 'import "./d";\nexport const b = 1;');
    write("src/c.ts", 'import "./d";\nexport const c = 1;');
    write("src/d.ts", 'import "./a";\nexport const d = 1;');
    // An acyclic island that must stay unmarked.
    write("src/x.ts", 'import "./y";\nexport const x = 1;');
    write("src/y.ts", "export const y = 1;");
  });

  afterAll(() => {
    fs.rmSync(cycleRoot, { recursive: true, force: true });
  });

  it("marks every node on a cycle as circular, including cross-edge nodes", async () => {
    const graph = await buildDepGraph({ root: cycleRoot });
    const circular = new Set(
      graph.nodes.filter((n) => n.isCircular).map((n) => n.id)
    );

    expect(circular).toEqual(
      new Set(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"])
    );
  });

  it("leaves acyclic files unmarked", async () => {
    const graph = await buildDepGraph({ root: cycleRoot });
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    expect(byId.get("src/x.ts")?.isCircular).toBeFalsy();
    expect(byId.get("src/y.ts")?.isCircular).toBeFalsy();
  });

  it("reports both elementary cycles, order-independently", async () => {
    const graph = await buildDepGraph({ root: cycleRoot });
    const asSets = graph.cycles.map((c) => [...c].sort().join(","));

    expect(graph.cycles.length).toBe(2);
    expect(asSets).toContain("src/a.ts,src/b.ts,src/d.ts");
    expect(asSets).toContain("src/a.ts,src/c.ts,src/d.ts");
  });
});

describe("findSCCs edge cases", () => {
  it("detects a self-loop as a nontrivial component", () => {
    const edges = new Map([["a", ["a"]]]);
    expect(findSCCs(edges)).toEqual([["a"]]);
  });

  it("ignores a size-1 component with no self-loop", () => {
    const edges = new Map([
      ["a", ["b"]],
      ["b", []],
    ]);
    expect(findSCCs(edges)).toEqual([]);
  });

  it("separates two disjoint cycles into two components", () => {
    const edges = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["c", ["d"]],
      ["d", ["c"]],
    ]);
    const sccs = findSCCs(edges).map((s) => [...s].sort().join(","));
    expect(sccs.sort()).toEqual(["a,b", "c,d"]);
  });

  it("groups a figure-eight (two cycles sharing one node) into one component", () => {
    // a->b->a and a->c->a share node a: all three are mutually reachable.
    const edges = new Map([
      ["a", ["b", "c"]],
      ["b", ["a"]],
      ["c", ["a"]],
    ]);
    expect(findSCCs(edges)[0].sort()).toEqual(["a", "b", "c"]);
  });

  it("survives a deep chain without stack overflow (iterative)", () => {
    const edges = new Map<string, string[]>();
    const N = 20000;
    for (let i = 0; i < N; i++) edges.set(`n${i}`, [`n${i + 1}`]);
    edges.set(`n${N}`, ["n0"]); // one big cycle at the end
    expect(() => findSCCs(edges)).not.toThrow();
  });
});

describe("cycle enumeration cap honesty", () => {
  it("marks all SCC members circular even when cycle enumeration is capped", async () => {
    // A complete digraph K7 has >2000 elementary cycles — well past MAX_CYCLES.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-k7-"));
    try {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const imports = [];
        for (let j = 0; j < n; j++) if (j !== i) imports.push(`import "./f${j}";`);
        const abs = path.join(root, "src", `f${i}.ts`);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, `${imports.join("\n")}\nexport const f${i} = ${i};`);
      }

      const graph = await buildDepGraph({ root });
      const circular = graph.nodes.filter((x) => x.isCircular).length;

      expect(circular).toBe(n); // every node is on a cycle, cap or no cap
      expect(graph.stats.cyclesTruncated).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

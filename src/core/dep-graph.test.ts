import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildDepGraph, buildDepGraphFromSeeds, findDependents } from "./dep-graph.js";

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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildDepGraphFromSeeds } from "./dep-graph.js";

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

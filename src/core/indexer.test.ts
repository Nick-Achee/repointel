import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex, getIndex, saveIndex } from "./indexer.js";

let repoRoot: string;

function writeFixture(relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-indexer-"));
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("generateIndex import extraction", () => {
  it("records re-export sources as imports (barrel files)", async () => {
    writeFixture(
      "src/components/index.ts",
      [
        'export * from "./button";',
        'export { Card } from "./card";',
        'export type { Props } from "./types";',
        'export * as icons from "./icons";',
      ].join("\n")
    );
    writeFixture("src/components/button.ts", "export const Button = 1;");
    writeFixture("src/components/card.ts", "export const Card = 1;");
    writeFixture("src/components/types.ts", "export type Props = {};");
    writeFixture("src/components/icons.ts", "export const Icon = 1;");

    const index = await generateIndex({ root: repoRoot });
    const barrel = index.files.find(
      (f) => f.relativePath === "src/components/index.ts"
    );

    expect(barrel).toBeDefined();
    expect(barrel!.imports).toContain("./button");
    expect(barrel!.imports).toContain("./card");
    expect(barrel!.imports).toContain("./types");
    expect(barrel!.imports).toContain("./icons");
  });
});

describe("import extraction precision", () => {
  it("ignores import statements inside string literals and comments", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-phantom-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/real.ts"), "export const real = 1;");
      fs.writeFileSync(path.join(root, "src/ghost.ts"), "export const ghost = 1;");
      fs.writeFileSync(
        path.join(root, "src/fixture.ts"),
        [
          'import { real } from "./real";',
          '// import { ghost } from "./ghost";',
          'const code = \'import { ghost } from "./ghost";\';',
          "export const f = [real, code];",
        ].join("\n")
      );

      const index = await generateIndex({ root });
      const fixture = index.files.find(
        (f) => f.relativePath === "src/fixture.ts"
      );

      expect(fixture?.imports).toContain("./real");
      expect(fixture?.imports).not.toContain("./ghost");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("index exclusion disclosure", () => {
  it("discloses what it excluded instead of presenting a partial count as the total", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-excl-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(root, "src/a.test.ts"), 'import "./a";');
      fs.writeFileSync(path.join(root, "src/b.spec.ts"), 'import "./a";');

      const index = await generateIndex({ root });

      expect(index.summary.totalFiles).toBe(1);
      expect(index.excludedFromIndex?.tests).toBe(2);
      expect(index.excludedFromIndex?.patterns.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes test files when includeTests is set, so impact analysis can see them", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-excl2-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(root, "src/a.test.ts"), 'import "./a";');

      const index = await generateIndex({ root, includeTests: true });

      expect(index.files.map((f) => f.relativePath)).toContain("src/a.test.ts");
      expect(index.excludedFromIndex?.tests).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("framework detection", () => {
  it("ignores node_modules and dist when detecting frameworks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-fw-"));
    try {
      const write = (rel: string, content: string) => {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      };
      write("src/cli.ts", "export const cli = 1;");
      write("node_modules/hono/dist/server.js", "module.exports = {};");
      write("dist/server.js", "export const x = 1;");

      const index = await generateIndex({ root });
      expect(index.frameworks.map((f) => f.name)).not.toContain("express");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not claim a framework the project does not depend on", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-fw2-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      // A CLI with its own server.ts, but no express dependency.
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "cli", dependencies: { commander: "^12.0.0" } })
      );
      fs.writeFileSync(
        path.join(root, "src/server.ts"),
        "export const server = 1;"
      );

      const index = await generateIndex({ root });
      expect(index.frameworks.map((f) => f.name)).not.toContain("express");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects a framework the project actually depends on", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-fw3-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "api", dependencies: { express: "^4.19.0" } })
      );
      fs.writeFileSync(
        path.join(root, "src/server.ts"),
        'import express from "express";\nexport const app = express();'
      );

      const index = await generateIndex({ root });
      expect(index.frameworks.map((f) => f.name)).toContain("express");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("getIndex staleness", () => {
  it("re-indexes automatically when a new file appears after the cached index", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-stale-"));
    try {
      fs.mkdirSync(path.join(root, "src"));
      fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;");

      const first = await getIndex({ root });
      saveIndex(first, path.join(root, ".repointel"));

      const newFile = path.join(root, "src/b.ts");
      fs.writeFileSync(newFile, "export const b = 2;");
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(newFile, future, future);

      const second = await getIndex({ root });
      expect(second.files.map((f) => f.relativePath)).toContain("src/b.ts");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-indexes automatically when an indexed file is modified", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-stale2-"));
    try {
      fs.mkdirSync(path.join(root, "src"));
      const file = path.join(root, "src/a.ts");
      fs.writeFileSync(file, "export const a = 1;");

      const first = await getIndex({ root });
      saveIndex(first, path.join(root, ".repointel"));

      fs.writeFileSync(file, 'import { z } from "./z";\nexport const a = z;');
      fs.writeFileSync(path.join(root, "src/z.ts"), "export const z = 1;");
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(file, future, future);
      fs.utimesSync(path.join(root, "src/z.ts"), future, future);

      const second = await getIndex({ root });
      const a = second.files.find((f) => f.relativePath === "src/a.ts");
      expect(a?.imports).toContain("./z");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

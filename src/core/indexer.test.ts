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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sliceFeature } from "./slicer.js";

let repoRoot: string;

function writeFixture(relativePath: string, content: string) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-slicer-"));
  writeFixture("src/auth/login.ts", 'import { db } from "../db";\nexport const login = db;');
  writeFixture("src/db.ts", "export const db = 1;");
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("sliceFeature seeds", () => {
  it("includes real file contents when seeded with a directory", async () => {
    const slice = await sliceFeature(["src/auth/"], "auth", { root: repoRoot });
    const paths = slice.files.map((f) => f.relativePath);

    expect(paths).toContain("src/auth/login.ts");
    expect(paths).toContain("src/db.ts");
    expect(paths).not.toContain("src/auth/");
    expect(slice.seedFiles).toContain("src/auth/login.ts");
    expect(slice.summary.totalTokens).toBeGreaterThan(0);
  });

  it("throws when no seed resolves to an indexed file", async () => {
    await expect(
      sliceFeature(["src/nope.ts"], "typo", { root: repoRoot })
    ).rejects.toThrow(/no.*match|not found|resolve/i);
  });
});

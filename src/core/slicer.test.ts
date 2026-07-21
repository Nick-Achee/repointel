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

describe("sliceFeature ranking", () => {
  let rankRoot: string;

  beforeAll(() => {
    rankRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-rank-"));
    const w = (rel: string, content: string) => {
      const abs = path.join(rankRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    // page -> a, page -> b, a -> shared, b -> shared ; shared is central.
    w("src/page.ts", 'import { a } from "./a";\nimport { b } from "./b";\nexport const p = [a, b];');
    w("src/a.ts", 'import { shared } from "./shared";\nexport const a = shared;');
    w("src/b.ts", 'import { shared } from "./shared";\nexport const b = shared;');
    w("src/shared.ts", "export const shared = 1;");
  });

  afterAll(() => {
    fs.rmSync(rankRoot, { recursive: true, force: true });
  });

  it("assigns a relevance rank to every file and pins the seed first", async () => {
    const slice = await sliceFeature(["src/page.ts"], "ranked", { root: rankRoot });

    expect(slice.files[0].relativePath).toBe("src/page.ts");
    for (const f of slice.files) expect(typeof f.rank).toBe("number");
  });

  it("ranks the shared dependency above the single-path siblings", async () => {
    const slice = await sliceFeature(["src/page.ts"], "ranked", { root: rankRoot });
    const rankOf = (p: string) =>
      slice.files.find((f) => f.relativePath === p)!.rank!;

    expect(rankOf("src/shared.ts")).toBeGreaterThan(rankOf("src/a.ts"));
    expect(rankOf("src/shared.ts")).toBeGreaterThan(rankOf("src/b.ts"));
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { buildDrift } from "./drift.js";
import { renderDrift } from "./drift.js";

let root: string;

function git(args: string[]) {
  execFileSync("git", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-drift-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/core/db.ts", "export const db = 1;");
  w("src/auth/login.ts", 'import { db } from "../core/db";\nexport const login = db;');
  git(["init", "-q"]);
  git(["config", "user.email", "t@t.t"]);
  git(["config", "user.name", "t"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  // Change: add a new file + a new export + a new edge.
  w("src/auth/reset.ts", 'import { db } from "../core/db";\nexport function reset() { return db; }');
  w("src/core/db.ts", "export const db = 1;\nexport const cache = 2;");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("buildDrift", () => {
  it("reports files, edges, and exports that changed since a ref (non-invasively)", async () => {
    const before = fs.readdirSync(root); // working tree snapshot
    const drift = await buildDrift("HEAD", { root });

    expect(drift.sinceRef).toBe("HEAD");
    expect(drift.diff.addedFiles).toContain("src/auth/reset.ts");
    expect(drift.diff.addedEdges).toContain("src/auth/reset.ts -> src/core/db.ts");
    expect(drift.diff.addedExports.some((e) => e.includes("cache"))).toBe(true);
    expect(drift.provenance).toBe("measured");
    expect(drift.questions.join(" ")).toMatch(/intend|expected|which/i);

    expect(fs.readdirSync(root).sort()).toEqual(before.sort());
  });

  it("returns an error for an unknown ref instead of throwing", async () => {
    const drift = await buildDrift("no-such-ref-xyz", { root });
    expect(drift.error).toBeTruthy();
    expect(drift.diff.addedFiles).toEqual([]);
  });
});

describe("renderDrift", () => {
  it("renders the changes with counts and routes intent to questions", async () => {
    const drift = await buildDrift("HEAD", { root });
    const md = renderDrift(drift);

    expect(md).toMatch(/# Drift since HEAD/);
    expect(md).toMatch(/## Structural changes \(measured\)/);
    expect(md).toContain("src/auth/reset.ts");
    expect(md).toMatch(/## Questions/);
    expect(md).toMatch(/\?\s*$/m);
  });

  it("renders the error when the ref is unknown", () => {
    const md = renderDrift({
      sinceRef: "bad", provenance: "measured",
      diff: { addedFiles: [], removedFiles: [], addedEdges: [], removedEdges: [], addedExports: [], removedExports: [] },
      crossBoundaryEdges: [], newCycles: 0, questions: [], error: "Could not resolve git ref: bad",
    });
    expect(md).toMatch(/Could not resolve/);
  });
});

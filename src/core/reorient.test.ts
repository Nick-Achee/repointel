import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildReorientation, renderReorientation } from "./reorient.js";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-reorient-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/auth/login.ts", 'import { db } from "../core/db";\nexport const login = db;');
  w("src/core/db.ts", "export const db = 1;");
  w("src/ui/page.ts", 'import { login } from "../auth/login";\nexport const page = login;');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("buildReorientation", () => {
  it("grounds current-state in the graph and asks the classification as a question", async () => {
    const r = await buildReorientation("login returns undefined after refactor", ["src/auth/"], { root });

    expect(r.trigger).toBe("login returns undefined after refactor");
    expect(r.current.guard).toHaveProperty("ok");
    expect(r.current.impact.affected).toContain("src/ui/page.ts");
    expect(r.questions.join(" ")).toMatch(/contract|domain|permission|classif/i);
    expect(r.provenance).toBe("measured");
  });
});

describe("renderReorientation", () => {
  it("renders the Reorientation Plan with current state and questions", async () => {
    const r = await buildReorientation("x broke", ["src/auth/"], { root });
    const md = renderReorientation(r);
    expect(md).toMatch(/# Reorientation: x broke/);
    expect(md).toMatch(/## Current state \(measured\)/);
    expect(md).toMatch(/## Questions/);
    expect(md).toMatch(/\?\s*$/m);
  });
});

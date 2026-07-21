import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { planCommand } from "./plan.js";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-plancmd-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/auth/login.ts", 'import { db } from "../core/db";\nexport function login() { return db; }');
  w("src/core/db.ts", "export const db = 1;");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("planCommand", () => {
  it("writes a plan markdown document and prints its path", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await planCommand({ goal: "add reset", seeds: ["src/auth/"], root });
    } finally {
      spy.mockRestore();
    }
    const out = path.join(root, ".repointel", "plans", "add-reset.md");
    expect(fs.existsSync(out)).toBe(true);
    const md = fs.readFileSync(out, "utf-8");
    expect(md).toMatch(/# Feature Plan: add reset/);
    expect(md).toContain("src/auth/login.ts");
  });

  it("emits the structured plan as JSON with --json", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.join(" "));
    });
    try {
      await planCommand({ goal: "add reset", seeds: ["src/auth/"], root, json: true });
    } finally {
      spy.mockRestore();
    }
    const payload = JSON.parse(lines.join("\n"));
    expect(payload.goal).toBe("add reset");
    expect(payload.observe.seedFiles).toContain("src/auth/login.ts");
    expect(payload.decide.guard).toHaveProperty("ok");
  });
});

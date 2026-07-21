import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { reorientCommand } from "./reorient.js";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-reorientcmd-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/auth/login.ts", "export const login = 1;");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("reorientCommand", () => {
  it("writes a reorientation markdown doc", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await reorientCommand({ trigger: "login broke", seeds: ["src/auth/"], root });
    } finally {
      spy.mockRestore();
    }
    const out = path.join(root, ".repointel", "reorient.md");
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, "utf-8")).toMatch(/# Reorientation: login broke/);
  });

  it("requires seeds", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    try {
      await reorientCommand({ trigger: "x", seeds: [], root });
    } finally {
      errSpy.mockRestore();
    }
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { teachInit } from "./teach.js";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-teach-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/ui/page.ts", 'import { u } from "../core/util";\nexport const p = u;');
  w("src/core/util.ts", "export const u = 1;");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("teachInit", () => {
  it("writes .repointel/architecture.json with inferred labels and unratified rules", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await teachInit({ root });
    } finally {
      spy.mockRestore();
    }
    const p = path.join(root, ".repointel", "architecture.json");
    expect(fs.existsSync(p)).toBe(true);
    const policy = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(policy.labels.map((l: { label: string }) => l.label).sort()).toEqual(["core", "ui"]);
    expect(policy.forbidden.every((r: { ratified: boolean }) => r.ratified === false)).toBe(true);
  });
});

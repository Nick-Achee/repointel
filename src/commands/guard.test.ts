import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { guardCheck } from "./guard.js";

let root: string;
function writePolicy(ratified: boolean, provenance: "declared" | "inferred") {
  const p = path.join(root, ".repointel", "architecture.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    version: "1.0.0",
    labels: [
      { label: "core", include: ["src/core/**"], provenance },
      { label: "ui", include: ["src/ui/**"], provenance },
    ],
    forbidden: [{ from: "core", to: "ui", kind: "edge", ratified }],
    entrypoints: [],
  }));
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-guardcmd-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/core/util.ts", 'import { p } from "../ui/page";\nexport const u = p;'); // violation
  w("src/ui/page.ts", "export const p = 1;");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("guardCheck", () => {
  it("exits non-zero on a declared, ratified violation", async () => {
    writePolicy(true, "declared");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    try {
      await guardCheck({ root });
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("returns a parseable report with --json", async () => {
    writePolicy(true, "declared");
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.join(" "));
    });
    try {
      await guardCheck({ root, json: true });
    } finally {
      spy.mockRestore();
    }
    const report = JSON.parse(lines.join("\n"));
    expect(report.ok).toBe(false);
    expect(report.violations[0].severity).toBe("error");
    process.exitCode = 0;
  });
});

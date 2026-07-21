import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { driftCommand } from "./drift.js";

let root: string;
function git(args: string[]) {
  execFileSync("git", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
}
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-driftcmd-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/a.ts", "export const a = 1;");
  git(["init", "-q"]); git(["config", "user.email", "t@t.t"]); git(["config", "user.name", "t"]);
  git(["add", "-A"]); git(["commit", "-qm", "base"]);
  w("src/b.ts", "export const b = 2;");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("driftCommand", () => {
  it("writes a drift markdown doc since a ref", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await driftCommand({ since: "HEAD", root });
    } finally {
      spy.mockRestore();
    }
    const out = path.join(root, ".repointel", "drift.md");
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, "utf-8")).toContain("src/b.ts");
  });

  it("emits JSON with --json", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => lines.push(a.join(" ")));
    try {
      await driftCommand({ since: "HEAD", root, json: true });
    } finally {
      spy.mockRestore();
    }
    const payload = JSON.parse(lines.join("\n"));
    expect(payload.sinceRef).toBe("HEAD");
    expect(payload.diff.addedFiles).toContain("src/b.ts");
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { oodaCommand } from "./ooda.js";

let repoRoot: string;
let prevCwd: string;

beforeAll(() => {
  prevCwd = process.cwd();
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-ooda-"));
  fs.mkdirSync(path.join(repoRoot, "src"));
  fs.writeFileSync(
    path.join(repoRoot, "src/a.ts"),
    'import { b } from "./b";\nexport const a = b;'
  );
  fs.writeFileSync(path.join(repoRoot, "src/b.ts"), "export const b = 1;");

  const featureDir = path.join(repoRoot, ".specify", "specs", "001-auth");
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, "tasks.md"),
    ["# Tasks", "- [x] Set up project", "- [~] Build login", "- [ ] Wire mailer"].join("\n")
  );

  process.chdir(repoRoot);
});

afterAll(() => {
  process.chdir(prevCwd);
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("ooda --json", () => {
  it("emits one machine-readable JSON document with observe/orient/decide", async () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.join(" "));
      });

    try {
      await oodaCommand({ json: true });
    } finally {
      spy.mockRestore();
    }

    // The entire stdout must parse as JSON — no banners, no colors.
    const parsed = JSON.parse(lines.join("\n"));

    expect(parsed.observe.files).toBeGreaterThan(0);
    expect(parsed.orient.currentFeature.id).toBe("001-auth");
    expect(parsed.orient.currentFeature.tasks.inProgress).toBe(1);
    expect(parsed.orient.currentFeature.tasks.completed).toBe(1);
    expect(Array.isArray(parsed.decide.actions)).toBe(true);
    expect(parsed.decide.actions.length).toBeGreaterThan(0);
  });
});

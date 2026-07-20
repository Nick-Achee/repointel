import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { oodaCommand } from "./ooda.js";

let repoRoot: string;

beforeAll(() => {
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

});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("currentFeature selection", () => {
  it("picks the feature with unfinished work, not the highest-numbered directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-feat-"));
        try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;");

      const mkFeature = (id: string, tasks: string[]) => {
        const dir = path.join(root, ".specify", "specs", id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "tasks.md"), ["# Tasks", ...tasks].join("\n"));
      };
      // Nothing is marked in-progress anywhere. 001 has real pending work;
      // 002 is fully shipped but sorts last.
      mkFeature("001-unfinished", ["- [x] Step one", "- [ ] Step two"]);
      mkFeature("002-shipped", ["- [x] All done", "- [x] Also done"]);

      const lines: string[] = [];
      const spy = vi
        .spyOn(console, "log")
        .mockImplementation((...args: unknown[]) => {
          lines.push(args.join(" "));
        });
      try {
        await oodaCommand({ root, json: true, refresh: true });
      } finally {
        spy.mockRestore();
      }

      const parsed = JSON.parse(lines.join("\n"));
      expect(parsed.orient.currentFeature.id).toBe("001-unfinished");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
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
      await oodaCommand({ root: repoRoot, json: true });
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

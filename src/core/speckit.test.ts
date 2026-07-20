import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectSpecKit } from "./speckit.js";

let repoRoot: string;

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-speckit-"));
  const featureDir = path.join(repoRoot, ".specify", "specs", "001-auth");
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, "tasks.md"),
    [
      "# Tasks",
      "- [ ] Design the schema",
      "- [~] Build the login form",
      "- [x] Set up the project",
      "- [/] Wire up the mailer",
    ].join("\n")
  );
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("speckit task parsing", () => {
  it("parses [~] and [/] markers as in-progress", async () => {
    const project = await detectSpecKit(repoRoot);
    const tasks = project?.features[0]?.tasks ?? [];

    expect(tasks.map((t) => t.status)).toEqual([
      "pending",
      "in-progress",
      "completed",
      "in-progress",
    ]);
  });
});

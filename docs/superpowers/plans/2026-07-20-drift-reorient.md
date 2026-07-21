# Drift + Reorient Protocols Implementation Plan (Guide layer, part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the two remaining OODA SOP protocols to the Guide layer — `repointel drift --since <git-ref>` (what changed in the graph since a ref, structurally classified) and `repointel reorient "<trigger>" --seeds <area>` (a graph-grounded Reorientation Plan for a missed constraint).

**Architecture:** Both are **composers** reusing shipped machinery. Drift gets the graph at a past ref **non-invasively** via `git archive <ref> | tar` into a temp dir (working tree untouched), then `snapshotGraph`/`diffSnapshots` (already shipped). Reorient composes the current guard report + seed impact + boundaries into the SOP §21 Reorientation shape. Same integrity line as `plan`: structural facts are `measured`; classification/intent/correction are **questions**, never asserted.

**Tech Stack:** TypeScript (ESM), vitest, commander. Build `tsc --noEmit && tsup`.

**Reference — reused signatures (shipped; compose, do not reimplement):**
- `src/core/contract.ts`: `snapshotGraph(graph, index): GraphSnapshot`; `diffSnapshots(before, after): SnapshotDiff` (`{addedFiles, removedFiles, addedEdges, removedEdges, addedExports, removedExports}` — edges are `"from -> to"` strings, exports `"file#symbol"`).
- `src/core/indexer.ts`: `generateIndex({root}): Promise<RepoIndex>`.
- `src/core/dep-graph.ts`: `buildDepGraph({root}): Promise<DepGraph>` (`.cycles: string[][]`); `findDependents(graph, targets): {direct, transitive, all, details}`.
- `src/core/understand.ts`: `inferBoundaries(index, graph): Boundary[]`.
- `src/core/guard.ts`: `evaluateGuard(policy, index, graph): GuardReport`.
- `src/core/policy.ts`: `derivePolicy(index, graph): ArchitecturePolicy`; type `ArchitecturePolicy`.
- `src/core/utils.ts`: `readJson<T>`, `ensureDir`.
- `node:child_process` `execFileSync` (NO shell — args as arrays, injection-safe).

---

### Task 1: `buildDrift` — diff the graph against a past git ref

**Files:**
- Create: `src/core/drift.ts`
- Test: `src/core/drift.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/drift.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { buildDrift } from "./drift.js";

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
    // Intent is a judgment — routed to questions.
    expect(drift.questions.join(" ")).toMatch(/intend|expected|which/i);

    // Non-invasive: working tree unchanged (no leftover temp extraction).
    expect(fs.readdirSync(root).sort()).toEqual(before.sort());
  });

  it("returns an error for an unknown ref instead of throwing", async () => {
    const drift = await buildDrift("no-such-ref-xyz", { root });
    expect(drift.error).toBeTruthy();
    expect(drift.diff.addedFiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/drift.test.ts`
Expected: FAIL — `Cannot find module './drift.js'`.

- [ ] **Step 3: Create the module**

Create `src/core/drift.ts`:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { snapshotGraph, diffSnapshots, type SnapshotDiff } from "./contract.js";
import { inferBoundaries } from "./understand.js";

export interface DriftOptions {
  root?: string;
}

export interface DriftReport {
  sinceRef: string;
  provenance: "measured";
  diff: SnapshotDiff;
  crossBoundaryEdges: string[]; // added edges that cross a directory boundary
  newCycles: number;
  questions: string[];
  error?: string;
}

const EMPTY_DIFF: SnapshotDiff = {
  addedFiles: [], removedFiles: [], addedEdges: [], removedEdges: [],
  addedExports: [], removedExports: [],
};

/** Extract a git ref's tree into a temp dir, non-invasively (no working-tree
 *  mutation). Returns the temp dir, or null if the ref does not resolve. */
function extractRef(root: string, ref: string): string | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-ref-"));
  const tarPath = path.join(tmp, "ref.tar");
  try {
    // No shell: args are arrays, so `ref` cannot inject.
    execFileSync("git", ["archive", "--format=tar", "-o", tarPath, ref], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    execFileSync("tar", ["-xf", tarPath, "-C", tmp], { stdio: ["pipe", "pipe", "pipe"] });
    fs.rmSync(tarPath, { force: true });
    return tmp;
  } catch {
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  }
}

export async function buildDrift(
  sinceRef: string,
  options: DriftOptions = {}
): Promise<DriftReport> {
  const root = options.root || process.cwd();

  const refDir = extractRef(root, sinceRef);
  if (!refDir) {
    return {
      sinceRef,
      provenance: "measured",
      diff: EMPTY_DIFF,
      crossBoundaryEdges: [],
      newCycles: 0,
      questions: [],
      error: `Could not resolve git ref: ${sinceRef}`,
    };
  }

  try {
    const [curIndex, curGraph, refIndex, refGraph] = await Promise.all([
      generateIndex({ root }),
      buildDepGraph({ root }),
      generateIndex({ root: refDir }),
      buildDepGraph({ root: refDir }),
    ]);

    const before = snapshotGraph(refGraph, refIndex);
    const after = snapshotGraph(curGraph, curIndex);
    const diff = diffSnapshots(before, after);

    // Which added edges cross a directory boundary (architecture drift signal)?
    const boundaryOf = new Map<string, string>();
    for (const b of inferBoundaries(curIndex, curGraph)) {
      for (const f of curIndex.files) {
        if (b.globs.some((g) => f.relativePath.startsWith(`src/${b.label}/`)))
          boundaryOf.set(f.relativePath, b.label);
      }
    }
    const crossBoundaryEdges = diff.addedEdges.filter((e) => {
      const [from, to] = e.split(" -> ");
      const a = boundaryOf.get(from);
      const b = boundaryOf.get(to);
      return a && b && a !== b;
    });

    const newCycles = Math.max(0, curGraph.cycles.length - refGraph.cycles.length);

    return {
      sinceRef,
      provenance: "measured",
      diff,
      crossBoundaryEdges,
      newCycles,
      questions: [
        "Is this drift INTENDED, or did something change that shouldn't have? The graph shows what moved, not whether it should have.",
        "Which drift CATEGORY is this (contract / architecture / data-model / permission / behavior)? Removed exports and new cross-boundary edges are the usual culprits.",
      ],
    };
  } finally {
    fs.rmSync(refDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/drift.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: clean (tsc gate).

- [ ] **Step 6: Commit**

```bash
git add src/core/drift.ts src/core/drift.test.ts
git commit -m "feat(drift): diff the graph against a past git ref (non-invasive)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `renderDrift` — Markdown drift report

**Files:**
- Modify: `src/core/drift.ts`
- Test: `src/core/drift.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/drift.test.ts`:

```ts
import { renderDrift } from "./drift.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/drift.test.ts -t renderDrift`
Expected: FAIL — `renderDrift` not exported.

- [ ] **Step 3: Implement `renderDrift`**

Add to `src/core/drift.ts`:

```ts
/** Render a DriftReport as Markdown. */
export function renderDrift(drift: DriftReport): string {
  const lines: string[] = [];
  lines.push(`# Drift since ${drift.sinceRef}`, "");
  if (drift.error) {
    lines.push(`> ${drift.error}`);
    return lines.join("\n");
  }

  const d = drift.diff;
  lines.push(`## Structural changes (${drift.provenance})`, "");
  const section = (title: string, items: string[]) => {
    lines.push(`**${title} (${items.length})**`);
    for (const i of items.slice(0, 15)) lines.push(`- ${i}`);
    if (items.length > 15) lines.push(`- …and ${items.length - 15} more`);
    lines.push("");
  };
  section("Added files", d.addedFiles);
  section("Removed files", d.removedFiles);
  section("Added edges", d.addedEdges);
  section("Removed edges", d.removedEdges);
  section("Added exports", d.addedExports);
  section("Removed exports", d.removedExports);

  if (drift.crossBoundaryEdges.length > 0) {
    lines.push(`**⚠ New cross-boundary edges (${drift.crossBoundaryEdges.length}) — possible architecture drift**`);
    for (const e of drift.crossBoundaryEdges.slice(0, 10)) lines.push(`- ${e}`);
    lines.push("");
  }
  if (drift.newCycles > 0) lines.push(`**⚠ ${drift.newCycles} new dependency cycle(s)**`, "");

  lines.push("## Questions (judgment — the graph cannot answer these)", "");
  for (const q of drift.questions) lines.push(`- ${q}`);

  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/drift.test.ts -t renderDrift`
Expected: PASS

- [ ] **Step 5: Build + full suite**

Run: `npm run build && npx vitest run`
Expected: clean, all green.

- [ ] **Step 6: Commit**

```bash
git add src/core/drift.ts src/core/drift.test.ts
git commit -m "feat(drift): render a drift report as Markdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `repointel drift` CLI + MCP `driftSince` param

**Files:**
- Create: `src/commands/drift.ts`
- Modify: `src/bin/cli.ts`, `src/mcp/server.ts`
- Test: Create `src/commands/drift.test.ts`; append to `src/mcp/server.test.ts`

- [ ] **Step 1: Write the failing CLI test**

Create `src/commands/drift.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/drift.test.ts`
Expected: FAIL — `Cannot find module './drift.js'`.

- [ ] **Step 3: Create the command**

Create `src/commands/drift.ts`:

```ts
import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { buildDrift, renderDrift } from "../core/drift.js";
import { ensureDir } from "../core/utils.js";

export interface DriftCommandOptions {
  since: string;
  root?: string;
  json?: boolean;
}

export async function driftCommand(options: DriftCommandOptions): Promise<void> {
  const root = options.root || process.cwd();
  const drift = await buildDrift(options.since, { root });

  if (options.json) {
    console.log(JSON.stringify(drift, null, 2));
    if (drift.error) process.exitCode = 2;
    return;
  }

  if (drift.error) {
    console.error(drift.error);
    process.exitCode = 2;
    return;
  }

  ensureDir(path.join(root, ".repointel"));
  const out = path.join(root, ".repointel", "drift.md");
  fs.writeFileSync(out, renderDrift(drift));

  const d = drift.diff;
  console.log(pc.green(`\n  ✓ Drift since ${options.since}`));
  console.log(pc.dim(`    +${d.addedFiles.length}/-${d.removedFiles.length} files, +${d.addedEdges.length}/-${d.removedEdges.length} edges, +${d.addedExports.length}/-${d.removedExports.length} exports`));
  if (drift.crossBoundaryEdges.length > 0)
    console.log(pc.yellow(`    ⚠ ${drift.crossBoundaryEdges.length} new cross-boundary edge(s)`));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/drift.test.ts`
Expected: PASS

- [ ] **Step 5: Register CLI + MCP**

In `src/bin/cli.ts`, add the import `import { driftCommand } from "../commands/drift.js";` and (after the `plan` block):

```ts
program
  .command("drift")
  .description("What changed in the graph since a git ref (Guide layer)")
  .requiredOption("--since <ref>", "Git ref to compare against (e.g. HEAD, a branch, a SHA)")
  .option("-j, --json", "Machine-readable drift report")
  .action(async (opts: { since: string; json?: boolean }) => {
    await driftCommand({ since: opts.since, json: opts.json });
  });
```

In `src/mcp/server.ts` (read it first): add `import { buildDrift } from "../core/drift.js";`, add a `driftSince` string field to `inputSchema`, add `driftSince` to the handler destructure, and before the final return add:

```ts
        if (driftSince) {
          (payload as Record<string, unknown>).drift = await buildDrift(driftSince, {
            root: repoRoot,
          });
        }
```

Add the matching MCP test — append inside `describe("repointel MCP server", ...)` in `src/mcp/server.test.ts`:

```ts
  it("returns a drift report when driftSince is given", async () => {
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, driftSince: "HEAD" },
    });
    const payload = callResult(result);
    expect(payload.drift).toBeDefined();
    expect(payload.drift).toHaveProperty("diff");
  });
```
(Note: `repoRoot` in server.test.ts is a temp dir; if it is not a git repo, `buildDrift` returns `{error, diff:emptyDiff}` — `payload.drift` is still defined with a `diff` property, so the assertion holds either way.)

- [ ] **Step 6: Build + full suite**

Run: `npm run build && npx vitest run`
Expected: clean, all green.

- [ ] **Step 7: Dogfood on repointel + commit source only**

Run: `node dist/bin/cli.js drift --since HEAD~1` — confirm it writes `.repointel/drift.md` and prints change counts. (Do NOT commit `.repointel/`.)

```bash
git add src/commands/drift.ts src/commands/drift.test.ts src/bin/cli.ts src/mcp/server.ts src/mcp/server.test.ts
git commit -m "feat(cli,mcp): drift — graph changes since a git ref

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `buildReorientation` — a graph-grounded Reorientation Plan

**Files:**
- Create: `src/core/reorient.ts`
- Test: `src/core/reorient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/reorient.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildReorientation } from "./reorient.js";

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
    // Current state is measured: guard + impact of the affected area.
    expect(r.current.guard).toHaveProperty("ok");
    expect(r.current.impact.affected).toContain("src/ui/page.ts");
    // The drift TAXONOMY is offered as a question, not a verdict.
    expect(r.questions.join(" ")).toMatch(/contract|domain|permission|classif/i);
    expect(r.provenance).toBe("measured");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/reorient.test.ts`
Expected: FAIL — `Cannot find module './reorient.js'`.

- [ ] **Step 3: Create the module**

Create `src/core/reorient.ts`:

```ts
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph, findDependents } from "./dep-graph.js";
import { evaluateGuard, type GuardReport } from "./guard.js";
import { derivePolicy, type ArchitecturePolicy } from "./policy.js";
import { expandSeeds } from "./dep-graph.js";
import { readJson } from "./utils.js";

export interface ReorientOptions {
  root?: string;
}

export interface Reorientation {
  trigger: string;
  provenance: "measured";
  current: {
    guard: GuardReport;
    impact: { affected: string[]; direct: string[]; transitive: string[] };
  };
  questions: string[];
}

/**
 * Compose the SOP Reorientation Plan: current graph state (measured) plus the
 * drift-classification and smallest-safe-correction as questions. A composer —
 * it computes no new graph fact.
 */
export async function buildReorientation(
  trigger: string,
  seeds: string[],
  options: ReorientOptions = {}
): Promise<Reorientation> {
  const root = options.root || process.cwd();

  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });

  const policy =
    readJson<ArchitecturePolicy>(
      path.join(root, ".repointel", "architecture.json")
    ) ?? derivePolicy(index, graph);
  const guard = evaluateGuard(policy, index, graph);

  const targets = expandSeeds(seeds, index);
  const impact = findDependents(graph, targets);

  return {
    trigger,
    provenance: "measured",
    current: {
      guard,
      impact: {
        affected: impact.all,
        direct: impact.direct,
        transitive: impact.transitive,
      },
    },
    questions: [
      "Classify the drift (the fix lives in the layer of the type): PRD / domain / data-model / CONTRACT (FE/BE shapes disagree) / PERMISSION / UI-state / test / architecture. Which is it?",
      "What is the single SOURCE OF TRUTH for that layer? Fix it there once — not the symptom in three places.",
      "What is the SMALLEST SAFE correction, and what test would have caught this (add it)?",
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/reorient.test.ts`
Expected: PASS

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/reorient.ts src/core/reorient.test.ts
git commit -m "feat(reorient): compose a graph-grounded Reorientation Plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `renderReorientation` + `repointel reorient` CLI + MCP

**Files:**
- Modify: `src/core/reorient.ts`
- Create: `src/commands/reorient.ts`
- Modify: `src/bin/cli.ts`, `src/mcp/server.ts`
- Test: Modify `src/core/reorient.test.ts`; create `src/commands/reorient.test.ts`; append to `src/mcp/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/core/reorient.test.ts`:

```ts
import { renderReorientation } from "./reorient.js";

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
```

Create `src/commands/reorient.test.ts`:

```ts
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
```

Append inside `describe("repointel MCP server", ...)` in `src/mcp/server.test.ts`:

```ts
  it("returns a reorientation when reorientTrigger is given with seeds", async () => {
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, reorientTrigger: "login broke", seeds: ["src/auth/"] },
    });
    const payload = callResult(result);
    expect(payload.reorient).toBeDefined();
    expect(payload.reorient.trigger).toBe("login broke");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/reorient.test.ts src/commands/reorient.test.ts`
Expected: FAIL (`renderReorientation` / `./reorient.js` missing).

- [ ] **Step 3: Implement render + command + wiring**

Add to `src/core/reorient.ts`:

```ts
/** Render a Reorientation as Markdown (SOP §21 shape). */
export function renderReorientation(r: Reorientation): string {
  const lines: string[] = [];
  lines.push(`# Reorientation: ${r.trigger}`, "");
  lines.push("> Current state is filled from the graph; classification and the correction are yours.", "");
  lines.push(`## Current state (${r.provenance})`, "");
  const g = r.current.guard;
  lines.push(`Architecture fitness: ${g.ok ? "no error-level violations" : "ERROR-level violations present"}`);
  for (const v of g.violations.filter((x) => x.classification === "divergent"))
    lines.push(`- ${v.severity === "error" ? "✗" : "⚠"} ${v.rule} (${v.provenance})`);
  lines.push(
    "",
    `Impact of the area: ${r.current.impact.affected.length} file(s) affected ` +
      `(${r.current.impact.direct.length} direct, ${r.current.impact.transitive.length} transitive).`,
    ""
  );
  lines.push("## Questions (judgment — reorient before adding code)", "");
  for (const q of r.questions) lines.push(`- ${q}`);
  return lines.join("\n");
}
```

Create `src/commands/reorient.ts`:

```ts
import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { buildReorientation, renderReorientation } from "../core/reorient.js";
import { ensureDir } from "../core/utils.js";

export interface ReorientCommandOptions {
  trigger: string;
  seeds: string[];
  root?: string;
}

export async function reorientCommand(options: ReorientCommandOptions): Promise<void> {
  const root = options.root || process.cwd();
  if (!options.seeds || options.seeds.length === 0) {
    console.error("reorient requires --seeds <area> (the files involved in the miss).");
    process.exitCode = 2;
    return;
  }

  const r = await buildReorientation(options.trigger, options.seeds, { root });
  ensureDir(path.join(root, ".repointel"));
  const out = path.join(root, ".repointel", "reorient.md");
  fs.writeFileSync(out, renderReorientation(r));

  console.log(pc.green(`\n  ✓ Reorientation for "${options.trigger}"`));
  console.log(pc.dim("    Current state from the graph; classify the drift and fix at the source of truth."));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
```

In `src/bin/cli.ts`, add `import { reorientCommand } from "../commands/reorient.js";` and (after the `drift` block):

```ts
program
  .command("reorient")
  .description("Graph-grounded reorientation for a missed constraint (Guide layer)")
  .argument("<trigger>", "What broke or was missed")
  .requiredOption("-s, --seeds <paths...>", "Files/area involved")
  .action(async (trigger: string, opts: { seeds: string[] }) => {
    await reorientCommand({ trigger, seeds: opts.seeds });
  });
```

In `src/mcp/server.ts`: add `import { buildReorientation } from "../core/reorient.js";`, a `reorientTrigger` string field in `inputSchema`, `reorientTrigger` in the destructure, and before the final return:

```ts
        if (reorientTrigger && seeds && seeds.length > 0) {
          (payload as Record<string, unknown>).reorient = await buildReorientation(
            reorientTrigger,
            seeds,
            { root: repoRoot }
          );
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/reorient.test.ts src/commands/reorient.test.ts src/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 5: Build + full suite + export from package root**

Add to `src/index.ts` (near the OODA-engine exports):

```ts
export { buildDrift, renderDrift, type DriftReport } from "./core/drift.js";
export { buildReorientation, renderReorientation, type Reorientation } from "./core/reorient.js";
```

Run: `npm run build && npx vitest run`
Expected: clean build, all green.

- [ ] **Step 6: Commit**

```bash
git add src/core/reorient.ts src/commands/reorient.ts src/commands/reorient.test.ts src/core/reorient.test.ts src/bin/cli.ts src/mcp/server.ts src/mcp/server.test.ts src/index.ts
git commit -m "feat(cli,mcp): reorient — graph-grounded Reorientation Plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end acceptance on repointel itself

**Files:**
- Test: `src/core/guide-protocols.acceptance.test.ts`

- [ ] **Step 1: Write the acceptance test**

Create `src/core/guide-protocols.acceptance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDrift, renderDrift } from "./drift.js";
import { buildReorientation, renderReorientation } from "./reorient.js";

const ROOT = process.cwd();

describe("guide protocols on repointel itself", () => {
  it("drift since HEAD~1 reports real structural changes, non-invasively", async () => {
    const drift = await buildDrift("HEAD~1", { root: ROOT });
    expect(drift.error).toBeFalsy();
    // HEAD~1..HEAD in this branch changed source, so the diff is non-empty.
    const total =
      drift.diff.addedFiles.length + drift.diff.removedFiles.length +
      drift.diff.addedEdges.length + drift.diff.removedEdges.length +
      drift.diff.addedExports.length + drift.diff.removedExports.length;
    expect(total).toBeGreaterThan(0);
    expect(renderDrift(drift)).toMatch(/# Drift since HEAD~1/);
  });

  it("reorient grounds current state and asks the classification", async () => {
    const r = await buildReorientation(
      "guard check reports a false smell",
      ["src/core/guard.ts"],
      { root: ROOT }
    );
    expect(r.current.guard).toHaveProperty("ok");
    expect(r.current.impact.affected.length).toBeGreaterThan(0);
    expect(r.questions.length).toBeGreaterThan(0);
    expect(renderReorientation(r)).toMatch(/## Current state \(measured\)/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/core/guide-protocols.acceptance.test.ts`
Expected: PASS. (If drift `total` is 0, HEAD~1 equals HEAD structurally — pick a ref with source changes; do not weaken below >0.)

- [ ] **Step 3: Full verification**

Run: `npm run build && npx vitest run`
Expected: clean build, all green.

- [ ] **Step 4: Commit**

```bash
git add src/core/guide-protocols.acceptance.test.ts
git commit -m "test(guide): acceptance for drift + reorient on repointel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§5.4 Guide deferred items):**
- `drift --since <ref>` (diff graph over a git range, classify, cite files) → Tasks 1–3. ✓
- `reorient` (classify a missed constraint, smallest safe correction) → Tasks 4–5. ✓
- MCP surfaces (`driftSince`, `reorientTrigger`) → Tasks 3, 5. ✓
- Package-root exports → Task 5. ✓
- Acceptance on repointel → Task 6. ✓

**Integrity line:** both composers keep structural facts `measured` and route classification/intent/correction to `questions` — tested in Tasks 1, 4. Drift is non-invasive (git archive to temp, working tree asserted unchanged) — tested in Task 1.

**Placeholder scan:** none — complete code and commands throughout.

**Type consistency:** `DriftReport`/`DriftOptions` (Task 1) → render (Task 2), CLI/MCP (Task 3). `Reorientation`/`ReorientOptions` (Task 4) → render + CLI/MCP (Task 5). `buildDrift(ref,{root})` / `buildReorientation(trigger,seeds,{root})` identical across call sites. Reuses `SnapshotDiff`, `GuardReport`, `expandSeeds`, `findDependents` from shipped modules. ✓

**Scope:** two composer protocols completing the Guide layer; each produces working software (a `drift`/`reorient` command + MCP surface). No new graph analysis invented.

**Security note:** `buildDrift` runs `git`/`tar` via `execFileSync` with **argument arrays, no shell** — the `ref` cannot inject; an invalid ref is caught and returned as `{error}`.

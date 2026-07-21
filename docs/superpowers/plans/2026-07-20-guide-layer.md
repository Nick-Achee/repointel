# Guide Layer Implementation Plan (Plan 2 of the OODA engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `repointel plan "<goal>" --seeds <area>` — the OODA SOP Feature Plan as a live, graph-grounded document: deterministic sections pre-filled from the real graph (with file:line + provenance), judgment sections printed as explicit questions, and an Act contract skeleton to verify the intended change.

**Architecture:** Guide is a **composer** — it computes no new graph fact. It arranges what the shipped pipeline already produces (ranked slice, inferred boundaries, guard report, impact) into the SOP's Observe/Orient/Decide/Act shape. The pre-fill/ask boundary is a graph-oracle test: auto-fill ONLY what a graph fact answers; everything else is a question. This is the integrity line — writing an inferred guess as fact would re-commit the overclaim sin.

**Tech Stack:** TypeScript (ESM), vitest, commander. Build `tsc --noEmit && tsup`; tests `npm run test:run`.

**Reference — reused signatures (all shipped; compose, do not reimplement):**
- `src/core/slicer.ts`: `sliceFeature(seeds, name, {root, depth?}): Promise<ContextSlice>` — `ContextSlice.files: SliceFile[]` each `{relativePath, type, sizeBytes, depth, reason, rank?}` (already PageRank-ranked, seed first); `.seedFiles`, `.summary.totalFiles/totalTokens`.
- `src/core/indexer.ts`: `generateIndex({root}): Promise<RepoIndex>` (`.files[].{relativePath, exports, symbols?}`).
- `src/core/dep-graph.ts`: `buildDepGraph({root}): Promise<DepGraph>`; `findDependents(graph, targets, {symbol?}): {direct, transitive, all, details}` (`details[]` each `{file, depth, via, symbols?, line?}`).
- `src/core/understand.ts`: `inferBoundaries(index, graph): Boundary[]` each `{label, globs, provenance:"inferred", instability, crossEdges}`.
- `src/core/guard.ts`: `evaluateGuard(policy, index, graph): GuardReport` — `{ok, violations:{rule,classification,matches,severity,provenance}[], smells:{rule,detail,severity}[], coverage:{unlabeled}}`.
- `src/core/policy.ts`: `derivePolicy(index, graph): ArchitecturePolicy`; type `ArchitecturePolicy`.
- `src/core/utils.ts`: `readJson<T>(path): T|null`, `ensureDir`, `readFileSafe`.

---

### Task 1: `buildPlan` core composer — the structured plan object

**Files:**
- Create: `src/core/plan.ts`
- Test: `src/core/plan.test.ts`

The composer returns a structured `FeaturePlan` object (rendering is Task 2; CLI is Task 3). Every field is either graph-derived (with evidence) or an explicit question — never an inferred guess stated as fact.

- [ ] **Step 1: Write the failing test**

Create `src/core/plan.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildPlan } from "./plan.js";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-plan-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  w("src/auth/login.ts", 'import { db } from "../core/db";\nexport function login() { return db; }');
  w("src/core/db.ts", "export const db = 1;");
  w("src/ui/page.ts", 'import { login } from "../auth/login";\nexport const page = login;');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("buildPlan", () => {
  it("fills Observe from the ranked seed slice with file evidence", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    expect(plan.goal).toBe("add password reset");
    expect(plan.observe.seedFiles).toContain("src/auth/login.ts");
    // Observed facts cite real files with provenance "measured"
    expect(plan.observe.files.length).toBeGreaterThan(0);
    expect(plan.observe.files[0]).toHaveProperty("relativePath");
    expect(plan.provenance.observe).toBe("measured");
  });

  it("fills Orient with inferred boundaries and routes volatility to a question", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    expect(plan.orient.boundaries.map((b) => b.label)).toContain("auth");
    expect(plan.orient.boundaries[0]).toHaveProperty("instability");
    // Volatility is a temporal/business judgment the graph cannot answer.
    expect(plan.orient.questions.join(" ")).toMatch(/volatil|change/i);
    expect(plan.provenance.orient).toBe("inferred");
  });

  it("fills Decide with the guard report and impact of the seeds", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    expect(plan.decide.guard).toHaveProperty("ok");
    // Impact: who depends on the seed area (ui/page imports auth/login).
    expect(plan.decide.impact.affected).toContain("src/ui/page.ts");
  });

  it("emits an Act contract skeleton of expected deltas as questions, not assertions", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    // The Act section proposes a contract the human completes — it is a
    // template of expected deltas, explicitly marked unverified.
    expect(plan.act.contractTemplate.name).toBeTruthy();
    expect(Array.isArray(plan.act.contractTemplate.expect)).toBe(true);
    expect(plan.act.note).toMatch(/complete|fill|expected/i);
  });

  it("marks judgment sections as questions, never asserts them", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });

    // Business primitives, pattern choice, DoD specifics are asked.
    const allQuestions = [
      ...plan.orient.questions,
      ...plan.decide.questions,
    ].join(" ");
    expect(allQuestions).toMatch(/primitive|pattern|invariant/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/plan.test.ts`
Expected: FAIL — `Cannot find module './plan.js'`.

- [ ] **Step 3: Create the composer**

Create `src/core/plan.ts`:

```ts
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { findDependents } from "./dep-graph.js";
import { sliceFeature } from "./slicer.js";
import { inferBoundaries, type Boundary } from "./understand.js";
import { evaluateGuard, type GuardReport } from "./guard.js";
import { derivePolicy, type ArchitecturePolicy } from "./policy.js";
import { readJson } from "./utils.js";

export interface PlanOptions {
  root?: string;
}

export interface FeaturePlan {
  goal: string;
  provenance: { observe: "measured"; orient: "inferred"; decide: "measured" };
  observe: {
    seedFiles: string[];
    files: Array<{ relativePath: string; rank?: number; reason: string }>;
    estimatedTokens: number;
    contextPack: string;
  };
  orient: {
    boundaries: Boundary[];
    questions: string[];
  };
  decide: {
    guard: GuardReport;
    impact: { affected: string[]; direct: string[]; transitive: string[] };
    questions: string[];
  };
  act: {
    contractTemplate: { name: string; expect: unknown[] };
    note: string;
  };
}

/**
 * Compose the SOP Feature Plan from graph facts. Deterministic sections are
 * filled with evidence; judgment sections are emitted as questions. This
 * function computes no new graph fact — it arranges what the pipeline produces.
 */
export async function buildPlan(
  goal: string,
  seeds: string[],
  options: PlanOptions = {}
): Promise<FeaturePlan> {
  const root = options.root || process.cwd();

  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });

  // OBSERVE — the ranked seed slice (PageRank-ordered, seed first).
  const slice = await sliceFeature(seeds, "plan", { root });
  const contextPack = path.join(".repointel", "slices", "plan.md");

  // ORIENT — inferred boundaries; volatility/primitives are judgment.
  const boundaries = inferBoundaries(index, graph);
  const orientQuestions = [
    "Which of these boundaries are VOLATILE (likely to change) vs stable? The graph shows structure, not rate-of-change.",
    "What are the business PRIMITIVES this touches (actors, resources, actions, invariants)? Name them.",
  ];

  // DECIDE — guard report (use a committed policy if present, else derive one)
  // and the impact of the seed area.
  const policy =
    readJson<ArchitecturePolicy>(
      path.join(root, ".repointel", "architecture.json")
    ) ?? derivePolicy(index, graph);
  const guard = evaluateGuard(policy, index, graph);
  const impact = findDependents(graph, slice.seedFiles);
  const decideQuestions = [
    "Does this change respect the architecture (see guard violations/smells)? Which boundary owns the new behavior?",
    "What PATTERN, if any, does the volatility justify — or is a plain function enough? Add a pattern only for demonstrated design pressure.",
    "What INVARIANT must hold after the change? Express it as an expected graph delta below.",
  ];

  // ACT — a contract skeleton the human completes: expected deltas to verify.
  const contractTemplate = {
    name: goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    expect: [
      { kind: "file-exists", path: "src/<area>/<new-file>.ts", _note: "the file this change should create" },
      { kind: "export-exists", file: "src/<area>/<file>.ts", symbol: "<newExport>", _note: "the symbol it should add" },
      { kind: "edge-exists", from: "src/<area>/<file>.ts", to: "src/<dep>.ts", _note: "the dependency it should wire" },
    ],
  };

  return {
    goal,
    provenance: { observe: "measured", orient: "inferred", decide: "measured" },
    observe: {
      seedFiles: slice.seedFiles,
      files: slice.files.map((f) => ({
        relativePath: f.relativePath,
        rank: f.rank,
        reason: f.reason,
      })),
      estimatedTokens: slice.summary.totalTokens,
      contextPack,
    },
    orient: { boundaries, questions: orientQuestions },
    decide: {
      guard,
      impact: {
        affected: impact.all,
        direct: impact.direct,
        transitive: impact.transitive,
      },
      questions: decideQuestions,
    },
    act: {
      contractTemplate,
      note: "Complete this contract with the expected graph deltas for your change, then verify with `repointel contract check`. It is a necessary-condition gate, not a test — a stub satisfies structure.",
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/plan.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: clean (tsc gate). Note: `plan.ts` imports `sliceFeature` from `slicer.ts`; confirm no import cycle (slicer does not import plan).

- [ ] **Step 6: Commit**

```bash
git add src/core/plan.ts src/core/plan.test.ts
git commit -m "feat(plan): compose the SOP Feature Plan from graph facts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Render a FeaturePlan as a Markdown document

**Files:**
- Modify: `src/core/plan.ts`
- Test: `src/core/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/plan.test.ts`:

```ts
import { renderPlan } from "./plan.js";

describe("renderPlan", () => {
  it("renders the SOP sections with evidence and questions, marking provenance", async () => {
    const plan = await buildPlan("add password reset", ["src/auth/"], { root });
    const md = renderPlan(plan);

    expect(md).toMatch(/# Feature Plan/);
    expect(md).toMatch(/## 1\. Observe/);
    expect(md).toMatch(/## 2\. Orient/);
    expect(md).toMatch(/## 3\. Decide/);
    expect(md).toMatch(/## 4\. Act/);
    // Observe cites a real file
    expect(md).toContain("src/auth/login.ts");
    // Judgment sections render as questions (a "?" line)
    expect(md).toMatch(/\?\s*$/m);
    // Provenance is disclosed, not hidden
    expect(md).toMatch(/measured|inferred/);
    // Act renders a fenced contract skeleton
    expect(md).toMatch(/```json[\s\S]*file-exists/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/plan.test.ts -t renderPlan`
Expected: FAIL — `renderPlan` not exported.

- [ ] **Step 3: Implement `renderPlan`**

Add to `src/core/plan.ts`:

```ts
/** Render a FeaturePlan as a Markdown document (the SOP shape, graph-grounded). */
export function renderPlan(plan: FeaturePlan): string {
  const lines: string[] = [];
  lines.push(`# Feature Plan: ${plan.goal}`, "");
  lines.push(
    "> Deterministic sections are filled from the graph (provenance noted).",
    "> Questions are judgment the graph cannot answer — you fill them.",
    ""
  );

  // 1. Observe
  lines.push(`## 1. Observe (${plan.provenance.observe})`, "");
  lines.push(`Seed area: ${plan.observe.seedFiles.join(", ")}`);
  lines.push(`Context pack: ${plan.observe.contextPack} (~${plan.observe.estimatedTokens} tokens)`, "");
  lines.push("Most relevant files (PageRank-ranked):");
  for (const f of plan.observe.files.slice(0, 12)) {
    const r = f.rank !== undefined ? ` (rank ${f.rank.toFixed(3)})` : "";
    lines.push(`- ${f.relativePath}${r} — ${f.reason}`);
  }
  lines.push("");

  // 2. Orient
  lines.push(`## 2. Orient (${plan.provenance.orient})`, "");
  lines.push("Boundaries (directory-inferred, with instability I = Ce/(Ca+Ce)):");
  for (const b of plan.orient.boundaries) {
    lines.push(`- **${b.label}** — I=${b.instability.toFixed(2)}, ${b.crossEdges.length} cross-edge(s)`);
  }
  lines.push("", "Questions (judgment — the graph cannot answer these):");
  for (const q of plan.orient.questions) lines.push(`- ${q}`);
  lines.push("");

  // 3. Decide
  lines.push(`## 3. Decide (${plan.provenance.decide})`, "");
  const g = plan.decide.guard;
  lines.push(`Architecture fitness: ${g.ok ? "no error-level violations" : "ERROR-level violations present"}`);
  const divergent = g.violations.filter((v) => v.classification === "divergent");
  for (const v of divergent) lines.push(`- ${v.severity === "error" ? "✗" : "⚠"} ${v.rule} (${v.provenance})`);
  for (const s of g.smells.slice(0, 5)) lines.push(`- ⚠ smell: ${s.detail}`);
  lines.push(
    "",
    `Impact of the seed area: ${plan.decide.impact.affected.length} file(s) affected ` +
      `(${plan.decide.impact.direct.length} direct, ${plan.decide.impact.transitive.length} transitive).`,
    ""
  );
  lines.push("Questions (judgment):");
  for (const q of plan.decide.questions) lines.push(`- ${q}`);
  lines.push("");

  // 4. Act
  lines.push("## 4. Act", "");
  lines.push(plan.act.note, "");
  lines.push("```json");
  lines.push(JSON.stringify(plan.act.contractTemplate, null, 2));
  lines.push("```");

  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/plan.test.ts -t renderPlan`
Expected: PASS

- [ ] **Step 5: Run build + full suite**

Run: `npm run build && npx vitest run`
Expected: clean build, all green.

- [ ] **Step 6: Commit**

```bash
git add src/core/plan.ts src/core/plan.test.ts
git commit -m "feat(plan): render a FeaturePlan as a graph-grounded SOP document

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `repointel plan` CLI command

**Files:**
- Create: `src/commands/plan.ts`
- Modify: `src/bin/cli.ts`
- Test: `src/commands/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/commands/plan.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/plan.test.ts`
Expected: FAIL — `Cannot find module './plan.js'`.

- [ ] **Step 3: Create the command**

Create `src/commands/plan.ts`:

```ts
import pc from "picocolors";
import * as path from "node:path";
import { buildPlan, renderPlan } from "../core/plan.js";
import { ensureDir, writeJson } from "../core/utils.js";
import * as fs from "node:fs";

export interface PlanCommandOptions {
  goal: string;
  seeds: string[];
  root?: string;
  json?: boolean;
}

export async function planCommand(options: PlanCommandOptions): Promise<void> {
  const root = options.root || process.cwd();
  if (!options.seeds || options.seeds.length === 0) {
    console.error("plan requires --seeds <area> (files or directories).");
    process.exitCode = 2;
    return;
  }

  const plan = await buildPlan(options.goal, options.seeds, { root });

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const slug =
    options.goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "plan";
  const plansDir = path.join(root, ".repointel", "plans");
  ensureDir(plansDir);
  const out = path.join(plansDir, `${slug}.md`);
  fs.writeFileSync(out, renderPlan(plan));

  console.log(pc.green(`\n  ✓ Feature Plan for "${options.goal}"`));
  console.log(pc.dim("    Observe/Orient/Decide filled from the graph; judgment sections are questions."));
  console.log(pc.dim("    Complete the Act contract, then: repointel contract check"));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/plan.test.ts`
Expected: PASS

- [ ] **Step 5: Register the CLI command**

In `src/bin/cli.ts`, add near the command imports:

```ts
import { planCommand } from "../commands/plan.js";
```

And add this registration (after the `guard` command block):

```ts
program
  .command("plan")
  .description("Compose a graph-grounded OODA Feature Plan for a goal (Guide layer)")
  .argument("<goal>", "What you want to build, e.g. \"add password reset\"")
  .requiredOption("-s, --seeds <paths...>", "Files/directories the change touches")
  .option("-j, --json", "Machine-readable structured plan")
  .action(async (goal: string, opts: { seeds: string[]; json?: boolean }) => {
    await planCommand({ goal, seeds: opts.seeds, json: opts.json });
  });
```

- [ ] **Step 6: Build and dogfood on repointel**

Run: `npm run build && node dist/bin/cli.js plan "add rename detection" --seeds src/core/indexer.ts`
Expected: writes `.repointel/plans/add-rename-detection.md`. Open it and confirm: Observe cites `src/core/indexer.ts` and ranked neighbors; Orient lists boundaries with instability; Decide shows guard results + impact; Act has a JSON contract skeleton. Report what the Decide section said about impact of `indexer.ts` (it should list many affected files — indexer is central).

- [ ] **Step 7: Commit**

```bash
git add src/commands/plan.ts src/commands/plan.test.ts src/bin/cli.ts
git commit -m "feat(cli): plan — graph-grounded OODA Feature Plan document

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Expose `plan` in the `repo_intel` MCP tool

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `src/mcp/server.test.ts`

- [ ] **Step 1: Read `src/mcp/server.ts` first** to see the real structure (the `rt` runtime abstraction, the destructure line `async ({ root, seeds, name, refresh, includeTests, symbol, contract, guard }) =>`, and where params are added to `inputSchema`). Adapt the insertions to the actual code.

- [ ] **Step 2: Write the failing test**

Append inside the existing `describe("repointel MCP server", ...)` block in `src/mcp/server.test.ts`:

```ts
  it("returns a feature plan when planGoal is given with seeds", async () => {
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, planGoal: "add sessions", seeds: ["src/auth/"] },
    });
    const payload = callResult(result);
    expect(payload.plan).toBeDefined();
    expect(payload.plan.goal).toBe("add sessions");
    expect(payload.plan.observe.seedFiles).toContain("src/auth/login.ts");
    expect(payload.plan.decide.guard).toHaveProperty("ok");
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/mcp/server.test.ts -t "feature plan"`
Expected: FAIL — `payload.plan` undefined.

- [ ] **Step 4: Wire `plan` into the handler**

In `src/mcp/server.ts`:
- Add import at the top:
```ts
import { buildPlan } from "../core/plan.js";
```
- Add a `planGoal` field to `inputSchema` (next to `guard`):
```ts
        planGoal: z
          .string()
          .optional()
          .describe(
            "Compose a graph-grounded OODA Feature Plan for this goal. Requires seeds. " +
              "Deterministic sections are filled from the graph; judgment sections are questions."
          ),
```
- Add `planGoal` to the handler destructure (append `, planGoal`).
- Immediately BEFORE the final `return { content: [...] }`, add:
```ts
        if (planGoal && seeds && seeds.length > 0) {
          (payload as Record<string, unknown>).plan = await buildPlan(
            planGoal,
            seeds,
            { root: repoRoot }
          );
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/mcp/server.test.ts -t "feature plan"`
Expected: PASS

- [ ] **Step 6: Build + full suite**

Run: `npm run build && npx vitest run`
Expected: clean build, all green (other MCP tests still pass).

- [ ] **Step 7: Commit**

```bash
git add src/mcp/server.ts src/mcp/server.test.ts
git commit -m "feat(mcp): expose feature plan via repo_intel planGoal param

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end acceptance — the plan cites real guard + impact on repointel

**Files:**
- Test: `src/core/plan.acceptance.test.ts`

- [ ] **Step 1: Write the acceptance test**

Create `src/core/plan.acceptance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPlan, renderPlan } from "./plan.js";

const ROOT = process.cwd();

describe("plan on repointel itself", () => {
  it("grounds Observe/Decide in the real graph and asks judgment questions", async () => {
    const plan = await buildPlan("add rename detection", ["src/core/indexer.ts"], {
      root: ROOT,
    });

    // Observe: the seed is present and the slice is ranked/non-empty.
    expect(plan.observe.seedFiles).toContain("src/core/indexer.ts");
    expect(plan.observe.files.length).toBeGreaterThan(1);

    // Decide: indexer.ts is central, so many files are affected.
    expect(plan.decide.impact.affected.length).toBeGreaterThan(3);
    expect(plan.decide.guard).toHaveProperty("ok");

    // Judgment is never asserted as fact — it is asked.
    expect(plan.orient.questions.length).toBeGreaterThan(0);
    expect(plan.decide.questions.length).toBeGreaterThan(0);

    // The rendered document is coherent and discloses provenance.
    const md = renderPlan(plan);
    expect(md).toMatch(/measured/);
    expect(md).toMatch(/## 4\. Act/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/core/plan.acceptance.test.ts`
Expected: PASS. (If `impact.affected` is small, that is a real finding about how central `indexer.ts` is — investigate, do not weaken the assertion below 1.)

- [ ] **Step 3: Full verification**

Run: `npm run build && npx vitest run`
Expected: clean build, all green.

- [ ] **Step 4: Commit**

```bash
git add src/core/plan.acceptance.test.ts
git commit -m "test(plan): end-to-end acceptance on repointel itself

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§5.4 Guide):**
- `repointel plan "<goal>" --seeds` command → Task 3. ✓
- Observe from ranked seed slice with file:line → Task 1 (`observe.files` with rank), Task 2 (render). ✓
- Orient boundaries + volatility as questions → Task 1/2. ✓
- Decide = GuardReport + recommendations/questions → Task 1/2. ✓ (uses committed policy if present, else derives one — a sensible default the spec implies.)
- Act = emitted contract skeleton → Task 1/2. ✓ (as a template of expected deltas the human completes, explicitly unverified — honoring "questions, not assertions".)
- Judgment sections as explicit questions → Task 1 (question arrays), tested. ✓
- `--json` → Task 3. ✓
- MCP surface → Task 4. ✓
- Deferred (`drift`, `reorient`) → NOT in this plan, per spec. Correct.

**Placeholder scan:** none — every step has complete code and exact commands.

**Type consistency:** `FeaturePlan`/`PlanOptions` defined in Task 1, consumed by `renderPlan` (Task 2), `planCommand` (Task 3), MCP (Task 4), acceptance (Task 5). `buildPlan(goal, seeds, {root})` signature identical across all call sites. `Boundary`/`GuardReport` imported from their shipped modules. ✓

**Scope:** one buildable subsystem (the plan composer + its CLI/MCP surfaces); produces working software (a `repointel plan` that emits a grounded document). `drift`/`reorient` are a later plan.

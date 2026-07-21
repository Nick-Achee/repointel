# Architecture Fitness Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic architecture-fitness spine — extend the contract wedge with two new expectation kinds, derive-and-ratify an architecture policy from the current graph, and evaluate it into a two-channel Guard report exposed via CLI and MCP.

**Architecture:** Everything compiles down to the shipped contract wedge (`evaluateContract`, convergent/absent/divergent). Teach adds `path-forbidden` and `orphan-forbidden` expectation kinds and a policy that compiles to expectations. Understand infers directory boundaries + instability (measured). Guard evaluates a policy against the live graph into a two-channel report (deterministic violations vs heuristic smells), with severity capped by provenance so a guessed label can never fail CI.

**Tech Stack:** TypeScript (ESM), vitest, commander CLI, `@modelcontextprotocol/sdk`. Build is `tsc --noEmit && tsup`; tests `npm run test:run`.

**Reference — reused signatures (already shipped, do not reimplement):**
- `src/core/contract.ts`: `type Expectation`, `evaluateContract(contract, index, graph): ContractResult`, `Classification = "convergent"|"absent"|"divergent"`, `pathMatches(value, pattern)` (private — glob via `matchesPattern`).
- `src/core/dep-graph.ts`: `buildDepGraph({root}): Promise<DepGraph>`, `findDependents(graph, targets, {symbol?}): {direct,transitive,all,details}`.
- `src/core/indexer.ts`: `generateIndex({root}): Promise<RepoIndex>`.
- `src/core/utils.ts`: `ensureDir`, `writeJson`, `readJson<T>`, `readFileSafe`.
- Types (`src/types/index.ts`): `DepGraph{nodes:DepNode[],edges:DepEdge[],cycles,stats}`, `DepEdge{from,to,type,...}`, `FileInfo{relativePath,type,...}`, `RepoIndex{files:FileInfo[],...}`.

---

### Task 1: `path-forbidden` expectation kind (transitive isolation)

**Files:**
- Modify: `src/core/contract.ts` (Expectation union ~line 20; switch in `evaluateContract` ~line 70)
- Test: `src/core/contract.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/contract.test.ts`:

```ts
describe("path-forbidden expectation", () => {
  it("is divergent when the target is reachable transitively, convergent when not", async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-pf-"));
    try {
      const w = (rel: string, c: string) => {
        const abs = path.join(r, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, c);
      };
      w("package.json", JSON.stringify({ name: "p", version: "1" }));
      // ui -> service -> db  (ui reaches db only transitively)
      w("src/ui/page.ts", 'import { s } from "../service/s";\nexport const p = s;');
      w("src/service/s.ts", 'import { d } from "../db/d";\nexport const s = d;');
      w("src/db/d.ts", "export const d = 1;");
      w("src/lonely/x.ts", "export const x = 1;");

      const index = await generateIndex({ root: r });
      const graph = await buildDepGraph({ root: r });

      const forbidden = evaluateContract(
        { name: "t", expect: [{ kind: "path-forbidden", from: "src/ui/**", to: "src/db/**" }] },
        index, graph
      );
      expect(forbidden.results[0].classification).toBe("divergent");

      const allowed = evaluateContract(
        { name: "t", expect: [{ kind: "path-forbidden", from: "src/lonely/**", to: "src/db/**" }] },
        index, graph
      );
      expect(allowed.results[0].classification).toBe("convergent");
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/contract.test.ts -t "path-forbidden"`
Expected: FAIL — the `path-forbidden` kind falls through to the `default` case and is classified `absent`, not `divergent`/`convergent`.

- [ ] **Step 3: Add the kind to the union and a case in the switch**

In `src/core/contract.ts`, add to the `Expectation` union (after the `edge-forbidden` line):

```ts
  | { kind: "path-forbidden"; from: string; to: string };
```

Add an import at the top of the file:

```ts
import { findDependents } from "./dep-graph.js";
```

Add this `case` in the `evaluateContract` switch (before the `default`):

```ts
      case "path-forbidden": {
        // Reachability: is any `to`-matching file reachable (directly or
        // transitively) from any `from`-matching file, following imports?
        const toNodes = graph.nodes
          .map((n) => n.id)
          .filter((id) => pathMatches(id, expectation.to));
        // findDependents walks importers of `to`; a from-file that appears in
        // that closure reaches `to`.
        const reachers = new Set(findDependents(graph, toNodes).all);
        const matches = graph.nodes
          .map((n) => n.id)
          .filter((id) => pathMatches(id, expectation.from) && reachers.has(id));
        return {
          expectation,
          classification: matches.length > 0 ? "divergent" : "convergent",
          detail:
            matches.length > 0
              ? `reaches forbidden target: ${matches.join(", ")}`
              : `no path ${expectation.from} -> ${expectation.to}`,
          matches: matches.length > 0 ? matches : undefined,
        };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/contract.test.ts -t "path-forbidden"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/contract.ts src/core/contract.test.ts
git commit -m "feat(contract): add path-forbidden expectation (transitive isolation)"
```

---

### Task 2: `orphan-forbidden` expectation kind

**Files:**
- Modify: `src/core/contract.ts`
- Test: `src/core/contract.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/contract.test.ts`:

```ts
describe("orphan-forbidden expectation", () => {
  it("flags a file with no imports and no importers that is not an entrypoint", async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-orphan-"));
    try {
      const w = (rel: string, c: string) => {
        const abs = path.join(r, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, c);
      };
      w("package.json", JSON.stringify({ name: "p", version: "1" }));
      w("src/a.ts", 'import { b } from "./b";\nexport const a = b;');
      w("src/b.ts", "export const b = 1;");
      w("src/orphan.ts", "export const orphan = 1;"); // nothing imports it

      const index = await generateIndex({ root: r });
      const graph = await buildDepGraph({ root: r });

      const res = evaluateContract(
        { name: "t", expect: [{ kind: "orphan-forbidden", entrypoints: ["src/a.ts"] }] },
        index, graph
      );
      expect(res.results[0].classification).toBe("divergent");
      expect(res.results[0].matches).toContain("src/orphan.ts");
      expect(res.results[0].matches).not.toContain("src/a.ts");
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/contract.test.ts -t "orphan-forbidden"`
Expected: FAIL — kind unknown, classified `absent`.

- [ ] **Step 3: Add the kind and case**

Add to the `Expectation` union:

```ts
  | { kind: "orphan-forbidden"; entrypoints?: string[] };
```

Add this `case` before `default`:

```ts
      case "orphan-forbidden": {
        const entry = new Set(expectation.entrypoints ?? []);
        const hasOut = new Set(graph.edges.map((e) => e.from));
        const hasIn = new Set(graph.edges.map((e) => e.to));
        const orphans = graph.nodes
          .map((n) => n.id)
          .filter((id) => !hasOut.has(id) && !hasIn.has(id) && !entry.has(id));
        return {
          expectation,
          classification: orphans.length > 0 ? "divergent" : "convergent",
          detail:
            orphans.length > 0
              ? `orphan modules: ${orphans.join(", ")}`
              : "no orphan modules",
          matches: orphans.length > 0 ? orphans : undefined,
        };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/contract.test.ts -t "orphan-forbidden"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/contract.ts src/core/contract.test.ts
git commit -m "feat(contract): add orphan-forbidden expectation"
```

---

### Task 3: Policy types + label resolver

**Files:**
- Create: `src/core/policy.ts`
- Test: `src/core/policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveLabels, type ArchitecturePolicy } from "./policy.js";

const POLICY: ArchitecturePolicy = {
  version: "1.0.0",
  labels: [
    { label: "core", include: ["src/core/**"], provenance: "declared" },
    { label: "cli", include: ["src/commands/**", "src/bin/**"], provenance: "declared" },
  ],
  forbidden: [],
  entrypoints: [],
};

describe("resolveLabels", () => {
  it("maps each file to its label and reports unlabeled files", () => {
    const files = ["src/core/utils.ts", "src/commands/scan.ts", "src/bin/cli.ts", "src/rogue.ts"];
    const { labelOf, unlabeled } = resolveLabels(POLICY, files);

    expect(labelOf.get("src/core/utils.ts")).toBe("core");
    expect(labelOf.get("src/commands/scan.ts")).toBe("cli");
    expect(labelOf.get("src/bin/cli.ts")).toBe("cli");
    expect(unlabeled).toEqual(["src/rogue.ts"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/policy.test.ts`
Expected: FAIL — `Cannot find module './policy.js'`.

- [ ] **Step 3: Create the module**

Create `src/core/policy.ts`:

```ts
import { matchesPattern } from "./utils.js";

export interface PolicyLabel {
  label: string;
  include: string[];
  exclude?: string[];
  provenance: "declared" | "inferred";
}

export interface PolicyRule {
  from: string;               // label
  to: string;                 // label
  kind: "edge" | "path";
  dependencyType?: "any" | "runtime";
  ratified: boolean;
}

export interface ArchitecturePolicy {
  version: string;
  labels: PolicyLabel[];
  forbidden: PolicyRule[];
  entrypoints: string[];
}

/**
 * Map each file to at most one label (first matching label wins) and collect
 * files that match no label. O(files x labels), computed once per guard run.
 */
export function resolveLabels(
  policy: ArchitecturePolicy,
  files: string[]
): { labelOf: Map<string, string>; unlabeled: string[] } {
  const labelOf = new Map<string, string>();
  const unlabeled: string[] = [];
  for (const file of files) {
    let matched: string | undefined;
    for (const l of policy.labels) {
      const inc = l.include.some((g) => matchesPattern(file, g));
      const exc = (l.exclude ?? []).some((g) => matchesPattern(file, g));
      if (inc && !exc) {
        matched = l.label;
        break;
      }
    }
    if (matched) labelOf.set(file, matched);
    else unlabeled.push(file);
  }
  return { labelOf, unlabeled };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/policy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/policy.ts src/core/policy.test.ts
git commit -m "feat(policy): ArchitecturePolicy types and label resolver"
```

---

### Task 4: Compile a policy rule into expectations

**Files:**
- Modify: `src/core/policy.ts`
- Test: `src/core/policy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/policy.test.ts`:

```ts
import { compileRule } from "./policy.js";

describe("compileRule", () => {
  it("expands a label->label edge rule into edge-forbidden expectations over globs", () => {
    const exps = compileRule(POLICY, {
      from: "core", to: "cli", kind: "edge", ratified: true,
    });
    // core has 1 glob, cli has 2 globs -> 2 edge-forbidden expectations
    expect(exps).toHaveLength(2);
    expect(exps.every((e) => e.kind === "edge-forbidden")).toBe(true);
    expect(exps).toContainEqual({ kind: "edge-forbidden", from: "src/core/**", to: "src/commands/**" });
  });

  it("compiles a path rule into a single path-forbidden per glob pair", () => {
    const exps = compileRule(POLICY, {
      from: "cli", to: "core", kind: "path", ratified: true,
    });
    expect(exps).toHaveLength(2);
    expect(exps.every((e) => e.kind === "path-forbidden")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/policy.test.ts -t compileRule`
Expected: FAIL — `compileRule` is not exported.

- [ ] **Step 3: Implement `compileRule`**

Add to `src/core/policy.ts` (import the Expectation type at the top):

```ts
import type { Expectation } from "./contract.js";
```

```ts
/** Expand a label->label rule into wedge expectations over the label globs. */
export function compileRule(
  policy: ArchitecturePolicy,
  rule: PolicyRule
): Expectation[] {
  const globsFor = (label: string) =>
    policy.labels.filter((l) => l.label === label).flatMap((l) => l.include);
  const fromGlobs = globsFor(rule.from);
  const toGlobs = globsFor(rule.to);
  const out: Expectation[] = [];
  for (const from of fromGlobs) {
    for (const to of toGlobs) {
      out.push(
        rule.kind === "path"
          ? { kind: "path-forbidden", from, to }
          : { kind: "edge-forbidden", from, to }
      );
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/policy.test.ts -t compileRule`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/policy.ts src/core/policy.test.ts
git commit -m "feat(policy): compile label rules to wedge expectations"
```

---

### Task 5: Understand — infer directory boundaries + instability

**Files:**
- Create: `src/core/understand.ts`
- Test: `src/core/understand.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/understand.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { inferBoundaries } from "./understand.js";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-understand-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  // core is depended-on (stable); ui depends outward (unstable)
  w("src/ui/page.ts", 'import { u } from "../core/util";\nexport const p = u;');
  w("src/core/util.ts", "export const u = 1;");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("inferBoundaries", () => {
  it("groups files by top-level src directory with instability and cross-edges", async () => {
    const index = await generateIndex({ root });
    const graph = await buildDepGraph({ root });
    const boundaries = inferBoundaries(index, graph);

    const byLabel = Object.fromEntries(boundaries.map((b) => [b.label, b]));
    expect(Object.keys(byLabel).sort()).toEqual(["core", "ui"]);
    // ui imports core: ui has efferent coupling, core has afferent
    expect(byLabel.ui.instability).toBe(1); // Ce=1, Ca=0 -> 1
    expect(byLabel.core.instability).toBe(0); // Ce=0, Ca=1 -> 0
    expect(byLabel.ui.crossEdges).toContainEqual(
      expect.objectContaining({ from: "src/ui/page.ts", to: "src/core/util.ts" })
    );
    expect(byLabel.ui.provenance).toBe("inferred");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/understand.test.ts`
Expected: FAIL — `Cannot find module './understand.js'`.

- [ ] **Step 3: Create the module**

Create `src/core/understand.ts`:

```ts
import type { RepoIndex, DepGraph } from "../types/index.js";

export interface Boundary {
  label: string;
  globs: string[];
  provenance: "inferred";
  instability: number; // Ce/(Ca+Ce), 0 = maximally stable
  crossEdges: Array<{ from: string; to: string; line?: number }>;
}

/** The label a file belongs to: its top-level directory under src/ (or "root"). */
function boundaryOf(relativePath: string): string {
  const p = relativePath.replace(/\\/g, "/");
  const m = p.match(/^src\/([^/]+)\//);
  if (m) return m[1];
  const top = p.split("/")[0];
  return top.includes(".") ? "root" : top;
}

/**
 * Infer boundaries from directory structure (measured), with Martin instability
 * and the exact cross-boundary edge list per boundary. No community detection.
 */
export function inferBoundaries(index: RepoIndex, graph: DepGraph): Boundary[] {
  const labelOf = new Map<string, string>();
  for (const f of index.files) labelOf.set(f.relativePath, boundaryOf(f.relativePath));

  const ce = new Map<string, number>(); // efferent: edges leaving the boundary
  const ca = new Map<string, number>(); // afferent: edges entering the boundary
  const cross = new Map<string, Boundary["crossEdges"]>();
  const globs = new Map<string, Set<string>>();

  for (const [file, label] of labelOf) {
    if (!globs.has(label)) globs.set(label, new Set());
    globs.get(label)!.add(`src/${label}/**`);
  }

  for (const edge of graph.edges) {
    const from = labelOf.get(edge.from);
    const to = labelOf.get(edge.to);
    if (!from || !to || from === to) continue;
    ce.set(from, (ce.get(from) ?? 0) + 1);
    ca.set(to, (ca.get(to) ?? 0) + 1);
    if (!cross.has(from)) cross.set(from, []);
    cross.get(from)!.push({ from: edge.from, to: edge.to, line: edge.line });
  }

  const labels = [...new Set(labelOf.values())].sort();
  return labels.map((label) => {
    const e = ce.get(label) ?? 0;
    const a = ca.get(label) ?? 0;
    return {
      label,
      globs: [...(globs.get(label) ?? [])],
      provenance: "inferred" as const,
      instability: e + a === 0 ? 0 : e / (e + a),
      crossEdges: cross.get(label) ?? [],
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/understand.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/understand.ts src/core/understand.test.ts
git commit -m "feat(understand): infer directory boundaries with instability"
```

---

### Task 6: Derive a policy from the current graph (propose satisfied rules)

**Files:**
- Modify: `src/core/policy.ts`
- Test: `src/core/policy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/policy.test.ts`:

```ts
import { describe as d2, it as i2, expect as e2 } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { derivePolicy } from "./policy.js";

d2("derivePolicy", () => {
  i2("proposes labels from directories and forbidden rules the code already satisfies", async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-derive-"));
    try {
      const w = (rel: string, c: string) => {
        const abs = path.join(r, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, c);
      };
      w("package.json", JSON.stringify({ name: "p", version: "1" }));
      // ui -> core, and core never imports ui: "core must not import ui" is satisfied.
      w("src/ui/page.ts", 'import { u } from "../core/util";\nexport const p = u;');
      w("src/core/util.ts", "export const u = 1;");

      const index = await generateIndex({ root: r });
      const graph = await buildDepGraph({ root: r });
      const policy = derivePolicy(index, graph);

      e2(policy.labels.map((l) => l.label).sort()).toEqual(["core", "ui"]);
      e2(policy.labels.every((l) => l.provenance === "inferred")).toBe(true);
      // proposes the satisfied invariant core -> ui, unratified
      const rule = policy.forbidden.find((f) => f.from === "core" && f.to === "ui");
      e2(rule).toBeDefined();
      e2(rule!.ratified).toBe(false);
      // does NOT propose ui -> core (that edge exists, so it is not an invariant)
      e2(policy.forbidden.find((f) => f.from === "ui" && f.to === "core")).toBeUndefined();
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/policy.test.ts -t derivePolicy`
Expected: FAIL — `derivePolicy` not exported.

- [ ] **Step 3: Implement `derivePolicy`**

Add to `src/core/policy.ts`:

```ts
import type { RepoIndex, DepGraph } from "../types/index.js";
import { inferBoundaries } from "./understand.js";

/**
 * Derive a candidate policy from the current graph: directory labels (inferred)
 * plus every directional invariant the code already satisfies (from -> to where
 * no edge from-label -> to-label exists), proposed unratified.
 */
export function derivePolicy(index: RepoIndex, graph: DepGraph): ArchitecturePolicy {
  const boundaries = inferBoundaries(index, graph);
  const labels: PolicyLabel[] = boundaries.map((b) => ({
    label: b.label,
    include: b.globs,
    provenance: "inferred",
  }));

  // Which label->label directions currently have at least one edge?
  const existing = new Set<string>();
  const labelOf = new Map<string, string>();
  for (const b of boundaries) {
    for (const f of index.files) {
      if (b.globs.some((g) => f.relativePath.startsWith(`src/${b.label}/`)))
        labelOf.set(f.relativePath, b.label);
    }
  }
  for (const e of graph.edges) {
    const f = labelOf.get(e.from);
    const t = labelOf.get(e.to);
    if (f && t && f !== t) existing.add(`${f} -> ${t}`);
  }

  const names = boundaries.map((b) => b.label);
  const forbidden: PolicyRule[] = [];
  for (const from of names) {
    for (const to of names) {
      if (from === to) continue;
      // Propose forbidding a direction only if the code already satisfies it.
      if (!existing.has(`${from} -> ${to}`)) {
        forbidden.push({ from, to, kind: "edge", ratified: false });
      }
    }
  }

  return { version: "1.0.0", labels, forbidden, entrypoints: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/policy.test.ts -t derivePolicy`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/policy.ts src/core/policy.test.ts
git commit -m "feat(policy): derive candidate policy from the current graph"
```

---

### Task 7: Guard evaluator — two-channel report with provenance-capped severity

**Files:**
- Create: `src/core/guard.ts`
- Test: `src/core/guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/guard.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { evaluateGuard } from "./guard.js";
import type { ArchitecturePolicy } from "./policy.js";

let root: string;
async function gi() {
  return { index: await generateIndex({ root }), graph: await buildDepGraph({ root }) };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "repointel-guard-"));
  const w = (rel: string, c: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c);
  };
  w("package.json", JSON.stringify({ name: "p", version: "1" }));
  // core imports ui -> violates "core must not import ui"
  w("src/core/util.ts", 'import { p } from "../ui/page";\nexport const u = p;');
  w("src/ui/page.ts", "export const p = 1;");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const rule = (provenance: "declared" | "inferred"): ArchitecturePolicy => ({
  version: "1.0.0",
  labels: [
    { label: "core", include: ["src/core/**"], provenance },
    { label: "ui", include: ["src/ui/**"], provenance },
  ],
  forbidden: [{ from: "core", to: "ui", kind: "edge", ratified: true }],
  entrypoints: [],
});

describe("evaluateGuard", () => {
  it("reports a declared-label violation as an error", async () => {
    const { index, graph } = await gi();
    const report = evaluateGuard(rule("declared"), index, graph);
    const v = report.violations.find((x) => x.classification === "divergent");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(v!.matches).toContain("src/core/util.ts -> src/ui/page.ts");
  });

  it("caps an inferred-label violation at warning (never fails CI)", async () => {
    const { index, graph } = await gi();
    const report = evaluateGuard(rule("inferred"), index, graph);
    const v = report.violations.find((x) => x.classification === "divergent");
    expect(v!.severity).toBe("warning");
  });

  it("reports unlabeled files in the coverage channel", async () => {
    const { index, graph } = await gi();
    const policy = rule("declared");
    policy.labels = [{ label: "core", include: ["src/core/**"], provenance: "declared" }];
    const report = evaluateGuard(policy, index, graph);
    expect(report.coverage.unlabeled).toContain("src/ui/page.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/guard.test.ts`
Expected: FAIL — `Cannot find module './guard.js'`.

- [ ] **Step 3: Create the module**

Create `src/core/guard.ts`:

```ts
import type { RepoIndex, DepGraph } from "../types/index.js";
import { evaluateContract } from "./contract.js";
import {
  resolveLabels,
  compileRule,
  type ArchitecturePolicy,
} from "./policy.js";

export interface GuardViolation {
  rule: string;
  classification: "convergent" | "divergent";
  matches: string[];
  severity: "error" | "warning";
  provenance: "declared" | "inferred";
}

export interface GuardReport {
  ok: boolean; // true when no error-level violation
  violations: GuardViolation[];
  smells: Array<{ rule: string; detail: string; severity: "warning" }>;
  coverage: { unlabeled: string[] };
}

/** A rule is declared only if BOTH its endpoint labels are declared. */
function ruleProvenance(
  policy: ArchitecturePolicy,
  from: string,
  to: string
): "declared" | "inferred" {
  const decl = (label: string) =>
    policy.labels
      .filter((l) => l.label === label)
      .every((l) => l.provenance === "declared") &&
    policy.labels.some((l) => l.label === label);
  return decl(from) && decl(to) ? "declared" : "inferred";
}

export function evaluateGuard(
  policy: ArchitecturePolicy,
  index: RepoIndex,
  graph: DepGraph
): GuardReport {
  const files = index.files.map((f) => f.relativePath);
  const { unlabeled } = resolveLabels(policy, files);

  const violations: GuardViolation[] = [];
  for (const rule of policy.forbidden) {
    if (!rule.ratified) continue; // unratified rules are proposals, not gates
    const provenance = ruleProvenance(policy, rule.from, rule.to);
    const expectations = compileRule(policy, rule);
    const result = evaluateContract(
      { name: `${rule.from}->${rule.to}`, expect: expectations },
      index,
      graph
    );
    const divergent = result.results.filter(
      (r) => r.classification === "divergent"
    );
    const matches = divergent.flatMap((r) => r.matches ?? []);
    violations.push({
      rule: `${rule.from} must not ${rule.kind === "path" ? "reach" : "import"} ${rule.to}`,
      classification: matches.length > 0 ? "divergent" : "convergent",
      matches,
      // Provenance cap: an inferred rule can never be an error.
      severity:
        matches.length > 0 && provenance === "declared" ? "error" : "warning",
      provenance,
    });
  }

  // Smell: god-file by degree (fan-in + fan-out), heuristic, warning-only.
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const smells: GuardReport["smells"] = [];
  const threshold = Math.max(10, files.length / 3);
  for (const [file, d] of degree) {
    if (d > threshold)
      smells.push({
        rule: "god-file (high fan-in + fan-out)",
        detail: `${file} has degree ${d}`,
        severity: "warning",
      });
  }

  return {
    ok: !violations.some((v) => v.severity === "error"),
    violations,
    smells,
    coverage: { unlabeled },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/guard.test.ts`
Expected: PASS (all three cases)

- [ ] **Step 5: Commit**

```bash
git add src/core/guard.ts src/core/guard.test.ts
git commit -m "feat(guard): two-channel fitness report with provenance-capped severity"
```

---

### Task 8: `repointel teach init` — derive + write the policy file

**Files:**
- Create: `src/commands/teach.ts`
- Modify: `src/bin/cli.ts`
- Test: `src/commands/teach.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/commands/teach.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/teach.test.ts`
Expected: FAIL — `Cannot find module './teach.js'`.

- [ ] **Step 3: Create the command**

Create `src/commands/teach.ts`:

```ts
import pc from "picocolors";
import * as path from "node:path";
import { generateIndex } from "../core/indexer.js";
import { buildDepGraph } from "../core/dep-graph.js";
import { derivePolicy } from "../core/policy.js";
import { writeJson } from "../core/utils.js";

export interface TeachInitOptions {
  root?: string;
}

export async function teachInit(options: TeachInitOptions = {}): Promise<void> {
  const root = options.root || process.cwd();
  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });
  const policy = derivePolicy(index, graph);

  const out = path.join(root, ".repointel", "architecture.json");
  writeJson(out, policy);

  console.log(pc.green(`\n  ✓ Derived policy: ${policy.labels.length} labels, ${policy.forbidden.length} candidate rules`));
  console.log(pc.dim("    All labels are 'inferred' and all rules 'ratified:false'."));
  console.log(pc.dim("    Review .repointel/architecture.json:"));
  console.log(pc.dim("      - promote a label's provenance to 'declared' to let its rules gate CI"));
  console.log(pc.dim("      - set a rule's 'ratified' to true to enforce it"));
  console.log(`\n  → ${pc.cyan(path.relative(root, out))}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/teach.test.ts`
Expected: PASS

- [ ] **Step 5: Register the CLI command**

In `src/bin/cli.ts`, add the import near the other command imports:

```ts
import { teachInit } from "../commands/teach.js";
```

Add the command registration (after the `contract` command block):

```ts
program
  .command("teach")
  .description("Derive an architecture policy from the current graph (Teach layer)")
  .argument("[action]", "action: init", "init")
  .action(async (action: string) => {
    if (action !== "init") {
      console.error(`Unknown teach action: ${action}. Try: teach init`);
      process.exitCode = 2;
      return;
    }
    await teachInit({});
  });
```

- [ ] **Step 6: Build and verify the command runs**

Run: `npm run build && node dist/bin/cli.js teach init`
Expected: writes `.repointel/architecture.json`, prints the derived label/rule counts. (This runs against repointel itself — confirm labels include `core`, `commands`, `bin`, `mcp`, `types`.)

- [ ] **Step 7: Commit**

```bash
git add src/commands/teach.ts src/commands/teach.test.ts src/bin/cli.ts
git commit -m "feat(cli): teach init — derive architecture policy"
```

---

### Task 9: `repointel guard check` — evaluate policy, exit codes

**Files:**
- Create: `src/commands/guard.ts`
- Modify: `src/bin/cli.ts`
- Test: `src/commands/guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/commands/guard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/guard.test.ts`
Expected: FAIL — `Cannot find module './guard.js'`.

- [ ] **Step 3: Create the command**

Create `src/commands/guard.ts`:

```ts
import pc from "picocolors";
import * as path from "node:path";
import { generateIndex } from "../core/indexer.js";
import { buildDepGraph } from "../core/dep-graph.js";
import { readJson } from "../core/utils.js";
import { evaluateGuard } from "../core/guard.js";
import type { ArchitecturePolicy } from "../core/policy.js";

export interface GuardCheckOptions {
  root?: string;
  json?: boolean;
}

export async function guardCheck(options: GuardCheckOptions = {}): Promise<void> {
  const root = options.root || process.cwd();
  const policyPath = path.join(root, ".repointel", "architecture.json");
  const policy = readJson<ArchitecturePolicy>(policyPath);
  if (!policy) {
    console.error(`No policy at ${path.relative(root, policyPath)}. Run: repointel teach init`);
    process.exitCode = 2;
    return;
  }

  const index = await generateIndex({ root });
  const graph = await buildDepGraph({ root });
  const report = evaluateGuard(policy, index, graph);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  console.log(pc.bold("\n  Architecture fitness\n"));
  for (const v of report.violations) {
    if (v.classification !== "divergent") continue;
    const tag = v.severity === "error" ? pc.red("✗ error") : pc.yellow("⚠ warn");
    console.log(`  ${tag}  ${v.rule} (${v.provenance})`);
    for (const m of v.matches.slice(0, 5)) console.log(pc.dim(`         ${m}`));
  }
  for (const s of report.smells) console.log(`  ${pc.yellow("⚠ smell")} ${s.detail}`);
  if (report.coverage.unlabeled.length > 0)
    console.log(`  ${pc.yellow("⚠ coverage")} ${report.coverage.unlabeled.length} unlabeled file(s)`);
  console.log(report.ok ? pc.green("\n  ✓ no error-level violations\n") : pc.red("\n  ✗ error-level violations present\n"));

  process.exitCode = report.ok ? 0 : 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/guard.test.ts`
Expected: PASS

- [ ] **Step 5: Register the CLI command**

In `src/bin/cli.ts`, add:

```ts
import { guardCheck } from "../commands/guard.js";
```

```ts
program
  .command("guard")
  .description("Check the codebase against its architecture policy (Guard layer)")
  .argument("[action]", "action: check", "check")
  .option("-j, --json", "Machine-readable report")
  .action(async (action: string, opts: { json?: boolean }) => {
    if (action !== "check") {
      console.error(`Unknown guard action: ${action}. Try: guard check`);
      process.exitCode = 2;
      return;
    }
    await guardCheck({ json: opts.json });
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/guard.ts src/commands/guard.test.ts src/bin/cli.ts
git commit -m "feat(cli): guard check — architecture fitness with exit codes"
```

---

### Task 10: Expose Guard in the `repo_intel` MCP tool

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `src/mcp/server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/mcp/server.test.ts` (inside the existing `describe("repointel MCP server", ...)`):

```ts
  it("returns a guard report when guard:true and a policy exists", async () => {
    fs.writeFileSync(
      path.join(repoRoot, ".repointel", "architecture.json"),
      JSON.stringify({
        version: "1.0.0",
        labels: [{ label: "all", include: ["src/**"], provenance: "inferred" }],
        forbidden: [],
        entrypoints: [],
      })
    );
    const result = await client.callTool({
      name: "repo_intel",
      arguments: { root: repoRoot, guard: true },
    });
    const payload = callResult(result);
    expect(payload.guard).toBeDefined();
    expect(payload.guard).toHaveProperty("ok");
    expect(payload.guard).toHaveProperty("coverage");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp/server.test.ts -t "guard report"`
Expected: FAIL — `payload.guard` is undefined.

- [ ] **Step 3: Wire guard into the handler**

In `src/mcp/server.ts`, add imports:

```ts
import { evaluateGuard } from "../core/guard.js";
import type { ArchitecturePolicy } from "../core/policy.js";
import { readJson } from "../core/utils.js";
```

Add a `guard` param to the tool's `inputSchema` (alongside `includeTests`):

```ts
        guard: z
          .boolean()
          .optional()
          .describe(
            "Also return the architecture fitness report from .repointel/architecture.json (Guard layer)."
          ),
```

Add `guard` to the handler destructure: `async ({ root, seeds, name, refresh, includeTests, symbol, guard }) => {`

After the impact block (before the final `return`), add:

```ts
        if (guard) {
          const policy = readJson<ArchitecturePolicy>(
            path.join(repoRoot, ".repointel", "architecture.json")
          );
          if (policy) {
            const { buildDepGraph } = await import("../core/dep-graph.js");
            const { generateIndex } = await import("../core/indexer.js");
            const gIndex = await generateIndex({ root: repoRoot, includeTests });
            const gGraph = await buildDepGraph({ root: repoRoot, includeTests });
            (payload as Record<string, unknown>).guard = evaluateGuard(policy, gIndex, gGraph);
          } else {
            (payload as Record<string, unknown>).guard = {
              error: "no .repointel/architecture.json — run `repointel teach init`",
            };
          }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp/server.test.ts -t "guard report"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/server.test.ts
git commit -m "feat(mcp): expose guard report via repo_intel guard param"
```

---

### Task 11: End-to-end acceptance test (dogfood on repointel itself)

**Files:**
- Test: `src/core/guard.acceptance.test.ts`

- [ ] **Step 1: Write the acceptance test**

Create `src/core/guard.acceptance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateIndex } from "./indexer.js";
import { buildDepGraph } from "./dep-graph.js";
import { derivePolicy } from "./policy.js";
import { evaluateGuard } from "./guard.js";
import type { ArchitecturePolicy } from "./policy.js";

const ROOT = process.cwd();

describe("architecture fitness on repointel itself", () => {
  it("derives a policy whose ratified declared invariants hold on the real graph", async () => {
    const index = await generateIndex({ root: ROOT });
    const graph = await buildDepGraph({ root: ROOT });

    // Derive, then RATIFY + DECLARE a known-true invariant: core must not
    // import commands (the CLI layer depends on core, never the reverse).
    const derived = derivePolicy(index, graph);
    const policy: ArchitecturePolicy = {
      ...derived,
      labels: derived.labels.map((l) =>
        l.label === "core" || l.label === "commands"
          ? { ...l, provenance: "declared" }
          : l
      ),
      forbidden: derived.forbidden.map((r) =>
        r.from === "core" && r.to === "commands" ? { ...r, ratified: true } : r
      ),
    };

    const report = evaluateGuard(policy, index, graph);
    // The invariant is real, so guard must pass (no error-level violation).
    expect(report.ok).toBe(true);
    const coreToCommands = report.violations.find(
      (v) => v.rule.startsWith("core must not import commands")
    );
    expect(coreToCommands?.classification).toBe("convergent");
  });

  it("catches an injected violation", async () => {
    const index = await generateIndex({ root: ROOT });
    const graph = await buildDepGraph({ root: ROOT });
    // Synthesize a forbidden edge in the graph copy: commands -> mcp forbidden,
    // but inject a core->commands edge to prove detection.
    const injected = {
      ...graph,
      edges: [...graph.edges, { from: "src/core/utils.ts", to: "src/commands/scan.ts", type: "static" as const }],
    };
    const policy: ArchitecturePolicy = {
      version: "1.0.0",
      labels: [
        { label: "core", include: ["src/core/**"], provenance: "declared" },
        { label: "commands", include: ["src/commands/**"], provenance: "declared" },
      ],
      forbidden: [{ from: "core", to: "commands", kind: "edge", ratified: true }],
      entrypoints: [],
    };
    const report = evaluateGuard(policy, index, injected);
    expect(report.ok).toBe(false);
    const v = report.violations.find((x) => x.severity === "error");
    expect(v!.matches).toContain("src/core/utils.ts -> src/commands/scan.ts");
  });
});
```

- [ ] **Step 2: Run the acceptance test**

Run: `npx vitest run src/core/guard.acceptance.test.ts`
Expected: PASS — both cases. (If case 1 fails because `core` legitimately imports `commands` somewhere, that is a REAL finding: investigate the edge; either it is a genuine layering violation to fix, or `core`/`commands` need relabeling. Do not weaken the test to make it pass.)

- [ ] **Step 3: Full verification**

Run: `npm run build && npm run test:run`
Expected: build clean (tsc gate passes), all tests green.

- [ ] **Step 4: Commit**

```bash
git add src/core/guard.acceptance.test.ts
git commit -m "test(guard): end-to-end acceptance on repointel itself"
```

---

## Self-Review

**Spec coverage:**
- §5.2 Teach expectation kinds → Tasks 1, 2. ✓
- §5.2 policy + compilation → Tasks 3, 4. ✓
- §5.1 Understand (measured boundaries + instability) → Task 5. ✓ (actions-from-ApiGraph deferred to Plan 2 — Guide is the only consumer; noted below.)
- §4 derive-and-ratify → Tasks 6 (derive), 8 (init writes unratified/inferred). Drift baseline diff → **deferred to Plan 1.5 / folded into Guard v2** (see note).
- §5.3 Guard two-channel report + provenance cap + CI exit + MCP → Tasks 7, 9, 10. ✓
- §7 acceptance → Task 11. ✓
- §5.4 Guide → **Plan 2** (explicitly out of this plan).

**Deviations from spec, called out honestly:**
- **Baseline drift diff** (§4.2 accept/reject) is NOT in this plan. Task 7's `evaluateGuard` produces the current-state report; the snapshot/diff/accept flow is a follow-on (it needs a committed-baseline UX). Guard v1 is still complete and useful without it. Add as "Plan 1.5" or first task of Plan 2.
- **Understand `actions` from ApiGraph** (§5.1) is deferred — nothing in Plan 1 consumes it; Guide (Plan 2) is its only consumer, so it belongs there.
- **`dependencyType` / type-only boundary on `edge-forbidden`** (§5.2) is deferred — not needed for the layering/hexagonal v1 rules; add when a hexagonal policy needs the runtime-vs-type distinction.

**Placeholder scan:** none — every step has complete code and exact run commands.

**Type consistency:** `ArchitecturePolicy`, `PolicyRule`, `PolicyLabel` defined in Task 3, used identically in 4/6/7/8/9/10. `GuardReport`/`GuardViolation` defined in Task 7, consumed in 9/10. `Boundary` defined in Task 5, used in 6. `resolveLabels`/`compileRule`/`derivePolicy`/`evaluateGuard`/`inferBoundaries`/`teachInit`/`guardCheck` names consistent across tasks. ✓

**Scope:** one buildable subsystem (the deterministic fitness spine); produces working, testable software (a `guard check` that gates CI). Guide is a separate plan.

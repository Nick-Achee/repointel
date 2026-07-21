# Design: the OODA architecture engine (Understand / Teach / Guard / Guide)

**Status:** Approved design, ready for implementation planning (2026-07-20)
**Basis:** 6-agent design workflow (research on statically-checkable principles + one
architect per layer), synthesized and stress-tested. Companion:
[THESIS_ROADMAP.md](../../THESIS_ROADMAP.md), [MCP.md](../../MCP.md).

## 1. Goal

Make repointel embody the OODA Product Builder SOP as **live, graph-grounded interfacing
prompts** instead of a static markdown template. Convert the SOP's Observe→Orient→Decide→Act
discipline into a tool that grounds each phase in the real dependency graph, asserts only
what the graph can prove, and asks the human for the rest.

This spec covers **one thin vertical slice touching all four layers**, dogfooded on
repointel itself.

## 2. The thesis: the contract wedge is the spine

Every layer compiles **down to the contract wedge already shipped in v0.5.0**
(`evaluateContract`, expectations `file-exists` / `export-exists` / `edge-exists` /
`edge-forbidden`, classified convergent / absent / divergent). No new checker is invented.

| SOP phase | Layer | Role |
|-----------|-------|------|
| Observe | (shipped graph) | facts: ranked slice, impact, git |
| Orient | **Understand** | infer boundaries + instability from the graph |
| Decide | **Guard** × **Teach** | check the graph against architecture rules |
| Act | (the wedge) | emit a contract of expected deltas to verify the change |
| — | **Guide** | orchestrate all of it into the SOP protocol document |

## 3. The integrity model: two channels, never mixed

The tool's credibility is a hard, structurally-enforced line between what the graph proves
and what it guesses. This is the single most important invariant in the design.

| Channel | Source | Max severity |
|---------|--------|--------------|
| **Violation** (deterministic) | dependency direction, layering, hexagonal, cycles, CQRS *module* separation, type-only boundary, orphans, transitive isolation — true graph oracles | **error** — only when the label is `declared` |
| **Smell** (heuristic) | god-file by degree, instability trend, vertical-slice cohesion ratio | **warning** |
| **Inferred** (guessed) | auto-seeded boundaries, naming-based query/command hints | **warning** |
| **Judgment** (not checkable) | "right primitive?", "abstraction earning its keep?", method-level CQS effects | **asked, never asserted** |

Never claimed as checkable (from the research — the design must not assert these):
method-level Command-Query Separation (an effect property, not an import property), full
CQRS correctness, whether a `domain/` file's *contents* match its label, true runtime
coupling strength, event-driven end-to-end correctness, business-volatility.

**Enforcement:** severity is capped by provenance in code, not by convention — an `inferred`
label can never produce an `error`. A future contributor cannot accidentally let a guessed
boundary fail CI.

## 4. The load-bearing UX problem: the layer map (derive-and-ratify)

Every deterministic Guard check is only as honest as the declared label map. Hand-authored
architecture rules are exactly where ArchUnit / dependency-cruiser adoption dies — nobody
keeps them current. The map therefore must be **derived and ratified, not authored**, using
the wedge's own snapshot/diff machinery one level up.

1. **Creation = confirm what the code already does.** `repointel teach init` reads the
   current graph and proposes: (a) labels from directory structure, and (b) the
   forbidden-edge rules the code **already satisfies today**, plus any Stable-Dependencies-
   Principle violations to fix. The human ratifies a checklist of observed invariants
   instead of authoring globs on a blank page. (This is `deriveContractFromDiff` lifted to
   the policy level: derive-policy-from-current-graph.)
2. **Drift = baseline diff, accept or reject.** The ratified policy is a committed,
   git-reviewed `.repointel/architecture.json`. `guard check` diffs the live graph against
   it; a new violation is surfaced as *"new since baseline: accept (update policy) or reject
   (fix code)?"* — the API Extractor `.api.md` model. The policy governs itself.
3. **Coverage cannot fall behind silently.** Files matching no label are a first-class
   warning ("N files match no layer, classify them"), so new top-level directories nag
   instead of being ignored.
4. **Provenance stays honest.** ratified → `declared` → may gate CI; auto-labeled or
   unratified → `inferred` → warn only.

## 5. The four layers (v1 scope)

### 5.1 Understand — infer the implied spec (measured only)

- **Module:** `src/core/understand.ts`, one pure function `inferSpec(index, depGraph,
  apiGraph, routeGraph): InferredSpec` over already-built graphs.
- **v1 emits:** boundaries from **directory structure** (measured); Martin instability
  `I = Ce / (Ca + Ce)` per boundary; the exact cross-boundary edge list; actions from the
  existing ApiGraph (Convex query/mutation/action, REST method+path) classified read/write.
- **Deferred:** community-detection boundaries (modularity is heuristic, Louvain is
  pass-order nondeterministic — the overclaim trap), LLM naming of primitives.
- **CLI:** `repointel understand [--json] [--seed <path>]`.

### 5.2 Teach — architecture principles as rules

- **Artifact:** `.repointel/architecture.json` — an `ArchitecturePolicy` (JSON,
  schema-validatable, LLM-emittable): label→globs map with per-label provenance, forbidden
  rules, entrypoint allowlist.
- **New expectation kinds** added to `contract.ts` (backward compatible): `path-forbidden`
  (transitive isolation via the `findDependents` reachability closure), `orphan-forbidden`
  (in-degree 0 ∧ out-degree 0 ∧ not an entrypoint). `edge-forbidden` already exists and
  gains an optional `dependencyType` (default `any`) for the type-only boundary.
- **Compilation:** a label maps to many globs; the compiler emits the cross-product of
  (fromGlob, toGlob) `edge-forbidden` expectations, or the evaluator precomputes
  `label(file)` membership once and scans edges. (Precompute is preferred — O(E) not
  O(rules·E).)
- **CLI:** `repointel teach init` (derive + ratify), writing the policy file.

### 5.3 Guard — the architecture fitness function

- **Module:** `src/core/guard.ts`, `evaluateGuard(policy, index, depGraph): GuardReport`.
- **v1 rule kinds (all deterministic, reuse existing engines):** acyclicity (`findSCCs`),
  `layer-forbidden` (precomputed labels + edge scan), `path-forbidden` (reachability
  closure), plus the coverage warning (unlabeled files) and one smell (god-file by degree).
- **Report:** two channels (violations / smells) that never merge; each violation carries
  the same convergent/divergent classification, the offending `from -> to` with file:line,
  and its provenance-capped severity. Reuses `snapshotGraph` / `diffSnapshots` for the
  baseline-drift accept/reject flow.
- **Surfaces:** `repointel guard check` (exit non-zero on `error`-level violations, for
  CI/hooks) and the `repo_intel` MCP tool (`guard: true`).

### 5.4 Guide — the OODA protocol runner

- **Module:** `src/commands/plan.ts` (composer, computes no new graph fact).
- **v1 command:** `repointel plan "<goal>" --seeds <area> [--json]` → the SOP Protocol-1
  Feature Plan as a **filled document**:
  - **Observe** — observed facts from the ranked seed slice, with file:line.
  - **Orient** — boundaries + instability from Understand; volatility as **questions**.
  - **Decide** — the GuardReport (violations + smells) + architecture recommendations.
  - **Act** — an emitted contract skeleton (expected graph deltas) to verify the change.
  - Judgment sections (right primitive? pattern choice? DoD specifics?) are printed as
    **explicit questions**, never filled.
- **Deferred:** the `drift` and `reorient` protocols (only `plan` ships in v1).

## 6. Key data shapes

```ts
interface InferredSpec {
  boundaries: Array<{
    label: string;
    globs: string[];
    provenance: "measured" | "inferred";
    instability: number;          // Ce/(Ca+Ce)
    crossEdges: Array<{ from: string; to: string; line?: number }>;
  }>;
  actions: Array<{ name: string; file: string; kind: "read" | "write" | "external" }>;
  unlabeled: string[];
}

interface ArchitecturePolicy {
  version: string;
  labels: Array<{ label: string; include: string[]; exclude?: string[];
                  provenance: "declared" | "inferred" }>;
  forbidden: Array<{ from: string; to: string; kind: "edge" | "path";
                     dependencyType?: "any" | "runtime"; ratified: boolean }>;
  entrypoints: string[];
}

interface GuardReport {
  violations: Array<{ rule: string; classification: "convergent" | "divergent";
                      matches: string[]; severity: "error" | "warning";
                      provenance: "declared" | "inferred" }>;
  smells: Array<{ rule: string; detail: string; severity: "warning" }>;
  coverage: { unlabeled: string[] };
  baseline?: { newViolations: string[]; fixedViolations: string[] };
}
```

## 7. Acceptance test (dogfood on repointel itself)

1. `repointel teach init` proposes labels `{bin, commands, core, mcp, types, generators,
   validators}` and forbidden rules the code already satisfies (e.g. `core -> commands`
   never occurs; cross-`commands` imports never occur). Human ratifies.
2. `repointel guard check` runs clean against the ratified policy (or surfaces a genuine
   violation — either is a passing test of the mechanism), exit 0.
3. Introduce a deliberate violation (make `src/core/utils.ts` import a command) →
   `guard check` reports it as a `divergent` `error` with file:line, exit non-zero.
4. `repointel plan "add rename detection" --seeds src/core/indexer.ts` emits a Feature Plan
   whose Decide section cites the guard results and whose Act section is a runnable contract.

## 8. Determinism / provenance rules (non-negotiable)

- No section, field, or report entry asserts a fact the graph cannot prove.
- Severity is capped by provenance in code: `inferred` ⇒ at most `warning`.
- Every auto-filled Guide section carries provenance and file:line; every non-graph section
  is an explicit question.
- Estimates and heuristics are labeled as such (carrying forward the v0.5.0 `provenance`
  discipline).

## 9. Testing approach

Test-first, matching the existing suite:
- Understand: instability math, cross-edge extraction, unlabeled detection — on fixtures.
- Teach: policy derivation from a known graph proposes the rules the fixture already
  satisfies; compilation to expectations is correct.
- Guard: a fixture with a known layering violation is `divergent`/`error`; a clean fixture
  is `convergent`; `inferred` labels never produce `error`; baseline diff detects a new
  violation.
- Guide: `plan` fills deterministic sections and leaves judgment sections as questions;
  `--json` output parses and carries provenance.

## 10. Explicitly out of scope for v1

Community-detection boundaries · method-level CQS · full CQRS correctness · git-churn
volatility · the `drift` and `reorient` protocols · LLM naming of primitives · a call graph
or any runtime/effect analysis. Each is named here so scope cannot creep silently.

## 11. Risks

- **Layer-map maintenance** (the biggest): mitigated by derive-and-ratify + drift diffs +
  unlabeled-file warnings (§4). If this UX is wrong, the tool is wrong.
- **Guide's marginal value over a frontier agent is unproven** — it is a one-shot grounded
  artifact (dodging per-turn-injection failure), but "meaningfully beats the agent reading
  the code" is a hypothesis. Build so the Guard-and-wedge floor is independently valuable.
- **Cross-product rule explosion** — precompute label membership to keep Guard O(E).

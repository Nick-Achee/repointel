# Changelog

## 0.7.0

The **Guide** layer — completes the OODA architecture engine. `repointel plan` turns the
OODA SOP from a static template into a live, graph-grounded document: deterministic sections
filled from the real graph, judgment sections asked as questions, never faked.

### Added

- **`repointel plan "<goal>" --seeds <area>`** — composes an Observe → Orient → Decide → Act
  Feature Plan document (written to `.repointel/plans/<slug>.md`, `--json` for the structured
  object):
  - **Observe** (measured): the PageRank-ranked seed slice with rank values + context pack.
  - **Orient** (inferred): directory boundaries with Martin instability `I = Ce/(Ca+Ce)`;
    volatility and business primitives as **questions**.
  - **Decide** (measured): the Guard fitness report + the impact of the seed area; pattern
    choice and invariants as **questions**.
  - **Act**: a contract skeleton of expected graph deltas to complete and verify with
    `repointel contract check`.
- **`planGoal`** on the `repo_intel` MCP tool (with `seeds`) — returns the structured plan;
  returns an explicit hint when seeds are missing.
- The OODA engine is now importable as a library: `buildPlan`, `renderPlan`, `evaluateGuard`,
  `derivePolicy`, `inferBoundaries` are re-exported from the package root.

### Integrity

- The pre-fill/ask boundary is the point: the plan auto-fills only what a graph **fact**
  answers and **asks** everything else. Provenance (`measured`/`inferred`) is printed per
  section; no inferred guess is ever stated as fact. Verified by adversarial review.

### Notes

- `plan` is a **composer** — it computes no new graph fact, only arranges the existing
  pipeline's outputs into the SOP shape.
- Deferred to a later release: the `drift` and `reorient` protocols. No index-format change.

## 0.6.0

The architecture-fitness spine — the first layer of the OODA architecture engine. Extends
the contract wedge from "does edge X exist" to "does this codebase obey its architecture,"
with rules **derived and ratified** from the current graph rather than hand-authored.

### Added

- **`repointel teach init`** — derives an `ArchitecturePolicy` from the current graph:
  directory labels plus the forbidden-edge rules the code **already satisfies**, all
  `inferred` and unratified. You confirm observed invariants instead of authoring a blank
  policy. Written to `.repointel/architecture.json`.
- **`repointel guard check`** — the architecture fitness function. Evaluates the policy into
  a two-channel report: deterministic **violations** vs heuristic **smells** (god-file by
  degree), plus **coverage** (unlabeled files). Exits non-zero on an error-level violation,
  `--json` for CI/hooks.
- **`guard: true`** on the `repo_intel` MCP tool — returns the fitness report inline.
- **Two new contract expectation kinds**: `path-forbidden` (transitive isolation via the
  reachability closure) and `orphan-forbidden`.
- **Understand** (`inferBoundaries`): directory boundaries with Martin instability
  `I = Ce/(Ca+Ce)` and the exact cross-boundary edge list (measured).

### Integrity

- **Severity is capped by provenance**, structurally: a machine-`inferred` label can never
  produce an `error`. Reaching CI-failing severity requires a human to declare **both**
  endpoint labels *and* ratify the rule. `derivePolicy` only ever emits `inferred` /
  `ratified:false`. Verified end-to-end by adversarial review.

### Notes

- Deferred to a later release (named in the design spec): baseline-drift accept/reject,
  method-level CQS, community-detection boundaries, and the `plan`/`drift`/`reorient`
  protocols (the Guide layer). This release is the deterministic floor.
- No index-format change (`INDEX_VERSION` stays 1.4.0); existing caches are unaffected.

## 0.5.0

The loop-with-graph thesis, functional end to end: a deterministic, ambiently-fresh code
graph, served ranked and on-demand, with intent auditable as expected graph deltas.

### Added

- **MCP server** — one `repo_intel` tool that auto-runs the whole pipeline (index → graph →
  SpecKit state → git → ranked actions) in a single call. Register with
  `claude mcp add repointel -s project -- npx -y repointel mcp`. Picks up rebuilds without
  restarting. See [docs/MCP.md](docs/MCP.md).
- **Impact analysis** — reverse dependencies (direct + transitive), symbol-scopable
  (`symbol` param) with intra-file delegation, `includeTests` to count test files, and a
  per-file explanation (depth, edge, bindings, import line). `decide.blastRadius` runs it on
  uncommitted files automatically.
- **Relevance ranking** — personalized PageRank from seed files now orders context slices by
  importance instead of BFS depth (`rankFromSeeds`, `personalizedPageRank`).
- **Intent-as-contract (the wedge)** — `repointel contract check` audits expected graph
  deltas (`file-exists`, `export-exists`, `edge-exists`, `edge-forbidden`) as
  convergent/absent/divergent (Reflexion vocabulary), exiting non-zero on failure for
  CI/hooks. `contract snapshot` + `contract diff` are the verify loop;
  `deriveContractFromDiff` turns an observed delta into a reusable contract. Also exposed via
  the `repo_intel` `contract` param.
- **`repointel watch`** — re-indexes on change (debounced, coalescing) with an optional live
  contract gate.
- **Correct cycle detection** — iterative Tarjan SCC plus bounded elementary-cycle
  enumeration, replacing a naive DFS that missed cross-edge cycles. `stats.cyclesTruncated`
  flags when the count is a floor.
- **Stable SCIP-style symbol IDs** — `pkg version path/name<descriptor>`, dependent only on
  (package, path, name, kind), so graph deltas are diffable across runs.
- **Honest observation signals** — a `provenance` block labels every field measured vs
  inferred; `project` identity and `git` working-tree state in every payload.
- `ooda --json` for machine-readable OODA output.

### Fixed

- Directory seeds now expand; `export … from` re-exports, aliased exports (`x as Y`), and
  `export *` barrels are traced correctly — previously each silently truncated the graph or
  misreported exports.
- Real tsconfig path-alias resolution (JSONC, `paths`/`baseUrl`/`extends`), replacing the
  hardcoded `@/ → src/`.
- Glob exclusion patterns (`**/*.stories.tsx`, bracket dirs) compile correctly.
- Framework detection gated on `package.json` deps — no more false "express" on a CLI.
- Import extraction ignores comments and string literals (no phantom edges).
- Ambient staleness detection (file set + mtime + index version) auto-refreshes on every
  read.
- `engines.node` set to `>=20.12` to match the real runtime floor (`@inquirer/prompts`).

### Notes

- `INDEX_VERSION` is now 1.4.0 — existing `.repointel/index.json` caches are refreshed
  automatically on first read.

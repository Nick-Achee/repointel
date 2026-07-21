# Changelog

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

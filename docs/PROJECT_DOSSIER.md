# Project Dossier — repointel

## Table of Contents

- [Product Summary](#product-summary)
- [Users and Roles](#users-and-roles)
- [Core Objects](#core-objects)
- [Primary Workflows](#primary-workflows)
- [Architecture Overview](#architecture-overview)
- [Frontend Map](#frontend-map)
- [Backend Map](#backend-map)
- [Data Model](#data-model)
- [Integrations](#integrations)
- [Runbook Summary](#runbook-summary)
- [Critical Flow Traces](#critical-flow-traces)
- [Testing and Reliability](#testing-and-reliability)
- [Security Review Notes](#security-review-notes)
- [Deployment Model](#deployment-model)
- [Risks and Open Questions](#risks-and-open-questions)

---

## Product Summary

**One sentence:** repointel is a CLI tool that scans a codebase, builds structural graphs (dependencies, routes, APIs), and generates focused context packs and LLM prompts for specification writing, drift auditing, and code healing.

**One paragraph:** repointel indexes a repository's source files, classifying them by type (page, component, hook, API route, schema, etc.) and detecting frameworks (Next.js, Convex, Remix). It builds three kinds of graphs — dependency imports, Next.js routes, and API endpoints — and can slice a focused subset of the codebase starting from seed files. It then generates structured LLM prompts that drive a "Spec → Audit → Heal" workflow: first generate a prescriptive specification for a route, then audit the implementation against that spec to find drift, then generate targeted code fixes. An OODA-loop orchestrator ties it all together with a propose-and-confirm interactive flow. All outputs are JSON and Markdown files written to a `.repointel/` directory.

**Evidence:** `README.md`, `src/bin/cli.ts`, `src/core/indexer.ts`, `src/generators/spec.ts`, `src/generators/audit.ts`, `src/generators/heal.ts`, `src/commands/ooda.ts`

---

## Users and Roles

| User | Description | Evidence |
|------|-------------|----------|
| Developer | Runs CLI locally to understand, specify, and maintain a codebase | All commands target `process.cwd()` |
| LLM (Claude, etc.) | Receives generated prompts and produces specs, drift reports, and fixes | `src/generators/spec.ts:94`, `src/generators/audit.ts:48`, `src/generators/heal.ts:36` |

There is no multi-user auth, no server, no database. This is a single-user local CLI tool.

---

## Core Objects

| Object | TypeScript Type | File | Description |
|--------|----------------|------|-------------|
| RepoIndex | `RepoIndex` | `src/types/index.ts` | Full inventory of files with metadata (type, hash, size, route paths, anti-patterns) |
| DepGraph | `DepGraph` | `src/types/index.ts` | Directed graph of file-level import dependencies with cycle detection |
| ApiGraph | `ApiGraph` | `src/types/index.ts` | Collection of API endpoints (Convex functions + REST routes) grouped by routers |
| RouteGraph | `RouteGraph` | `src/types/index.ts` | Next.js App Router map: pages, layouts, middleware, dynamic routes |
| ContextSlice | `ContextSlice` | `src/types/index.ts` | Focused subset of files starting from seeds, with depth and token counts |
| SpecKitProject | `SpecKitProject` | `src/core/speckit.ts` | Representation of a `.specify/` directory with features, specs, plans, tasks |
| DataFlowGraph | `DataFlowGraph` | `src/core/visualizer.ts` | Visualization graph with nodes, edges, and UI/logic/API/data layers |

**Relationships:**
- `RepoIndex` is the foundation — all graphs are built from it
- `DepGraph` is built by tracing imports from `RepoIndex` files
- `ContextSlice` is extracted using `DepGraph` to follow imports from seed files
- `ApiGraph` and `RouteGraph` are independent graphs built from `RepoIndex`
- `DataFlowGraph` is built from a `ContextSlice` + `DepGraph` for visualization
- `SpecKitProject` is an external `.specify/` folder structure that repointel can detect and integrate with

---

## Primary Workflows

### 1. Scan & Index
**Goal:** Build a complete inventory of a repository.
**Flow:** `repointel scan` → `indexer.generateIndex()` → walks files via fast-glob → classifies each file → detects frameworks → saves `RepoIndex` to `.repointel/index.json`
**Evidence:** `src/core/indexer.ts`, `src/commands/scan.ts`

### 2. Build Graphs
**Goal:** Understand structural relationships in the codebase.
**Flow:** `repointel graph [deps|routes|api|all]` → reads `RepoIndex` → builds `DepGraph`/`RouteGraph`/`ApiGraph` → saves JSON + optional Mermaid diagrams to `.repointel/graphs/`
**Evidence:** `src/core/dep-graph.ts`, `src/core/route-graph.ts`, `src/core/api-graph.ts`, `src/commands/graph.ts`

### 3. Slice Context
**Goal:** Extract a focused, token-counted context pack for an LLM.
**Flow:** `repointel slice --seeds file1.ts,file2.ts` → resolves seeds → walks imports via `DepGraph` to specified depth → collects files with metadata → saves `ContextSlice` to `.repointel/slices/`
**Evidence:** `src/core/slicer.ts`, `src/commands/slice.ts`

### 4. Spec → Audit → Heal
**Goal:** Drive specification-first development with LLM assistance.
**Flow:**
1. `repointel spec --route /dashboard` → generates LLM prompt with context → user feeds to LLM → LLM outputs `SPEC.md`
2. `repointel audit --route /dashboard --spec SPEC.md` → generates audit prompt with spec + implementation → LLM outputs `DRIFT_REPORT.md`
3. `repointel heal --route /dashboard --spec SPEC.md --drift DRIFT_REPORT.md` → generates heal prompt with source files → LLM outputs diffs
**Evidence:** `src/generators/spec.ts`, `src/generators/audit.ts`, `src/generators/heal.ts`, `src/commands/interactive.ts:133-237`

### 5. OODA Loop
**Goal:** Orchestrate project-level decision making with LLM assistance.
**Flow:** `repointel ooda` → Observe (scan) → Orient (build graphs, detect SpecKit) → Decide (generate prioritized actions + context) → Act (interactive propose/confirm loop or output prompt files)
**Evidence:** `src/commands/ooda.ts`

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                   CLI (Commander)                 │
│                  src/bin/cli.ts                   │
├──────────┬───────────┬───────────┬───────────────┤
│  scan    │  graph    │  slice    │  spec/audit/  │
│  cmd     │  cmd      │  cmd      │  heal/ooda    │
├──────────┴───────────┴───────────┴───────────────┤
│                   Core Layer                      │
│  indexer  dep-graph  api-graph  route-graph       │
│  slicer   speckit    visualizer  utils            │
├──────────────────────────────────────────────────┤
│               Generators Layer                    │
│  spec.ts      audit.ts       heal.ts             │
├──────────────────────────────────────────────────┤
│               Validators Layer                    │
│  eval.ts (artifact validation)                   │
├──────────────────────────────────────────────────┤
│                File System I/O                    │
│  Reads: source files in target repo              │
│  Writes: .repointel/ (index.json, graphs/, etc.) │
└──────────────────────────────────────────────────┘
```

This is a **pure CLI tool** with no frontend, no backend server, no database. All state is files on disk.

---

## Frontend Map

N/A — repointel has no frontend. It is a terminal-only CLI.

---

## Backend Map

N/A — repointel has no server. It runs as a local CLI process.

### CLI Commands (the "API surface")

| Command | Handler | Core Functions Called |
|---------|---------|---------------------|
| `scan` | `src/commands/scan.ts` | `indexer.generateIndex()` |
| `graph` | `src/commands/graph.ts` | `dep-graph.buildDepGraph()`, `route-graph.buildRouteGraph()`, `api-graph.buildApiGraph()` |
| `slice` | `src/commands/slice.ts` | `slicer.sliceFeature()` or `slicer.sliceRoute()` |
| `spec` | `src/commands/spec.ts` | `slicer.sliceRoute()`, `generators/spec.generateSpecPrompt()` |
| `audit` | `src/commands/audit.ts` | `slicer.sliceRoute()`, `generators/audit.generateAuditPrompt()` |
| `heal` | `src/commands/heal.ts` | `slicer.sliceRoute()`, `generators/heal.generateHealPrompt()` |
| `eval` | `src/commands/eval.ts` | `validators/eval.validateAll()` |
| `ooda` | `src/commands/ooda.ts` | All of the above, plus `speckit.detectSpecKit()` |
| `interactive` | `src/commands/interactive.ts` | Delegates to all above commands |

---

## Data Model

repointel has no database. All data is JSON files on disk in `.repointel/`.

### Output File Structure

```
.repointel/
├── index.json            # RepoIndex
├── graphs/
│   ├── deps.json         # DepGraph
│   ├── deps.mmd          # Mermaid diagram
│   ├── routes.json       # RouteGraph
│   ├── routes.mmd        # Mermaid diagram
│   └── api.json          # ApiGraph
├── slices/
│   └── {name}.json       # ContextSlice
└── prompts/
    ├── DECISION_CONTEXT.md   # Generated by OODA
    ├── PROPOSAL_PROMPT.md    # Generated by OODA
    └── APPROVED_PLAN.md      # Saved by OODA
```

### Key Type Shapes

**FileInfo** (in RepoIndex):
- `relativePath`, `path`, `type` (page|component|hook|lib|api|route|schema|config|style|test|type|asset|other)
- `hash`, `sizeBytes`, `isClientComponent`, `routePath`, `antiPatterns`

**DepGraphNode**: `id` (relative path), `path`, `type`, `isExternal`, `isCircular`
**DepGraphEdge**: `from`, `to`, `type` (import|require|dynamic)

**ApiEndpoint**: `id`, `name`, `path`, `file`, `type` (convex|rest), `method`, `isPublic`, `args`, `returns`

**Evidence:** `src/types/index.ts`

---

## Integrations

| Integration | Purpose | Evidence |
|-------------|---------|----------|
| Git | Read current commit hash and branch | `src/core/utils.ts:9-36` (`execSync("git rev-parse HEAD")`) |
| fast-glob | File system scanning with gitignore support | `src/core/indexer.ts` |
| SpecKit (.specify/) | External spec management folder structure | `src/core/speckit.ts` |
| LLMs (external) | Consume generated prompts | `src/generators/*.ts` — outputs Markdown prompts |

**Secrets/Environment Variables:** None. repointel uses no API keys, tokens, or environment variables.

---

## Runbook Summary

See [RUNBOOK.md](./RUNBOOK.md) for full details.

**Quick start:**
```bash
npm install
npm run build
node dist/bin/cli.js scan       # Index a repo
node dist/bin/cli.js graph all  # Build all graphs
```

---

## Critical Flow Traces

### Flow 1: `repointel scan`

1. **Entry:** `src/bin/cli.ts` registers `scan` command → calls `scanCommand()` in `src/commands/scan.ts`
2. **Index:** `scanCommand()` calls `generateIndex({ root: cwd })` in `src/core/indexer.ts`
3. **File Walk:** `generateIndex()` uses `fast-glob` with patterns like `**/*.{ts,tsx,js,jsx,...}` respecting `.gitignore`
4. **Classification:** Each file is classified by `classifyFile()`: checks file path patterns to assign `FileType`
5. **Framework Detection:** Scans for `next.config.*`, `convex/`, `remix.config.*`, etc.
6. **Anti-pattern Detection:** Checks for `console.log`, `any` type, `eslint-disable`, `@ts-ignore` in source files
7. **Route Path Extraction:** For Next.js App Router files, converts file paths to route paths via `filePathToRoutePath()`
8. **Output:** Saves `RepoIndex` JSON to `.repointel/index.json`
9. **No auth, no network, no side effects** beyond file writes.

**Evidence:** `src/core/indexer.ts`, `src/core/utils.ts:117-139`

### Flow 2: `repointel spec --route /dashboard`

1. **Entry:** `specCommand({ route: "/dashboard" })` in `src/commands/spec.ts`
2. **Slice:** Calls `sliceRoute("/dashboard")` which finds the page file for `/dashboard`, then walks imports via `buildDepGraphFromSeeds()`
3. **API Graph:** Optionally builds `ApiGraph` for the route's files
4. **Dep Mermaid:** Generates a Mermaid dependency diagram
5. **Prompt Generation:** `generateSpecPrompt({ slice, apiGraph, depMermaid })` in `src/generators/spec.ts` assembles a structured LLM prompt
6. **Output:** Writes the prompt to stdout or a file. User feeds it to an LLM.
7. **No validation of LLM output** — the user is responsible for saving the result.

**Evidence:** `src/commands/spec.ts`, `src/generators/spec.ts`

### Flow 3: `repointel ooda`

1. **Entry:** `oodaCommand()` in `src/commands/ooda.ts`
2. **Observe:** Checks for existing index, regenerates if missing/stale via `generateIndex()`
3. **Orient:** Builds dependency graph, detects SpecKit project, reads `.specify/memory/constitution.md`
4. **Decide:** Generates `DECISION_CONTEXT.md` with repo overview, SpecKit status, current feature focus, anti-patterns
5. **Actions:** `generateActions()` produces prioritized list: fix anti-patterns > continue tasks > resume stalled features > create new feature > explore
6. **Interactive Loop:** If interactive, runs propose-confirm loop: user selects action → generates `PROPOSAL_PROMPT.md` → user pastes LLM response → approve/modify/reject
7. **Output:** Saves `APPROVED_PLAN.md` on approval

**Evidence:** `src/commands/ooda.ts:54-190`

---

## Permissions Model

None. repointel is a local CLI tool with no authentication or authorization. It reads and writes files in the current working directory.

---

## Error Handling Strategy

- Functions use `try/catch` with fallback returns (e.g., `readFileSafe()` returns `null` on error)
- No global error boundary or crash reporter
- CLI commands print errors to stdout with `picocolors` formatting
- Validator (`eval.ts`) provides structured error reporting for generated artifacts

**Evidence:** `src/core/utils.ts:48-54`, `src/validators/eval.ts`

---

## Background Jobs / Queues

None. All operations are synchronous or use simple `async/await`. No queues, workers, or background processes.

---

## Testing and Reliability

- **No test files found.** No `test/`, `__tests__/`, or `*.test.ts` files exist in the repository.
- **No test framework** configured in `package.json` (no jest, vitest, mocha, etc.)
- **No CI/CD** configuration files found (no `.github/workflows/`, no `Jenkinsfile`, etc.)
- The `eval` command provides artifact validation but is not automated testing.

**Evidence:** `package.json` (no test script), file listing shows no test files.

---

## Security Review Notes

- **No secrets handling:** No API keys, tokens, or environment variables used
- **No network requests:** All operations are local filesystem only
- **No user input sanitization concerns:** CLI args are paths and strings, consumed locally
- **execSync usage:** `src/core/utils.ts:11-35` runs `git rev-parse` — safe since it's a fixed command, not user-interpolated
- **File write paths:** Output directories are hardcoded to `.repointel/` — no path traversal risk

**Risk:** None significant for a local CLI tool.

---

## Deployment Model

- **Published to npm** as `repointel` package (version 0.4.0)
- **Binary:** `repointel` (configured in `package.json` `bin` field)
- **No container, no server deployment** — installed via `npm install -g repointel` or used locally

**Evidence:** `package.json` (`bin`, `files`, `publishConfig`)

---

## Risks and Open Questions

See [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) for the full list.

**Key risks:**
1. **No tests** — all behavior is unverified
2. **Tight coupling to Next.js App Router** — route graph and file classification assume Next.js conventions
3. **Token counting is approximate** — uses `content.length / 4` heuristic, not a real tokenizer
4. **No incremental updates** — `scan` re-indexes the entire repo every time

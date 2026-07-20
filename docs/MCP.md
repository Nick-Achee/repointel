# repointel as an MCP server

One tool — `repo_intel` — that auto-runs the whole pipeline in a single call.

## Register

**Claude Code** (project scope; writes `.mcp.json`):

```bash
claude mcp add repointel -s project -- npx -y repointel mcp
```

**Any MCP client** — add to its config:

```json
{
  "mcpServers": {
    "repointel": {
      "command": "npx",
      "args": ["-y", "repointel", "mcp"]
    }
  }
}
```

The server speaks stdio and writes nothing but protocol traffic to stdout.

**It picks up rebuilds without restarting.** A stdio server is long-lived, so it would
normally serve whatever code existed when the client spawned it — stale the moment you
rebuild. Instead the implementation is resolved per call through a dynamic import keyed on
the build's mtime: an unchanged build hits the module cache, a new build is imported fresh.
Every response reports which build served it:

```jsonc
"server": { "tool": "repo_intel", "runtime": "reloaded", "buildStamp": 1784590860712 }
```

`runtime: "reloaded"` means the call ran the current build. A partially-written bundle
mid-rebuild falls back to the bundled copy rather than failing the call.

## The one tool

`repo_intel` takes no required arguments. Every call:

1. **Observes** — re-indexes only if files changed (staleness is detected from the file
   set and mtimes; nothing to remember to refresh).
2. **Orients** — traces every import, including barrel re-exports and tsconfig `paths`
   aliases; builds the dependency graph; reads SpecKit feature/task state.
3. **Decides** — returns ranked next actions.

With `seeds`, it also returns the context slice **and impact analysis** — the reverse
dependencies, i.e. every file that breaks if the seeds change. This is the answer grep
cannot give: grep finds direct textual importers, the graph finds the transitive closure.

Measured on this repo for `src/core/utils.ts` with `includeTests: true`:
**34 affected files** (23 direct + 11 transitive) vs **23** from `grep -rl`. The extra 11
are files that never mention `utils` but break anyway, reached through the import chain.

Add `symbol: "matchesPattern"` and it narrows to the **3 files that actually bind that
symbol** — `src/core/slicer.ts`, `src/core/utils.test.ts`, `src/index.ts` — plus **14
transitive consumers**. Symbol scoping follows intra-file delegation: `slicer.ts` imports
only `matchesPatterns` (plural), but that wrapper calls `matchesPattern`, so it is
correctly included.

Honest comparison: on this question `grep -rn matchesPattern` also finds those 3 files,
and gives line numbers the tool does not. What grep cannot produce is the **14 downstream
files** that never mention the symbol but break through the import chain. The graph's
advantage here is reach, not precision — text search is not worse at naming direct
matches, and it is faster.

Every payload also carries `project` (name, version, description, README tagline, entry
points) and `git` (branch, head, uncommitted and untracked files, recent commits), so the
recommendations in `decide` reflect the working tree rather than only what a spec claims.

`decide.blastRadius` needs no arguments at all: it runs impact analysis on whatever source
files you have uncommitted and reports what they reach, nearest first — with the importing
line number for each, so you can go straight to the call site.

| Argument | Type | Purpose |
|----------|------|---------|
| `root` | string | Repo root. Defaults to cwd. |
| `seeds` | string[] | Also return a context slice for these files/directories (`["src/auth/"]` — directories expand). |
| `name` | string | Slice name. Defaults to `context`. |
| `refresh` | boolean | Force a full re-index. |
| `includeTests` | boolean | Index test/spec files too. Off by default; `observe.excludedFromIndex` always reports how many were left out. **Turn on for complete impact analysis** — test files are dependents too. |
| `symbol` | string | Narrow impact to one exported name, e.g. `matchesPattern`. Only files that actually bind that symbol count as directly affected (namespace imports always count). |

## Response shape

```jsonc
{
  "root": "/path/to/repo",
  "observe": { "files": 29, "totalSizeBytes": 0, "frameworks": [], "byType": {} },
  "orient": {
    "features": [ { "id": "001-auth", "tasks": { "total": 3, "completed": 1, "inProgress": 1, "pending": 1, "nextPending": "Wire mailer" } } ],
    "currentFeature": { /* same shape */ },
    "graph": { "nodes": 29, "edges": 104, "circular": 0, "externalDeps": 13 }
  },
  "decide": { "actions": [ { "title": "...", "command": "...", "why": "..." } ] },
  "artifacts": {
    "index": ".repointel/index.json",
    "depGraph": ".repointel/graphs/deps.json",
    "decisionContext": ".repointel/prompts/DECISION_CONTEXT.md"
  },
  // present only when seeds were passed
  "slice": {
    "seedFiles": ["src/auth/login.ts"],
    "files": ["src/auth/login.ts", "src/db.ts"],
    "totalFiles": 2,
    "estimatedTokens": 412,
    "excluded": [],
    "contextPack": ".repointel/slices/context.md"
  },
  // impact analysis: who breaks if the seeds change (reverse dependencies)
  "impact": {
    "of": ["src/auth/login.ts"],
    "symbol": null,
    "direct": ["src/routes/session.ts"],
    "transitive": ["src/bin/cli.ts"],
    "totalAffected": 2,
    // why each file is affected, nearest first
    "details": [
      { "file": "src/routes/session.ts", "depth": 1, "via": "src/auth/login.ts",
        "symbols": ["login"], "line": 4 },
      { "file": "src/bin/cli.ts", "depth": 2, "via": "src/routes/session.ts",
        "symbols": ["session"], "line": 11 }
    ]
  }
}
```

A bad seed returns an MCP error result (`isError: true`) with a readable message — it
never throws or emits an empty slice.

## Usage pattern

Call it at the **start** of feature or debugging work to orient, and **again after
changes** to see what actually landed. That second call is the loop closing: the graph is
re-derived from the real files, so it reports what exists, not what the agent believes.

The `.repointel/` artifacts it writes (index, graph, context pack, decision context) are
plain files — readable directly when the agent wants detail beyond the summary.

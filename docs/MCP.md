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

## The one tool

`repo_intel` takes no required arguments. Every call:

1. **Observes** — re-indexes only if files changed (staleness is detected from the file
   set and mtimes; nothing to remember to refresh).
2. **Orients** — traces every import, including barrel re-exports and tsconfig `paths`
   aliases; builds the dependency graph; reads SpecKit feature/task state.
3. **Decides** — returns ranked next actions.

| Argument | Type | Purpose |
|----------|------|---------|
| `root` | string | Repo root. Defaults to cwd. |
| `seeds` | string[] | Also return a context slice for these files/directories (`["src/auth/"]` — directories expand). |
| `name` | string | Slice name. Defaults to `context`. |
| `refresh` | boolean | Force a full re-index. |

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

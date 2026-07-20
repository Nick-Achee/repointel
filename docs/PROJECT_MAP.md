# Project Map — repointel

## Tech Stack

| Layer | Technology | Evidence |
|-------|-----------|----------|
| Language | TypeScript (strict, ESM) | `tsconfig.json` |
| Runtime | Node.js >= 18 | `package.json` engines field |
| Build | tsup | `tsup.config.ts` |
| Package Manager | npm | `package-lock.json` present |
| CLI Framework | Commander.js | `package.json` deps, `src/bin/cli.ts` |
| Interactive Prompts | @inquirer/prompts | `src/commands/ooda.ts`, `src/commands/interactive.ts` |
| File Scanning | fast-glob | `src/core/indexer.ts`, `src/core/speckit.ts` |
| Terminal Styling | picocolors | throughout commands |

## Folder Map

```
repointel/
├── src/
│   ├── bin/
│   │   └── cli.ts              # CLI entry point (Commander program definition)
│   ├── core/
│   │   ├── indexer.ts           # Repo scanner: walks files, classifies types, detects frameworks
│   │   ├── dep-graph.ts         # Builds import/dependency graphs from source files
│   │   ├── api-graph.ts         # Discovers API endpoints (Convex functions + REST routes)
│   │   ├── route-graph.ts       # Maps Next.js App Router pages/layouts/middleware
│   │   ├── slicer.ts            # Extracts focused context slices from seed files
│   │   ├── speckit.ts           # SpecKit integration: .specify/ folder management
│   │   ├── visualizer.ts        # Generates Mermaid diagrams (data flow, architecture, sequence)
│   │   └── utils.ts             # Shared helpers (git, file I/O, path transforms)
│   ├── commands/
│   │   ├── scan.ts              # `repointel scan` command handler
│   │   ├── graph.ts             # `repointel graph` command handler
│   │   ├── slice.ts             # `repointel slice` command handler
│   │   ├── spec.ts              # `repointel spec` command handler
│   │   ├── audit.ts             # `repointel audit` command handler
│   │   ├── heal.ts              # `repointel heal` command handler
│   │   ├── eval.ts              # `repointel eval` command handler
│   │   ├── ooda.ts              # `repointel ooda` OODA-loop orchestrator
│   │   └── interactive.ts       # `repointel interactive` wizard mode
│   ├── generators/
│   │   ├── spec.ts              # Generates LLM prompts for writing route specifications
│   │   ├── audit.ts             # Generates LLM prompts for auditing spec drift
│   │   └── heal.ts              # Generates LLM prompts for fixing spec drift
│   ├── validators/
│   │   └── eval.ts              # Validates generated artifacts (index, graphs) for consistency
│   ├── types/
│   │   └── index.ts             # All TypeScript interfaces (RepoIndex, DepGraph, etc.)
│   └── index.ts                 # Public API barrel export
├── dist/                        # Build output (gitignored)
├── .repointel/                  # Runtime output directory (generated artifacts)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Key Entrypoints

| Entrypoint | File | Purpose |
|------------|------|---------|
| CLI binary | `src/bin/cli.ts` | Commander program, registers all subcommands |
| Library API | `src/index.ts` | Barrel re-export for programmatic usage |

## Key Scripts (package.json)

| Script | Command | Purpose |
|--------|---------|---------|
| `build` | `tsup` | Compile TypeScript to `dist/` |
| `dev` | `tsup --watch` | Watch mode for development |
| `typecheck` | `tsc --noEmit` | Type checking without emitting |
| `lint` | `tsc --noEmit` | Same as typecheck (no separate linter) |
| `prepublishOnly` | `npm run build` | Build before publishing |

## CLI Commands (from `src/bin/cli.ts`)

| Command | Description |
|---------|-------------|
| `scan` | Index the repository: classify files, detect frameworks, find anti-patterns |
| `graph [type]` | Build dependency/route/API graphs, output JSON and/or Mermaid |
| `slice` | Extract a focused context slice from seed files or a route |
| `spec` | Generate an LLM prompt to write a route specification |
| `audit` | Generate an LLM prompt to audit implementation against a spec |
| `heal` | Generate an LLM prompt to fix drift identified by audit |
| `eval` | Validate generated artifacts for internal consistency |
| `ooda` | OODA loop orchestrator: Observe-Orient-Decide-Act workflow |
| `interactive` | Interactive wizard mode for guided usage |

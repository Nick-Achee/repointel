# repointel

> Repo intelligence CLI — Generate architecture graphs, context slices, and LLM-ready artifacts from any TypeScript/JavaScript codebase.

[![npm version](https://img.shields.io/npm/v/repointel.svg)](https://www.npmjs.com/package/repointel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why repointel?

Modern LLMs work best with focused, relevant context. repointel helps you:

- **Extract** precise code slices for LLM prompts (not your entire codebase)
- **Visualize** dependencies, routes, and API endpoints as Mermaid diagrams
- **Budget tokens** with model-aware limits (Claude, GPT-4, Gemini)
- **Detect** anti-patterns (hooks issues, race conditions, missing cleanup)
- **Integrate** with SpecKit for spec-driven development
- **Automate** spec generation, auditing, and drift detection

## Installation

```bash
npm install -g repointel
# or
npx repointel --help
```

## Quick Start

```bash
# OODA workflow - the recommended entry point
repointel ooda

# This will:
# 1. OBSERVE - Scan and index your repository (if needed)
# 2. ORIENT - Build dependency graphs, detect SpecKit
# 3. DECIDE - Generate decision context for your LLM
# 4. ACT - Provide instructions for feeding context to any LLM

# Then feed the output to your LLM:
cat .repointel/prompts/DECISION_CONTEXT.md | claude    # Claude Code
codex < .repointel/prompts/DECISION_CONTEXT.md         # OpenAI Codex
```

**Or use individual commands:**

```bash
# Scan your repository
repointel scan

# Generate dependency graph with Mermaid
repointel deps -f mermaid

# Slice a specific route with token budgeting
repointel slice --route /dashboard/users --model claude-opus-4.5

# Generate visualizations
repointel viz --seeds src/auth/index.ts

# Start spec-driven development
repointel specify --create "User Auth" --seeds src/auth/
```

## Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `ooda` | **Primary workflow** - Observe, Orient, Decide, Act loop |
| `scan` | Index repository files, imports, exports, detect frameworks |
| `graph` | Build dependency, route, or API graphs |
| `slice` | Generate focused context packs for LLMs |
| `viz` | Generate rich architecture visualizations |
| `specify` | SpecKit integration - manage specs, plans, tasks |
| `eval` | Validate generated artifacts |

### Spec/Audit/Heal Workflow

| Command | Description |
|---------|-------------|
| `spec` | Generate LLM prompt to create route specification |
| `audit` | Generate LLM prompt to audit implementation vs spec |
| `heal` | Generate LLM prompt to fix drift |

### Shortcuts

| Command | Equivalent |
|---------|------------|
| `deps` | `graph --type deps` |
| `routes` | `graph --type routes` |
| `api` | `graph --type api` |

---

## Key Features

### Model-Aware Token Budgeting

Target specific LLM context windows when creating slices:

```bash
# Budget for Claude Opus (200K context)
repointel slice --route /dashboard --model claude-opus-4.5

# Budget for GPT-4o (128K context)
repointel slice --seeds src/api/ --model gpt-4o

# Budget for Gemini 2.0 Pro (1M context)
repointel slice --seeds src/ --model gemini-2.0-pro
```

**Supported models:**
- `claude-opus-4.5` - 200K context, 32K output
- `claude-sonnet-4` - 200K context, 64K output
- `gpt-4o` - 128K context
- `gpt-4-turbo` - 128K context
- `o1` / `o3` - 200K context, 100K output
- `gemini-2.0-pro` / `gemini-1.5-pro` - 1M context

---

### Rich Visualizations

Generate architecture diagrams showing client-server flows:

```bash
# Generate all diagram types
repointel viz --seeds src/core/slicer.ts

# Specific diagram type
repointel viz --route /dashboard --diagram dataflow

# Left-to-right layout
repointel viz --seeds src/api/ --direction LR
```

**Diagram types:**
- `dataflow` - Client-server data flow with API calls
- `architecture` - Layered view (UI → Logic → API → Data)
- `sequence` - Request/response sequence diagrams
- `components` - Component import relationships

Add diagrams to slice output:
```bash
repointel slice --seeds src/auth/ --viz
```

---

### Anti-Pattern Detection

Automatically detect common issues during scan:

```bash
repointel scan
```

**Detected patterns:**
- `conditionalHooks` - Hooks called inside if/switch/ternary
- `hooksInLoops` - Hooks called inside loops
- `missingDeps` - useEffect with empty deps but references state
- `missingCleanup` - useEffect with subscriptions but no cleanup
- `asyncStateUpdate` - setState after await without isMounted check
- `unboundedFetch` - fetch/promise without AbortController

---

### Framework & Spec Detection

Automatically detect frameworks and spec formats:

**Frameworks:** Next.js, Remix, Astro, Vite, Express, Convex

**Specs:** SpecKit, OpenAPI, TypeSpec, GraphQL schemas

---

### SpecKit Integration

Full compatibility with [GitHub SpecKit](https://github.com/github/spec-kit) for spec-driven development:

```bash
# Initialize .specify/ structure with project context
repointel specify --init --name "MyApp" --purpose "A task management app for developers"

# Create a new feature with code context
repointel specify --create "User Authentication" --seeds src/auth/

# Focus on a feature - see status, related files, next steps
repointel specify --focus 1

# View dashboard of all features
repointel specify
```

**SpecKit Dashboard:**
- Track features through specs → plans → tasks
- Auto-detect related code files
- Cross-reference between specs
- Smart next-step suggestions
- Reduce cognitive overhead when context-switching

**Constitution (`.specify/memory/constitution.md`):**

The constitution is the heart of your project's identity. It helps LLMs understand:

- What your project is and what it does
- Available commands/features
- Core principles and development guidelines

```bash
# Initialize with a rich constitution
repointel specify --init \
  --name "repointel" \
  --purpose "Repo intelligence CLI that generates architecture graphs and LLM-ready artifacts"
```

Best practices for constitution.md:

- Add a `## What This Project Is` section explaining the project's purpose
- Add a `## What It Does` section listing commands/features
- Add a `## Core Principles` section with development guidelines
- Keep it human-readable AND LLM-consumable

---

## Command Reference

### `repointel scan`

Index your repository and generate `.repointel/index.json`.

```bash
repointel scan [options]

Options:
  -r, --refresh              Force regeneration even if index exists
  -i, --include <patterns>   Additional glob patterns to include
  -e, --exclude <patterns>   Glob patterns to exclude
  -o, --output <dir>         Output directory (default: .repointel)
```

**Output includes:**
- File inventory with metadata
- Import/export relationships
- Hook and side-effect counts
- Client vs server component detection
- Framework detection (Next.js, Convex, etc.)
- Spec detection (SpecKit, OpenAPI, TypeSpec)
- Anti-pattern warnings

---

### `repointel graph`

Build dependency, route, and/or API graphs.

```bash
repointel graph --type <deps|routes|api|all> [options]

Options:
  -t, --type <type>       Graph type: deps, routes, api, or all (required)
  -s, --seeds <files...>  Seed files for scoped dependency graph
  -d, --depth <n>         Max traversal depth (default: 10)
  -f, --format <fmt>      Output: json, mermaid, or both (default: json)
  -o, --output <dir>      Output directory (default: .repointel/graphs)
```

---

### `repointel slice`

Generate focused context slices for LLM consumption.

```bash
repointel slice [options]

Options:
  -r, --route <path>          Route path to slice (e.g., /dashboard/events)
  -s, --seeds <files...>      Seed files for feature slice
  -n, --name <name>           Name for feature slice (default: feature)
  -d, --depth <n>             Max import traversal depth (default: 5)
  -m, --model <model>         Target LLM for token budgeting
  --max-tokens <n>            Override model's default token budget
  --max-bytes <n>             Max total slice size (default: 8MB)
  --max-file-bytes <n>        Max single file size (default: 400KB)
  -e, --exclude <patterns...> Glob patterns to exclude
  -f, --format <fmt>          Output: json, markdown, or both (default: both)
  -o, --output <dir>          Output directory (default: .repointel/slices)
  --viz                       Include architecture diagrams in markdown
```

**Examples:**

```bash
# Slice by route with token budget
repointel slice --route /dashboard/events --model claude-opus-4.5

# Slice by seed files with diagrams
repointel slice --seeds src/lib/auth.ts --name auth --viz

# Compare token usage across models
repointel slice --route /api/users --model gpt-4o
repointel slice --route /api/users --model gemini-2.0-pro
```

---

### `repointel viz`

Generate rich architecture visualizations.

```bash
repointel viz [options]

Options:
  -r, --route <path>       Route path to visualize
  -s, --seeds <files...>   Seed files for visualization
  -n, --name <name>        Name for output files (default: feature)
  -d, --depth <n>          Max import traversal depth (default: 5)
  --diagram <type>         Diagram type: all, dataflow, architecture, sequence, components
  --direction <dir>        Graph direction: TD (top-down) or LR (left-right)
  -o, --output <dir>       Output directory (default: .repointel/diagrams)
```

---

### `repointel specify`

SpecKit integration for spec-driven development.

```bash
repointel specify [options]

Options:
  --init                   Initialize .specify/ folder structure
  --name <name>            Project name for constitution (used with --init)
  --purpose <text>         Project purpose/description (used with --init)
  --list                   List all features in .specify/specs/
  --create <name>          Create a new feature specification
  --focus <id>             Focus on a feature (by number, ID, or name)
  -r, --route <path>       Route path to include in feature context
  -s, --seeds <files...>   Seed files to include in feature context
  -d, --depth <n>          Max import traversal depth (default: 5)
```

**Examples:**

```bash
# Start spec-driven development with project context
repointel specify --init --name "MyApp" --purpose "A task management app"

# Create feature from code context
repointel specify --create "Payment Processing" --seeds src/payments/

# Focus on a feature for context
repointel specify --focus 1

# View all features
repointel specify --list
```

---

## Output Structure

```
.repointel/
├── index.json              # Repository index (from scan)
├── graphs/
│   ├── deps.json           # Dependency graph
│   ├── deps.mmd            # Mermaid diagram
│   ├── routes.json         # Route graph
│   ├── api.json            # API graph
│   └── api.mmd             # Mermaid diagram
├── slices/
│   ├── dashboard_users.json    # Slice manifest with token counts
│   └── dashboard_users.md      # Markdown context pack (with diagrams if --viz)
├── diagrams/
│   ├── feature_dataflow.mmd    # Client-server data flow
│   ├── feature_architecture.mmd # Layered architecture
│   ├── feature_sequence.mmd    # Sequence diagram
│   └── feature_components.mmd  # Component dependencies
└── prompts/
    ├── dashboard-users_GENERATE_SPEC.prompt.txt
    ├── dashboard-users_AUDIT.prompt.txt
    └── dashboard-users_HEAL.prompt.txt

.specify/                    # SpecKit structure (if initialized)
├── memory/
│   └── constitution.md      # Project principles
├── templates/
│   ├── spec-template.md
│   ├── plan-template.md
│   └── tasks-template.md
└── specs/
    └── 001-feature-name/
        ├── spec.md          # Feature specification
        ├── plan.md          # Technical plan
        └── tasks.md         # Implementation tasks
```

---

## Use Cases

### 1. LLM Context Generation with Token Budgets

```bash
# Generate context that fits in Claude's context window
repointel slice --route /dashboard/events --model claude-opus-4.5

# Output shows:
#   Tokens: ~45,000 (23% of available)
#   Remaining: 147,000 tokens
#   Est. Cost: $0.68
```

### 2. Architecture Documentation

```bash
# Generate all visualizations
repointel viz --seeds src/core/ --name core-architecture

# Embed in slice markdown
repointel slice --seeds src/api/ --viz
```

### 3. Spec-Driven Development

```bash
# 1. Create feature with context
repointel specify --create "User Auth" --seeds src/auth/

# 2. Focus and see next steps
repointel specify --focus 1

# 3. Edit spec.md, plan.md, tasks.md

# 4. Track progress
repointel specify
```

### 4. Code Quality Checks

```bash
# Scan and see anti-patterns
repointel scan

# Check for circular dependencies
repointel deps --format json | jq '.cycles'
```

---

## Programmatic API

```typescript
import {
  generateIndex,
  buildDepGraph,
  buildDepGraphFromSeeds,
  buildRouteGraph,
  buildApiGraph,
  sliceRoute,
  sliceFeature,
  generateContextPack,
  depGraphToMermaid,
  routeGraphToMermaid,
  apiGraphToMermaid,
  visualizeSlice,
  detectSpecKit,
  initializeSpecKit,
} from 'repointel';

// Scan with anti-pattern detection
const index = await generateIndex({ root: process.cwd() });
console.log('Anti-patterns:', index.summary.totalAntiPatterns);

// Generate context slice with token budget
const slice = await sliceRoute('/dashboard', {
  root: process.cwd(),
  model: 'claude-opus-4.5',
});
console.log('Token usage:', slice.tokenBudget?.used);

// Generate visualizations
const viz = await visualizeSlice(slice, { root: process.cwd() });
console.log('Data flow diagram:', viz.dataFlow);

// SpecKit integration
const speckit = await detectSpecKit(process.cwd());
if (!speckit) {
  await initializeSpecKit(process.cwd());
}
```

---

## Supported Frameworks

| Framework | Support |
|-----------|---------|
| Next.js App Router | Full |
| Next.js Pages Router | Full |
| React (Vite, CRA) | Full |
| Convex | Full (queries, mutations, actions) |
| REST API Routes | Full |
| Remix | Detection |
| Astro | Detection |
| Express | Detection |
| tRPC | Coming soon |
| GraphQL | Schema detection |

---

## Philosophy

repointel follows the **Observe → Orient → Decide → Act** (OODA) loop pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                         OODA LOOP                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   OBSERVE          ORIENT           DECIDE          ACT         │
│   (repointel)      (repointel)      (Your LLM)      (Your LLM)  │
│                                                                 │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐    ┌─────────┐  │
│   │  scan   │ ───► │  graph  │ ───► │ context │───►│  code   │  │
│   │  index  │      │  detect │      │  prompt │    │ changes │  │
│   └─────────┘      └─────────┘      └─────────┘    └─────────┘  │
│        │                │                │              │       │
│        ▼                ▼                ▼              ▼       │
│   Deterministic    Deterministic    LLM Reasoning   LLM Action  │
│   (fast, cheap)    (fast, cheap)    (any model)     (any model) │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **LLM-Agnostic** — repointel generates context, you choose the LLM
   - Works with Claude Code, OpenAI Codex, Cursor, Copilot, etc.
   - No vendor lock-in, no API keys required in repointel

2. **Deterministic OO** — Observe and Orient are fast and reproducible
   - Scanning, indexing, and graphing are pure computation
   - Same input always produces same output

3. **Context-First** — The goal is reducing cognitive overhead
   - Generate focused slices, not entire codebases
   - Track feature state across context switches
   - Cross-reference between specs automatically

4. **Continuous Loop** — Run `repointel ooda` after each work session
   - State updates automatically
   - New decision context reflects progress
   - Keeps you and your LLM synchronized

### Workflow

```bash
# 1. Run OODA loop (does OO, generates D context)
repointel ooda

# 2. Feed to your LLM of choice
cat .repointel/prompts/DECISION_CONTEXT.md | claude

# 3. LLM analyzes and acts (writes code, updates tasks)
# ... LLM does its work ...

# 4. Run OODA again to update state
repointel ooda

# Repeat!
```

---

## Contributing

```bash
git clone https://github.com/yourusername/repointel.git
cd repointel
npm install
npm run dev -- scan  # Run in dev mode
npm run build        # Build for production
npm test             # Run tests
```

---

## License

MIT

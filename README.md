# repointel

> **Repo Intel** — Know where you are in your codebase. Always.

*Also known as: repo intel, repo-intel, repository intelligence*

[![npm version](https://img.shields.io/npm/v/repointel.svg)](https://www.npmjs.com/package/repointel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The Problem

When building with AI assistants, you lose track of where you are. The codebase grows, context fragments, and you end up stuck — unsure what's implemented, what's broken, or what to do next.

**repointel fixes this.** It traverses your imports recursively, surfaces relevant context, and shows you exactly where you stand in your application buildout.

## How I Actually Use It

I don't memorize CLI flags. I just talk to my LLM:

> "Run repointel on this project and help me understand where we are."

> "Use repointel to update the spec for user authentication."

> "Let's run repointel and see if that feature landed across all the slices."

The LLM runs the commands. repointel does the heavy lifting — indexing files, tracing imports, detecting what's connected to what. Then I iterate from there.

## The Workflow

```
Spec → Plan → Task → Execute → Re-index
```

1. **Spec** — Define what you're building (repointel manages `.specify/` structure)
2. **Plan** — Break it down into technical steps
3. **Task** — Generate actionable items
4. **Execute** — Build it (with your LLM)
5. **Re-index** — Run repointel again to see where you landed

This cycle keeps you oriented. When you're stuck, run `repointel ooda` and see the current state.

## Installation

```bash
npm install -g repointel
# or
npx repointel --help
```

## Quick Start

```bash
# The OODA loop — observe, orient, decide, act
repointel ooda

# Or scan your repo to build the index
repointel scan

# See your dependency graph
repointel deps

# Slice a specific area for focused context
repointel slice --seeds src/auth/
```

## What It Does

### Import Traversal
Starting from any file, repointel walks the import tree — what does this file import? What do those files import? — until it builds a complete picture of that slice of your app.

### Spec-Driven Development
Uses [SpecKit](https://github.com/github/spec-kit) structure:
- `.specify/specs/` — Feature specifications
- `.specify/memory/constitution.md` — Project identity and principles
- Specs → Plans → Tasks workflow

```bash
# Initialize spec structure
repointel specify --init --name "MyApp" --purpose "What this app does"

# Create a feature spec with code context
repointel specify --create "User Auth" --seeds src/auth/

# Focus on a specific feature
repointel specify --focus 1
```

### Architecture Visualization
Generate Mermaid diagrams of your codebase:

```bash
repointel viz --seeds src/core/
repointel deps -f mermaid
```

### Context Slicing
Extract focused chunks of your codebase for LLM context:

```bash
repointel slice --route /dashboard
repointel slice --seeds src/api/ --name api-layer
```

## Core Commands

| Command | What it does |
|---------|--------------|
| `ooda` | Full observe-orient-decide-act loop |
| `scan` | Index your repo (files, imports, exports) |
| `deps` | Show dependency graph |
| `slice` | Extract focused context |
| `viz` | Generate architecture diagrams |
| `specify` | Manage specs, plans, tasks |
| `spec` | Generate spec prompt for a route |
| `audit` | Check implementation vs spec |
| `heal` | Generate fix prompt for drift |

## Output Structure

```
.repointel/
├── index.json           # Repository index
├── graphs/              # Dependency graphs (JSON + Mermaid)
├── slices/              # Context packs for LLMs
└── prompts/             # Generated prompts

.specify/                # SpecKit structure
├── memory/
│   └── constitution.md  # Project identity
├── templates/           # Spec/plan/task templates
└── specs/
    └── 001-feature/
        ├── spec.md
        ├── plan.md
        └── tasks.md
```

## Philosophy

**Reduce noise. Surface signal.**

When you're deep in a build, entropy accumulates. Files multiply, imports tangle, and you lose the thread. repointel brings you back to center by:

1. **Traversing imports** — Following the dependency chain to map what's connected
2. **Slicing context** — Giving you just what's relevant, not everything
3. **Tracking specs** — Keeping feature state across context switches
4. **Re-indexing** — Updating the picture after each work session

The goal isn't to replace your LLM — it's to give your LLM (and you) the context needed to make good decisions.

## Works With

- **Frameworks**: Next.js, React, Convex, Express, Remix, Astro, Vite
- **LLMs**: Claude Code, Cursor, Copilot, any AI assistant
- **Specs**: SpecKit, OpenAPI, TypeSpec, GraphQL schemas

## Contributing

```bash
git clone https://github.com/Nick-Achee/repointel.git
cd repointel
npm install
npm run dev -- scan
npm test
```

---

Built by [Nick Achee](https://nickachee.xyz) • [consultnta.com](https://consultnta.com)

MIT License

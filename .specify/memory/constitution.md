# repointel

> Repo intelligence CLI — Generate architecture graphs, context slices, and LLM-ready artifacts from any TypeScript/JavaScript codebase.

## What This Project Is

**repointel** is an open-source CLI tool that helps developers work with LLMs more effectively. It implements the OODA loop (Observe → Orient → Decide → Act) to:

1. **OBSERVE**: Scan and index codebases (files, imports, exports, frameworks)
2. **ORIENT**: Build dependency graphs, detect patterns, identify anti-patterns
3. **DECIDE**: Generate focused context for LLMs (slices, visualizations, prompts)
4. **ACT**: The LLM takes action based on the context provided

The key insight: LLMs work best with focused, relevant context—not entire codebases. repointel does the deterministic work (OO) so LLMs can do the reasoning work (DA).

## What It Does

- `repointel ooda` — Primary workflow, runs the full loop
- `repointel scan` — Index repository files and detect frameworks
- `repointel deps` — Build dependency graphs with Mermaid output
- `repointel slice` — Generate focused context packs for LLMs
- `repointel viz` — Generate architecture diagrams (dataflow, sequence, etc.)
- `repointel specify` — SpecKit integration for spec-driven development

## Core Principles

1. **LLM-Agnostic**: Works with Claude Code, Codex, Cursor, Copilot—any LLM
2. **Deterministic OO**: Observe and Orient are fast, reproducible, no AI needed
3. **Context-First**: Generate focused slices, not entire codebases
4. **Open Source**: MIT licensed, designed for community contribution

## Development Guidelines

- TypeScript with strict mode
- ESM modules only
- Tests with Vitest
- Mermaid for all diagram output
- SpecKit compatible (.specify/ folder structure)

## Quality Standards

- All code must pass `npm run build` and `npm test`
- New features need unit and integration tests
- README must document all public commands
- OODA workflow must remain fast (< 2s for typical repos)

---
*This is repointel's own constitution, dogfooding the OODA Context Engine feature.*

# Open Questions — repointel

## P0 — High Priority

### 1. No test suite
**Risk:** All behavior is unverified. Regressions can ship silently.
**Next step:** Check if there's a planned test framework. Consider adding vitest given the existing tsup/TypeScript setup.
**Files to investigate:** `package.json` (for any test-related deps or scripts)

### 2. Token counting is approximate
**Risk:** Context slices report token counts using `content.length / 4`, which can significantly overcount or undercount for LLMs with different tokenizers.
**Where:** `src/core/slicer.ts` (search for token estimation logic)
**Next step:** Consider using `tiktoken` or `gpt-tokenizer` for accurate counts, or document the approximation clearly.

## P1 — Medium Priority

### 3. Framework support is narrow
**Observation:** Route graph only supports Next.js App Router. API graph only supports Convex and Next.js REST routes. File classification is tuned for Next.js + Convex conventions.
**Risk:** Users with other frameworks (Remix, SvelteKit, Astro) get minimal value from graph/slice commands.
**Where:** `src/core/route-graph.ts:85-110`, `src/core/api-graph.ts`, `src/core/indexer.ts` (classifyFile)
**Next step:** Document supported frameworks explicitly. Consider plugin architecture for framework adapters.

### 4. No incremental scanning
**Observation:** `repointel scan` always re-indexes the entire repo. No file hash comparison or git diff-based incremental updates.
**Risk:** Slow on large repos.
**Where:** `src/core/indexer.ts` — `generateIndex()` always does a full walk
**Next step:** Could use file mtimes or git status to skip unchanged files.

### 5. SpecKit integration is tightly coupled
**Observation:** The `.specify/` folder structure (constitution, specs, plans, tasks) is a specific workflow opinion baked into the tool.
**Risk:** Users who don't use SpecKit conventions get OODA-loop noise about missing features.
**Where:** `src/core/speckit.ts`, `src/commands/ooda.ts:96-106`
**Next step:** Make SpecKit integration opt-in or detect-and-skip more gracefully.

## P2 — Low Priority

### 6. Mermaid output not validated
**Observation:** Generated Mermaid diagrams use string concatenation. Invalid node IDs could produce broken diagrams.
**Where:** `src/core/route-graph.ts:288-354`, `src/core/visualizer.ts`
**Mitigation:** The `sanitizeId()` function strips non-alphanumeric chars, which covers most cases.

### 7. Anti-pattern detection is basic
**Observation:** Detects `console.log`, `any` types, `eslint-disable`, `@ts-ignore` via simple regex. No AST-based analysis.
**Where:** `src/core/indexer.ts` (anti-pattern counting in `generateIndex`)
**Next step:** Acceptable for v0.4.0. Could evolve to use TypeScript compiler API for deeper analysis.

### 8. No `--help` examples in CLI
**Observation:** Commander provides `--help` but individual commands lack usage examples.
**Where:** `src/bin/cli.ts`
**Next step:** Add `.example()` calls to Commander commands.

## Resolved

(None yet — first pass)

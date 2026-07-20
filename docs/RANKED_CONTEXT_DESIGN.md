# Design: Ranked, Prefix-Safe Context (dropping the token dependency)

**Status:** Proposal (2026-07-20)
**Replaces:** token-budgeted greedy packing in `src/core/slicer.ts`

## Problem

Slice packing is budget-first: `estimateTokens = ceil(chars/3.5)` → greedy include in
BFS-depth order → hard-exclude on budget overflow. This bakes three unknowable facts
into the core algorithm:

1. **The tokenizer.** Measured on this repo's own 28 TS files: o200k (GPT) averages
   3.92 chars/token; Claude's current tokenizer (Opus 4.7+/Sonnet 5/Fable 5) averages
   ~2.45 chars/token on TS — the *same file* costs ~1.73× more tokens on Claude.
   `chars/3.5` over-estimates GPT by ~12% and under-estimates Claude by 25–35%.
   There is no single "token count" of a file.
2. **The model catalog.** All 8 rows of `MODEL_CONFIGS` are wrong, stale, or dead
   (Opus 4.5 listed at 3× its launch price; gpt-4-turbo/o1 in shutdown; gemini-2.0-pro
   never GA'd). Hardcoded model tables rot in months.
3. **The consumer's context state.** repointel's primary consumer is an LLM agent
   (per README). The agent knows its remaining window; repointel never can.

Also, greedy skip-and-continue is relevance-inverted: a large depth-1 file can be
excluded while its depth-4 transitive deps still consume budget.

## Principle

> **Turn the knapsack problem into a prefix problem.**
> Output a relevance-ordered, fidelity-layered stream such that *every prefix is the
> best possible context of that size*. The consumer cuts wherever it wants, in
> whatever unit it wants. Bytes are exact and model-independent; tokens become an
> optional, clearly-labeled estimate at the presentation layer only.

## Architecture

### 1. Score: personalized PageRank from seeds (~40 lines, no deps)

Replace BFS-depth ordering with personalized PageRank on the existing import graph
(the production-proven approach — Aider's repo map, confirmed from source):

- Nodes: files. Edges: importer → imported, weight `√(refCount) × mul`.
- Multipliers (Aider-calibrated): ×50 edge originates from a seed file; ×10 identifier
  mentioned by the user; ×10 well-named long identifier; ×0.1 `_private`-style names;
  ×0.1 symbols defined in >5 files.
- Personalization vector: mass concentrated on seed files (and user-mentioned files).
- Power iteration, damping d = 0.85, ~20–50 iterations, O(iters·E).

Cheap additive signals (all validated in shipping tools — Copilot, Cody, research):
- **Fan-in prior** (afferent coupling Ca): high-Ca files are load-bearing.
- **Git co-change:** files that historically change in the same commits as the seeds.
- **Recency:** recently edited files rank up.

### 2. Degrade: three fidelity tiers instead of include/exclude (MCKP)

Every ranked file exists at one of three representations:

| Tier | Content | Cost |
|------|---------|------|
| 0 — map | path + type + one-line role | ~free |
| 1 — skeleton | imports, exports, signatures, types; bodies stripped (TS compiler API; ~70% reduction) | low |
| 2 — full | complete source | full |

Rules:
- Seeds are always Tier 2.
- High-Ca / low-instability files (I = Ce/(Ca+Ce)) get Tier 1 minimum — their
  interfaces must be visible.
- A file that exceeds a per-file soft cap degrades to its skeleton; it is **never
  silently dropped**. ("One huge essential file" problem — solved by fidelity, not
  exclusion, same as Aider/repomix.)
- If a hard cap is requested: greedy by value density (score/cost) with the
  `max(greedy, best-single-item)` bound — a proven 1/2-approximation, ~20 lines.

### 3. Emit: prefix-safe layout

```
[manifest: every ranked file, tier 0, rank order]   ← orientation, ~free
[skeletons: tier 1+, rank order]                    ← structure
[full bodies: tier 2, rank order]                   ← depth
```

Truncating this artifact at ANY byte yields the most valuable context of that size.
That property — not token math — is what makes the output model-agnostic and
future-proof. An agent can also stop reading when oriented, or fetch Tier-2 bodies
itself using the manifest as an index.

## Where tokens go

- Native budget unit: **bytes/chars** (`--budget 200kb`). Exact, free, universal.
- `--tokens` becomes a labeled estimate: exact o200k via `gpt-tokenizer`
  (pure JS, measured 11.8 MB/s, byte-identical to js-tiktoken) plus a per-provider
  multiplier for Claude (TS ≈ ×1.73, JS ≈ ×1.52, default ×1.55), printed as
  `~67k (GPT o200k) / ~105k (Claude est.)` — never one bare number.
- Optional exact Claude counts via the free `count_tokens` API behind
  `--exact --provider claude` (needs ANTHROPIC_API_KEY; separate rate pool).
- Safety margin ×1.1–1.2 on any budget-fit comparison.
- **Delete `MODEL_CONFIGS`.** If model metadata is wanted, fetch models.dev
  `api.json` or LiteLLM's `model_prices_and_context_window.json` at runtime with a
  cached snapshot fallback and user override. Under this design that data is
  cosmetic (labels), not load-bearing (correctness).

## Related fixes this design absorbs

- **Cycle detection:** replace one-pass DFS path-slicing (verified counterexample:
  A→B, A→C, B→D, C→D, D→A reports 1 of 2 cycles and misses C entirely) with
  iterative Tarjan SCC (~70 lines, O(V+E), exact "which files are on cycles");
  optionally Johnson's algorithm per-SCC, capped, to list elementary cycles.
- **Coupling metrics:** add fan-in Ca and instability I per file (one O(E) pass);
  they double as ranking priors and as a `deps` report upgrade. God-file rule:
  fan-in AND fan-out both in top decile.
- **Relevance inversion:** by construction, a file's dependencies can no longer
  outrank the file itself after it is excluded — nothing is excluded.

## Implementation estimate

| Piece | ~Lines TS | Deps |
|-------|-----------|------|
| PageRank power iteration | 40 | none |
| Ca/Ce/instability | 30 | none |
| Tarjan SCC (iterative) | 70 | none |
| Density packer + tier substitution | 60 | none |
| Skeleton extractor | 100 | typescript (already present) |
| Prefix-safe emitter | 50 | none |
| Token labeling (optional flag) | 30 | gpt-tokenizer (~2 MB single-encoding import) |

## Sources

- Aider repo map internals: https://raw.githubusercontent.com/Aider-AI/aider/main/aider/repomap.py
- RepoGraph (ICLR 2025): https://arxiv.org/html/2410.14684v1 (+8.6% rel. on SWE-bench-Lite)
- Cody context fusion: https://arxiv.org/html/2408.05344v1
- GraphCoder: https://arxiv.org/abs/2406.07003
- Anthropic token counting (new-tokenizer ~+30% note): https://platform.claude.com/docs/en/build-with-claude/token-counting.md
- gpt-tokenizer: https://github.com/niieani/gpt-tokenizer
- Johnson's algorithm: https://www.cs.tufts.edu/comp/150GA/homeworks/hw1/Johnson%2075.PDF
- Martin package metrics: https://en.wikipedia.org/wiki/Software_package_metrics
- Model catalogs: https://models.dev/ · LiteLLM model_prices_and_context_window.json

# Roadmap: the loop with the graph inside it

**Status:** Evidence-backed plan (2026-07-20)
**Basis:** 14-agent research sweep over GitHub + arXiv (5 researchers, 5 skeptic audits,
1 completeness critic, 3 gap-fill researchers). Claims below survived fact-checking;
audit corrections are incorporated.
**Companion docs:** [RANKED_CONTEXT_DESIGN.md](RANKED_CONTEXT_DESIGN.md) (ranking math),
[REVIEW_FINDINGS.md](REVIEW_FINDINGS.md) (56 verified bugs).

## The thesis, tested against the world

> An OODA loop with a deterministic code graph inside it: observe/orient is deterministic
> tracing kept ambiently fresh; the graph grounds the LLM's context; intent compiles to a
> contract of expected graph deltas, so auditing agent work is a graph diff, not an opinion.

The research verdict, pillar by pillar:

| Pillar | Verdict | Evidence |
|--------|---------|----------|
| 1. Deterministic ambient graph | **Solved practice — assemble, don't invent** | Aider tag-cache, TS incremental builder, Nx daemon, Glean fact-ownership, Continue.dev merkle diffing all converge on the same architecture |
| 2. Graph-ranked context serving | **Validated math, WRONG delivery model — revise** | Frontier harnesses dropped injected maps/RAG for agentic search; prompt-cache economics penalize per-turn injection ~10× |
| 3. Intent → graph-delta contract | **Confirmed open space — this is the wedge** | No shipped tool compiles feature specs to machine-checked structural deltas (Thoughtworks SDD evaluation is explicit); every component exists separately |

## The big revision (counter-evidence we must respect)

The original design assumed the ranked context pack gets served to the LLM every turn.
The evidence says no:

- Claude Code tested RAG + local vector DB and removed it (~May 2025) — agentic search
  "outperformed by a lot." Codex CLI ships ripgrep in the core prompt, no index. Amp —
  built by Sourcegraph, owner of the deepest code graph (SCIP) — exposes the graph only
  as on-demand symbol tools, never injected context.
- Prompt caching is strict-prefix: injecting a re-ranked map early in context invalidates
  the cached suffix every turn (~10× input cost; cache reads are ~0.1× base). Aider itself
  keeps its map tiny (~1k tokens default) and offers `--map-refresh manual` to protect the
  prefix — accepting staleness to preserve cache.
- Published graph wins (RepoGraph +2–2.7 abs pts on SWE-bench Lite; LocAgent 92.7%
  file-localization) are real but measured on weak scaffolds/pre-frontier models; none
  demonstrated additive gains on top of a frontier agentic-grep harness.

**Consequence:** the graph belongs (a) behind cheap, cache-safe, on-demand tools the agent
calls — Serena/Amp-style verbs with PageRank ranking *inside tool responses* — and (b) in a
one-shot session-start map. The prefix-safe ranked pack remains the right artifact for
explicit exports (`slice`), just not something injected every turn. The per-turn deliverable
nobody else offers is the **contract audit** (pillar 3).

## Status (2026-07-21)

**All four phases are implemented and merged/branched.** The loop-with-graph thesis is
functional end to end: a deterministic, ambiently-fresh graph (Phase 1–2), served ranked
and on-demand (Phase 3), with intent auditable as expected graph deltas (Phase 4 — the
wedge no shipped tool offered). 113 tests, typecheck-gated build, CI on Node 20.12/22/24.
What remains is refinement (rename re-identification, framework plugins, NL→contract
compilation with human approval), not new load-bearing structure.

## Architecture (four phases)

### Phase 1 — Honest graph (largely done)

The contract is worthless if the graph lies. Done (all test-first):

1. ✅ Directory-seed expansion; `export … from` re-export extraction.
2. ✅ Real tsconfig alias resolution (JSONC-tolerant parse, `paths`/`baseUrl`, `extends`) —
   replaces the hardcoded `@/ → src/`.
3. ✅ `matchesPattern` glob compilation fixed (single-pass token translation).
4. ✅ **Tarjan SCC replaces `detectCycles`** (iterative, O(V+E), handles the proven
   cross-edge counterexample) + bounded per-SCC elementary-cycle enumeration. Reverse-dep
   impact analysis (`findDependents`) with symbol scoping and intra-file delegation.
5. ✅ Symbol-level facts: exported symbols with kind, plus per-edge imported bindings and
   import line numbers.
6. ✅ **Stable node IDs** using SCIP-style symbol grammar
   (`repointel 0.4.1 src/core/utils.ts/matchesPattern().`) — prefix-safe, survives
   re-indexing. Graph deltas are only diffable if IDs are stable. *(Remaining: rename
   re-identification via content-hash match.)*
7. ✅ Provenance labels (measured vs inferred), dependency-gated framework detection,
   corrected file-type taxonomy, git/project identity in the payload.

Remaining Phase 1 work:

- Rename re-identification (content-hash match) so a moved file keeps its node identity.
- Framework extraction as **plugins with graded facts** (Knip's architecture: 178 per-tool
   plugins, enabled by dependency detection). Existence/export/HTTP-method/registrar facts
   are *deterministic* (frameworks mandate static analyzability); type-level schemas and
   usage facts are *heuristic* — the contract vocabulary must respect that line. Prefer
   first-party generated artifacts as ground truth (`.next/routes-manifest.json`,
   Convex `_generated/api.d.ts`, TanStack `routeTree.gen.ts`).

### Phase 2 — Ambient freshness (no daemon required) — ✅ done

Shipped: staleness detection (file-set + mtime + index-version) auto-refreshes on every
read, so correctness ("always current") holds without a daemon. `repointel watch` is the
optional accelerator — recursive `fs.watch` with a debouncer that coalesces event storms
and never overlaps runs, plus an optional live contract gate. The `@parcel/watcher`
snapshot optimization below stays deferred (native dep; the O(files) stat scan is fine at
repo scale).

The converged production pattern: **per-file content hashing + file-granularity fact
ownership**. Watcher (or catch-up diff) → dirty set → re-parse dirty files only → delete
facts owned by each dirty file, insert fresh ones → re-resolve reverse-dependents only when
the file's *exported surface hash* changed (TypeScript's "signature firewall": body edits
never invalidate dependents).

- `@parcel/watcher` with `writeSnapshot()` / `getEventsSince()` — O(changes) catch-up
  *between CLI invocations*, no daemon. Write snapshot at end of every run; diff at start
  of next. `repointel watch` becomes an optional accelerator, not the foundation.
- Event hygiene (all evidenced): treat every event as "path dirty" + re-stat (atomic saves
  arrive as delete+create); debounce 50–100 ms; above ~500 dirty paths fall back to a full
  stat-scan diff (git checkout storms); chokidar fallback needs `awaitWriteFinish`
  (default stabilityThreshold 2000 ms).
- Cache: SQLite or JSON, keyed by content hash, with a CACHE_VERSION bumped when extractor
  logic changes (Aider's trick — this is also why the current stale-cache bug class dies).
- Avoid (all evidenced dead ends): graph DB servers (CodexGraph demo-ware, Potpie = heavy
  infra), per-language name-binding engines (stack-graphs archived Sep 2025 — even GitHub
  couldn't sustain it), sub-file salsa-style incrementality (overkill at repo scale),
  ctags daemons (never shipped).

### Phase 3 — Serving the graph (cache-safe) — ✅ core done

Shipped: personalized PageRank (`rankFromSeeds`, Aider weights: √#bindings, ×50 seed-origin,
×0.1 private-only) now orders slice files by relevance to the seeds instead of BFS depth, so
under a budget the most central files survive. `repo_intel` serves reverse-deps
(`findDependents`), symbol-scoped impact, and ranked context on-demand — never forced (the
navigation-paradox caution). Deferred: a separate ~1k-token session-start map and
skeleton-fidelity tiers.

- **On-demand tools** (MCP surface; Serena's adoption at 26.6k stars shows agents adopt
  symbol-granular verbs): `find-symbol`, `who-imports` (reverse deps — a top gap from the
  review), `trace-route`, `rank-context <seeds>` — with personalized PageRank ordering
  inside each response (Aider's exact weights: edge = mul·√refs; ×50 seed-file origin,
  ×10 user-mentioned, ×0.1 underscore-private).
- **Session-start map**: one-shot, small (~1k tokens, Aider-sized), prefix-safe layout.
- **`slice` keeps the prefix-safe pack** (manifest → skeletons → bodies) for explicit
  exports; byte-budgeted natively, token labels as per-provider estimates only.
- The "navigation paradox" caution (CodeCompass 2026): never *force* graph traversal —
  serve ranked results when asked, let the agent grep when grepping is right.

### Phase 4 — The wedge: intent compiles to a contract — ✅ core done

Shipped (`src/core/contract.ts`, `repointel contract`, `repo_intel contract` param):
a `Contract` of `Expectation`s (`file-exists`, `export-exists`, `edge-exists`,
`edge-forbidden`, globs allowed) evaluated to the Reflexion trichotomy — **convergent**
(promised+present), **absent** (promised, missing), **divergent** (present, forbidden).
`contract check` is a CI/hook gate (exit 1 on failure). `contract snapshot` + `contract diff`
are the verify loop: capture, let the agent work, diff to see what landed;
`deriveContractFromDiff` turns an observed delta into a reusable contract. Deferred: the
NL→contract compilation front-half (must be human-approved per the evidence) and Nx-style
tag constraints.

No shipped tool does this. Every component is proven separately — it's an assembly problem:

- **Contract language:** extend dependency-cruiser's battle-tested JSON rule schema
  (`forbidden` / `allowed` / **`required`** — "module matching X MUST have a dependency
  matching Y" already ships) from static invariants to **expected deltas**: `node-appears`
  (route file exists), `export-appears` (mutation `resetPassword` in `convex/auth.ts`),
  `edge-appears` (mailer gains inbound edge), plus Nx-style tag constraints so rules
  survive file moves. JSON, schema-validated — a compile target an LLM can emit and a
  schema can reject.
- **Audit mechanism:** Reflexion Models (Murphy & Notkin, FSE 1995) give the 30-year-old
  correct output vocabulary — every declared/observed edge classified **convergent**
  (promised & present), **divergent** (present, not promised), **absent** (promised,
  missing). cargo-semver-checks proves the two-snapshot graph-query mechanism at scale;
  API Extractor proves the "committed canonical snapshot, git diff = audit" workflow.
- **Compiling NL intent → contract, honestly:** the measured evidence (nl2postcond 32–77%
  accept@1; Verina 52.3%) says *silent* auto-compilation is unsupported. But constrained-
  grammar translation grounded against a live graph hits 90%+ (NL2TL/nl2spec), and ONE
  round of human yes/no approval closes most of the rest (TiCoder: pass@1 48%→70%, correct
  formalization for 90.4% within ~1.7 questions). So: closed predicate vocabulary,
  referentially validated against the current graph (an assertion naming a nonexistent
  module is rejected at compile time), **mandatory one-shot human approval** of the
  compiled contract, rendered back as NL for the diff-check (Clover pattern).
- **Contracts are necessary-condition gates, not oracles:** structural assertions are the
  weakest discriminators (stubs satisfy them — nl2postcond measures exactly this), so the
  contract gate layers *under* tests, never replaces them.

### The verify loop (evidence-ranked signal order)

The headline from the self-repair literature: LLMs are terrible at *detecting* their own
flaws (F1 < 0.3) and excellent at *fixing* precisely-reported ones (89% with a
deterministic report). The auditor must be deterministic; the LLM is the actuator. Order
by repair-yield per token:

1. **Parse gate, reject-before-apply** (~zero tokens; SWE-agent ablation: 18.0%→15.0%
   without it) — broken state never enters the loop.
2. **Scoped typecheck**: `tsc --noEmit` over the reverse-dependency closure of changed
   files (the graph makes this cheap).
3. **Lint**, rendered Aider-style: offending line inside its enclosing scope, never bare
   line numbers.
4. **Contract diff** (Phase 4): convergent/divergent/absent report.
5. **Targeted tests**: graph-selected minimal suite before *and* after the edit
   (TestPrune: +9.4% resolve at −23% cost).
6. Cap repair reflections at ~3 (gains saturate; Aider's cap). Mixed feedback beats any
   single modality (63.6% vs 57.9% test-only).

Delivery: Claude Code hooks (PostToolUse/Stop, exit-code-2 blocking) are the productized
inner gate — `repointel audit --contract` slots directly in, echoing the tsarch-for-agents
pattern (rules run in a Stop hook; agent self-corrects next round).

## New bugs surfaced by the research (add to backlog)

- `detectFramework` checks `app/` before Remix, so Remix repos (which use `app/routes`)
  are misclassified as Next.js App Router ([route-graph.ts](../src/core/route-graph.ts)).
- Next conventions missing from route detection: `template`, `default`, `forbidden`,
  `unauthorized`, `global-error`, `instrumentation`, `proxy` (Knip's Next plugin covers
  these).

## Sources (load-bearing)

- Aider repo map: https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system
- Serena: https://github.com/oraios/serena · SCIP: https://github.com/sourcegraph/scip
- Nx daemon/project graph; Knip plugin architecture: https://knip.dev
- dependency-cruiser rules (incl. `required`): https://github.com/sverweij/dependency-cruiser
- cargo-semver-checks (two-snapshot graph queries); API Extractor `.api.md` workflow
- Reflexion models: Murphy & Notkin, FSE 1995
- RepoGraph ICLR25 (arXiv 2410.14684); LocAgent ACL25; CodePlan FSE24; SpecRover ICSE25
- Self-repair: Huang et al. ICLR24; Dolcetti 2412.14841; ChatRepair ISSTA24; TestPrune 2510.18270
- Spec compilation: nl2postcond FSE24; TiCoder TSE24; Clover 2024; Verina 2025
- Counter-evidence on injected maps: Boris Cherny on Claude Code dropping RAG; Manus KV-cache
  writeup; Aider `--map-refresh`; AAAI26 Amazon agentic-search-vs-RAG
- Freshness: @parcel/watcher snapshots; TS `.tsbuildinfo` signature firewall; Glean
  incremental fact ownership; stack-graphs archival (Sep 2025)

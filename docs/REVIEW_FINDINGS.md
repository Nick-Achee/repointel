# Review Findings — 2026-07-20

Multi-agent review (4 reviewers x adversarial verification; 65 agents total).
Every finding below was independently re-verified against the code — several were
reproduced empirically by executing the actual functions. 1 finding was refuted and excluded.

**56 confirmed:** critical 2, major 29, minor 25

## Critical (2)

### Directory seeds silently produce empty slices — README Quick Start commands don't work
`src/core/dep-graph.ts:350` — dimension: commands

buildDepGraphFromSeeds treats each seed as an exact file relativePath: fileMap.get("src/auth/") returns undefined, so the directory becomes a single import-less node and no traversal happens. README advertises directory seeds three times (line 63 `repointel slice --seeds src/auth/`, line 92 `repointel viz --seeds src/core/`, line 101 `repointel slice --seeds src/api/`), and every command ooda generates uses `--seeds src/`. Verified: `node dist/bin/cli.js slice --seeds src/commands/` outputs Files: 1, Tokens: ~0, and the JSON contains files: ["src/commands/"] — the 'slice' is the directory entry itself with empty content, reported as success.

**Failure scenario:** New user follows README Quick Start: `repointel slice --seeds src/auth/`. Command prints '✅ Generated' but the context pack contains zero source code (1 pseudo-file, ~0 tokens). Same for `viz --seeds src/core/` (empty diagrams) and every ooda-recommended slice command.

**Suggested fix:** In buildDepGraphFromSeeds (and sliceFeature), expand seeds that are directories into all indexed files under that prefix (index.files.filter(f => f.relativePath.startsWith(seed))), and warn when a seed matches nothing.

### Import extraction misses `export ... from` re-exports and reads imports out of comments
`src/core/indexer.ts:111` — dimension: quality

extractImports() only matches `import ...` and `require(...)` patterns, so re-export barrels (`export { x } from './y'`, `export * from './y'`) produce zero dependency edges, and the regex also matches import statements inside comments/JSDoc. Verified on repointel's own output: src/index.ts re-exports from 6 modules, yet .repointel/graphs/deps.json has 0 outgoing edges for it, and its only detected 'import' is the string 'repointel' scraped from its own JSDoc example. Since DepGraph feeds slices, viz, and OODA orient, barrel files silently truncate the traversal that is the tool's core promise ('traverses your imports recursively').

**Failure scenario:** User runs `repointel slice --seeds src/index.ts` (or any seed whose subtree passes through a barrel index.ts, ubiquitous in real codebases). Traversal dead-ends at the barrel; the slice/context pack omits everything behind it with no warning, and the LLM receives an incomplete picture presented as complete.

**Suggested fix:** Add `export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]` to extractImports, strip comments before matching (or use a real parser like ts-morph/es-module-lexer), and add a regression test using src/index.ts itself as the fixture.

## Major (29)

### pages/api routes are globbed but always yield zero endpoints (default-export handlers unmatched)
`src/core/api-graph.ts:106` — dimension: analysis

buildApiGraph globs pages/api/**/*.ts and src/pages/api/**/*.ts, but extractRestHandlers only recognizes App Router-style named method exports. Pages Router API routes use `export default function handler(req, res)`, so no method matches and no endpoint is emitted. Additionally the path derivation never strips the "pages/api" prefix or the file extension, so even a hypothetical match would produce "/pages/api/users.ts" instead of "/api/users".

**Failure scenario:** A Pages Router app with pages/api/users.ts (`export default function handler...`): buildApiGraph reads the file and returns an ApiGraph with stats.byType.rest = 0 and no endpoints — a silent total false negative for the entire pages/api tree despite the glob explicitly targeting it.

**Suggested fix:** For files under pages/api, detect `export default` handlers, derive the path by stripping the pages prefix and extension (and mapping index.ts to the directory path), and record the method as unknown/ALL.

### Convex api path uses file basename only, breaking nested convex directories and colliding ids
`src/core/api-graph.ts:42` — dimension: analysis

extractConvexFunctions builds apiPath as `api.${basename}.${funcName}`. Convex generates the api object from the path relative to convex/, including subdirectories (convex/users/mutations.ts -> api.users.mutations.fn). Using only the basename produces wrong paths and makes same-named files in different folders collide on the same endpoint id.

**Failure scenario:** convex/users/mutations.ts exporting `update` is reported as "api.mutations.update" instead of "api.users.mutations.update"; an LLM consuming the generated spec/audit prompt will reference a nonexistent function. If convex/admin/users.ts and convex/users.ts both export `list`, both endpoints get id "api.users.list" — duplicate ids in the graph, merged nodes in apiGraphToMermaid, and validateApiGraph does not flag it.

**Suggested fix:** Derive the module path from the file path relative to the convex/ root with directory separators mapped to dots (dropping the extension), e.g. `api.users.mutations.update`.

### internal* Convex functions are namespaced under api.* instead of internal.*
`src/core/api-graph.ts:42` — dimension: analysis

The apiPath template is always `api.${fileName}.${funcName}`, including for internalQuery/internalMutation/internalAction. In Convex, internal functions are referenced via the `internal` object (internal.file.fn), never `api.*`, so the graph presents identifiers that don't exist in the codebase.

**Failure scenario:** convex/jobs.ts with `export const cleanup = internalMutation({...})`: the endpoint is recorded as path/id "api.jobs.cleanup" with isPublic: false. Any audit prompt or cross-reference (e.g. matching visualizer useQuery targets against the API graph) uses the api.* name; the real call sites use internal.jobs.cleanup, so lookups and generated docs are wrong.

**Suggested fix:** Use `internal.` as the prefix when funcType starts with "internal".

### findParentLayout skips the layout in the page's own directory
`src/core/route-graph.ts:70` — dimension: analysis

The walk starts at i = segments.length - 1, so the first candidate checked is the route path's parent, never the route path itself. In Next.js a layout.tsx in the same directory as page.tsx is that page's direct wrapping layout, and both map to the same routePath here (layoutMap is keyed by the layout's routePath), so the same-path layout is never found.

**Failure scenario:** app/dashboard/layout.tsx and app/dashboard/page.tsx: the page's routePath is "/dashboard", segments = ["dashboard"]; the loop only checks "/" and returns the root layout. The dashboard page is reported as a child of the root layout, and in routeGraphToMermaid it is drawn inside the Root Layout subgraph instead of the Dashboard layout subgraph. Every page co-located with its own layout is misattributed one level up.

**Suggested fix:** Start the loop at i = segments.length (checking the route's own path first), then walk up.

### Mermaid id collision: layout subgraph id equals page node id (root layout + root page collide as "_")
`src/core/route-graph.ts:310` — dimension: analysis

Layout ids and page ids are both the routePath (only api routes get a ":api" suffix), and sanitizeId maps both through the same transform. A layout and a page at the same route path therefore produce a mermaid subgraph and a node with the identical id, which mermaid cannot render (a subgraph containing a node with its own id / duplicate id).

**Failure scenario:** Any App Router project with app/layout.tsx and app/page.tsx (i.e., essentially every one): layout id "/" -> sanitizeId -> "_", emitted as `subgraph _["Root Layout"]`; the root page id "/" also sanitizes to "_" and (since its parentLayout is "/") is declared inside that subgraph as `_["/"]`. The output contains a subgraph whose id equals a node id inside it, plus `class _ page` targeting both; mermaid fails to render or silently merges the two. The same collision occurs for /dashboard/layout.tsx + /dashboard/page.tsx (both "_dashboard").

**Suggested fix:** Namespace ids by kind, e.g. `layout_` + sanitizeId(id) for layout subgraphs and `page_`/`route_` prefixes for route nodes, keeping the prefix consistent in the hierarchy-edge and class emission.

### HTTP method detection misses `export const { GET, POST } = handlers` and re-exports
`src/core/route-graph.ts:44` — dimension: analysis

extractHttpMethods (and the identical regex in api-graph.ts:107) only matches `export [async] function METHOD` or `export const METHOD`. Destructured exports and re-exports — the standard patterns for NextAuth v5 and shared handlers — never match.

**Failure scenario:** app/api/auth/[...nextauth]/route.ts containing `export const { GET, POST } = handlers;` (NextAuth v5 boilerplate) or `export { GET, POST } from "@/lib/handlers"`: extractHttpMethods returns [], so the route node has methods: []; in api-graph.ts extractRestHandlers pushes zero endpoints, so the app's auth API is entirely absent from the API graph, stats, and the API tables injected into audit/spec prompts.

**Suggested fix:** Add patterns for `export const {...} = ...` destructuring and `export { ... } from` lists, checking whether the braces contain the method name (including `as GET` aliases).

### Route groups at the leaf are not stripped, producing routes like "/(marketing)"
`src/core/utils.ts:130` — dimension: analysis

filePathToRoutePath strips route groups with /\(([^)]+)\)\//g, which requires a trailing slash after the group. When a page sits directly inside a route group, the file suffix is stripped first, leaving the group as the final segment with no trailing slash, so the group survives into the route path. The identical regex is duplicated in extractRestHandlers at src/core/api-graph.ts:97 with the same defect.

**Failure scenario:** app/(marketing)/page.tsx: strip ^app -> "/(marketing)/page.tsx"; strip /page.tsx -> "/(marketing)"; group regex finds no "(marketing)/" with trailing slash, so the derived route is "/(marketing)" instead of "/". The route graph, dedup checks in eval.ts (keyed on routePath), and every downstream slice/spec prompt report a URL that does not exist. app/(marketing)/about/page.tsx works (group has trailing slash), so the bug silently affects only leaf pages of groups.

**Suggested fix:** Strip group segments segment-wise: split the path on "/" and drop any segment matching /^\([^)]+\)$/ before rejoining, instead of a slash-anchored global replace. Apply the same fix in api-graph.ts extractRestHandlers.

### Parallel-route slots (@slot) and intercepting segments ((.), (..)) leak into route paths
`src/core/utils.ts:117` — dimension: analysis

filePathToRoutePath handles route groups only. Next.js App Router parallel-route slot directories (@modal, @analytics) and intercepting-route markers ((.)foo, (..)foo, (...)foo) are never stripped, so derived route paths contain segments that never appear in a URL.

**Failure scenario:** app/dashboard/@analytics/page.tsx yields routePath "/dashboard/@analytics" although the page is served at "/dashboard". app/@modal/(.)photo/[id]/page.tsx yields "/@modal/(.)photo/[id]". These bogus paths propagate to RouteGraph ids, findParentLayout lookups (which then miss the correct ancestor layout chain), mermaid diagrams, and the "Route:" header of generated spec/audit prompts.

**Suggested fix:** When deriving the route path, drop segments starting with "@" and strip leading (.)/(..)/(...)  interception markers from segments (the marker's segment remains part of the matched URL, minus the marker).

### MODEL_CONFIGS pricing is stale or fabricated; cost estimates off 2-5x
`src/types/index.ts:436` — dimension: analysis

MODEL_CONFIGS feeds tokenBudget.estimatedCost (src/core/slicer.ts:256) which is printed as fact (src/commands/slice.ts:128). Several entries are wrong: claude-opus-4.5 is priced $5/$25 per Mtok (config says 0.015/0.075 per 1k = $15/$75, 3x high) and its maxOutput is 64000 not 32000; gpt-4o has been $2.50/$10 per Mtok since Aug 2024 (config 0.005/0.015 is the launch price, 2x high); o3 dropped to $2/$8 per Mtok in June 2025 (config 0.01/0.04 is 5x high, with only a source-comment "TBD" that never reaches users); "gemini-2.0-pro" never shipped as a GA priced model — its 0.00125/0.005 numbers are copied from gemini-1.5-pro; gemini-1.5-pro's $1.25/Mtok rate only applies to prompts <=128k tokens, while the config advertises a 1,000,000-token window and applies the low rate to the whole window — exactly the regime this slicer targets.

**Failure scenario:** `repointel slice --model claude-opus-4.5` on a 150k-token slice prints Est. Cost $2.25 when the real input cost is $0.75; `--model o3` overstates by 5x; `--model gemini-2.0-pro` prints a cost for a model that cannot be purchased; a 500k-token gemini-1.5-pro slice is billed at the <=128k tier and understates real cost by 2x. Users making pack-vs-split decisions on these numbers are systematically misled.

**Suggested fix:** Correct the numbers, remove or clearly mark unpriceable/experimental models, model tiered pricing (or cap at the tier boundary), and surface a "pricing as of <date>" disclaimer next to estimatedCost.

### ooda in-progress detection can never match: compares against "in_progress" but the type/parser use "in-progress"/never emit it
`src/commands/ooda.ts:220` — dimension: commands

ooda.ts filters tasks with t.status === "in_progress" (underscore) at lines 220, 328, 497, 505, 566, but SpecKitTask.status is the union "pending" | "in-progress" | "completed" (src/core/speckit.ts:58). The comparison has no type overlap (tsc TS2367 confirms) and is always false. Every in-progress-dependent behavior in ooda is dead code: the 'Continue: "<task>"' action is never offered, auto-focus (line 327-330) never finds the feature being worked on and always falls back to the last feature in the list, and DECISION_CONTEXT.md's 'Currently In Progress' section (line 497-509) can never be generated.

**Failure scenario:** Repo has features 001 (task actively being worked) and 002 (created later, untouched). Run `repointel ooda`: the state summary reports Focus = feature 002, the recommended action ignores the active task entirely, and the generated decision context omits any 'Currently In Progress' section — ooda misclassifies the repo state on every run.

**Suggested fix:** Change all "in_progress" literals to "in-progress", and add a typecheck step (tsc --noEmit) to the build so no-overlap comparisons fail CI.

### ooda OBSERVE/ORIENT reuse stale artifacts with no staleness check, contradicting its own 're-run to update state' guidance
`src/commands/ooda.ts:66` — dimension: commands

Without --refresh, OBSERVE only rescans when index.json is missing or unparseable (needsObserve), and ORIENT only rebuilds deps.json when the file doesn't exist (line 84). getIndex (src/core/indexer.ts:522-531) loads whatever is on disk with no comparison against the stored gitCommit or file mtimes. Yet the generated DECISION_CONTEXT.md tells the LLM 'Run `repointel ooda` again after completing work to update state' (line 658) and README's workflow step 5 is 'Re-index — run repointel again to see where you landed' — a plain re-run updates nothing.

**Failure scenario:** Run `repointel ooda` (index created, 57 files). Complete a feature adding 20 files with new anti-patterns. Run `repointel ooda` again as instructed: OBSERVE prints '✓ Index exists (57 files)', the dependency graph is the old one, and the decision context/anti-pattern counts describe the pre-work repo — the loop recommends actions based on state that no longer exists.

**Suggested fix:** In gatherState, compare index.gitCommit to current HEAD (utils already has getGitCommit) and/or index generatedAt vs newest file mtime; set needsObserve when stale. Do the same for deps.json in ORIENT.

### Build passes only because tsup skips typechecking — tsc --noEmit reports 13 real errors
`src/commands/ooda.ts:87` — dimension: commands

npx tsc --noEmit fails with 13 errors, all shipped in the built package: buildDepGraph(root) at ooda.ts:87 and getIndex(root) at ooda.ts:305 pass a string where an options object is expected (TS2559) — both only work by coincidence because the ignored root defaults to process.cwd() which equals the argument; ooda.ts:324 assigns undefined to a null-typed field; the five "in_progress" no-overlap comparisons (TS2367); spec.entryPoints accesses at 228/237 (TS2339); plus 3 direction-union errors in src/core/visualizer.ts:597-600. The 'build works, 31/31 tests pass' signal is hollow for these paths because tsup transpiles without checking.

**Failure scenario:** Any future refactor that changes ooda's root handling (e.g. supporting --root <dir>) will index/graph the wrong directory silently, since the passed root string is discarded and cwd is used. Today, the type errors already encode the two behavioral bugs reported separately (in_progress, entryPoints).

**Suggested fix:** Add "typecheck": "tsc --noEmit" to package.json scripts, run it in CI/prepublish, and fix the 13 errors (pass { root } objects at ooda.ts:87 and 305).

### ooda task actions reference nonexistent spec.entryPoints, so every suggested slice command is `--seeds src/` — which produces an empty slice
`src/commands/ooda.ts:228` — dimension: commands

currentFeature.spec?.entryPoints?.[0] at lines 228 and 237 reads a property that does not exist on SpecKitSpec (speckit.ts:37-45 — tsc TS2339 confirms), so it is always undefined and the fallback "src/" is always used. Combined with the directory-seed bug, the top-priority command ooda recommends for continuing/starting a task (`repointel slice --seeds src/ --name <id>`) yields a 1-node, 0-token slice. The OODA loop's flagship recommendation chain is non-functional end to end.

**Failure scenario:** Feature 001 has pending tasks whose spec names concrete files. `repointel ooda --yes` auto-selects the task action; the suggested command in PROPOSAL_PROMPT.md is `repointel slice --seeds src/ --name 001-...`; running it produces a context pack with zero source content.

**Suggested fix:** Either add entryPoints parsing to parseSpec (e.g. from backticked file paths in spec.md) or derive seeds from the feature's related files; and fix directory-seed expansion so the fallback at least works.

### --max-tokens is silently ignored unless --model is also passed
`src/core/slicer.ts:284` — dimension: commands

In both sliceRoute (line 128) and sliceFeature (line 284), tokenBudget = modelConfig ? (options.maxTokens || calculateTokenBudget(modelConfig)) : null — the user-supplied maxTokens is only consulted when a model config resolved. cli.ts:73 documents `--max-tokens <n>` as 'Max tokens for slice (overrides model default)' with no stated dependency on --model. Verified: `slice --seeds src/commands/ooda.ts --max-tokens 100` packed 8 files / ~34,327 tokens, blowing the requested 100-token cap with no warning.

**Failure scenario:** User runs `repointel slice --seeds src/app/ --max-tokens 50000` to fit a context window. The flag does nothing; the slice is capped only by the 8MB byte default and can exceed the requested budget by orders of magnitude, silently.

**Suggested fix:** Apply options.maxTokens as the budget whenever it is set, independent of modelConfig: const tokenBudget = options.maxTokens ?? (modelConfig ? calculateTokenBudget(modelConfig) : null).

### Unknown --model values are silently swallowed — no validation, no warning, budgeting silently disabled
`src/core/slicer.ts:45` — dimension: commands

getModelConfig returns MODEL_CONFIGS[model] which is undefined for any string not in the hardcoded key set; both slice functions then treat modelConfig as falsy and skip token budgeting entirely with no error. The CLI does not validate --model (cli.ts:71 free-text option). Verified: `slice --seeds src/bin/cli.ts --model gpt-5` succeeds with no Token Budget section and no warning. Also `--model custom` (a member of the LLMModel union) can never work from the CLI since customModelConfig is not settable, yet it resolves to undefined the same silent way.

**Failure scenario:** User types `--model claude-opus-4` (missing '.5') or `--model gpt-5`. The command succeeds, prints no budget, and packs up to 8MB (~2.4M estimated tokens) — the user believes the slice was sized for their model's 200k window when no budgeting occurred at all.

**Suggested fix:** Validate options.model against Object.keys(MODEL_CONFIGS) in sliceCommand and exit with the list of valid models; at minimum print a warning when getModelConfig returns undefined.

### No syntax ever produces an "in-progress" task, so specify's Active Work/In Progress/stalled logic misclassifies
`src/core/speckit.ts:291` — dimension: commands

parseTasks only recognizes `- [ ]` and `- [x]` and maps them to "pending"/"completed" — nothing ever produces "in-progress" despite it being in the status union. In src/commands/specify.ts, the 'In Progress' counter (line 159, 566-569) is always 0, the '🔥 Active Work' section (line 580-593) never renders, 'Currently working on' (line 178-185) never shows, and the 'stalled/Ready to Resume' filter (line 596-601: has pending AND no in-progress) is trivially true for every feature with any pending task.

**Failure scenario:** User marks a task as in-progress in tasks.md (e.g. `- [~] Build login form` or any marker) — parseTasks either treats it as not-a-task or pending. `repointel specify` dashboard shows 'In Progress: 0' and lists the actively-worked feature under '⏸️ Ready to Resume' alongside every other feature, making the 'know where you are' status display wrong by construction.

**Suggested fix:** Support an in-progress checkbox marker (e.g. `- [~]` or `- [>]`) in parseTasks, or remove "in-progress" from the model and all UI that claims to display it.

### tsconfig paths are loaded but never used; @/ alias hardcoded to src/
`src/core/dep-graph.ts:97` — dimension: core

loadTsConfigPaths (lines 29-43) parses baseUrl/paths from tsconfig.json and the result is passed into resolveImport (lines 80-120), but the tsConfig parameter is never referenced inside the function body. Instead, '@/' is unconditionally rewritten to 'src/' (line 98) and '~/' to repo root (line 105). Any alias other than '@/' or '~/' fails the first guard (lines 87-92) and is classified as an external package. Additionally, tsconfig.json is usually JSONC (comments, trailing commas), so JSON.parse at line 35 silently returns {} for most real projects — masked only because the result is unused anyway.

**Failure scenario:** A Next.js app without a src/ directory has tsconfig '{"paths": {"@/*": ["./*"]}}'. Import '@/components/button' is rewritten to 'src/components/button', tryResolveFile finds nothing, resolveImport returns {path: null, isExternal: false}, and in buildDepGraph (lines 243-261) the import is neither added as an edge nor counted as an external dep — it silently vanishes. Every '@/' edge in the repo is dropped, so dep graphs are near-empty and slices built from seeds omit all aliased dependencies. Similarly, a repo using '"@lib/*": ["src/lib/*"]' has every '@lib/x' import misclassified as external package '@lib/x'.

**Suggested fix:** Actually consult tsConfig.paths in resolveImport: for each pattern like '@/*', map the matched suffix onto each target and call tryResolveFile; fall back to baseUrl resolution. Parse tsconfig with a JSONC-tolerant parser (strip comments/trailing commas) and follow 'extends'. Remove the hardcoded '@/'->'src/' rewrite or keep it only as a last-resort fallback.

### Windows: path.join produces backslash node IDs that mismatch fast-glob posix keys
`src/core/dep-graph.ts:113` — dimension: core

Index keys (file.relativePath) come from fast-glob, which always returns forward-slash paths. But resolveImport's relative branch builds paths with path.join/path.normalize (lines 112-114), and tryResolveFile's directory-index branch uses path.join(stripped, `index${ext}`) (line 67). On Windows these return backslash-separated strings, so resolved edge targets never equal any fileMap/edgeMap key.

**Failure scenario:** On Windows, BFS in buildDepGraphFromSeeds dequeues 'src\core\utils.ts' (backslash), fileMap.get returns undefined (key is 'src/core/utils.ts'), so imports = [] and traversal dies after depth 1 — slices contain only seeds plus their direct children with no grandchildren. In buildDepGraph, edgeMap keys are posix but neighbor values are backslash, so detectCycles' edges.get(neighbor) always returns [] and cycle detection can never find any cycle. Prefix checks like relativePath.startsWith('convex/') (line 149) and mermaid node matching also fail.

**Suggested fix:** Normalize every resolved path to posix separators before returning it, e.g. resolved.split(path.sep).join('/'), or use path.posix.join throughout since all inputs are repo-relative posix paths.

### extractImports misses `export ... from` re-exports, so barrel files break the graph
`src/core/indexer.ts:111` — dimension: core

extractImports (lines 111-124) only matches 'import ...', 'import(...)', and 'require(...)'. Re-export syntax — export * from './x', export { a } from './x', export type { T } from './x' — is not matched at all. Verified empirically: extractImports on a barrel file containing only re-exports returns []. Since dep-graph.ts consumes file.imports from the index (dep-graph.ts lines 235, 363), barrel files appear to have zero dependencies.

**Failure scenario:** src/components/index.ts contains only 'export * from "./Button"; export { Card } from "./Card"'. A page imports from '@/components' (the barrel). buildDepGraphFromSeeds reaches index.ts at depth 1 and stops — Button.tsx and Card.tsx are never enqueued because fileInfo.imports is empty. The resulting slice/context pack contains the page and an empty barrel but none of the components actually rendered, and cycle detection through barrels is impossible. Any repo using barrel exports (extremely common) gets a truncated graph.

**Suggested fix:** Add a pattern for re-exports, e.g. content.matchAll(/export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g), and merge results into the import set.

### detectFrameworks/detectSpecs glob without ignore list, scanning node_modules and producing false detections
`src/core/indexer.ts:394` — dimension: core

detectFrameworks (line 394) and detectSpecs (line 416) call fg(patterns, { cwd, absolute: false }) with no ignore option, unlike generateIndex which passes DEFAULT_IGNORE. Unanchored patterns — '**/app.{js,ts}', '**/server.{js,ts}' for express and '**/*.graphql', '**/openapi.{yaml,yml,json}', '**/*.tsp' for specs — therefore traverse node_modules, .next, and dist.

**Failure scenario:** Any repo with node_modules installed: dozens of packages ship app.js/server.js, so 'express' is reported as a detected framework in virtually every project; the graphql package and many others ship .graphql files, so the repo is falsely reported as having a GraphQL spec (index.specs), which downstream commands (ooda, audit) treat as ground truth. It also makes framework detection walk the entire node_modules tree, an order-of-magnitude slowdown on large installs.

**Suggested fix:** Pass ignore: DEFAULT_IGNORE (plus '**/node_modules/**' explicitly) to both fg calls, and consider anchoring the express patterns (e.g. 'src/**', root-level) instead of '**/'.

### Slicer greedy first-fit can silently drop a seed file while including its dependencies
`src/core/slicer.ts:191` — dimension: core

In both sliceRoute (lines 182-199) and sliceFeature (lines 324-341), a file that exceeds maxFileBytes or the remaining token budget is skipped with 'continue' and iteration proceeds to deeper nodes. There is no priority for seeds and no stop-at-budget: a depth-0 seed that doesn't fit is excluded while its depth-1..n imports (which only matter because of that seed) still consume the budget. The function returns a normal-looking slice; nothing errors or warns.

**Failure scenario:** sliceRoute('/dashboard') where app/dashboard/page.tsx is 300KB (~86k estimated tokens) and the model budget is 50k tokens. page.tsx is dequeued first, fails 'totalTokens + fileTokens > tokenBudget', and lands in excluded with reason 'token_budget'. The loop then packs dozens of small depth 1-4 helper files. The generated context pack for route /dashboard contains every helper except the route's own page component — the one file the LLM actually needs — and the caller has no signal beyond an entry buried in the excluded list. Same with maxFileBytes: a 500KB seed (over the 400KB default) is dropped at line 182-185 while its imports are kept.

**Suggested fix:** Pack seeds first regardless of order and fail loudly (throw or set an error flag) if any seed cannot fit; alternatively prune the subtree of an excluded file, since dependencies of an excluded file rarely make sense on their own.

### matchesPattern glob-to-regex escaping order corrupts ** and bracket patterns
`src/core/utils.ts:167` — dimension: core

matchesPattern (lines 167-178) replaces '**' with '.*' BEFORE escaping dots, so the final .replace(/\./g, '\\.') turns the injected '.*' into '\.*' — 'zero or more literal dots'. Verified empirically: '**/*.stories.tsx' compiles to /^\.*\/[^/]*\.stories\.tsx$/ which fails to match 'src/components/Button.stories.tsx', and '**/node_modules/**' compiles to /^\.*\/node_modules\/\.*$/ which matches nothing real. Regex metacharacters '[', ']', '(', ')', '+', '?' are also never escaped, so 'app/[id]/page.tsx' becomes a character class and fails to match itself.

**Failure scenario:** User runs a slice with exclude ['**/*.stories.tsx']. In sliceRoute/sliceFeature (slicer.ts lines 165, 309) matchesPatterns returns false for every nested storybook file, so all of them are silently included in the context pack, blowing the token budget on files the user explicitly excluded. Exclude 'app/[id]/page.tsx' likewise never matches the literal path.

**Suggested fix:** Escape all regex metacharacters first, then substitute glob tokens: escape the pattern, then replace escaped '\*\*' with '.*' and remaining '\*' with '[^/]*' (or use an existing library like picomatch/micromatch, which is already transitively available via fast-glob).

### OODA Decide/Act is largely theater: generic actions, top recommendation is unactionable, and the loop is manual copy-paste
`src/commands/ooda.ts:206` — dimension: quality

Observe/Orient do real work (index + dep graph), but Decide generates the same five template actions for any repo. The priority-1 recommendation 'Fix N anti-pattern(s)' suggests the command `repointel scan --refresh` — which re-scans and fixes nothing — and neither the action nor DECISION_CONTEXT.md lists which files contain the anti-patterns (generateDecisionContext at lines 477-484 emits only aggregate counts, though per-file data exists in index.json). The Act phase executes nothing: it prints suggested commands and, in the propose/confirm loop, asks the human to `cat` a prompt into their LLM and paste the LLM's multi-line plan back into a single-line @inquirer input() (line 800), where the first newline terminates entry. Approval just writes APPROVED_PLAN.md.

**Failure scenario:** User (or their LLM) follows the recommended action: runs `repointel scan --refresh`, which changes nothing; the next `ooda` run recommends the identical action again. An LLM given DECISION_CONTEXT.md and told to fix '12 anti-patterns' cannot locate them without independently re-reading index.json.

**Suggested fix:** Make the anti-pattern action list the offending files (data already exists in index.files[].antiPatterns), replace the no-op suggested command, and either pipe proposals to the LLM directly or read plans from a file path instead of a single-line paste prompt.

### Default interactive OODA mode breaks the README's primary 'the LLM runs the commands' workflow
`src/commands/ooda.ts:155` — dimension: quality

README.md's stated usage (lines 16-26) is that the user talks to their LLM and 'The LLM runs the commands.' But `repointel ooda` defaults to interactive mode (isInteractive = options.interactive !== false && !options.yes) with no TTY detection anywhere in src/ (grep for isTTY: none). When an agent like Claude Code runs it in a non-TTY shell, the @inquirer select() throws, the bare catch prints 'Cancelled.', and the run silently ends after the prompts are written. The flags that make agent usage work (--yes, --no-interactive) exist in cli.ts (lines 130-131) but appear nowhere in the README. The DECISION_CONTEXT.md footer also hardcodes 'Generated by repointel v0.2.0' (line 662) while the package is 0.4.1.

**Failure scenario:** User tells Claude Code 'Run repointel on this project and help me understand where we are' (the README's own example). The agent runs `repointel ooda`, the interactive prompt dies with 'Cancelled.', and the agent gets a partial transcript, never reaching the decide/act guidance.

**Suggested fix:** Detect !process.stdout.isTTY and fall back to non-interactive output automatically; document --yes/--no-interactive in the README; derive the version string from package.json.

### Zero test coverage on the entire intelligence pipeline; only the visualizer is tested
`src/core/dep-graph.ts:1` — dimension: quality

All 31 passing tests live in src/core/visualizer.test.ts and src/commands/visualize.test.ts (verified via `vitest run`). The value-bearing chain — indexer.ts (regex import/export extraction), dep-graph.ts (import resolution, BFS, cycle detection), slicer.ts (token budget math), route-graph.ts, api-graph.ts, speckit.ts, and the 1007-line ooda.ts — has no tests. The riskiest are indexer + dep-graph, because every other artifact derives from them, and the confirmed re-export bug proves regressions there ship silently. docs/PROJECT_DOSSIER.md's 'Testing and Reliability' section is itself stale (claims 'No test framework configured... no *.test.ts files exist'), showing the docs are not regenerated against reality.

**Failure scenario:** Any refactor to resolveImport() or extractImports() that breaks alias handling or edge construction passes CI (tests green, build green) while every downstream slice, graph, and OODA context becomes quietly wrong — the exact failure mode the tool exists to prevent.

**Suggested fix:** Add fixture-repo tests for indexer (imports incl. re-exports, comments, multiline), dep-graph (alias resolution, cycles, seed BFS depth), and slicer (budget inclusion/exclusion order, token math). Regenerate or delete the stale dossier section.

### tsconfig path aliases are loaded but never used; only hardcoded '@/ -> src/' resolves
`src/core/dep-graph.ts:80` — dimension: quality

loadTsConfigPaths() parses compilerOptions.baseUrl/paths (lines 29-43) and the result is passed into resolveImport(), but the tsConfig parameter is never referenced in the function body. Alias handling is hardcoded: '@/' is rewritten to 'src/' and '~/' to repo root. Projects whose tsconfig maps '@/*' to './*' (the create-next-app default when there is no src/ directory) or use custom aliases ('@components/*', '#app/*') get every aliased import silently classified as unresolvable, dropping edges from the graph.

**Failure scenario:** A Next.js app without a src/ directory (alias '@/*': ['./*']) runs `repointel slice --route /dashboard`. Every '@/components/...' import fails tryResolveFile('src/components/...'), so the slice contains only the page/layout seeds — the LLM context pack is missing nearly all dependencies, with no warning.

**Suggested fix:** Actually apply tsConfig.paths (longest-prefix match against paths entries plus baseUrl) in resolveImport, and surface unresolved internal-looking imports as warnings in slice output instead of dropping them silently.

### No reverse-dependency query or file-importance ranking despite being core orientation questions
`src/core/dep-graph.ts:279` — dimension: quality

The DepGraph stores directed edges, but nothing in src/ exposes 'who imports this file' — grep for importedBy/dependents/centrality finds nothing, no CLI command accepts a file and returns its dependents, and DepNode has no fan-in field. The only 'importance' stat computed is maxDeps, which counts outgoing edges (fan-out) — i.e., which file imports the most, not which file is most depended upon. For the stated goal ('know where you are', safe LLM-assisted edits), blast-radius ('what breaks if the LLM changes utils.ts?') and hotspot ranking are the first questions a user asks, and the data to answer them already exists in deps.json edges.

**Failure scenario:** Before letting an LLM refactor src/core/utils.ts, the user asks 'what depends on this?' repointel has no command for it; the user must manually grep deps.json, or the LLM edits the file blind to its 15+ dependents.

**Suggested fix:** Add a `repointel who-imports <file>` (or `deps --reverse <file>`) command using an inverted edge index, add fan-in counts to DepNode, and rank slices/decision context by in-degree so high-blast-radius files are flagged.

### No staleness detection anywhere: cached index, graphs, and slices are served as current regardless of age or commit
`src/core/indexer.ts:522` — dimension: quality

getIndex() returns any existing .repointel/index.json without comparing its stored gitCommit/generatedAt to the working tree; slicer and dep-graph both build on it. OODA's Observe only checks that the index file exists (gatherState, ooda.ts lines 299-309) and Orient reuses graphs/deps.json purely on existence (ooda.ts line 84), despite the dossier claiming ooda 'regenerates if missing/stale'. The repo's own artifacts prove the hazard: .repointel/graphs/routes.json and api.json are dated 2026-02-04 and slices/cli-context.json is from 2025-12-28, yet every command would consume them as current. For a tool whose tagline is 'Know where you are. Always.', there is no freshness guarantee and no watch/incremental mode (admitted in docs/OPEN_QUESTIONS.md item 4).

**Failure scenario:** User does a week of work, then runs `repointel slice --route /checkout` without re-scanning. The slice is built from a month-old index: renamed files are 'missing', new files absent, and the LLM is confidently oriented against a repo state that no longer exists.

**Suggested fix:** On load, compare stored gitCommit against `git rev-parse HEAD` (already available via getGitCommit) and either auto-refresh or print a prominent staleness warning with the artifact's age; stamp all consumed artifacts with a freshness check.

### Token budgeting silently disables itself for 'custom' or any unrecognized model, and defaults enforce no LLM budget at all
`src/core/slicer.ts:41` — dimension: quality

getModelConfig() returns undefined for model='custom' without a customConfig (which the CLI cannot supply — cli.ts only exposes --model and --max-tokens) and for any name not in MODEL_CONFIGS. Because sliceRoute/sliceFeature guard with `modelConfig ? ... : null`, budgeting is silently skipped: verified live, `--model custom` and `--model gpt-5` both produced slices with no tokenBudget field, no warning, no error. MODEL_CONFIGS (src/types/index.ts:435) is a hardcoded, already-stale list (o3 prices commented 'TBD') that will silently reject every future model name. Additionally, without --model (the README quick-start path) the only cap is 8MB of bytes — roughly 2.4M estimated tokens — so default slices are not actually 'packed into an LLM token budget'. Minor: estimateTokens divides by 3.5 while its own comment and PROJECT_DOSSIER.md line 324 say /4, and reported totalTokens excludes the markdown scaffolding/fences of the generated .md pack, so real pack size exceeds the accounted budget.

**Failure scenario:** User runs `repointel slice --seeds src/ --model gpt-5` expecting a context-window-safe pack. Budgeting is silently off; the resulting pack can exceed the model's context window, and the JSON reports no budget section explaining why.

**Suggested fix:** Validate --model against MODEL_CONFIGS keys via Commander .choices() and fail loudly on unknown names; make --max-tokens work standalone without --model; apply a sane default token cap when no model is given; reconcile the 3.5-vs-4 divisor with docs.

## Minor (25)

### extractAuthRequirement regex can never match real Convex functions (auth detection is dead code)
`src/core/api-graph.ts:67` — dimension: analysis

Two independent defects: (1) `\(\{[^}]*handler:` cannot cross a `}` — any function with an args validator (`args: { id: v.id("users") }`) puts a `}` before `handler:`, so the whole pattern fails. (2) The pattern is compiled with the "m" flag, so the `$` in the lookahead `(?=export\s+const|$)` matches at the first end-of-line; the lazy `([^]*?)` body capture therefore stops at the first newline after `{`, capturing at most one line — getUserIdentity on any later line is invisible.

**Failure scenario:** Standard Convex code: `export const getUser = query({ args: { id: v.id("users") }, handler: async (ctx, { id }) => {\n  const identity = await ctx.auth.getUserIdentity(); ... }})` — defect (1) aborts the match, so auth is undefined. Even without an args object, defect (2) makes the captured body empty (the `{` is at end of line), so "authenticated" is never returned. Every endpoint's auth field is undefined in practice.

**Suggested fix:** Match per-function spans by slicing content between successive `export const` offsets (already available from funcPattern.exec indices in extractConvexFunctions) and search that slice for getUserIdentity/getAuthUserId; drop the fragile single regex and the "m" flag.

### apiGraphToMermaid groups REST endpoints by file basename, collapsing all Next.js routes into one "route" subgraph
`src/core/api-graph.ts:251` — dimension: analysis

Grouping uses path.basename(endpoint.file, ".ts"). Every App Router REST handler file is named route.ts, so all REST endpoints across the whole app land in a single subgraph labeled "route"; .js files additionally keep their extension (basename "route.js"). Convex files with equal basenames in different directories also merge into one subgraph.

**Failure scenario:** An app with app/api/users/route.ts and app/api/orders/route.ts renders one mermaid subgraph `route["route"]` containing GET /api/users, POST /api/orders, etc. — the router structure the diagram is supposed to show is erased.

**Suggested fix:** Group REST endpoints by their route path's parent (e.g. dirname of the file relative to app/) and Convex endpoints by file path relative to convex/, not by basename.

### Optional catch-all segments produce param name "[...slug]" instead of "slug"
`src/core/utils.ts:157` — dimension: analysis

extractRouteParams slices one bracket pair and strips a leading "...", but Next.js optional catch-alls use double brackets: for "[[...slug]]" the slice yields "[...slug]", which still starts with "[" so the "..." strip does not apply and the brackets remain in the param name.

**Failure scenario:** app/docs/[[...slug]]/page.tsx: RouteNode.params = ["[...slug]"] instead of ["slug"]; any consumer comparing params to `params.slug` in code (audit prompts, spec generation) sees a mismatch.

**Suggested fix:** Strip repeatedly: `segment.replace(/^\[+|\]+$/g, "").replace(/^\.\.\./, "")`.

### fetch-call detection has no word boundary: router.prefetch() counted as an API call
`src/core/visualizer.ts:117` — dimension: analysis

The fetch regex /fetch\s*\(\s*['"`].../ matches "fetch(" as a substring of longer identifiers. Additionally the optional method capture uses \{[^}]*method which cannot cross nested braces, so any init object with e.g. a headers object before method loses the method.

**Failure scenario:** A Next.js component calling `router.prefetch("/settings")` produces a false "fetch GET /settings" edge and an external node in the data-flow/sequence diagrams. `fetch("/api/x", { headers: { "Content-Type": "application/json" }, method: "POST" })` is labeled GET because [^}]* stops at the headers object's closing brace.

**Suggested fix:** Use /(?<![\w.$])fetch\s*\(/ (also rejecting `.fetch` only when it's a member of a non-window object, or at minimum \b), and search the full init argument for method: via a brace-balanced scan.

### stripComments truncates code lines containing "//" inside string literals
`src/core/visualizer.ts:73` — dimension: analysis

The single-line comment strip /(?<!:)\/\/.*$/gm only whitelists "://". Any other "//" inside a string — protocol-relative URLs, doubled path slashes — deletes the rest of the line before pattern matching, and the multi-line strip /\/\*[\s\S]*?\*\// also eats content between "/*" and "*/" occurring inside strings (e.g. glob literals like "src/**/*.ts").

**Failure scenario:** `fetch("//api.example.com/v1/data")` becomes `fetch("` after stripping, so the call is never detected (false negative). A file containing two glob strings `"src/**/*.ts"` ... `"lib/**/*.ts"` has all code between the first "/*" and the next "*/" removed, hiding any useQuery/fetch calls in between.

**Suggested fix:** Use a small tokenizer that tracks string/template-literal state when removing comments, or at least skip stripping inside quote spans.

### Import edges reference files cut by maxNodes, creating phantom mermaid nodes
`src/core/visualizer.ts:286` — dimension: analysis

buildDataFlowGraph only creates nodes for slice.files.slice(0, maxNodes) (line 204), but import edges are filtered against sliceFileSet built from all slice files. Edges touching files beyond maxNodes reference ids that were never declared, so mermaid auto-creates unlabeled nodes whose visible text is the raw sanitized path.

**Failure scenario:** A slice with 60 files and default maxNodes = 50: dep-graph edges into files 51-60 emit lines like `src_components_Foo_tsx --> src_lib_deep_util_ts` where the target node was never declared; the rendered diagram shows bare nodes labeled "src_lib_deep_util_ts" outside both the Client and Server subgraphs, and they belong to no layer in architectureToMermaid.

**Suggested fix:** Build sliceFileSet from the same truncated list used for node creation (or add nodes lazily for edge endpoints).

### validateArtifact misdetects ContextSlice JSON as a RepoIndex
`src/validators/eval.ts:414` — dimension: analysis

Type detection checks `"files" in data && "summary" in data` first, but ContextSlice also has both `files` and `summary` (src/types/index.ts:326-344). A slice artifact passed to eval is validated as a RepoIndex against the wrong schema.

**Failure scenario:** `repointel eval .repointel/slices/route.json`: every SliceFile lacks `hash`, so validateRepoIndex emits an INVALID_HASH warning per file, plus a SUMMARY_MISMATCH warning (summary.clientComponents is undefined), while none of the slice's actual invariants are checked. With --strict (src/commands/eval.ts:86) a perfectly valid slice fails the eval.

**Suggested fix:** Detect slices first via distinctive keys (`seedFiles`/`excluded`), or match RepoIndex on `frameworks`/`specs` presence instead of the generic files+summary pair.

### repointel --version reports 0.1.0; package is 0.4.1; generated docs say v0.2.0
`src/bin/cli.ts:20` — dimension: commands

cli.ts hardcodes .version("0.1.0") while package.json is at 0.4.1 (verified: `node dist/bin/cli.js --version` prints 0.1.0). Separately, ooda.ts:662 hardcodes 'Generated by repointel v0.2.0' into every DECISION_CONTEXT.md footer. Three different version strings ship in one package.

**Failure scenario:** User files a bug report including `repointel --version` output (0.1.0); maintainer investigates against the wrong release. Any tooling gating on version (npx cache checks, changelog links) sees a version three minors behind reality.

**Suggested fix:** Read version from package.json (e.g. createRequire(import.meta.url)('../../package.json').version) in cli.ts and interpolate the same constant into the ooda context footer.

### --no-interactive is documented as 'same as --yes' but behaves differently: no action auto-selected, no proposal prompt written
`src/bin/cli.ts:131` — dimension: commands

cli.ts:131 says '--no-interactive  Skip interactive prompts (same as --yes)'. In ooda.ts:155-183, --yes auto-selects the recommended action and writes PROPOSAL_PROMPT.md, while --no-interactive alone hits the else branch that only prints 'Tell your LLM which action to take' and writes nothing beyond DECISION_CONTEXT.md.

**Failure scenario:** CI or an LLM harness runs `repointel ooda --no-interactive` then `cat .repointel/prompts/PROPOSAL_PROMPT.md` (as the --yes path instructs). The file doesn't exist (or is stale from a previous run), so the pipeline feeds the wrong/no proposal to the model.

**Suggested fix:** Either make --no-interactive imply the --yes code path, or correct the help text to describe what it actually does.

### --refresh on spec/audit/heal is dead: documented 'Force regeneration of index' but never used
`src/commands/audit.ts:15` — dimension: commands

All three commands declare refresh?: boolean (audit.ts:15, heal.ts:15, spec.ts:14) matching cli.ts help text 'Force regeneration of index', but none of them reference options.refresh; sliceRoute internally calls getIndex({ root }) which loads the cached index. Grep confirms zero usages of options.refresh in any of the three command bodies.

**Failure scenario:** User edits route code, then runs `repointel audit --route /dashboard --spec SPEC.md --refresh` expecting a fresh index. The audit prompt is built from the stale cached index — files added since the last scan are absent from the slice, so the LLM audit reports drift that doesn't exist (or misses drift that does).

**Suggested fix:** Thread refresh through: if (options.refresh) await generateIndex({ root, refresh: true }) + saveIndex before slicing, or pass a refresh option into sliceRoute/getIndex.

### graph --type with an invalid value reports success and exits 0 having generated nothing
`src/commands/graph.ts:45` — dimension: commands

graphCommand checks options.type against "deps"/"routes"/"api"/"all" in independent ifs with no else/validation. Any other value falls through all three blocks and still prints '✅ Generated:' with an empty list, exit code 0. Verified: `node dist/bin/cli.js graph -t dep` → success banner, no files, exit 0. The same pattern affects slice/graph --format (e.g. `--format md` writes neither json nor markdown but prints '✅ Generated:').

**Failure scenario:** A script or LLM assistant runs `repointel graph -t dep` (typo). Exit code 0 and a success banner make the caller believe graphs exist; subsequent steps read .repointel/graphs/deps.json and get stale or missing data.

**Suggested fix:** Validate type/format against the allowed sets at the top of graphCommand/sliceCommand and exit(1) with an error, or use commander's .choices() (Option.choices) on these flags.

### Interactive wizard rejects absolute SPEC.md/DRIFT_REPORT.md paths due to path.join misuse
`src/commands/interactive.ts:196` — dimension: commands

The audit/heal steps check fs.existsSync(path.join(state.root, specPath)) (lines 196, 219, 224). path.join does not reset on absolute segments, so an absolute input like /Users/nick/SPEC.md becomes <root>/Users/nick/SPEC.md and the existence check fails — even though auditCommand/healCommand themselves handle absolute paths correctly via path.isAbsolute (audit.ts:27-29).

**Failure scenario:** In `repointel i` → Spec/Audit/Heal → Audit, user enters '/Users/nick/specs/SPEC.md' (a file that exists). Wizard prints '❌ File not found' and aborts, while the equivalent direct CLI call `repointel audit -r / -s /Users/nick/specs/SPEC.md` works.

**Suggested fix:** Use path.isAbsolute(specPath) ? specPath : path.join(state.root, specPath) for the existence checks (same pattern the commands already use), or path.resolve(state.root, specPath).

### ooda -o/--output flag is documented but completely ignored
`src/commands/ooda.ts:22` — dimension: commands

cli.ts:129 declares `-o, --output <dir>` ('Output directory for decision context') for ooda and OodaCommandOptions includes output?: string, but oodaCommand never reads options.output anywhere — DECISION_CONTEXT.md, PROPOSAL_PROMPT.md and APPROVED_PLAN.md are always written to <cwd>/.repointel/prompts (lines 115-118, 172, 781, 845).

**Failure scenario:** `repointel ooda --yes -o /tmp/ctx` — user expects /tmp/ctx/DECISION_CONTEXT.md; nothing is written there, and files land in .repointel/prompts instead. No warning is emitted.

**Suggested fix:** Use options.output for promptsDir (const promptsDir = options.output ?? path.join(root, ".repointel", "prompts")) or remove the flag from cli.ts.

### ooda's top-priority 'Fix N anti-pattern(s)' action recommends a command that cannot fix anything
`src/commands/ooda.ts:211` — dimension: commands

The highest-priority generated action is titled 'Fix N anti-pattern(s)' but its attached command is `repointel scan --refresh` (line 211), which only re-detects and re-counts anti-patterns; it changes no code. With --yes this becomes the auto-selected recommended action, so the non-interactive flow proposes a no-op as the fix. Additionally N comes from the possibly-stale index (see stale-index finding), so the count itself may describe already-fixed code.

**Failure scenario:** `repointel ooda --yes` in a repo whose cached index recorded 3 anti-patterns. Auto-selected action: 'Fix 3 anti-pattern(s)' → suggested command `repointel scan --refresh`. Running it fixes nothing; the loop recommends the identical action forever.

**Suggested fix:** Point the action at something actionable — e.g. generate a fix prompt listing the specific files/patterns from index.files[].antiPatterns (a slice of the offending files piped to the LLM), and refresh the index before counting.

### ooda --focus silently ignores an unmatched feature query instead of erroring
`src/commands/ooda.ts:323` — dimension: commands

gatherState sets currentFeature = findFeature(speckit, options.focus) which returns undefined on no match (also a tsc error, line 324: undefined assigned to null-typed field). Unlike specify --focus (specify.ts:114-121, which prints 'Feature not found' and lists available features), ooda prints nothing: the run proceeds with no focus, no feature context in DECISION_CONTEXT.md, and generic actions only. ooda's findFeature also returns early on any numeric-prefixed query (line 399-401), so '2-factor-auth' resolves via parseInt to feature #2 or nothing, never falling through to name matching as specify.ts does.

**Failure scenario:** `repointel ooda --focus auth-flow` with a typo'd name: no error, no warning; the user gets a decision context that silently omits the feature they asked for and assumes the tool found nothing to focus on.

**Suggested fix:** When options.focus is set and findFeature returns undefined, print the not-found message with available features (mirror specify.ts) and exit non-zero; align the two findFeature implementations.

### Falsy-check on depth/maxTokens makes depth 0 and other falsy options impossible
`src/core/dep-graph.ts:320` — dimension: core

buildDepGraphFromSeeds uses 'options.depth || 10' (line 320) and slicer uses 'options.depth || 5' (slicer.ts lines 119, 275) and 'options.maxTokens || calculateTokenBudget(...)' (slicer.ts lines 129, 285). A caller passing depth: 0 (seeds only, a legitimate request) silently gets depth 10/5 instead.

**Failure scenario:** sliceFeature(seeds, name, { depth: 0 }) intending 'just these files' traverses 5 levels of imports and packs the whole transitive closure, potentially blowing the token budget with files the user explicitly did not want.

**Suggested fix:** Use nullish coalescing: options.depth ?? 10 (and ?? for maxTokens/maxBytes/maxFileBytes).

### getImportType classifies a mixed type+value import pair as 'type-only'
`src/core/dep-graph.ts:125` — dimension: core

getImportType (lines 125-143) tests whether ANY 'import type ... "spec"' appears in the file. When a file contains both `import type { Foo } from './x'` and `import { bar } from './x'` (extractImports dedupes to one spec), the type-only pattern matches first and the edge is labeled 'type-only' even though there is a runtime dependency. Multiline `import type {\n...\n} from './x'` conversely fails to match (no s flag, .*? does not cross newlines) and degrades to 'static' — the dangerous direction is the former, since consumers that prune type-only edges would drop a real runtime dependency.

**Failure scenario:** File has `import type { User } from './models'` and `import { validateUser } from './models'`. The edge ./models is emitted as type-only; any downstream logic that filters type-only edges (e.g. a future runtime-only slice or visualizer filter) drops a module whose code executes at runtime.

**Suggested fix:** Classify per import statement rather than per file: iterate actual matched statements from extractImports (return match kind alongside spec), and mark the edge 'static' if any non-type import of the same spec exists.

### BFS depth cap emits dangling edges to nodes that are never added to the graph
`src/core/dep-graph.ts:378` — dimension: core

In buildDepGraphFromSeeds, edges are pushed (lines 378-382) for every resolved import of a node at depth == maxDepth, but the targets enqueued at depth maxDepth+1 are discarded by 'if (depth > maxDepth) continue' (line 346) without ever becoming nodes. The returned graph contains edges whose 'to' has no corresponding node, and stats.totalEdges is inflated relative to the visible graph.

**Failure scenario:** seeds with depth: 2 on a chain a->b->c->d: node list is [a,b,c] but edges include c->d. Any consumer that joins edges to nodes (JSON output consumers, or code assuming edge endpoints exist) hits missing-node lookups; depGraphToMermaid only survives because it re-filters by nodeIds (line 484).

**Suggested fix:** Only push the edge when the target will be (or already is) a node — e.g. check 'depth + 1 <= maxDepth || visited.has(resolvedPath)' before edges.push, or add frontier targets as leaf nodes.

### Seeds-based graph hardcodes externalDeps: 0 despite encountering external imports
`src/core/dep-graph.ts:428` — dimension: core

buildDepGraphFromSeeds skips external imports at line 374 without recording them, then reports stats.externalDeps: 0 (line 428). buildDepGraph tracks the same statistic properly via a Set (lines 214, 245-249, 304), so the two graph flavors report contradictory stats for the same repo.

**Failure scenario:** A seeds graph over files importing react, next, and zod reports externalDeps: 0; any consumer (report output, ooda heuristics) comparing full-graph vs seed-graph stats concludes the sliced subsystem has no external dependencies.

**Suggested fix:** Track a Set<string> of external package names in the BFS exactly as buildDepGraph does and report its size.

### Import regex matches inside comments and strings, creating phantom dependency edges
`src/core/indexer.ts:113` — dimension: core

extractImports runs regexes over raw file content with no comment/string stripping. Verified empirically: a file containing only '// import "./legacy"' yields imports: ['./legacy']. If the referenced file exists, dep-graph resolves it and emits a real edge; require( in prose or example code inside JSDoc blocks behaves the same.

**Failure scenario:** utils.ts contains a doc comment '// migrated from: import "./legacy-utils"' and legacy-utils.ts still exists on disk. The graph shows a live edge utils -> legacy-utils; buildDepGraphFromSeeds pulls legacy-utils (and its whole subtree) into every slice that touches utils, wasting token budget, and dead-code analysis built on this graph reports the legacy file as still referenced.

**Suggested fix:** Strip // line comments and /* */ block comments (and ideally template-literal/string contents) before running the import regexes, or anchor static-import matches to line starts (/^\s*import/m) to cut the most common false positives.

### sliceFeature never validates seeds; typo'd seeds yield an empty slice labeled 'external'
`src/core/slicer.ts:268` — dimension: core

sliceRoute throws when no files match the route (line 141), but sliceFeature performs no seed validation. A nonexistent seed still becomes a BFS node in buildDepGraphFromSeeds (node pushed at dep-graph.ts line 355 even when readFileSafe returns null), then fs.statSync throws in the slicer and the seed is excluded with the misleading reason 'external' (lines 317-321).

**Failure scenario:** sliceFeature(['src/coer/slicer.ts'] /* typo */, 'slicing') returns a structurally valid slice: 0 files, totalTokens 0, excluded [{file: 'src/coer/slicer.ts', reason: 'external'}]. A script piping this into generateContextPack sends an essentially empty context pack to the LLM with no error, and the 'external' label points the user away from the actual problem (a typo, not an external module).

**Suggested fix:** Validate each seed against the index (or fs.existsSync) up front and throw listing the missing seeds; use a distinct excluded reason like 'not_found' instead of 'external' for unreadable non-external paths.

### filePathToRoutePath's unanchored ^app regex mangles paths under apps/ (monorepos)
`src/core/utils.ts:123` — dimension: core

.replace(/^app/, '') strips the first three characters of any path starting with 'app', not just an 'app/' directory segment. 'apps/web/app/dashboard/page.tsx' becomes 's/web/app/dashboard/page.tsx', yielding routePath '/s/web/app/dashboard'. Same flaw for ^src\/app matching 'src/appointments/...' (becomes 'ointments/...').

**Failure scenario:** Running repointel at a monorepo root: every page under apps/web/app/* gets a garbage routePath, so findRouteFiles (slicer.ts lines 58-69) never matches and sliceRoute('/dashboard') throws 'No files found for route: /dashboard' even though the page exists; route listings show phantom '/s/web/...' routes.

**Suggested fix:** Anchor to a full segment with a trailing slash or end: .replace(/^src\/app(\/|$)/, '/').replace(/^app(\/|$)/, '/'), or better, locate the app directory root explicitly before deriving routes.

### README overstates framework support; graphs only understand Next.js App Router and Convex
`README.md:151` — dimension: quality

README 'Works With: Next.js, React, Convex, Express, Remix, Astro, Vite' carries no caveats, but the implementation is Next+Convex specific: route-graph.ts route typing assumes page./layout./route. conventions and its detectFramework only distinguishes nextjs-app/nextjs-pages/remix/unknown with no Remix route extraction; api-graph.ts extracts only Convex functions and Next.js route.ts handlers (no Express route parsing — Express 'support' is just a `**/app.{js,ts}` detection glob in indexer.ts:59 that false-positives on any project); file classification hardcodes convex/ => schema and Next.js special files (indexer.ts:80-106, duplicated in slicer.ts:96 and dep-graph.ts:148). docs/OPEN_QUESTIONS.md item 3 admits 'Users with other frameworks get minimal value', but that admission never made it to the README, which is what npm users see.

**Failure scenario:** An Express or Astro user installs repointel based on the 'Works With' list, runs `repointel graph routes` / `graph api`, and gets empty or nonsense graphs (every file typed 'component', no endpoints), concluding the tool is broken rather than out of scope.

**Suggested fix:** Add a support matrix to the README (full: Next.js App Router + Convex; partial: generic TS/JS dep graph + slices; unsupported: route/api graphs elsewhere), and have route/api commands print an explicit 'framework not supported' message instead of empty output.

### OODA silently scaffolds .specify/ into any repository it is run in
`src/commands/ooda.ts:96` — dimension: quality

During Orient, if the repo is not a SpecKit project, oodaCommand unconditionally calls initializeSpecKit(root) and writes a .specify/ directory tree (constitution, templates) without asking. A user who ran `repointel ooda` purely to see where they stand gets workflow-opinion files injected into their repo (and into git status). docs/OPEN_QUESTIONS.md item 5 already flags SpecKit coupling as noise for non-SpecKit users; this is the sharpest instance of it.

**Failure scenario:** Developer runs `repointel ooda` once in a client's repo to get oriented; their next `git status` shows an unexplained .specify/ tree they must investigate and delete, eroding trust in the tool on first contact.

**Suggested fix:** Make SpecKit initialization opt-in (prompt in interactive mode, `--init-speckit` flag otherwise) and have OODA degrade gracefully when no .specify/ exists.

### LLM consumability of .repointel/ is real but partial: good context packs, monolithic index, no entry-point manifest
`src/core/slicer.ts:408` — dimension: quality

The stated purpose (LLM-ready artifacts) is genuinely served by the slice .md context packs — verified on disk, they contain a file manifest, an excluded-files list with reasons, and full fenced source contents — and by DECISION_CONTEXT.md. Gaps: index.json is a single monolithic JSON with per-file hook/side-effect/anti-pattern counts that an LLM cannot efficiently consume on large repos (and it is what getIndex feeds everything); graphs/*.json have no markdown companion aside from .mmd diagrams; and .repointel/ has no top-level manifest telling an agent which artifact answers which question, so agents must know the directory conventions a priori. The shipped .claude/ skills (scan/deps/slice/spec/audit/heal in package.json files array) partially mitigate this for Claude Code users only.

**Failure scenario:** An agent asked 'where are we in this codebase?' opens .repointel/ and finds index.json (hundreds of KB of per-file counters), several graph JSONs, and stale slices with no README/manifest — it burns context ingesting raw JSON or guesses wrong about which file is authoritative and how fresh it is.

**Suggested fix:** Generate a small .repointel/SUMMARY.md (or manifest.json) on every scan: artifact inventory with generatedAt/gitCommit, top-level repo stats, and pointers to the right artifact per question; consider a compact index summary separate from the full per-file dump.

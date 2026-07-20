# Runbook — repointel

## Prerequisites

| Requirement | Version | How to check |
|-------------|---------|-------------|
| Node.js | >= 18 | `node --version` |
| npm | any | `npm --version` |
| Git | any | `git --version` (optional, for commit hash tracking) |

No database, no Docker, no external services required.

## Setup

```bash
# Clone and install
cd repointel
npm install

# Build
npm run build
```

## Development

```bash
# Watch mode (recompiles on change)
npm run dev

# Type check
npm run typecheck
```

## Running the CLI

After building, the CLI is at `dist/bin/cli.js`:

```bash
# Direct invocation
node dist/bin/cli.js <command>

# Or link globally
npm link
repointel <command>
```

### Commands

```bash
# 1. Scan a target repository
cd /path/to/target-repo
repointel scan
# Output: .repointel/index.json

# 2. Build graphs
repointel graph deps          # Dependency graph
repointel graph routes        # Next.js route graph
repointel graph api           # API endpoint graph
repointel graph all           # All graphs
repointel graph deps --format mermaid  # Mermaid output

# 3. Extract a context slice
repointel slice --route /dashboard
repointel slice --seeds src/app/page.tsx,src/components/Header.tsx --name my-feature

# 4. Spec workflow
repointel spec --route /dashboard        # Generate spec prompt
repointel audit --route /dashboard --spec SPEC.md   # Audit prompt
repointel heal --route /dashboard --spec SPEC.md --drift DRIFT_REPORT.md  # Heal prompt

# 5. Validate artifacts
repointel eval

# 6. OODA loop (interactive orchestrator)
repointel ooda
repointel ooda --yes          # Auto-select recommended action
repointel ooda --refresh      # Force re-scan

# 7. Interactive wizard
repointel interactive
```

## Build

```bash
npm run build
# Output: dist/bin/cli.js, dist/index.js
```

The build uses `tsup` with the following config:
- Entry: `src/index.ts` + `src/bin/cli.ts`
- Format: ESM only
- Target: Node 18
- DTS: generates `.d.ts` files for library consumers

## Test / Lint

```bash
npm run typecheck    # TypeScript type checking (tsc --noEmit)
```

There are no unit tests or integration tests in this project. The `eval` command provides runtime artifact validation:

```bash
repointel eval       # Validates .repointel/ artifacts for consistency
```

## Common Failures and Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module` errors | Not built | Run `npm run build` |
| `No index found` | Haven't scanned yet | Run `repointel scan` in the target repo |
| Empty graph output | Target repo has no Next.js routes or Convex functions | Expected — graphs only populate for supported frameworks |
| `ENOENT .repointel/` | First run | Run `repointel scan` first, it creates the directory |
| `TypeError: Cannot read properties of null` | Stale index after file changes | Run `repointel scan --refresh` |

## Output Directory Structure

All outputs go to `.repointel/` in the target repository's root:

```
.repointel/
├── index.json              # Repo index (from scan)
├── graphs/
│   ├── deps.json           # Dependency graph
│   ├── deps.mmd            # Mermaid diagram
│   ├── routes.json         # Route graph
│   ├── routes.mmd          # Mermaid diagram
│   └── api.json            # API graph
├── slices/
│   └── {name}.json         # Context slices
└── prompts/
    ├── DECISION_CONTEXT.md # OODA decision context
    ├── PROPOSAL_PROMPT.md  # OODA proposal prompt
    └── APPROVED_PLAN.md    # OODA approved plan
```

## Publishing

```bash
npm run build
npm publish
```

The package is configured with `publishConfig.access: "public"` and the binary name `repointel`.

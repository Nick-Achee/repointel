import type { ContextSlice, ApiGraph } from "../types/index.js";
import { formatBytes } from "../core/utils.js";

export interface AuditContext {
  slice: ContextSlice;
  apiGraph?: ApiGraph;
  depMermaid?: string;
  specContent: string;
}

function buildFileMetrics(slice: ContextSlice): string {
  const lines: string[] = [];
  lines.push("| File | Type | Depth | Size |");
  lines.push("|------|------|-------|------|");

  for (const file of slice.files) {
    lines.push(
      `| ${file.relativePath} | ${file.type} | ${file.depth} | ${formatBytes(file.sizeBytes)} |`
    );
  }

  return lines.join("\n");
}

function buildApiUsage(apiGraph: ApiGraph | undefined): string {
  if (!apiGraph || apiGraph.endpoints.length === 0) {
    return "No API endpoints detected.";
  }

  const lines: string[] = [];
  lines.push("| Endpoint | Type | Visibility | File |");
  lines.push("|----------|------|------------|------|");

  for (const endpoint of apiGraph.endpoints.slice(0, 30)) {
    const visibility = endpoint.isPublic ? "public" : "internal";
    lines.push(
      `| ${endpoint.path} | ${endpoint.type} | ${visibility} | ${endpoint.file} |`
    );
  }

  if (apiGraph.endpoints.length > 30) {
    lines.push(`| ... | ... | ... | (${apiGraph.endpoints.length - 30} more) |`);
  }

  return lines.join("\n");
}

export function generateAuditPrompt(context: AuditContext): string {
  const { slice, apiGraph, depMermaid, specContent } = context;

  const fileMetrics = buildFileMetrics(slice);
  const apiUsage = buildApiUsage(apiGraph);

  return `You are auditing a Next.js route implementation against its specification.

## Specification

The following is the authoritative specification for this route:

\`\`\`markdown
${specContent}
\`\`\`

---

## Current Implementation

**Route:** ${slice.name}
**Audited:** ${slice.generatedAt}
**Git Commit:** ${slice.gitCommit || "Unknown"}

### Import Graph

\`\`\`mermaid
${depMermaid || "graph TD\n  A[No graph available]"}
\`\`\`

### File Metrics

${fileMetrics}

### API Usage

${apiUsage}

---

## Your Task

Compare the current implementation against the specification. For each section of the spec, determine if the implementation matches.

### Audit Categories

1. **COMPLIANT** - Implementation matches spec exactly
2. **DRIFT** - Implementation differs from spec (may or may not be a bug)
3. **MISSING** - Spec requirement not implemented
4. **EXTRA** - Implementation has features not in spec (scope creep)
5. **UNCLEAR** - Cannot determine from available information

---

## Output Format

Generate a structured drift report:

\`\`\`markdown
# Drift Report: ${slice.name}

**Audited:** ${slice.generatedAt}
**Spec Version:** [git commit of spec if known]
**Implementation Version:** ${slice.gitCommit || "Unknown"}

## Summary

- Compliant: X items
- Drift: X items
- Missing: X items
- Extra: X items
- Unclear: X items

## Findings

### Section 1: Purpose
**Status:** COMPLIANT | DRIFT | MISSING | EXTRA | UNCLEAR
**Evidence:** [specific code reference]
**Notes:** [explanation]

### Section 2: Entry Points
**Status:** ...
...

### Section 3: Data Requirements
#### Queries
| Specified | Implemented | Status |
|-----------|-------------|--------|
| api.x.y   | api.x.y     | ✓      |
| api.x.z   | -           | MISSING|

#### Mutations
[same format]

### Section 4: Component Contract
[for each component, verify props match]

### Section 5: State Management
[verify state patterns match spec]

### Section 6: User Flows
[verify flows are implemented]

### Section 7: Success Criteria
[check each criterion]

### Section 8: Boundaries
[verify scope alignment]

### Section 9: Dependencies
[verify dependencies match]

### Section 10: Risk Areas
[note any risks materialized]

---

## Priority Actions

### P0 - Critical (blocks functionality)
1. [action needed]

### P1 - High (degrades UX)
1. [action needed]

### P2 - Medium (technical debt)
1. [action needed]

### P3 - Low (nice to have)
1. [action needed]

---

## Recommendations

[Strategic recommendations based on findings]
\`\`\`

Be specific. Reference exact file paths, line numbers where possible, and function names.
`;
}

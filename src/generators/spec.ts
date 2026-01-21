import * as path from "node:path";
import type { ContextSlice, RouteGraph, ApiGraph, DepGraph } from "../types/index.js";
import { formatBytes } from "../core/utils.js";

export interface SpecContext {
  slice: ContextSlice;
  routeGraph?: RouteGraph;
  apiGraph?: ApiGraph;
  depGraph?: DepGraph;
  depMermaid?: string;
}

function buildArchitectureSummary(slice: ContextSlice): string {
  const lines: string[] = [];

  lines.push(`- **Total Files:** ${slice.summary.totalFiles}`);
  lines.push(`- **Total Size:** ${formatBytes(slice.summary.totalBytes)}`);
  lines.push(`- **Max Depth:** ${slice.summary.maxDepth}`);
  lines.push(`- **Seed Files:** ${slice.seedFiles.join(", ")}`);
  lines.push("");
  lines.push("**File Types:**");

  for (const [type, count] of Object.entries(slice.summary.byType)) {
    if (count > 0) {
      lines.push(`- ${type}: ${count}`);
    }
  }

  return lines.join("\n");
}

function buildFileAnalysis(slice: ContextSlice): string {
  const lines: string[] = [];

  for (const file of slice.files) {
    lines.push(`### ${file.relativePath}`);
    lines.push("");
    lines.push(`- **Type:** ${file.type}`);
    lines.push(`- **Size:** ${formatBytes(file.sizeBytes)}`);
    lines.push(`- **Depth:** ${file.depth}`);
    lines.push(`- **Reason:** ${file.reason}`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildApiAnalysis(apiGraph: ApiGraph | undefined, routePath: string): string {
  if (!apiGraph) {
    return "No API graph available.";
  }

  const lines: string[] = [];

  // Group by type
  const convexEndpoints = apiGraph.endpoints.filter((e) => e.type === "convex");
  const restEndpoints = apiGraph.endpoints.filter((e) => e.type === "rest");

  if (convexEndpoints.length > 0) {
    lines.push("**Convex Functions:**");
    for (const endpoint of convexEndpoints.slice(0, 20)) {
      const visibility = endpoint.isPublic ? "public" : "internal";
      lines.push(`- \`${endpoint.path}\` (${visibility}) - ${endpoint.file}`);
    }
    if (convexEndpoints.length > 20) {
      lines.push(`- ... and ${convexEndpoints.length - 20} more`);
    }
    lines.push("");
  }

  if (restEndpoints.length > 0) {
    lines.push("**REST Endpoints:**");
    for (const endpoint of restEndpoints) {
      lines.push(`- \`${endpoint.method} ${endpoint.path}\` - ${endpoint.file}`);
    }
    lines.push("");
  }

  if (lines.length === 0) {
    return "No API endpoints detected.";
  }

  return lines.join("\n");
}

export function generateSpecPrompt(context: SpecContext): string {
  const { slice, depMermaid, apiGraph } = context;
  const routePath = slice.name;

  const architectureSummary = buildArchitectureSummary(slice);
  const fileAnalysis = buildFileAnalysis(slice);
  const apiAnalysis = buildApiAnalysis(apiGraph, routePath);

  return `You are generating a prescriptive specification for a Next.js route.

## Context Pack Information

**Route:** ${routePath}
**Generated:** ${slice.generatedAt}
**Git Commit:** ${slice.gitCommit || "Unknown"}

---

## Architecture Summary

${architectureSummary}

---

## Import Graph

\`\`\`mermaid
${depMermaid || "graph TD\n  A[No graph available]"}
\`\`\`

---

## File Analysis

${fileAnalysis}

---

## API Layer

${apiAnalysis}

---

## Your Task

Generate a complete SPEC.md file for this route. The spec must be:

1. **Prescriptive** - Define what SHOULD happen, not just what currently happens
2. **Specific** - Use exact file paths, function names, prop types
3. **Testable** - Each criterion must be verifiable
4. **Bounded** - Clearly define what's in/out of scope

### Output Format

Output a complete markdown document following this structure:

\`\`\`markdown
# Route Specification: ${routePath}

## 1. Purpose
[Single sentence describing the route's responsibility]

## 2. Entry Points
- Page: \`path/to/page.tsx\`
- Layouts: [list parent layouts]

## 3. Data Requirements
### Queries
- \`api.module.queryName\` - [what it fetches]

### Mutations
- \`api.module.mutationName\` - [what it changes]

### Data Shape
[TypeScript interface for expected data]

## 4. Component Contract
[List each component with its required props]

## 5. State Management
- Client: [useState/useReducer patterns]
- URL: [search params used]
- Form: [form libraries/patterns]

## 6. User Flows
### Primary
1. User arrives at route
2. [step]
3. [step]

### Error States
- [error]: [how handled]

### Loading States
- [loading state]: [UI shown]

## 7. Success Criteria
### Functional
- [ ] [specific testable criterion]

### Performance
- [ ] [specific testable criterion]

### Accessibility
- [ ] [specific testable criterion]

## 8. Boundaries
### DOES
- [responsibility]

### DOES NOT
- [delegated responsibility]

## 9. Dependencies
### Internal
- [file]: [purpose]

### External
- [package]: [purpose]

## 10. Risk Areas
- [risk]: [mitigation]
\`\`\`

Be thorough. This spec will be used to audit the implementation for drift.
`;
}

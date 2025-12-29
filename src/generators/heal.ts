import type { ContextSlice } from "../types/index.js";

export interface HealContext {
  slice: ContextSlice;
  depMermaid?: string;
  specContent: string;
  driftContent: string;
  sourceFiles: { path: string; content: string }[];
}

function buildFilesInScope(slice: ContextSlice): string {
  const lines: string[] = [];

  for (const file of slice.files) {
    lines.push(`- ${file.relativePath} (depth: ${file.depth}, reason: ${file.reason})`);
  }

  return lines.join("\n");
}

function buildSourceFiles(sourceFiles: { path: string; content: string }[]): string {
  const lines: string[] = [];

  for (const file of sourceFiles) {
    lines.push(`### \`${file.path}\``);
    lines.push("");
    lines.push("```tsx");
    lines.push(file.content);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

export function generateHealPrompt(context: HealContext): string {
  const { slice, depMermaid, specContent, driftContent, sourceFiles } = context;

  const filesInScope = buildFilesInScope(slice);
  const sourceFilesSection = buildSourceFiles(sourceFiles);

  return `You are a code healer. Your job is to fix implementation drift.

## Drift Report

The following drift was identified during audit:

\`\`\`markdown
${driftContent}
\`\`\`

---

## Specification (Target State)

\`\`\`markdown
${specContent}
\`\`\`

---

## Current Implementation

**Route:** ${slice.name}
**Git Commit:** ${slice.gitCommit || "Unknown"}

### Files in Scope

${filesInScope}

### Import Graph

\`\`\`mermaid
${depMermaid || "graph TD\n  A[No graph available]"}
\`\`\`

---

## Source Files

${sourceFilesSection}

---

## Your Task

Generate precise fixes for each drift item. You must:

1. **Fix only what's broken** - Don't refactor unrelated code
2. **Preserve existing patterns** - Match the codebase style
3. **Minimal changes** - Smallest diff that fixes the issue
4. **No new dependencies** unless absolutely required

---

## Output Format

For each fix:

\`\`\`markdown
## Fix #N: [Short Title]

**Drift Item:** [reference from drift report]
**Priority:** P0 | P1 | P2 | P3
**Files Changed:** [list of files]

### Problem

[Explain what's wrong and why it matters]

### Solution

[Explain the fix approach]

### Changes

#### File: \`path/to/file.tsx\`

\`\`\`diff
@@ -10,7 +10,7 @@ function Component() {
-  const [state, setState] = useState(null);
+  const [state, setState] = useState<User | null>(null);
\`\`\`

#### File: \`path/to/other.ts\`

\`\`\`diff
...
\`\`\`

### Verification

1. [How to verify the fix works]
2. [Expected behavior after fix]

### Side Effects

- [Any other code affected]
- [Or "None expected"]

---
\`\`\`

## Important Rules

1. **Show complete diffs** - Include enough context (3+ lines) for unambiguous application
2. **One fix per drift item** - Don't combine fixes
3. **Order by priority** - P0 first, then P1, etc.
4. **If unsure, ask** - Mark unclear items with [NEEDS_CLARIFICATION]
5. **Test commands** - Include commands to verify if applicable

## Constraints

- Do not add console.log or debug statements
- Do not add comments explaining the fix (the PR will do that)
- Do not change formatting/whitespace unless required
- Do not "improve" code beyond the spec requirements
`;
}

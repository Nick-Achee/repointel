---
description: Generate context slice for a route or feature
allowed-tools: Bash(repointel:*)
argument-hint: [--route /path OR --seeds file1.ts file2.ts]
---

# Context Slice

Generate a focused context pack for LLM consumption.

Usage:
- /slice --route /dashboard/events
- /slice --seeds src/lib/auth.ts src/hooks/useAuth.ts

Run: `repointel slice $ARGUMENTS -f both`

This generates:
- JSON manifest with file metadata
- Markdown context pack with file contents

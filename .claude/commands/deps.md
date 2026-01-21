---
description: Build dependency graph
allowed-tools: Bash(repointel:*)
argument-hint: [--seeds file1.ts file2.ts] (optional)
---

# Dependency Graph

Build and visualize the dependency graph.

Usage:
- /deps (full graph)
- /deps --seeds src/app/page.tsx (scoped graph)

Run: `repointel deps $ARGUMENTS -f both`

Generates:
- `.repointel/graphs/deps.json` - structured graph data
- `.repointel/graphs/deps.mmd` - Mermaid diagram

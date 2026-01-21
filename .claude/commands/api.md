---
description: Build API graph (Convex functions, REST routes)
allowed-tools: Bash(repointel:*)
---

# API Graph

Extract and visualize all API endpoints.

Run: `repointel api -f both`

Detects:
- Convex queries, mutations, actions
- REST API routes (Next.js App Router)
- Public vs internal/protected endpoints

Generates:
- `.repointel/graphs/api.json` - structured endpoint data
- `.repointel/graphs/api.mmd` - Mermaid diagram

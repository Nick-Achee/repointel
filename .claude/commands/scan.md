---
description: Scan repository and generate architecture index
allowed-tools: Bash(repointel:*)
---

# Scan Repository

Index all files in the repository, extracting imports, exports, and metadata.

Run: `repointel scan`

Generates `.repointel/index.json` with:
- All source files
- Import/export relationships
- Hook and side-effect counts
- File types and sizes

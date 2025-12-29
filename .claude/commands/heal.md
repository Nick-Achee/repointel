---
description: Generate LLM prompt to fix drift between spec and implementation
allowed-tools: Bash(repointel:*), Read, Edit
argument-hint: [route-path] [spec-file] [drift-file]
---

# Heal Drift

Generate fixes for drift between specification and implementation.

Usage: /heal /dashboard/events ./SPEC.md ./DRIFT_REPORT.md

Parse arguments and run: `repointel heal --route [route] --spec [spec-file] --drift [drift-file]`

After generating the prompt:
1. Read the generated prompt file
2. Generate specific code fixes for each drift item
3. Apply fixes with minimal changes

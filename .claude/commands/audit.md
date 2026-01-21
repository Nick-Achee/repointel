---
description: Generate LLM prompt to audit implementation against spec
allowed-tools: Bash(repointel:*), Read
argument-hint: [route-path] [spec-file]
---

# Audit Implementation

Audit the implementation of a route against its specification.

Usage: /audit /dashboard/events ./SPEC.md

Parse arguments and run: `repointel audit --route [route] --spec [spec-file]`

After generating the prompt:
1. Read the generated prompt file
2. Create a DRIFT_REPORT.md comparing implementation to spec

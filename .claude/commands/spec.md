---
description: Generate LLM prompt to create a route specification
allowed-tools: Bash(repointel:*)
argument-hint: [route-path]
---

# Generate Specification

Generate a prescriptive specification prompt for the given route.

Run: `repointel spec --route $ARGUMENTS`

After generating the prompt:
1. Read the generated prompt file
2. Use it to create a complete SPEC.md for the route

# Visualization Engine

> Generate architecture diagrams from code analysis

## Overview

The Visualization Engine transforms code analysis data (slices, dependency graphs, API graphs) into Mermaid diagrams that help developers understand their codebase architecture.

## Scope

**Files:** 1
**Size:** 18 KB
**Tokens:** ~5,401

### File Types

- **component**: 1

## Entry Points

- `src/core/visualizer.ts`

## User Stories

1. **As a developer**, I want to generate data flow diagrams so that I can see how data moves between client and server components.

2. **As a tech lead**, I want to visualize architecture layers (UI, Logic, API, Data) so that I can ensure proper separation of concerns.

3. **As a new team member**, I want to see component dependency diagrams so that I can understand how the codebase is structured.

4. **As a developer**, I want sequence diagrams for API flows so that I can trace request/response patterns.

## Requirements

### Functional Requirements

1. **FR-1**: Generate Mermaid-compatible diagram syntax
2. **FR-2**: Support multiple diagram types: dataflow, architecture, sequence, components
3. **FR-3**: Detect and visualize client vs server components
4. **FR-4**: Show data fetching patterns (useQuery, useMutation, fetch)
5. **FR-5**: Support both top-down (TD) and left-right (LR) layouts
6. **FR-6**: Handle large codebases without memory issues

### Non-Functional Requirements

1. **NFR-1**: Diagram generation should complete in < 2 seconds for typical slices
2. **NFR-2**: Output should be valid Mermaid syntax that renders in VS Code, GitHub, etc.

## Acceptance Criteria

- [x] `repointel viz --seeds <file>` generates all 4 diagram types
- [x] `repointel viz --diagram dataflow` generates only dataflow diagram
- [x] `repointel slice --viz` includes diagrams in markdown output
- [x] Diagrams correctly identify client vs server components
- [x] API calls (useQuery, useMutation, fetch) are shown with appropriate arrows
- [x] Output files are saved to `.repointel/diagrams/`

## Clarifications

- Diagrams are Mermaid syntax, not rendered images
- Visualization is deterministic (same input = same output)
- Works with the OODA loop - OO phases only, no LLM needed

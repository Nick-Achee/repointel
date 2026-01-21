# Tasks: Visualization Engine

## Setup

- [x] Create feature branch
- [x] Set up development environment

## Implementation

- [x] Define TypeScript types for DataFlowNode, DataFlowEdge, DataFlowGraph
- [x] Implement API call detection (useQuery, useMutation, useAction, fetch)
- [x] Implement state pattern extraction (useState, useReducer, useContext)
- [x] Build data flow graph from context slice
- [x] Generate dataflow Mermaid diagram (client/server separation)
- [x] Generate architecture Mermaid diagram (layered view)
- [x] Generate sequence diagram (request/response flow)
- [x] Generate component dependency diagram
- [x] Integrate with slice command (--viz flag)
- [x] Implement viz command for standalone visualization

## Testing

- [x] Manual testing: viz command generates all 4 diagram types
- [x] Manual testing: slice --viz embeds diagrams in markdown
- [x] Write unit tests for diagram generators (19 tests passing)
- [x] Write integration tests (12 tests passing)

## Completion

- [x] Code review (fixed false positive API detection in comments)
- [x] Documentation update (README already covers viz comprehensively)
- [x] Merge to main

## Notes

All core functionality is complete. The visualization engine:

- Generates valid Mermaid syntax that renders in VS Code, GitHub, mermaid.live
- Correctly identifies client vs server components via isClient flag
- Shows API calls (useQuery, useMutation, fetch) with appropriate arrow styles
- Supports TD (top-down) and LR (left-right) layouts
- Handles large codebases with maxNodes limiting

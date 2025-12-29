# OODA Context Engine

> Make repointel self-aware - understand what the CLI is, what it does, and guide users to the right next action

## Overview

The OODA Context Engine enhances the `repointel ooda` command to be truly context-aware. Instead of just showing file counts and task lists, it should understand the project's purpose (from constitution.md), reason about the current state, and guide users to meaningful next actions.

This is the missing piece that makes repointel a world-class developer tool - it doesn't just observe the codebase, it *understands* it.

## Scope

**Files:** 8
**Size:** 104 KB
**Tokens:** ~30,093

### File Types

- **api**: 1
- **lib**: 6
- **type**: 1

## Entry Points

- `src/commands/ooda.ts`
- `src/core/speckit.ts`

## User Stories

1. **As a developer using repointel for the first time**, I want the OODA command to explain what this project is and what I can do with it, so I understand the tooling immediately.

2. **As a developer returning to a project**, I want `repointel ooda` to remind me where I left off and what the project's goals are, so I can quickly regain context.

3. **As a developer**, I want the constitution.md to contain the project's actual purpose and vision, so the LLM can reason about whether actions align with the project's goals.

4. **As a team member**, I want `repointel ooda` to show me the project's principles and guidelines, so I follow the right patterns when contributing.

5. **As an LLM receiving DECISION_CONTEXT.md**, I want to understand what the CLI tool does and what options are available, so I can make informed decisions about next steps.

## Requirements

### Functional Requirements

1. **FR-1**: Constitution.md should contain project purpose, vision, and what the CLI does
2. **FR-2**: OODA command should read and include constitution in DECISION_CONTEXT.md
3. **FR-3**: OODA should explain what repointel commands are available and when to use them
4. **FR-4**: OODA should suggest next actions based on project state AND project goals
5. **FR-5**: `repointel specify --init` should prompt for project purpose when creating constitution
6. **FR-6**: DECISION_CONTEXT.md should include a "What is this project?" section

### Non-Functional Requirements

1. **NFR-1**: Constitution should be human-readable and LLM-consumable
2. **NFR-2**: OODA output should fit in one terminal screen when possible

## Acceptance Criteria

- [ ] `repointel specify --init` prompts for project description and purpose
- [ ] Constitution.md contains: project name, purpose, what it does, key principles
- [ ] DECISION_CONTEXT.md includes "Project Purpose" section from constitution
- [ ] DECISION_CONTEXT.md explains available repointel commands
- [ ] `repointel ooda` shows project purpose in CLI output
- [ ] LLM receiving DECISION_CONTEXT.md can answer "what is this project?"

## Clarifications

- This is about making repointel self-aware, not adding AI features
- The constitution is for humans AND LLMs to understand the project
- OODA is deterministic - it generates context for LLMs to consume
- This enables true dogfooding - repointel understands itself

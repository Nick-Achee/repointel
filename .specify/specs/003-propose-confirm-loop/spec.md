# Propose & Confirm Loop

> Add a co-authored decision step to the OODA Decide phase where LLM proposes actions and human approves/modifies before execution

## Overview

Currently the OODA command generates options and expects the user to manually copy context to their LLM. This feature adds an interactive "Propose & Confirm" loop where:

1. User states what they want to do (or accepts recommended action)
2. LLM proposes a specific plan with steps
3. User can: Approve, Modify, Reject, or provide feedback
4. Loop continues until user approves
5. Only then does execution (Act) begin

This makes the Decide phase truly collaborative.

## User Stories

1. **As a developer**, I want the CLI to propose a specific plan for my chosen action, so I can review it before execution starts.

2. **As a developer**, I want to modify a proposed plan by giving feedback, so I can adjust the approach without starting over.

3. **As a developer**, I want to approve a plan with a single keypress, so I can move quickly when the proposal is good.

4. **As a developer**, I want to reject a proposal and try a different action, so I'm not locked into a bad path.

5. **As a developer**, I want the approved plan saved to a file, so I have a record of what was agreed upon.

## Requirements

### Functional Requirements

1. **FR-1**: After showing actions, prompt user to select one (or type custom request)
2. **FR-2**: Generate a proposed plan based on selected action + project context
3. **FR-3**: Display proposal and prompt for: [A]pprove / [M]odify / [R]eject / [Q]uit
4. **FR-4**: If Modify: prompt for feedback, regenerate proposal
5. **FR-5**: If Reject: return to action selection
6. **FR-6**: If Approve: save plan to `.repointel/prompts/APPROVED_PLAN.md`
7. **FR-7**: After approval, show clear "ACT" instructions with the approved plan

### Non-Functional Requirements

1. **NFR-1**: Proposal generation should work without requiring API keys in the CLI (output prompt for external LLM)
2. **NFR-2**: Interactive prompts should use @inquirer/prompts for consistent UX
3. **NFR-3**: The loop should be escapable at any point with Ctrl+C or 'q'

## Acceptance Criteria

- [ ] `repointel ooda` prompts for action selection after showing options
- [ ] Selected action generates a proposal prompt
- [ ] User can approve with 'a' or 'y'
- [ ] User can modify with 'm' and provide feedback
- [ ] User can reject with 'r' to go back to action selection
- [ ] Approved plan is saved to APPROVED_PLAN.md
- [ ] Non-interactive mode (`--yes` flag) auto-approves recommended action

## Design Notes

Since repointel is LLM-agnostic and doesn't embed API calls, the "proposal" is generated as a prompt that gets fed to the user's LLM of choice. The flow becomes:

```text
OODA runs → Shows actions → User selects →
CLI outputs PROPOSAL_PROMPT.md → User feeds to LLM →
LLM responds with plan → User pastes back (or approves if good) →
CLI saves APPROVED_PLAN.md → ACT phase begins
```

For tighter integration, we could add optional `--llm` flag that calls Claude/OpenAI directly, but the default should remain LLM-agnostic.

# Tasks: Propose & Confirm Loop

## Setup

- [x] Create feature branch
- [x] Review existing ooda.ts implementation

## Implementation

### Phase 1: Action Selection

- [x] Add interactive action selection prompt after displaying options
- [x] Support numeric selection (1-5) and custom text input
- [x] Add `--yes` flag for non-interactive mode (auto-select recommended)

### Phase 2: Proposal Generation

- [x] Create `generateProposalPrompt()` function
- [x] Include selected action + decision context in proposal prompt
- [x] Save proposal prompt to `.repointel/prompts/PROPOSAL_PROMPT.md`
- [x] Output instructions to feed prompt to user's LLM

### Phase 3: Confirm Loop

- [x] Add prompt for user to paste LLM's proposed plan
- [x] Display the proposed plan with formatting
- [x] Add confirm prompt: [A]pprove / [M]odify / [R]eject / [Q]uit
- [x] Handle Approve: save to APPROVED_PLAN.md, proceed to ACT
- [x] Handle Modify: prompt for feedback, regenerate proposal prompt
- [x] Handle Reject: return to action selection
- [x] Handle Quit: exit gracefully

### Phase 4: ACT Phase Enhancement

- [x] Display approved plan in ACT phase output
- [x] Show specific next steps based on approved plan
- [ ] Update DECISION_CONTEXT.md with approved plan reference

## Testing

- [x] Test action selection with various inputs (--yes flag)
- [ ] Test confirm loop flow (approve path) - requires interactive testing
- [ ] Test confirm loop flow (modify path) - requires interactive testing
- [ ] Test confirm loop flow (reject path) - requires interactive testing
- [x] Test non-interactive mode with --yes flag

## Completion

- [x] Code review
- [ ] Update README with new OODA workflow
- [ ] Merge to main

## Notes

The key insight is that repointel stays LLM-agnostic. It generates prompts that the user feeds to their LLM of choice. The "proposal" comes from the external LLM, and repointel just facilitates the confirm/modify/reject loop.

Future enhancement: optional `--llm claude|openai` flag for direct API integration.

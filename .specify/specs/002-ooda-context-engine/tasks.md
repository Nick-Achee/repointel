# Tasks: OODA Context Engine

## Setup

- [x] Create feature branch
- [x] Set up development environment

## Implementation

### Phase 1: Enhanced Constitution

- [x] Update constitution.md template to include project purpose fields
- [x] Add `--purpose` option to `repointel specify --init`
- [x] Add `--name` option for project name during init
- [x] Create rich constitution format with sections: Purpose, What It Does, Principles

### Phase 2: OODA Context Awareness

- [x] Read constitution.md in OODA command
- [x] Add "Project Purpose" section to DECISION_CONTEXT.md
- [x] Add "Available Commands" section explaining repointel commands
- [x] Show project purpose summary in CLI output
- [x] Include constitution principles in decision guidance

### Phase 3: Smart Action Suggestions

- [x] Generate actions based on project goals (not just task state)
- [x] Suggest relevant repointel commands based on current state
- [x] Add "Why" explanations to action suggestions
- [x] Prioritize actions that align with project principles

## Testing

- [x] Test constitution generation with --purpose flag
- [x] Test DECISION_CONTEXT.md includes all new sections (verified manually)
- [x] Test OODA CLI output shows project purpose (verified: "Project: repointel")
- [x] Verify LLM can answer "what is this project?" from context (verified)

## Completion

- [x] Code review
- [x] Update README with constitution best practices
- [ ] Merge to main

## Notes

The goal is to make repointel self-aware. When you run `repointel ooda`:

- It should understand what the project IS (from constitution)
- It should know what commands are available
- It should suggest actions that align with project goals
- The LLM receiving DECISION_CONTEXT.md should "get it" immediately

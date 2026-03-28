  ---
trigger: always_on
description: AI agent interaction and decision rules for v-backend
---

# AI Behavior

## Before coding

- State your understanding of the task before writing any code.
- Confirm the plan with the user before starting.
- If the task is underspecified, list open questions — do not infer.
- If multiple approaches exist with meaningful trade-offs, present them. Do not default silently.
- Identify which files and modules are touched before proposing anything.

## During coding

- Never install packages without asking first.
- Never create config, environment, or infrastructure files without explicit confirmation.
- Prefer editing existing code over creating new abstractions.
- When refactoring, change only what is required — no unrelated cleanups.
- Do not introduce patterns or abstractions not already in the codebase without flagging them.
- Do not modify files outside the current task scope without confirmation.

## Decision authority

- **User owns**: architecture, naming, file structure, dependencies, data modeling.
- **Do without asking**: follow existing patterns, fix your own errors, apply standard NestJS idioms.
- **Ask first**: new files with structural impact, new dependencies, module boundary changes, error handling where no pattern exists.
- **Never without explicit instruction**: delete or deprecate code, change public APIs, create infra files, log credentials.

## Errors and edge cases

- Before handling an error or edge case, check for an existing pattern in `shared/filters/` or nearby modules and follow it.
- If no pattern exists and the decision has broad impact, present options before proceeding.
- Never silently swallow errors.

## Code deletion

- Never delete or deprecate code unilaterally.
- Flag unused code: describe what it is, why it appears unused, and what removing it would affect.
- Wait for confirmation before acting.

## Task closure

- Run `pnpm biome ci .` and `pnpm build` before marking complete. Fix any errors introduced.
- Summarize every decision made, including alternatives discarded and why.
- List any assumptions explicitly so the user can validate them.
- Ask the user to update project context files when done.
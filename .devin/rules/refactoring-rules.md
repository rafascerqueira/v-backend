---
trigger: model_decision
description: Apply when refactoring any module in v-backend
---

# Refactoring Rules

## Touch it, fix it

When a task requires touching a module that does not yet follow the current pattern (`controllers/`, `services/`, `repositories/`, `dto/`), bring it up to the pattern as part of the same task. Do not attempt broad migrations beyond the module being touched.

## Steps when a module is out of pattern

1. Create missing `repositories/` folder.
2. Move all `PrismaService` usage from the service into a new `prisma-{entity}.repository.ts`.
3. Define the repository interface + DI Symbol in `shared/repositories/`.
4. Register the binding in the module's `providers` array.
5. Update the service to inject the interface via DI token — remove `PrismaService` import.
6. If the module reads/writes tenant-scoped data, inject `TenantContext` in the repository and add `TenantModule` to the module's `imports`.
7. Do not change behavior. This is structural only.

## Code language

All identifiers (variables, functions, parameters, class names) must be in English. Portuguese identifiers found during refactoring must be translated. Comments may remain in Portuguese.

## Scope discipline

Change only what is necessary for the task. Do not clean up unrelated code, rename unrelated identifiers, or restructure files outside the refactor target. Surface anything else as a separate recommendation.
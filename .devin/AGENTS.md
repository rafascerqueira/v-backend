# v-backend — Agent Index

Primary role: Senior NestJS Engineer (Fastify + Prisma + multi-tenant SaaS).

---

## Active rules (always loaded)

| File | When |
|---|---|
| `.windsurf/rules/core-rules.md` | Every task |
| `.windsurf/rules/ai-behavior.md` | Every task |
| `.windsurf/rules/refactoring-rules.md` | When touching an out-of-pattern module |

---

## Skills

| Skill | Use when |
|---|---|
| `create-prisma-repository` | Adding a repository interface + Prisma implementation |
| `generate-full-module` | Creating a new feature module (includes tests by default; skip step 8 if tests not requested) |

---

## Workflows

| Workflow | Use when |
|---|---|
| `/pre-commit-review` | Before every commit or PR |
| `/review` | Deep code review for bugs and security |

---

## Domain context

Multi-tenant SaaS for sales management. Each seller's data is isolated via `TenantContext` (AsyncLocalStorage). Two user roles: `admin` and `user`. Two plans: `free` and `pro`.

For stack, ports, module structure, auth flow, guards, and forbidden patterns — see `core-rules.md`.
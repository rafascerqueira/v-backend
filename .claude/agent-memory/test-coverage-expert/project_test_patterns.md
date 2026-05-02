---
name: Key test patterns for v-backend
description: DI tokens, mock factories, Jest 30 CLI flag, and recurring guard override patterns used across the codebase
type: project
---

Key DI token names:
- `ACCOUNT_REPOSITORY` from `@/shared/repositories/account.repository`
- `ADMIN_REPOSITORY` from `@/shared/repositories/admin.repository`

Guard override pattern (all controller specs):
```typescript
.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
.overrideGuard(RolesGuard).useValue({ canActivate: () => true })  // admin specs only
```

Admin controller uses `@Req() req: any` for current user — tests call controller methods directly with `makeRequest()` returning `{ user: { sub: 'admin-uuid-1' } }`.

Jest 30 CLI flag: use `--testPathPatterns` (not `--testPathPattern` — that was renamed in Jest 30).

**Why:** `--testPathPattern` was removed and causes ELIFECYCLE errors.

**How to apply:** When running a subset of specs: `pnpm test -- --testPathPatterns="foo|bar"`.

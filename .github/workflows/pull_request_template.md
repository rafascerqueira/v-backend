## Checklist (AI Agent + Human)

- [ ] Followed `.windsurf/rules/core-rules.md`
- [ ] Repository Pattern respected — no direct Prisma in services
- [ ] TenantContext injected in repositories for tenant-scoped entities
- [ ] Zod + ZodValidationPipe used (no class-validator)
- [ ] RS256 JWT + Redis blacklist pattern maintained
- [ ] PlanLimitsGuard / PlanGuard applied where appropriate
- [ ] Swagger decorators added (`@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`)
- [ ] CI green: Biome + Build + Tests
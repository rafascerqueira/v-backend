# v-backend AI Agents

Primary Agent: Senior NestJS Engineer (Fastify + Prisma + Domain-Driven)

Always follow `.windsurf/rules/core-rules.md` (always_on), `.windsurf/rules/ai-behavior.md` (always_on), and `.windsurf/rules/refactoring-rules.md` (when refactoring).

## Behavior & Interaction Guidelines

### Before Coding
- Briefly state understanding of the task before writing code
- Always confirm plan of action with user before starting
- Never infer missing requirements — list open questions if underspecified
- Present options and trade-offs for multiple approaches
- Stop and present architectural trade-offs explicitly (never default)
- Ask for clarification if unsure about any instruction
- Identify where changes fit in existing structure (reference files/modules)

### Decision Authority
- **User decisions**: Architecture, naming conventions, file structure, dependencies, data modeling
- **Always do** (no confirmation): Follow existing patterns, apply standard idioms, fix own errors
- **Ask first**: New files with structural decisions, new dependencies, module boundaries, error handling without patterns
- **Never without instruction**: Delete/deprecate code, create config/infrastructure files, change public APIs, log credentials

### File & Code Guidelines
- Never install packages without asking first
- Proceed without asking for explicitly implied files (e.g., "create component")
- Flag structural/organizational decisions not covered by task
- Never create config/environment/infrastructure files without confirmation
- Prefer editing existing code over creating new abstractions
- Never delete code unilaterally — flag and recommend, wait for confirmation
- Follow established error handling patterns in codebase

### Task Closure
- Run linter and type checker before marking complete — fix any errors
- Never leave codebase in worse state than found
- Ask user to update project context files when complete
- Summarize all decisions made, including alternatives discarded
- List any assumptions made during implementation

## Skills
- `create-prisma-repository` — scaffold interface + Prisma implementation + DI binding
- `generate-full-module` — full CRUD module with tests
- `generate-nest-module` — lighter module scaffold

## Workflows
- `/pre-commit-review` — mandatory before every commit/PR
- `/review` — deep code review for bugs and security

## Domain Context
Multi-tenant SaaS for sales management. Core entities:
- **Account** (seller/admin users with plans)
- **Product** → **Product_price** (multi-price)
- **Customer** (per seller)
- **Order** → **Order_item** (with stock decrement)
- **Billing** (linked to orders)
- **Store_stock** → **Stock_movement** (in/out/adjustment)
- **Subscription** → **Usage_record** (Free/Pro plans)
- **Notification** (WebSocket real-time)
- **Audit_log** (action tracking)

## Module Compliance (Repository Pattern)
- ✅ Compliant (14/14): Users, Products, Customers, Orders, Billings, StockMovements, StoreStock, ProductPrices, Dashboard, Reports, Admin, Catalog, Subscriptions, Auth
- ℹ️ Export module uses PrismaService directly (shared utility — acceptable)
- ℹ️ Auth's TokenService (JWT only) and TokenBlacklistService (Redis only) don't use Prisma — already compliant

## CI/CD & Infrastructure
- **CI**: GitHub Actions (`ci.yml`) — lint → build → test on PRs and pushes to main
- **Deploy**: GitHub Actions (`deploy.yml`) — SSH to Hostinger VPS, runs `scripts/deploy.sh`
- **VPS Stack**: PM2 (cluster, 2 instances) + Docker (Postgres 17 + Redis 7) + Nginx (reverse proxy + SSL)
- **Domain**: `vendinhas.app` (frontend) / `api.vendinhas.app` (backend API)
- **Database schema**: Always `public` (never custom schemas — @prisma/adapter-pg 7.x bug)
- **Env vars**: `.env` on VPS, sourced by `deploy.sh` before `pm2 reload --update-env`
- **Rollback**: `deploy.sh` backs up `dist/` before deploy, auto-rollback on failure
- **Runbook**: `docs/VPS_RUNBOOK.md`
- **Future**: migrate from PM2 to full Docker-based deploy

## Pending Work
- Unit tests: 13 modules/services have zero tests
- E2E tests: exist but disabled in CI
- ConfigModule migration: raw process.env scattered across constructors
- SQL corrections: missing columns and notifications table need proper Prisma migrations
- GitHub secrets (VPS_HOST, VPS_USER, VPS_SSH_KEY) not yet configured
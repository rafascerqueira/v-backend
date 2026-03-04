# v-backend AI Agents

Primary Agent: Senior NestJS Engineer (Fastify + Prisma + Domain-Driven)

Always follow `.windsurf/rules/core-rules.md` (always_on) and `.windsurf/rules/refactoring-rules.md` (when refactoring).

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
- ✅ Compliant: Users, Products, Customers
- ❌ Need refactoring: Orders, Billings, Dashboard, StockMovements, StoreStock, ProductPrices, Reports, Admin, Catalog, Subscriptions
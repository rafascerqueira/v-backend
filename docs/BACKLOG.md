# Backlog Vendinhas backend (v-backend)

> Here are some features that haven't been implemented yet, but we hope to make them available on the frontend soon.

## Features

here is some gaps found on frontend debug

- [x] Bundles (product packages)
  Implemented: `GET/POST /bundles`, `PATCH/DELETE /bundles/:id` with tenant-scoped repository, Zod DTO, and full unit test coverage.

- [x] Promotions (discounts, sales, etc.)
  Implemented: `GET/POST /promotions`, `PATCH /promotions/:id/end`. Status computed dynamically from dates. Price auto-fetched from `product_price` table.

- [x] Creating customer — billing_day field
  Added optional `billing_day` (1–31) to `Customer` model, DTO, repository, and tests. Frontend can omit the field; it defaults to `null`.

- [x] Supplier management
  Implemented: `GET/POST /suppliers`, `PATCH/DELETE /suppliers/:id`, `GET /suppliers/:id/debts`, `POST /suppliers/:id/debts`, `POST /suppliers/debts/:debtId/pay`. Debt status auto-advances (pending → partial → paid).


## Improvements 

- [x] encompassing some tests on the existing suite in which some controllers are not tested.
  Added missing tests for `OrdersController` (findAll, updateStatus, delete) and `CustomersService` (document uniqueness, billing_day passthrough).

- [x] Administrator users should have the power to create other users, delete and handle user subscriptions.
  Added `POST /admin/accounts` (create seller account) and `DELETE /admin/accounts/:id` (delete account, blocks admin accounts). Audit logged.

- [x] ensure idempotency, customers with the same data can be persisted in different user environments (when it occurred), but never duplicated within the same user's environment.
  `@@unique([seller_id, email])`, `@@unique([seller_id, phone])`, `@@unique([seller_id, document])` constraints enforced. `CustomersService` maps P2002 → `ConflictException` for all three fields.

- [x] caching data to fast bootstrap to some points in system data display. think about view table in postgres DB.
  Created PostgreSQL view `v_seller_stats` (migration `20260412003520`). Added Redis cache (TTL 60s, key `dashboard:stats:{sellerId}`) in `DashboardService.getStats`.

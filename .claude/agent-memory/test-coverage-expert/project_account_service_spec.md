---
name: AccountService spec uses real PasswordHasherService
description: The existing account.service.spec.ts uses the real PasswordHasherService (not a mock) and an in-memory store for the repository mock — changePassword tests must hash real passwords to populate the store correctly
type: project
---

`src/modules/users/services/account.service.spec.ts` deliberately injects the real `PasswordHasherService` (not a `jest.fn()` mock) and uses a stateful in-memory `accountsStore` array as the repository mock. This means `changePassword` tests must call `passwordHasher.hash(password)` to generate a real hash before pushing the account into the store.

**Why:** The original spec was written to test real password verification end-to-end at the unit level without Prisma. Pure mocks would lose that signal.

**How to apply:** When adding new `changePassword`-style tests that depend on password verification, push accounts with hashed passwords using `await passwordHasher.hash(...)` rather than plain strings. The `update` mock still needs `mockResolvedValueOnce` since it's a `jest.fn()` stub.

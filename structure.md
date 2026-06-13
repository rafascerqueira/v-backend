# Estrutura do projeto

> Fonte autoritativa: `CLAUDE.md` (seção "Module structure"). Este arquivo
> apenas resume; em caso de divergência, vale o `CLAUDE.md`.

Os módulos seguem uma estrutura por camadas (controller → service →
repository), **não** a árvore DDD (`application/domain/infrastructure/interfaces`).

```
src/
 ├── modules/{feature}/          # ex.: products, orders, customers, stock-movements, billings, ...
 │    ├── {feature}.module.ts
 │    ├── controllers/           # fronteira HTTP — valida, chama service, retorna
 │    ├── services/              # regra de negócio — nunca importa PrismaService
 │    ├── repositories/          # única camada que usa PrismaService
 │    └── dto/                   # schemas Zod + tipos z.infer<>
 └── shared/                     # serviços/helpers reutilizáveis
      ├── prisma/                # PrismaService (singleton)
      ├── redis/                 # RedisService (ioredis)
      ├── queue/                 # BullMQ (producer + processors)
      ├── repositories/          # interfaces + DI symbols
      ├── tenant/                # TenantContext (AsyncLocalStorage)
      ├── crypto/                # hashing Argon2id
      ├── email/                 # EmailService (nodemailer)
      ├── filters/               # GlobalExceptionFilter + ZodExceptionFilter
      └── websocket/             # NotificationsGateway + NotificationService
```

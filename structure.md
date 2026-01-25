# Estrutura do projeto
## baseado em Padrões de Projeto (DDD)

```
src/
 ├── modules/
 │    ├── products/
 │    │     ├── application/      # Casos de uso (services)
 │    │     ├── domain/           # Entidades, agregados, eventos
 │    │     ├── infrastructure/   # Repositórios, adapters (ex.: Prisma)
 │    │     ├── interfaces/       # DTOs e contratos
 │    │     ├── products.module.ts
 │    │     └── products.controller.ts
 │    ├── orders/
 │    │     ├── application/
 │    │     ├── domain/
 │    │     ├── infrastructure/
 │    │     └── ...
 │    ├── customers/
 │    ├── stock/
 │    └── billings/
 ├── shared/                      # Serviços e helpers reutilizáveis
 │    ├── prisma/
 │    │     └── prisma.service.ts
 │    ├── events/
 │    ├── utils/
 │    └── constants/
 └── main.ts
```
 

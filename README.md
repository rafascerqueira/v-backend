# 🛒 Vendinhas API

API RESTful para sistema de gestão de vendas, desenvolvida com NestJS e Fastify.

[![NestJS](https://img.shields.io/badge/NestJS-11.x-red?logo=nestjs)](https://nestjs.com/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-black?logo=fastify)](https://fastify.io/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma)](https://prisma.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 📋 Índice

- [Funcionalidades](#-funcionalidades)
- [Tecnologias](#-tecnologias)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Executando](#-executando)
- [Documentação da API](#-documentação-da-api)
- [Autenticação](#-autenticação)
- [Testes](#-testes)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Banco de Dados](#-banco-de-dados)
- [Licença](#-licença)

## ✨ Funcionalidades

- **Autenticação JWT** com RS256 (criptografia assimétrica)
- **Refresh tokens** para renovação de sessão
- **Logout seguro** com blacklist de tokens (Redis)
- **Cookies HttpOnly** para máxima segurança
- **CRUD completo** de clientes, produtos, pedidos
- **Controle de estoque** com movimentações
- **Faturamento** e cobranças
- **Preços dinâmicos** por período
- **Health checks** para monitoramento
- **Documentação Swagger** interativa

## 🛠 Tecnologias

| Tecnologia | Versão | Descrição |
|------------|--------|-----------|
| NestJS | 11.x | Framework Node.js |
| Fastify | 5.x | HTTP server de alta performance |
| Prisma | 7.x | ORM moderno para TypeScript |
| PostgreSQL | 15+ | Banco de dados relacional |
| Redis | 7+ | Cache e blacklist de tokens |
| Zod | 4.x | Validação de schemas |
| Argon2 | - | Hash de senhas (Argon2id) |
| JWT | RS256 | Autenticação com chaves assimétricas |

## 📦 Pré-requisitos

- **Node.js** 20.x ou superior
- **pnpm** 9.x ou superior
- **PostgreSQL** 15 ou superior
- **Redis** 7 ou superior
- **OpenSSL** (para gerar chaves RSA)

## 🚀 Instalação

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/vendinhas-backend.git
cd vendinhas-backend

# Instale as dependências
pnpm install

# Gere o cliente Prisma
pnpm prisma generate
```

## ⚙️ Configuração

### 1. Variáveis de Ambiente

Copie o arquivo de exemplo e configure:

```bash
cp .env.example .env
```

Edite o `.env`:

```env
# Banco de dados
DATABASE_URL="postgresql://user:password@localhost:5432/vendinhas?schema=public"

# JWT (RS256 se keys existirem, fallback para HS256)
JWT_KEYS_DIR=./keys
JWT_SECRET=seu_jwt_secret_aqui
JWT_REFRESH_SECRET=seu_refresh_secret_aqui
JWT_ACCESS_TOKEN_EXPIRES_IN=1d
JWT_REFRESH_TOKEN_EXPIRES_IN=7d

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 2. Gerar Chaves RSA (Recomendado)

```bash
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

### 3. Configurar Banco de Dados

```bash
# Iniciar PostgreSQL e Redis (Docker)
docker-compose up -d

# Executar migrations
pnpm prisma migrate dev

# (Opcional) Popular com dados de exemplo
pnpm prisma db seed
```

## ▶️ Executando

```bash
# Desenvolvimento (com hot reload)
pnpm start:dev

# Produção
pnpm build
pnpm start:prod
```

A API estará disponível em: `http://localhost:3000`

## 📚 Documentação da API

Acesse a documentação Swagger interativa:

```
http://localhost:3000/api/docs
```

### Endpoints Principais

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/auth/register` | Criar conta |
| POST | `/auth/login` | Login (retorna JWT) |
| POST | `/auth/refresh` | Renovar tokens |
| POST | `/auth/logout` | Logout (invalida token) |
| GET | `/customers` | Listar clientes |
| POST | `/customers` | Criar cliente |
| GET | `/products` | Listar produtos |
| POST | `/products` | Criar produto |
| GET | `/orders` | Listar pedidos |
| POST | `/orders` | Criar pedido |
| GET | `/health` | Health check |

## 🔐 Autenticação

### Fluxo de Login

```
POST /auth/login
Content-Type: application/json

{
  "email": "usuario@exemplo.com",
  "password": "SenhaSegura123"
}
```

Resposta:
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIs...",
  "expiresIn": 86400
}
```

### Usando o Token

```bash
curl -H "Authorization: Bearer {accessToken}" \
  http://localhost:3000/customers
```

### Refresh Token

```
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

### Logout

```
POST /auth/logout
Authorization: Bearer {accessToken}
```

> O logout invalida o token no Redis e limpa os cookies HttpOnly.

## 🧪 Testes

```bash
# Testes unitários
pnpm test

# Testes com coverage
pnpm test:cov

# Testes E2E
pnpm test:e2e

# Watch mode
pnpm test:watch
```

## 📁 Estrutura do Projeto

```
src/
├── config/              # Configurações (Swagger, etc)
├── health/              # Health checks
├── modules/
│   ├── auth/            # Autenticação JWT
│   │   ├── controllers/
│   │   ├── decorators/
│   │   ├── guards/
│   │   └── services/
│   ├── users/           # Usuários e contas
│   ├── customers/       # Clientes
│   ├── products/        # Produtos
│   ├── orders/          # Pedidos
│   ├── billings/        # Faturamento
│   ├── product-prices/  # Preços
│   ├── store-stock/     # Estoque
│   └── stock-movements/ # Movimentações
├── shared/
│   ├── crypto/          # Password hashing (Argon2)
│   ├── filters/         # Exception filters
│   ├── pipes/           # Validation pipes (Zod)
│   ├── prisma/          # PrismaService
│   ├── redis/           # RedisService
│   └── repositories/    # Repository interfaces
└── main.ts              # Bootstrap
```

## 🗄️ Banco de Dados

A estrutura do banco de dados foi modelada utilizando o Prisma ORM e está definida em `prisma/schema.prisma`. O diagrama abaixo ilustra as principais entidades e seus relacionamentos.

```mermaid
erDiagram
    User {
        String id PK
        String name
        String email UK
        String role
    }

    Customer {
        String id PK
        String name
        String email UK
        String phone UK
        String document UK
    }

    Product {
        Int id PK
        String name
        String sku UK
        String category
        String description
        Json specifications
    }

    Order {
        Int id PK
        String order_number UK
        String customer_id FK
        OrderStatus status
        PaymentStatus payment_status
        Int total
    }

    Order_item {
        Int id PK
        Int order_id FK
        Int product_id FK
        Int quantity
        Int unit_price
        Int total
    }

    Billing {
        Int id PK
        Int order_id FK
        String billing_number UK
        BillingStatus status
        Int total_amount
        Int paid_amount
    }

    Stock_movement {
        Int id PK
        Int product_id FK
        MovementType movement_type
        ReferenceType reference_type
        Int quantity
    }

    Product_price {
        Int id PK
        Int product_id FK
        PriceType price_type
        Int price
        DateTime valid_from
        DateTime valid_to
    }

    Store_stock {
        Int id PK
        Int product_id FK
        Int quantity
        Int reserved_quantity
        Int min_stock
    }

    Customer ||--|{ Order : "places"
    Order ||--|{ Order_item : "contains"
    Product ||--|{ Order_item : "references"
    Order ||--|{ Billing : "generates"
    Product ||--|{ Stock_movement : "has"
    Product ||--o{ Product_price : "has"
    Product ||--o{ Store_stock : "manages"
```

### Legenda
- **PK**: Chave Primária (Primary Key)
- **FK**: Chave Estrangeira (Foreign Key)
- **UK**: Chave Única (Unique Key)

---

## Licença

[MIT](LICENSE).
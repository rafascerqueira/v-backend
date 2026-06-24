# Stripe — Roadmap de configuração para produção

Assinatura recorrente **cartão-only**, plano **Pro R$ 14,90/mês**, API version **`2026-03-25.dahlia`**
(SDK `stripe@21.0.1`). Domínios: API `https://api.vendinhas.app`, frontend `https://vendinhas.app`.

> Ordem importa. Faça as fases na sequência. Itens marcados **[código]** já estão prontos no
> repo e só precisam de **deploy**; o resto é configuração no Dashboard / VPS / Cloudflare.

---

## Fase 0 — Pré-requisitos

- [ ] Conta Stripe **ativada em modo LIVE** (verificação de negócio + conta bancária p/ payout, BRL).
- [ ] Domínios no ar com TLS: `api.vendinhas.app` (backend) e `vendinhas.app` (frontend).
- [ ] Branch com as correções de billing pronta para deploy (ver Fase 4).

## Fase 1 — Stripe Dashboard (modo LIVE)

1. **Branding** — Settings → Branding: logo, cor primária, nome do negócio (aparece no Checkout e no Portal).
2. **Produto + Preço** — Catálogo → produto **"Profissional"** → Price **recorrente, mensal, BRL, R$ 14,90** → copiar o `price_...` (LIVE).
   - (Opcional) Preço do Enterprise, se for usar.
3. **Customer Portal** — Settings → Billing → Customer portal: habilitar **cancelar assinatura**, **atualizar cartão** e (opcional) **trocar de plano**; preencher links de termos/privacidade.
4. **Dunning (CRÍTICO)** — Settings → Billing → *Manage failed payments*: ativar Smart Retries e, após a última tentativa, **Cancel subscription**.
   - É isso que dispara `customer.subscription.deleted` → o sistema rebaixa a conta para `free`. Sem essa config, inadimplente fica `pro` para sempre.
5. **Webhook endpoint** — Developers → Webhooks → Add endpoint:
   - URL: `https://api.vendinhas.app/webhooks/stripe`
   - **API version: deixar o default da conta (`2026-03-25.dahlia`)** — bate com o SDK/código. Não fixar outra versão.
   - Eventos (somente os tratados):
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
   - Após criar, **Reveal** o *Signing secret* → `whsec_...` (vai no `.env`, Fase 2).

## Fase 2 — Variáveis de ambiente (VPS `.env`, **fora do git**)

```dotenv
STRIPE_SECRET_KEY=sk_live_...          # chave secreta LIVE
STRIPE_WEBHOOK_SECRET=whsec_...        # signing secret DO ENDPOINT da Fase 1.5 (≠ secret do `stripe listen`)
STRIPE_PRICE_PRO=price_...             # price LIVE da Fase 1.2
STRIPE_PRICE_ENTERPRISE=price_...      # se usar
# já devem existir:
APP_URL=https://api.vendinhas.app
FRONTEND_URL=https://vendinhas.app
NODE_ENV=production
TRUST_PROXY=loopback
```

Aplicar (VPS): `set -a && source .env && set +a && pm2 reload ecosystem.config.js --update-env`.

> Em produção **NÃO** se usa `stripe listen` (isso é só dev local). A Stripe entrega direto no endpoint público.

## Fase 3 — Deixar a rajada de webhook passar (3 camadas de rate-limit)

A Stripe envia ~10 eventos num piscar ao concluir o checkout. As 3 camadas precisam liberar `/webhooks/stripe`:

1. **App** — `@SkipThrottle()` no `WebhookController`. **[código]** já feito.
2. **Nginx** — hoje `/webhooks/stripe` cai no `location /` com `limit_req zone=api burst=20` (`nginx/vendinhas.conf`). Adicionar location dedicado **sem** `limit_req` apontando para `vendinhas_api`.
3. **Cloudflare** — regra para **pular rate-limit + WAF/bot challenge** em `/webhooks/stripe` (allow das faixas de IP da Stripe); **bloquear** `/webhooks/pagseguro` (ver `EDGE_SECURITY_RUNBOOK.md`).

## Fase 4 — Deploy do código

Subir a branch com as correções desta rodada:

- **[código]** SDK `stripe@21.0.1` + `apiVersion: '2026-03-25.dahlia'`.
- **[código]** `@SkipThrottle()` no webhook (Fase 3.1).
- **[código]** handlers recorrentes corrigidos (período via `items.data[]`, link via `parent.subscription_details`, sem `Invalid Date`).
- **[código]** reconcile: `POST /admin/subscriptions/reconcile` + cron BullMQ diário (04:00), bidirecional.
- **[código]** frontend: preço lido de `GET /subscriptions/plans` + polling no retorno do checkout.

Pipeline: `prisma migrate deploy` → drift guard → `nginx -t`/reload → `pm2 reload --update-env`. Rodar `pnpm test` no CI antes.

## Fase 5 — Verificar em produção

- [ ] Dashboard → Webhooks → **Send test event** → esperar `200` e entrega ok.
- [ ] Checkout real (cartão real, R$ 14,90) **ou** Stripe *test clock* num sandbox → confirmar:
  - `webhook_events` com `processed=true` (pelo menos `checkout.session.completed` e `customer.subscription.created`);
  - conta com `plan_type='pro'` e linha em `subscriptions` com `status='active'` e período correto.
- [ ] Abrir "Gerenciar assinatura" → confirmar que o Portal abre e permite cancelar/atualizar cartão.
- [ ] Safety net ativo: cron de reconcile às 04:00 e `POST /admin/subscriptions/reconcile` disponível (admin).

---

## Gotchas (aprendidos nesta integração)

- **Versão de API**: tudo em `2026-03-25.dahlia` (SDK `stripe@21.0.1`). Não criar o endpoint em outra versão; **não** subir para `stripe@22.2.x` (pina `2026-05-27.dahlia`, mais nova que a conta) sem subir a conta junto.
- **Webhook secret de produção** = signing secret do **endpoint** no Dashboard (≠ o do `stripe listen`, que é só dev).
- **Fonte de verdade do preço** = o Price na Stripe; `PLAN_PRICES` (centavos) e o frontend (que lê de `/subscriptions/plans`) precisam bater com ele.
- **As 3 camadas de rate-limit** (app/nginx/Cloudflare) precisam liberar a rota de webhook — senão `429` derruba os eventos de ativação.
- **Assinatura do webhook** é verificada sobre o raw body (`rawBody: true`); nginx/Cloudflare não podem alterar o corpo nem injetar headers de CORS na rota.

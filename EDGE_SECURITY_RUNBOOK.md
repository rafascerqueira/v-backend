# Edge & Public-Surface Security Runbook

Hardening for the **unauthenticated** request surface, layered on top of the app-level
protections. Covers Cloudflare console config and origin lockdown that can't live in code.

> Companion to `VPS_RUNBOOK.md`. The app/nginx pieces referenced here are already in the
> repo (`src/main.ts`, `nginx/vendinhas.conf`); this doc is the console + OS side.

## Public surface (what these rules protect)

| Group | Routes |
|---|---|
| Infra | `GET /`, `GET /health[/liveness/readiness]` |
| Auth | `POST /auth/register`, `/login`, `/refresh`, `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`, OAuth redirects/callbacks |
| Webhooks | `POST /webhooks/stripe` (signature-verified), `/webhooks/pagseguro` (returns 410) |
| Storefront | `GET /catalog/loja/:slug[...]`, `POST .../customer/lookup`, `/customer/auth`, `/customer/password*`, `POST /catalog/orders`, `GET /catalog/orders/:n/track` |

---

## Already done in code (don't redo — verify)

- **`TRUST_PROXY=loopback`** (`src/main.ts`): Fastify trusts only the local nginx hop, so
  `X-Forwarded-For` can't be spoofed to evade rate limits. Set `TRUST_PROXY=loopback` in prod `.env`.
- **nginx real-IP from Cloudflare** (`nginx/vendinhas.conf`): `set_real_ip_from` (CF ranges) +
  `real_ip_header CF-Connecting-IP`, so `$remote_addr` and rate-limit keys are the true client.
- **Per-route `@Throttle`** on auth + catalog endpoints; global throttler backstop.
- **nginx rate-limit zones** (`api`/`web`/`uploads`), HSTS, `X-Frame-Options`, `nosniff`,
  `Referrer-Policy: no-referrer` on the API host, `client_max_body_size 10M`.
- **Stripe webhook** verifies signatures; **PagSeguro** webhook disabled (410).
- **Private avatars** served only via authenticated route; `/uploads/profiles/` blocked at nginx.

---

## 1. Lock the origin to Cloudflare (the keystone)

WAF, rate limits, and bot rules are worthless if an attacker resolves the origin IP and hits
`api.vendinhas.app` directly. Two layers:

### 1a. OS firewall — only accept 443 from Cloudflare ranges
```bash
# Allow SSH (adjust port), then 443 ONLY from Cloudflare, deny the rest.
for cidr in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
  ufw allow proto tcp from "$cidr" to any port 443
done
ufw deny 443/tcp
ufw deny 80/tcp        # CF talks 443 to origin; drop plain 80 at the origin
ufw reload
```
Re-run when Cloudflare updates ranges (rare). Keep this in sync with the `set_real_ip_from`
list in `nginx/vendinhas.conf`.

### 1b. Authenticated Origin Pulls (mTLS)
Cloudflare presents a client cert; nginx refuses anyone who doesn't.
1. Cloudflare dashboard → SSL/TLS → Origin Server → **Authenticated Origin Pulls** → On (zone-level).
2. Install CF's origin-pull CA on the box and require it in each `server` block:
   ```nginx
   ssl_client_certificate /etc/nginx/cloudflare/origin-pull-ca.pem;
   ssl_verify_client on;
   ```
   (CA: https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)

### 1c. TLS mode
SSL/TLS → Overview → **Full (strict)**. Never "Flexible". Enable **Always Use HTTPS** and
**Minimum TLS 1.2**.

---

## 2. Cloudflare WAF

- Security → WAF → **Managed Rules**: enable Cloudflare Managed Ruleset + OWASP Core Ruleset
  (start at Paranoia/sensitivity Medium, watch for false positives on uploads).
- Custom rules:
  - **Block** `http.request.uri.path eq "/webhooks/pagseguro"` (dead endpoint).
  - **Skip/allow** `/webhooks/stripe` only from Stripe's published IP ranges
    (https://stripe.com/docs/ips) — signature verification is the real defense; this trims noise.
  - Optionally **block** `/health` from the public (see §6).

---

## 3. Edge rate limiting (in front of the origin)

App `@Throttle` is the backstop; these reject before traffic reaches the box. Security → WAF →
Rate limiting rules:

| Rule (path) | Suggested budget | Action |
|---|---|---|
| `/auth/login` | 10 / 10 min / IP | Managed Challenge then block |
| `/auth/register` | 5 / 10 min / IP | Block |
| `/auth/forgot-password` | 5 / 15 min / IP | Block |
| `/catalog/*/customer/lookup` | 15 / 5 min / IP | Managed Challenge |
| `/catalog/*/customer/auth` | 10 / 10 min / IP | Block |
| `POST /catalog/orders` | 20 / 10 min / IP | Managed Challenge |

Key on IP; consider keying login on IP+body(email) if on a plan that supports it.

---

## 4. Bot mitigation / Turnstile

Rate limits slow abuse; CAPTCHA stops it. Add **Cloudflare Turnstile** to the frontend forms and
verify the token server-side (or via a Cloudflare rule) on:

- `POST /auth/register`, `/auth/login`, `/auth/forgot-password`
- `POST /catalog/*/customer/lookup` and `/customer/auth` — **this is the mitigation for the
  customer-enumeration oracle** (the lookup returns `{found, firstName, hasPassword}` by design
  for the checkout UX; CAPTCHA + the existing throttle is the right control, not removing the field)
- `POST /catalog/orders` (fake-order floods)

Enable **Bot Fight Mode** (or Super Bot Fight Mode) as a baseline.

---

## 5. Caching the storefront (absorb scraping/DDoS) — with PII guardrails

Cache the public reads, **never** the personalized ones.

- **Cache**: `GET /catalog/loja/:slug` and `GET /catalog/loja/:slug/products` — Cache Rule, edge TTL
  a few minutes, respect `Cache-Control`.
- **Bypass cache (critical)**: `/catalog/loja/*/customers/*` and any `/customer/*` path — these
  return one person's PII; a cache hit could serve it to another visitor.

---

## 6. Don't expose internals through the edge

- `/health*` returns DB/Redis readiness — useful internally, an info leak publicly. Either restrict
  via a Cloudflare WAF rule (allow only your monitoring source / Cloudflare health checks, block
  the rest) or move liveness checks to an internal-only hostname.
- `GET /` returns `"Hello World!"` (an origin fingerprint). It's `@Public()` for the load-balancer
  root check; consider returning a neutral 200 with no body, or blocking it at the edge.

---

## 7. Observability

- Cloudflare → Analytics & Logs: watch WAF events, rate-limit hits, challenge solve rates.
- Alert on spikes in **401/403/429** and in `POST /catalog/orders` volume per slug — early signal
  for credential stuffing, enumeration, and fake-order floods.

---

## Verification checklist

```bash
# 1. Origin is NOT reachable except via Cloudflare (run from a non-CF host):
curl -sk --resolve api.vendinhas.app:443:<ORIGIN_IP> https://api.vendinhas.app/   # expect timeout/refused

# 2. Real client IP reaches the app (check rate-limit keys aren't all CF IPs):
#    tail nginx access log -> $remote_addr should be visitor IPs, not 104.x/172.x CF ranges.

# 3. trustProxy can't be spoofed:
curl -s https://api.vendinhas.app/auth/login -H 'X-Forwarded-For: 1.2.3.4' ...   # throttle still keys off real IP

# 4. Security headers present:
curl -sI https://api.vendinhas.app/ | grep -iE 'strict-transport|x-frame|x-content-type|referrer'

# 5. Dead webhook is closed:
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.vendinhas.app/webhooks/pagseguro   # expect 410
```

## Priority order
1. Origin lockdown (§1) — firewall to CF + Authenticated Origin Pulls.
2. Confirm `TRUST_PROXY=loopback` + nginx real-IP are live (already in code).
3. Edge rate limits (§3) + Turnstile (§4) on auth / lookup / orders.
4. WAF managed rules + webhook allowlist (§2).
5. Caching split (§5), health exposure (§6), monitoring (§7).

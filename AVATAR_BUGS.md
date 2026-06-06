# Bugs: Avatar de Perfil

## leia atentamente, faça a correção e teste.

Erros identificados em produção: **404** ao renderizar o avatar e **403** ao fazer upload ou remoção.
Diagnosticado via análise do código de produção em 2026-06-06.

---

## Bug 1 — 404: `<img>` não envia cookie de sessão

### Causa

O frontend renderiza o avatar assim (settings page):

```jsx
<img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
```

Em produção, `avatarUrl` é `https://api.vendinhas.app/auth/profile/avatar?v=...`.
Essa rota exige autenticação via cookie `access_token` (JwtAuthGuard).

O browser **nunca envia cookies `SameSite=Lax` em subrecursos** (`<img>`, `<script>`, etc.),
mesmo que o site e a API compartilhem o mesmo eTLD+1 (`vendinhas.app`). O cookie não
chega ao guard → sem sessão → `avatar.controller.ts` retorna 404 na linha:

```typescript
// avatar.controller.ts
if (!avatar) {
  reply.status(404).send()   // ← cai aqui mesmo quando o avatar existe no MinIO
  return
}
```

### Arquivos a alterar

- Frontend: componente de avatar na settings page (o `<img>` que usa `avatarUrl`)
- Frontend: possivelmente o componente de avatar no header/navbar, se existir

### Correção

Substituir a tag `<img>` por um hook/componente que faz `fetch` com
`credentials: 'include'`, converte a resposta em blob e cria um `object URL`.
Aplicar apenas quando a URL aponta para a rota privada (`/auth/profile/avatar`).
URLs absolutas de OAuth (Google/Facebook) continuam sendo usadas diretamente no `<img>`.

```typescript
// Exemplo de hook — useAvatarUrl.ts
import { useEffect, useState } from 'react'

export function useAvatarObjectUrl(avatarUrl: string | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!avatarUrl) {
      setObjectUrl(null)
      return
    }

    // OAuth avatars (Google/Facebook): URL absoluta, usar direto no <img>
    if (/^https?:\/\//.test(avatarUrl) && !avatarUrl.includes('/auth/profile/avatar')) {
      setObjectUrl(avatarUrl)
      return
    }

    let cancelled = false
    fetch(avatarUrl, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) return null
        return res.blob()
      })
      .then((blob) => {
        if (cancelled || !blob) return
        setObjectUrl(URL.createObjectURL(blob))
      })
      .catch(() => {})

    return () => {
      cancelled = true
      setObjectUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [avatarUrl])

  return objectUrl
}
```

```jsx
// Na settings page — trocar:
<img src={ah} alt="Avatar" ... />

// Por:
const displayUrl = useAvatarObjectUrl(ah)
// ...
{displayUrl
  ? <img src={displayUrl} alt="Avatar" ... />
  : <User className="w-8 h-8 text-gray-400" />
}
```

### Observação

Não alterar `sameSite` dos cookies para `'none'` — isso ampliaria a superfície de ataque
CSRF e exigiria revisão de toda a proteção de double-submit.

---

## Bug 2 — 403: cookie CSRF expira antes do refresh token

### Causa

O cookie `csrf_token` tem `maxAge` igual ao `access_token` (1 dia, via `JWT_ACCESS_TOKEN_EXPIRES_IN`).
O `refresh_token` vive 7 dias. Quando o usuário fica inativo por mais de 1 dia:

1. `access_token` expira → browser também perde o `csrf_token` (mesmo `maxAge`)
2. Usuário volta, o frontend silenciosamente renova os tokens via `POST /auth/refresh`
3. O refresh emite novo `access_token` + novo `csrf_token` — mas o axios **não relê** o
   cookie imediatamente após o refresh; a leitura de `document.cookie['csrf_token']` que
   o axios usa para montar o header `X-CSRF-Token` ainda retorna `undefined`
4. A próxima mutação (upload/delete de avatar) é disparada com header CSRF vazio
5. `csrfTokensMatch(undefined, undefined)` → `false` → **403 "Invalid or missing CSRF token"**

Adicionalmente, o `GET /auth/me` só emite o CSRF cookie quando ele **não existe**:

```typescript
// me.controller.ts
if (!request.cookies?.[AUTH_COOKIES.CSRF_TOKEN]) {   // ← condicional
  setCsrfCookie(reply, 7 * 24 * 60 * 60)
}
```

Se o cookie expirou e o `GET /auth/me` não é chamado antes da mutação, o token
não é renovado.

### Arquivos a alterar

**Backend:**
- `src/modules/auth/controllers/me.controller.ts`
- `src/modules/auth/controllers/refresh-token.controller.ts`

**Frontend:**
- Interceptor do axios (onde o refresh silencioso é feito) — garantir que após o
  refresh, uma nova leitura do cookie seja feita antes de retentar a request original

### Correção — Backend

**`me.controller.ts`**: remover o `if` — sempre re-emitir o CSRF no `/auth/me`.
O `/auth/me` é chamado no boot do SPA e serve exatamente como ponto de sincronização
do token; não há custo em rotacioná-lo a cada boot.

```typescript
// ANTES
if (!request.cookies?.[AUTH_COOKIES.CSRF_TOKEN]) {
  setCsrfCookie(reply, 7 * 24 * 60 * 60)
}

// DEPOIS — sempre emite, garante que o cookie nunca fique obsoleto
setCsrfCookie(reply, 7 * 24 * 60 * 60)
```

**`refresh-token.controller.ts`**: alinhar o `maxAge` do CSRF cookie com o do
`refresh_token` (7 dias), não com o do `access_token` (1 dia).
O CSRF precisa durar pelo menos tanto quanto a sessão pode ser renovada.

```typescript
// ANTES
setCsrfCookie(response, tokens.expiresIn)   // expiresIn = 1 dia

// DEPOIS
setCsrfCookie(response, 7 * 24 * 60 * 60)  // alinhado com o refresh_token
```

### Correção — Frontend (interceptor do axios)

Após o refresh silencioso, o axios deve aguardar o browser processar o `Set-Cookie`
antes de retentar. Na prática, basta uma microtask (ou releitura explícita do cookie):

```typescript
// No interceptor de erro do axios autenticado
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true
      await api.post('/auth/refresh')   // novo csrf_token chega via Set-Cookie
      // Forçar releitura do cookie antes de retentar:
      error.config.headers['X-CSRF-Token'] = getCookie('csrf_token') ?? ''
      return axiosInstance(error.config)
    }
    return Promise.reject(error)
  }
)
```

---

## Bug 3 — Avatares órfãos (migração local → S3)

### Causa

Há 3 arquivos em `/var/www/vendinhas/uploads/profiles/` que existem **somente no disco local**
e não foram migrados para o MinIO quando o `STORAGE_DRIVER` foi alterado para `s3`.
Se qualquer um desses usuários tentar acessar o avatar, `getObject()` busca no MinIO,
não encontra, retorna `null` → **404**.

```
uploads/profiles/
├── cmmgmrks000085nrx7vzditbr-profile.jpeg   ← apenas no disco, não no MinIO
├── cmmvclna1000j5nrxy1x9hfr3-profile.jpeg   ← apenas no disco, não no MinIO
└── cmmw8gj0s000n5grx4kdjqam0-profile.jpg    ← apenas no disco, não no MinIO
```

### Correção

Migrar os arquivos para o MinIO e confirmar que o bucket os recebeu corretamente.
Executar em produção (os arquivos já estão no servidor):

```bash
# Variáveis do .env de produção
ENDPOINT="http://127.0.0.1:9000"
BUCKET="vendinhas-uploads"
ACCESS_KEY="vendinhas_app"
SECRET_KEY="<STORAGE_S3_SECRET_ACCESS_KEY do .env>"

for file in /var/www/vendinhas/uploads/profiles/*; do
  filename=$(basename "$file")
  ext="${filename##*.}"

  # Detectar content-type
  case "$ext" in
    jpg|jpeg) ct="image/jpeg" ;;
    png)      ct="image/png"  ;;
    webp)     ct="image/webp" ;;
    *)        ct="application/octet-stream" ;;
  esac

  echo "Enviando profiles/$filename ($ct)..."
  # Usar aws CLI ou mc (MinIO client) conforme disponível no servidor
  # Com mc:
  # mc cp "$file" "local/$BUCKET/profiles/$filename"
  # Com aws CLI:
  # AWS_ACCESS_KEY_ID=$ACCESS_KEY AWS_SECRET_ACCESS_KEY=$SECRET_KEY \
  #   aws --endpoint-url $ENDPOINT s3 cp "$file" "s3://$BUCKET/profiles/$filename" \
  #   --content-type "$ct"
done
```

Após a migração, verificar que cada key existe no MinIO antes de deletar os arquivos locais.
Não é necessário alterar o banco — os `account.avatar` já apontam para a storage key correta
(`profiles/{userId}-profile.{ext}`).

---

## Checklist de implementação

- [x] **Bug 1** — Criar `useAvatarUrl` no frontend (`v-frontend/src/lib/use-avatar.ts`) — fetch com credenciais via axios → blob URL
- [x] **Bug 1** — Substituir `<img src={avatarUrl}>` na settings page
- [x] **Bug 1** — Outros pontos: header do dashboard (`(dashboard)/layout.tsx`) também migrado; varredura confirmou que não há mais nenhum
- [x] **Bug 2** — `me.controller.ts`: removido o `if`, sempre emite CSRF
- [x] **Bug 2** — `refresh-token.controller.ts`: `maxAge` do CSRF agora é `7 * 24 * 60 * 60`
- [x] **Bug 2** — Frontend: interceptor do axios relê `csrf_token` e seta `X-CSRF-Token` antes de retentar
- [ ] **Bug 3** — Migrar os 3 arquivos órfãos do disco local para o MinIO em produção ⚠️ **manual, na VPS**
- [ ] **Bug 3** — Confirmar via `GET /auth/profile/avatar` autenticado que os 3 usuários veem o avatar após a migração

### ⚠️ Pendência de produção (não automatizável daqui)

Os Bugs 1 e 2 estão corrigidos no código e cobertos por testes. **Falta apenas o Bug 3**, que é
migração de dados na VPS — rode o script da seção "Bug 3" no servidor (com `mc` ou `aws` CLI) e
confirme que cada key existe no MinIO antes de apagar os arquivos locais.

### Verificação de configuração (causa raiz do cross-origin)

Confirme no `.env` de **produção** (não o local) que o cookie é compartilhado entre os subdomínios —
sem isso a sessão e o CSRF não chegam à API e os erros persistem mesmo com o código corrigido:

```bash
NODE_ENV=production
COOKIE_DOMAIN=.vendinhas.app        # compartilha cookies entre vendinhas.app e api.vendinhas.app
APP_URL=https://api.vendinhas.app
FRONTEND_URL=https://vendinhas.app
CORS_ORIGIN=https://vendinhas.app
```


## Ao final da correção remover este arquivo (após concluir o Bug 3 em produção) 
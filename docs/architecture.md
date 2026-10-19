# Arquitetura e decisões

Plataforma pessoal de estudo sobre vídeos hospedados no Google Drive de terceiros
(acesso somente leitura). Um único usuário.

## Visão geral

```
Navegador ──► Next.js :3000 ──(rewrite /api/*)──► Django/DRF :8000 ──► SQLite (volume)
   │                                                     │
   └── iframe drive.google.com/file/d/<id>/preview       └──► Google Drive API (drive.readonly)
```

## Decisões

### 1. O Next.js faz proxy de `/api/*`

O navegador só fala com `localhost:3000`. O `next.config.ts` reescreve `/api/*` para o
Django (`BACKEND_URL`). Isso traz três vantagens:

- o cookie httpOnly do refresh token é *first-party* e não exige `SameSite=None` nem CORS
  com credenciais;
- o `middleware.ts` do Next enxerga esse cookie e consegue proteger as páginas;
- a CSP pode usar `connect-src 'self'`.

Exceção: o callback do OAuth do Google (`/api/google/callback`) aponta direto para
`localhost:8000`, porque é o redirect URI cadastrado no Google Cloud.

Os rewrites são resolvidos **no build**, por isso o Docker recebe `BACKEND_URL` como
build arg.

### 2. Sessão: JWT com access token em memória e refresh token em cookie httpOnly

| Token   | Onde fica                                         | Duração (padrão)             |
| ------- | ------------------------------------------------- | ---------------------------- |
| access  | memória do JS (`lib/api/client.ts`)               | 5 min                        |
| refresh | cookie `refresh_token`, httpOnly, SameSite=Lax    | 7 dias, rotacionado a cada uso |

- Ao carregar a página, o `AuthProvider` chama `POST /api/auth/refresh` para obter um
  access token novo.
- Qualquer resposta 401 dispara **um único** refresh compartilhado e uma nova tentativa.
  Se o refresh falhar, o usuário vai para `/login?next=...`.
- Refresh tokens usados ou do logout entram na blacklist do simplejwt.
- O middleware do Next só verifica se o cookie **existe**; quem valida é a API. Um cookie
  inválido é apagado pelo backend na primeira falha de refresh, o que evita loops de
  redirecionamento.
- O cookie fica em `Path=/` para que o middleware o veja nas rotas de página.
- CSRF: `SameSite=Lax` impede o envio do cookie em POSTs cross-site, e as respostas
  de refresh não são legíveis por outras origens (sem CORS liberado).

Limitação conhecida: duas abas fazendo refresh exatamente ao mesmo tempo podem invalidar
uma à outra (rotação + blacklist). A aba afetada pede login de novo. É aceitável para
uso pessoal.

### 3. Usuário único

O login só aceita um **superuser ativo**. Não existe endpoint de cadastro. O
`/admin` do Django só é montado se `DJANGO_ADMIN_ENABLED=true` (padrão: igual a
`DJANGO_DEBUG`).

### 4. Banco de dados

SQLite em `DATA_DIR/db.sqlite3`, com `journal_mode=WAL` e transações `IMMEDIATE`. Isso
permite que a importação (que roda numa thread) escreva enquanto a API atende leituras.
Para usar PostgreSQL, basta definir `DATABASE_URL`.

### 5. Segredos

- Os tokens OAuth do Google são guardados com `EncryptedTextField` (Fernet). A chave
  `FIELD_ENCRYPTION_KEY` aceita várias chaves separadas por vírgula para rotação: a
  primeira criptografa e todas descriptografam.
- O `client_secret` do Google entra só por variável de ambiente.
- O `.env` é ignorado pelo git, e o pre-commit roda `detect-private-key`.

### 6. Cliente da API tipado

`drf-spectacular` gera `frontend/openapi.yml`, e o `openapi-typescript` gera
`src/lib/api/schema.d.ts`, consumido pelo `openapi-fetch`. Os dois arquivos são
versionados para que o frontend compile sem o backend rodando. Para regenerar:
`make schema`. Um teste do backend falha se o schema tiver avisos.

### 7. Content Security Policy

Definida em `next.config.ts`. Pontos principais: `frame-src https://drive.google.com
https://docs.google.com` (player e preview de anexos), `frame-ancestors 'none'` e
`connect-src 'self'`. `script-src` precisa de `'unsafe-inline'` por causa dos scripts
de bootstrap do Next. Se for preciso endurecer, a evolução natural é usar nonce.

### 8. Dependências

- Backend: `pip-tools` (`requirements.in` → `requirements.txt` com versões travadas).
  Para atualizar: `make lock`.
- Frontend: `pnpm` com `pnpm-lock.yaml`.
- Utilitário `cn`: o shadcn/ui atual usa o pacote oficial `cn` (repositório
  `shadcn-ui/cn`) no lugar de `clsx` + `tailwind-merge`.

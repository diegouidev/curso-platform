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

### 9. Google OAuth (Fase 2)

- **Escopo único:** `drive.readonly`. O e-mail da conta vem de `about.get` do próprio Drive,
  para não pedir `openid`/`email`. Um teste (`test_readonly_guard.py`) falha se surgir
  qualquer outro escopo no código.
- **Início do fluxo:** `GET /api/google/connect` é uma navegação de página inteira e não
  carrega o access token, que fica em memória. Por isso esse endpoint também aceita o
  **cookie de refresh**: valida assinatura, expiração e blacklist, sem rotacionar.
- **State e PKCE:** ficam no banco (`OAuthState`, com o verifier criptografado, TTL de
  10 minutos e uso único), não na sessão nem em cache local. Assim funciona com vários
  workers do gunicorn e com o callback indo direto para `:8000`.
- **Callback:** valida o state, troca o código (passando `code`, e não a URL, para o
  oauthlib não recusar o `http://localhost`), exige `drive.readonly` entre os escopos
  concedidos (o consentimento granular permite desmarcar) e exige o refresh token.
- **Erros do Google** voltam como **409** com `code` (`google_not_connected`,
  `google_reconnect_required`…), nunca 401: o 401 é reservado para a sessão JWT, e o
  frontend tenta um refresh quando recebe 401.
- **Renovação:** o token é renovado 5 minutos antes de expirar. Tokens renovados pela
  própria lib durante uma importação são persistidos ao final. Se o Google recusar o
  refresh token, `needs_reconnect=True` e a UI mostra "Reconectar Google".
- **Desconectar** revoga o token no Google (best-effort) e apaga a credencial local.

### 10. Cliente do Drive somente leitura

`apps/drive/client.py` é o **único** módulo que importa `googleapiclient`, e só expõe
`files.list`, `files.get` (metadados) e `about.get`. Retentativas:

| Situação | Ação |
| --- | --- |
| 429, 5xx, 403 `rateLimitExceeded`/`userRateLimitExceeded`, erro de rede | até 5 retentativas com backoff exponencial (1, 2, 4, 8, 16 s) + jitter |
| 401 | renova o token uma vez e repete |
| 404 / 403 | `DriveNotFound` / `DriveAccessDenied` (sem retentar) |
| 403 `accessNotConfigured` | `DriveApiDisabled` (API não ativada no projeto) |

### 11. Importação e sincronização (Fase 3)

- **Duas etapas:** (1) a *varredura* (`scanner.py`) lê o Drive inteiro para a memória,
  sem tocar no banco; (2) a *aplicação* (`sync.py`) grava tudo numa única transação.
  Se o Drive falhar no meio, nada fica pela metade.
- **Mapeamento:** raiz → curso; subpastas de 1º nível → módulos; pastas mais profundas
  entram no módulo pai, com o título prefixado pelo caminho (`Extras / Bônus`); vídeos
  soltos na raiz → módulo "Geral" (identificado pelo id da própria raiz); demais arquivos
  → anexos (da aula, quando o nome bate com o do vídeo na mesma pasta).
- **Atalhos** do Drive são seguidos (vale o id do alvo, que é o que o embed precisa).
  Ciclos são ignorados e pastas atalho sem acesso são puladas sem derrubar a importação.
- **Vídeo** = `mimeType` `video/*`, ou `application/octet-stream` com extensão de vídeo
  (alguns `.mkv` chegam assim).
- **Ordenação natural** sem acentos e sem diferenciar maiúsculas: `Aula 2` < `Aula 10`,
  `1.2` < `1.10`.
- **Limpeza de títulos** (opcional, por curso) é conservadora: remove extensão e
  underscores e colapsa `01 - 01 - X` em `01 - X`, mas mantém `1.1 X` e `10 - 10 Anos`.
- **Idempotência:** tudo casa por id do Drive. Títulos editados (`title_is_custom`) não
  são sobrescritos, mas `drive_name_original` é sempre atualizado. Aulas **nunca são
  apagadas**: as que somem ficam com `missing_in_drive=True` e vão para o fim do módulo;
  progresso e anotações ficam intactos; se o arquivo voltar, a marca sai. Se o vídeo
  mudou de pasta no Drive, a aula muda de módulo e mantém o mesmo id e progresso. Anexos
  não guardam dados do usuário e são removidos quando somem.
- **Ordem personalizada:** os flags `modules_order_is_custom` e `lessons_order_is_custom`
  (definidos pela tela de organização, na Fase 6) fazem a sincronização manter a ordem
  existente e só acrescentar os itens novos no fim.
- **Jobs:** `ImportJob` registra status, contadores e estatísticas, e roda numa
  `threading.Thread` (sem Celery). O frontend consulta o status a cada 1,5 s. Um job
  "rodando" sem atualização há 10 minutos (servidor reiniciado, por exemplo) é marcado
  como falho e libera nova sincronização. Só um job ativo por curso.
- **Progresso agregado** conta apenas aulas visíveis, em módulos visíveis e presentes no
  Drive.

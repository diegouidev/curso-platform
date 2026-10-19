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

### 12. Player e progresso (Fase 4)

- **Player:** iframe do embed oficial (`/file/d/<id>/preview`), 16:9, `allow="autoplay;
  fullscreen"`. O vídeo nunca passa pelo backend. O iframe é de outra origem, então o
  evento `load` dispara mesmo quando o Google mostra erro ou tela de login: **não dá para
  saber se o vídeo carregou**. Por isso o link "O vídeo não carrega?" fica sempre visível
  e vira um alerta se o `load` não acontecer em 20 s. A ajuda cobre conta errada, várias
  contas abertas, cookies de terceiros (Safari/Chrome/Firefox) e vídeo recém-enviado. O
  "Abrir no Drive" usa `?authuser=<e-mail conectado>` para o Google escolher a conta certa
  numa aba nova.
- **`GET /api/lessons/{id}` não tem efeito colateral.** "Última aula aberta" é gravada
  pelo primeiro heartbeat (`seconds=0`), enviado quando a página abre. Assim o prefetch da
  anterior e da próxima não conta como abrir.
- **Navegação:** anterior/próxima atravessam módulos e pulam aulas ocultas, de módulos
  ocultos ou fora do Drive. Uma aula fora da lista (aberta por link direto) tem
  `position=null`, mas ainda recebe as vizinhas mais próximas.
- **Tempo na página:** só conta com a aba visível (Page Visibility API), com base em
  timestamps (não em ticks do timer, que o navegador atrasa). O cliente envia a cada 15 s
  e também ao esconder a aba, sair da página ou trocar de aula, usando `fetch` com
  `keepalive` (o `sendBeacon` não envia o header `Authorization`). O servidor limita cada
  heartbeat a 60 s.
- **StudySession:** cada heartbeat estende a última sessão da aula se ela terminou há
  menos de 2 min; senão abre outra. `seconds` guarda só o tempo visível. É a base das
  estatísticas (sequência de dias, tempo por semana).
- **Conclusão:** `POST`/`DELETE /api/lessons/{id}/complete`, idempotentes (concluir duas
  vezes mantém o primeiro `completed_at`). O frontend atualiza de forma otimista e
  oferece "Desfazer" no toast. Depois de concluir, a ação principal passa a ser "Próxima".
- **Sugestão de conclusão:** com a preferência ligada e a duração conhecida, quando o
  tempo na página (gravado + não enviado) passa de X% da duração, aparece um toast
  "Marcar como concluída?". Uma vez por visita, nunca marca sozinho. As preferências
  (`StudyPreferences`, registro único) ficam no backend para entrar no backup.
- **Continuar de onde parei** (`GET /api/continue[?course=<id>]`): (1) a última aula
  aberta, se não concluída; (2) se já concluída, a próxima não concluída depois dela no
  curso; (3) a aberta mais recente não concluída; (4) nada aberto: a primeira não
  concluída do curso mais recente. Cursos arquivados ficam de fora, a menos que sejam
  pedidos explicitamente.
- **Atalhos:** `M` concluir/desfazer, `N` próxima, `P` anterior, `F` tela cheia
  (`requestFullscreen` no iframe), `S` modo foco. São ignorados ao digitar, com
  Ctrl/Alt/Meta e dentro de diálogos. Limitação: depois de clicar no vídeo, o foco fica
  dentro do iframe do Drive e as teclas vão para o player do Google.
- **Modo foco** (sidebar escondida) é lembrado no `localStorage`. No celular, a lista de
  aulas vira uma gaveta (`Sheet`).

### 13. Anotações, busca e estatísticas (Fase 5)

- **Anotações:** uma por aula (`GET/PUT /api/lessons/{id}/note`, upsert). Editor com abas
  Escrever/Visualizar; o preview usa `react-markdown` + GFM, que **não renderiza HTML
  cru**, então uma anotação não injeta markup. Salvamento automático com debounce de
  800 ms, serializado numa fila (sempre vence o texto mais recente, mesmo com respostas
  fora de ordem), `Ctrl+S` salva na hora e, ao sair da página ou trocar de aula, o
  pendente vai com `keepalive` (até 60 mil caracteres: o navegador limita o corpo de
  uma requisição `keepalive` a 64 KiB).
- **Busca (`Ctrl+K`/`⌘K`):** `GET /api/search?q=` procura em títulos de cursos (e
  descrição), títulos de aulas (e do módulo) e no texto das anotações. A comparação é
  feita em Python sobre texto sem acentos e sem maiúsculas (`unicodedata` + `casefold`),
  porque o `LIKE` do SQLite só ignora maiúsculas em ASCII. Todas as palavras precisam
  aparecer. Aulas ocultas e de módulos ocultos ficam de fora; o título que começa com a
  busca vem primeiro. Para anotações, a API devolve um trecho cortado em palavras e o
  deslocamento do termo, que o frontend destaca com `<mark>`. Para uma biblioteca
  pessoal (milhares de linhas), varrer tudo por requisição é rápido o bastante.
- **Estatísticas (`GET /api/stats`):** calculadas por **dia local** (`TIME_ZONE`). Um dia
  conta para a sequência com pelo menos 1 minuto em páginas de aula ou uma conclusão.
  A sequência atual sobrevive até o fim do dia seguinte ao último dia estudado (não zera
  de manhã antes de estudar). A semana começa na segunda-feira. O tempo total vem de
  `LessonProgress.time_on_page_seconds`; o tempo por dia, das `StudySession`.
- **Dashboard:** card "Continuar assistindo" em destaque, depois a linha de 3 indicadores
  (concluídas na semana, sequência, tempo de estudo com barras dos últimos 7 dias, hoje
  destacado, tooltip no hover e lista equivalente para leitores de tela) e a grade de
  cursos. Se as estatísticas falharem, elas somem e o resto da página continua.
- **Layout:** grids de uma coluna usam `grid-cols-1` (`minmax(0, 1fr)`). Uma trilha
  `auto` cresce até a largura mínima de textos com `truncate` (sem quebra) e empurra a
  coluna para baixo da sidebar.

# Curso Platform

Plataforma pessoal para assistir aulas que estão num Google Drive de outra pessoa (com acesso
**somente leitura**) e registrar o que o Drive não oferece: aulas concluídas, onde parei,
tempo de estudo e anotações.

- Os vídeos tocam pelo **player oficial do Drive** (`/file/d/<id>/preview`): nada é baixado,
  copiado ou alterado no Drive. O acesso usa só o escopo `drive.readonly`.
- Uso pessoal: um único usuário, sem cadastro.

| Parte | Tecnologia | Pasta |
| --- | --- | --- |
| API | Python 3.12, Django 5.2, DRF, SQLite, JWT | [backend/](backend/) |
| Interface | Next.js 15, TypeScript, Tailwind, shadcn/ui, TanStack Query | [frontend/](frontend/) |
| Testes E2E | Playwright + axe-core, com Google Drive simulado | [e2e/](e2e/) |
| Documentação | Arquitetura e decisões, guia do Google | [docs/](docs/) |

## O que dá para fazer

- **Importar um curso** colando o link da pasta do Drive. Subpastas viram módulos, vídeos viram
  aulas (em ordem natural: `Aula 2` antes de `Aula 10`), PDFs e Docs viram materiais.
  **Sincronizar** traz o que o dono adicionou, sem apagar seu progresso nem suas anotações.
- **Assistir** com a lista de aulas ao lado, concluir/desfazer, anterior/próxima, modo foco e
  atalhos: `M` concluir · `N` próxima · `P` anterior · `F` tela cheia · `S` modo foco.
- **Continuar de onde parou**, com sugestão de conclusão quando o tempo na página passa de X%
  da duração (o Drive não informa quanto do vídeo foi assistido).
- **Anotações** em Markdown por aula, salvas sozinhas.
- **Busca** (`Ctrl+K`) em cursos, aulas e no texto das anotações, sem se importar com acentos.
- **Dashboard** com o que continuar, aulas concluídas na semana, sequência de dias e tempo de
  estudo.
- **Organizar**: renomear, reordenar arrastando e ocultar módulos e aulas; capa e descrição do
  curso; arquivar.
- **Backup**: exportar progresso e anotações (JSON) ou só as anotações (Markdown) e importar
  de volta.

---

## Instalação no Windows com WSL (recomendado)

Os comandos abaixo rodam no terminal do **Ubuntu (WSL)**, exceto o primeiro.

### 1. Instalar o WSL com Ubuntu

No **PowerShell como administrador** (depois reinicie o computador se ele pedir):

```powershell
wsl --install -d Ubuntu-24.04
```

Abra o "Ubuntu" no menu Iniciar e crie seu usuário Linux.

### 2. Instalar as dependências do sistema

```bash
sudo apt update && sudo apt install -y git make python3.12 python3.12-venv
```

Node.js 20 e pnpm:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
```

```bash
sudo corepack enable
```

Docker (opcional para desenvolver, obrigatório para `make up` e `make e2e`): instale o
[Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) no Windows e
ative **Settings → Resources → WSL integration → Ubuntu-24.04**. Confira no Ubuntu:

```bash
docker compose version
```

### 3. Baixar o projeto

Clone dentro do Linux (`~`), não em `/mnt/c/...`: o acesso ao disco do Windows pelo WSL é
muito mais lento.

```bash
git clone https://github.com/diegouidev/curso-platform.git ~/curso-platform && cd ~/curso-platform
```

### 4. Instalar as dependências do projeto e criar o `.env`

```bash
make setup
```

Gere a chave que criptografa os tokens do Google e cole em `FIELD_ENCRYPTION_KEY` no `.env`:

```bash
backend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 5. Configurar o acesso ao Google Drive

Siga [docs/google-oauth.md](docs/google-oauth.md) (uma vez só): criar o projeto no Google
Cloud, ativar a Drive API, colocar seu e-mail como usuário de teste e criar a credencial
OAuth. Depois preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`.

### 6. Criar o banco e o seu usuário

```bash
make migrate
```

```bash
make createsuperuser
```

### 7. Rodar

```bash
make dev
```

Abra **http://localhost:3000** no navegador do Windows (o WSL repassa o `localhost`). Entre
com o usuário criado, vá em **Configuração inicial**, conecte o Google e cole o link da pasta
do curso.

> O vídeo toca com a sessão do Google **do seu navegador**. Ele precisa estar logado na mesma
> conta que tem acesso à pasta. Se não carregar, use "O vídeo não carrega?" abaixo do player.

---

## Com Docker

Sobe backend e frontend em modo de produção. O banco fica no volume `sqlite_data`.

```bash
make up
```

```bash
make docker-createsuperuser
```

Para atualizar depois de mudar o código ou o `.env`, rode `make up` de novo. **Espere
importações e sincronizações terminarem antes**: reiniciar o backend interrompe uma
importação em andamento (ela pode ser repetida em seguida pelo botão Sincronizar).

Sem `make` (por exemplo, no PowerShell do Windows), use os comandos equivalentes:

```powershell
docker compose up -d --build
```

```powershell
docker compose exec backend python manage.py createsuperuser
```

Mudou o `.env`? `restart` não relê o arquivo; recrie o container:

```bash
docker compose up -d --force-recreate backend
```

---

## Testes

| Comando | O que roda |
| --- | --- |
| `make test` | pytest do backend (Google Drive sempre simulado) e type-check do frontend |
| `make lint` | ruff, black, ESLint e Prettier, sem alterar nada |
| `make e2e` | Playwright em Docker contra builds de produção, com Drive simulado e banco descartável |

`make e2e` sobe um stack separado (projeto `curso-platform-e2e`, sem portas expostas), então
não mexe nos seus containers nem nos seus dados. Ele cobre login, importação, player
(concluir, desfazer, atalhos, sugestão de conclusão, continuar), anotações e busca,
organização, configurações e backup, a versão para celular e uma varredura de acessibilidade
(WCAG 2.1 AA, temas claro e escuro). Relatório: `e2e/playwright-report/index.html`.

## Comandos úteis

| Comando | O que faz |
| --- | --- |
| `make dev` | backend (:8000) e frontend (:3000) juntos; Ctrl+C para os dois |
| `make migrate` | aplica as migrações do banco |
| `make fmt` | corrige lint e formatação |
| `make schema` | regenera o OpenAPI e o cliente TypeScript |
| `make lock` | atualiza as versões travadas do Python |
| `make logs` | segue os logs do Docker Compose |
| `make help` | lista todos os alvos |

## Solução de problemas

| Problema | O que fazer |
| --- | --- |
| O vídeo não carrega | Navegador logado em outra conta Google, várias contas abertas ou cookies de terceiros bloqueados (Safari). Veja "O vídeo não carrega?" abaixo do player. |
| Aparece "Reconectar Google" | No modo de teste do Google Cloud o acesso expira a cada 7 dias. Clique em Reconectar ([detalhes](docs/google-oauth.md)). |
| A importação ficou parada | Se o backend reiniciou no meio, a importação é marcada como interrompida em até 10 minutos. Depois clique em **Sincronizar**. |
| `Port 3000/8000 is already in use` | Pare o outro processo ou o `make dev` que ficou aberto (`make down` para o Docker). |
| Tudo muito lento no WSL | O projeto está em `/mnt/c/...`. Clone dentro do Linux (`~/`). |

## Documentação

- [docs/architecture.md](docs/architecture.md): arquitetura e decisões de cada fase.
- [docs/google-oauth.md](docs/google-oauth.md): passo a passo do Google Cloud Console.

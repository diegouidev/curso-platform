# Curso Platform

Plataforma pessoal para assistir aulas que estão num Google Drive compartilhado comigo
(somente leitura) e registrar progresso e anotações.

- **Backend:** Django 5.2 + DRF, SQLite, JWT ([backend/](backend/))
- **Frontend:** Next.js 15 + Tailwind + shadcn/ui ([frontend/](frontend/))
- **Docs:** [docs/architecture.md](docs/architecture.md)

## Pré-requisitos (WSL / Ubuntu)

- Python 3.12, Node 20+, pnpm 9+, `make`
- Docker (opcional)

```bash
sudo apt update && sudo apt install -y make python3.12-venv
```

## Primeira execução (sem Docker)

1. Instalar as dependências e criar o `.env`:

   ```bash
   make setup
   ```

2. Gerar a chave de criptografia e colocar em `FIELD_ENCRYPTION_KEY` no `.env`:

   ```bash
   backend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

3. Criar o banco:

   ```bash
   make migrate
   ```

4. Criar o usuário de login (único):

   ```bash
   make createsuperuser
   ```

5. Subir backend e frontend:

   ```bash
   make dev
   ```

Acesse http://localhost:3000.

## Com Docker

```bash
make up
```

```bash
make docker-createsuperuser
```

O SQLite fica no volume `sqlite_data`.

## Comandos úteis

| Comando        | O que faz                                        |
| -------------- | ------------------------------------------------ |
| `make test`    | pytest + type-check do frontend                  |
| `make lint`    | ruff, black, eslint e prettier (sem alterar nada)|
| `make fmt`     | corrige lint e formatação                        |
| `make schema`  | regenera o OpenAPI e o cliente TypeScript        |
| `make lock`    | atualiza as versões travadas do Python           |
| `make help`    | lista todos os alvos                             |

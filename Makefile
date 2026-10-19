SHELL := /bin/bash
.DEFAULT_GOAL := help

PY      := backend/.venv/bin/python
PIP     := backend/.venv/bin/pip
MANAGE  := cd backend && .venv/bin/python manage.py
PNPM    := pnpm --dir frontend

.PHONY: help
help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# --- Setup -------------------------------------------------------------------
.PHONY: setup
setup: .env backend/.venv ## Install backend + frontend deps and git hooks
	$(PIP) install -q -r backend/requirements.txt -r backend/requirements-dev.txt
	$(PNPM) install
	backend/.venv/bin/pre-commit install

.env:
	cp .env.example .env
	@sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')|" .env
	@echo ".env criado. Gere FIELD_ENCRYPTION_KEY depois do 'make setup' (veja o comentário no arquivo)."

backend/.venv:
	python3 -m venv backend/.venv
	$(PIP) install -q --upgrade pip pip-tools

.PHONY: lock
lock: ## Re-pin backend dependencies (pip-tools)
	cd backend && .venv/bin/pip-compile -q --strip-extras requirements.in -o requirements.txt
	cd backend && .venv/bin/pip-compile -q --strip-extras requirements-dev.in -o requirements-dev.txt

# --- Development (no Docker) ----------------------------------------------------
.PHONY: dev
dev: ## Run backend (:8000) and frontend (:3000) together; Ctrl+C stops both
	@trap 'kill 0' INT TERM EXIT; \
	  ($(MANAGE) runserver 8000) & \
	  ($(PNPM) dev) & \
	  wait

.PHONY: dev-backend
dev-backend: ## Run only the Django dev server
	$(MANAGE) runserver 8000

.PHONY: dev-frontend
dev-frontend: ## Run only the Next.js dev server
	$(PNPM) dev

.PHONY: migrate
migrate: ## Apply database migrations
	$(MANAGE) migrate

.PHONY: makemigrations
makemigrations: ## Create new migrations
	$(MANAGE) makemigrations

.PHONY: createsuperuser
createsuperuser: ## Create the single login user
	$(MANAGE) createsuperuser

.PHONY: schema
schema: ## Export OpenAPI schema and regenerate the TypeScript client
	$(MANAGE) spectacular --validate --fail-on-warn --file ../frontend/openapi.yml
	$(PNPM) gen:api

# --- Quality -------------------------------------------------------------------
.PHONY: test
test: test-backend test-frontend ## Run all tests

.PHONY: test-backend
test-backend: ## Run pytest
	cd backend && .venv/bin/pytest

.PHONY: test-frontend
test-frontend: ## Type-check the frontend (E2E tests arrive in phase 7)
	$(PNPM) typecheck

.PHONY: lint
lint: ## Lint and check formatting (no changes)
	cd backend && .venv/bin/ruff check . && .venv/bin/black --check .
	$(PNPM) lint
	$(PNPM) format:check

.PHONY: fmt
fmt: ## Auto-fix lint and formatting
	cd backend && .venv/bin/ruff check --fix . && .venv/bin/black .
	$(PNPM) lint --fix
	$(PNPM) format

# --- Docker ----------------------------------------------------------------------
.PHONY: up
up: ## Build and start with Docker Compose
	docker compose up -d --build

.PHONY: down
down: ## Stop Docker Compose services
	docker compose down

.PHONY: logs
logs: ## Follow Docker Compose logs
	docker compose logs -f

.PHONY: docker-createsuperuser
docker-createsuperuser: ## Create the login user inside the backend container
	docker compose exec backend python manage.py createsuperuser

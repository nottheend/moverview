# ── Firefly Dashboard — Makefile ──────────────────────────────────────────────
#
# Copy .env.example → .env and fill in your values before starting.
#
# Typical workflow:
#   make dev          ← local development (no Docker needed)
#   make build        ← build Docker image locally
#   make push         ← push to your Cloudron registry
#   make deploy       ← first install on Cloudron
#   make update       ← re-deploy after code changes
#   make logs         ← tail live logs from Cloudron
#

-include .env
export

# ── Config (override in .env) ─────────────────────────────────────────────────
#
# CLOUDRON_REGISTRY: your Cloudron's built-in Docker registry.
# Find it in: Cloudron Admin → App Store → (top right gear icon) → Registry
# It will look like: registry.your-cloudron.example.com
#
# Login once:   make login
# Then deploy:  make release && make deploy   (first time)
#               make release && make update   (after that)
#

IMAGE_NAME        ?= firefly-dashboard
CLOUDRON_REGISTRY ?= registry.your-cloudron.example.com
IMAGE             ?= $(CLOUDRON_REGISTRY)/$(IMAGE_NAME)
VERSION           ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
CLOUDRON_APP      ?= firefly-ui
CLOUDRON_HOST     ?= your-cloudron.example.com

# ── Dev ───────────────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Start backend + frontend in parallel (requires Node 20+)
	@echo "Starting dev servers — backend :3000, frontend :5173"
	@trap 'kill 0' INT; \
	  (cd server && npm install --silent && node index.js) & \
	  (cd client && npm install --silent && npm run dev) & \
	  wait

.PHONY: install-deps
install-deps: ## Install all npm dependencies
	cd server && npm install
	cd client && npm install

# ── Docker ────────────────────────────────────────────────────────────────────

.PHONY: login
login: ## Login to your Cloudron's Docker registry (do this once per machine)
	@echo "Use your Cloudron admin username + password:"
	docker login $(CLOUDRON_REGISTRY)

.PHONY: build
build: ## Build Docker image locally
	docker build --build-arg APP_VERSION=$(VERSION) -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .
	@echo "Built: $(IMAGE):$(VERSION)"

.PHONY: push
push: ## Push image to Cloudron registry
	docker push $(IMAGE):$(VERSION)
	docker push $(IMAGE):latest
	@echo "Pushed: $(IMAGE):$(VERSION)"

.PHONY: release
release: build push ## Build + push in one step (most common command)

# ── Cloudron ──────────────────────────────────────────────────────────────────

.PHONY: deploy
deploy: ## First-time install on Cloudron
	cloudron install \
	  --image $(IMAGE):$(VERSION) \
	  --location $(CLOUDRON_APP) \
	  --env FIREFLY_BASE_URL=$(FIREFLY_BASE_URL) FIREFLY_TOKEN=$(FIREFLY_TOKEN)

.PHONY: update
update: ## Update existing Cloudron app to latest image
	cloudron update \
	  --image $(IMAGE):$(VERSION) \
	  --app $(CLOUDRON_APP)

.PHONY: logs
logs: ## Tail logs from the running Cloudron app
	cloudron logs -f --app $(CLOUDRON_APP)

.PHONY: restart
restart: ## Restart the Cloudron app
	cloudron restart --app $(CLOUDRON_APP)

# ── Util ──────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

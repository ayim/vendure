# Overwatch Vendure demo deployment

This deployment runs a real Vendure API, the official Vendure Next.js storefront,
PostgreSQL, and Caddy on a single small Linux host. The API exports Vendure's native
OpenTelemetry traces and logs to New Relic. The storefront captures explicit PostHog
events for authentication, product/cart, checkout, and order-completion paths.

## Configure

Copy the repository root `.env.example` to `.env` and fill every `replace_me` value.
The real `.env` is ignored by Git.

The host must allow inbound TCP port 80. Docker Engine with the Compose plugin is
the only runtime prerequisite.

## Deploy

From the repository root:

```bash
APP_VERSION="$(git rev-parse --short HEAD)" \
  docker compose --env-file .env -f deploy/vendure-demo/compose.yml up -d --build
```

Verify:

```bash
curl --fail "$PUBLIC_URL/health"
docker compose --env-file .env -f deploy/vendure-demo/compose.yml ps
```

The initial seed job is idempotent: it skips product import once products exist.

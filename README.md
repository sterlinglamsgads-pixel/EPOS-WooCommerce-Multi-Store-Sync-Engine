# EPOS ↔ WooCommerce Multi-Store Sync Engine

Production-grade product synchronization between **EPOS Now** and **WooCommerce** for a multi-store business. Supports real-time webhooks, scheduled sync, queue-based processing with BullMQ, and independent per-store configuration.

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Setup Guide](#setup-guide)
- [Configuration](#configuration)
- [Running the System](#running-the-system)
- [API Reference](#api-reference)
- [Webhook Endpoints](#webhook-endpoints)
- [Project Structure](#project-structure)
- [Module Reference](#module-reference)
- [Database Schema](#database-schema)
- [Sync Flow](#sync-flow)

---

## Features

- **Multi-store** — each store syncs independently with its own WooCommerce instance
- **Queue-driven** — BullMQ with Redis for reliable, concurrent job processing
- **Real-time webhooks** — instant sync on product changes from WooCommerce or EPOS
- **Scheduled sync** — configurable cron interval (default every 10 minutes)
- **Batch updates** — WooCommerce batch API (up to 100 products per request)
- **Smart matching** — products matched by SKU → Barcode → Name (priority order)
- **Retry with back-off** — exponential retry (3 attempts); permanent failures (HTTP 400) skip retry
- **Dry-run mode** — preview all changes without writing to WooCommerce
- **Redis caching** — product lookups cached with 5-minute TTL
- **Sync direction** — configurable per store: `EPOS_TO_WOO`, `WOO_TO_EPOS`, `BIDIRECTIONAL`
- **API key auth** — protect admin routes with `X-API-Key` header
- **Webhook signature verification** — HMAC-SHA256 validation for both WooCommerce and EPOS
- **Detailed logging** — per-product logs to file and database; per-run aggregate stats

---

## Architecture Overview

```
┌──────────┐   cron / API / webhook
│  Express │ ─────────────────────────┐
│  Server  │                          ▼
└──────────┘                  ┌──────────────┐
                              │  BullMQ Queue │  (Redis)
                              └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
             sync-all-stores   sync-store       sync-product
                    │                │                │
                    │    ┌───────────┴──────────┐     │
                    │    │  EPOS API   WOO API  │     │
                    │    └───────────┬──────────┘     │
                    │                ▼                 │
                    │          Match & Diff            │
                    │                │                 │
                    │         Batch Update ────────────┘
                    │                │
                    ▼                ▼
               ┌─────────┐   ┌───────────┐
               │  MySQL   │   │   Redis   │
               │ (state)  │   │  (cache)  │
               └─────────┘   └───────────┘
```

---

## Prerequisites

- **Node.js** >= 16
- **MySQL** >= 5.7 (or MariaDB >= 10.3)
- **Redis** >= 6
- EPOS Now account with API access (v4 token)
- One or more WooCommerce stores with REST API credentials

---

## Setup Guide

### 1. Clone & install

```bash
git clone <repo-url>
cd epos-woo-sync
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Configuration](#configuration)).

### 3. Start Redis

```bash
# Linux / macOS
redis-server

# Windows (WSL or Docker)
docker run -d -p 6379:6379 redis:7-alpine
```

### 4. Initialize the database

```bash
npm run db:init
```

Creates the `epos_woo_sync` database and all tables.

### 5. Add your stores

Use the API to register each store:

```bash
curl -X POST http://localhost:3000/api/stores \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key_here" \
  -d '{
    "name": "Main Street Store",
    "epos_branch_id": "branch_001",
    "woo_url": "https://mainstreet.com/wp-json/wc/v3",
    "woo_key": "ck_...",
    "woo_secret": "cs_...",
    "sync_direction": "EPOS_TO_WOO"
  }'
```

Repeat for each store.

### 6. Start the system

You need **two processes** running:

```bash
# Terminal 1 — Express server + cron scheduler
npm start

# Terminal 2 — BullMQ worker (processes queued jobs)
npm run worker
```

---

## Configuration

All configuration via `.env`:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Express server port | `3000` |
| `API_KEY` | API key for admin route authentication | _(open if unset)_ |
| `EPOS_API_URL` | Default EPOS Now API base URL | `https://api.eposnowhq.com/api/v4` |
| `EPOS_API_TOKEN` | Default EPOS Now API token | — |
| `DB_HOST` | MySQL host | `127.0.0.1` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `root` |
| `DB_PASSWORD` | MySQL password | — |
| `DB_NAME` | Database name | `epos_woo_sync` |
| `REDIS_HOST` | Redis host | `127.0.0.1` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | _(none)_ |
| `SYNC_DIRECTION` | Default sync direction | `EPOS_TO_WOO` |
| `SYNC_INTERVAL_MINUTES` | Cron interval | `10` |
| `BATCH_SIZE` | Products per WooCommerce batch | `20` |
| `DRY_RUN` | Disable WooCommerce writes | `false` |
| `WEBHOOK_SECRET` | EPOS webhook HMAC secret | _(skip verification)_ |
| `WOO_WEBHOOK_SECRET` | WooCommerce webhook HMAC secret | _(skip verification)_ |
| `LOG_DIR` | Log file directory | `./logs` |
| `LOG_LEVEL` | `info` or `debug` | `info` |

Per-store EPOS API URL and token can be overridden in the `stores` table. WooCommerce credentials are always per-store.

---

## Running the System

| Script | Command | Description |
|---|---|---|
| `start` | `npm start` | Express server + cron scheduler |
| `worker` | `npm run worker` | BullMQ worker process |
| `sync:once` | `npm run sync:once` | One-shot sync of all stores, then exit |
| `sync:dry` | `npm run sync:dry` | Dry-run sync (no WooCommerce writes) |
| `db:init` | `npm run db:init` | Initialize database schema |

Sync a single store: `node src/run-once.js <storeId>`

---

## API Reference

All `/api/*` routes require `X-API-Key` header (if `API_KEY` is set).

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{ status, uptime }` |

### Stores

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stores` | List all stores (credentials stripped) |
| `POST` | `/api/stores` | Create a new store |
| `GET` | `/api/stores/:id` | Get store details |
| `PUT` | `/api/stores/:id` | Update store config |

**POST /api/stores** body:

```json
{
  "name": "Store Name",
  "epos_branch_id": "branch_001",
  "woo_url": "https://example.com/wp-json/wc/v3",
  "woo_key": "ck_...",
  "woo_secret": "cs_...",
  "sync_direction": "EPOS_TO_WOO"
}
```

### Sync

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sync/status` | Last 20 sync runs. Filter: `?store_id=1` |
| `GET` | `/api/sync/logs` | Sync logs. Filter: `?store_id=1&status=failed&limit=100` |
| `GET` | `/api/sync/queue` | BullMQ queue job counts |
| `POST` | `/api/sync/trigger` | Queue sync for all active stores |
| `POST` | `/api/sync/trigger/:storeId` | Queue sync for a specific store |

---

## Webhook Endpoints

Webhook routes do **not** require API key auth (they use signature verification).

| Method | Path | Trigger |
|---|---|---|
| `POST` | `/webhooks/woo/:storeId/product-updated` | WooCommerce product update |
| `POST` | `/webhooks/epos/:storeId/product-updated` | EPOS Now product update |

Configure your WooCommerce webhook to point to:
```
https://your-server.com/webhooks/woo/1/product-updated
```

---

## Project Structure

```
epos-woo-sync/
├── .env.example
├── package.json
├── logs/                         # Daily log files (auto-created)
└── src/
    ├── app.js                    # Express server + bootstrap
    ├── run-once.js               # One-shot sync runner
    ├── config/
    │   ├── index.js              # Central env config
    │   └── redis.js              # Redis connection config
    ├── cron/
    │   └── sync.job.js           # Cron scheduler → queues jobs
    ├── db/
    │   ├── db.js                 # MySQL connection pool
    │   ├── init.js               # Schema initializer
    │   └── schema.sql            # DDL for all tables
    ├── middleware/
    │   └── auth.js               # API key middleware
    ├── routes/
    │   ├── api.routes.js         # Admin / status / trigger routes
    │   └── webhook.routes.js     # Webhook routes
    ├── services/
    │   ├── epos.service.js       # EPOS Now API client (per-store)
    │   └── woo.service.js        # WooCommerce API client (per-store)
    ├── sync/
    │   ├── sync.engine.js        # Core sync orchestrator
    │   ├── sync.queue.js         # BullMQ queue + job producers
    │   └── sync.worker.js        # BullMQ worker process
    ├── utils/
    │   ├── cache.js              # Redis cache helper
    │   ├── logger.js             # File + console logging
    │   ├── matcher.js            # Product matching (SKU/barcode/name)
    │   └── sku.util.js           # SKU normalization
    └── webhooks/
        ├── epos.webhook.js       # EPOS webhook handler
        └── woo.webhook.js        # WooCommerce webhook handler
```

---

## Module Reference

### Sync Engine (`sync/sync.engine.js`)

| Function | Description |
|---|---|
| `syncAllStores()` | Fetches all active stores, queues a `sync-store` job for each. |
| `syncStore(storeId, { dryRun })` | Full sync cycle for one store: fetch → match → diff → batch update → log. Returns `{ total, synced, created, failed, skipped }`. |
| `syncProduct(data)` | Sync a single product (create or update). Used by the worker for individual retries. Throws `UnrecoverableError` on HTTP 400 to prevent BullMQ retry. |
| `syncProductFromWebhook(data)` | Handle incoming webhook events. Routes to appropriate sync based on `source` and store `sync_direction`. |
| `getActiveStores()` | Returns all stores with `is_active = 1`. |
| `getStore(storeId)` | Returns a single store row by ID. |

### Sync Queue (`sync/sync.queue.js`)

| Function | Description |
|---|---|
| `addSyncAllStoresJob()` | Enqueue a fan-out job that triggers all stores. |
| `addSyncStoreJob(storeId)` | Enqueue a sync for one store. |
| `addSyncProductJob(data)` | Enqueue a single product sync (create/update retry). |
| `addWebhookSyncJob(data)` | Enqueue a webhook-triggered sync (priority 1). |

All jobs: 3 attempts, exponential back-off (2s base), auto-cleanup.

### Sync Worker (`sync/sync.worker.js`)

BullMQ worker with concurrency 5. Handles job types: `sync-all-stores`, `sync-store`, `sync-product`, `webhook-sync`. Run as a separate process: `npm run worker`.

### EPOS Service (`services/epos.service.js`)

| Function | Description |
|---|---|
| `fetchAllProducts(store)` | Paginated fetch of all EPOS products (200/page, cached 5min). |
| `normalizeProduct(raw)` | Transforms raw EPOS object → `{ eposId, name, sku, barcode, price, stock }`. |

### WooCommerce Service (`services/woo.service.js`)

| Function | Description |
|---|---|
| `fetchAllProducts(store)` | Paginated fetch of all WooCommerce products (50/page, cached 5min). |
| `updateProduct(store, wooId, data)` | Update a single product. |
| `batchUpdate(store, updates)` | Batch update products (auto-chunked to 100). |
| `createProduct(store, data)` | Create a new WooCommerce product. |
| `findBySku(store, sku)` | Look up a product by SKU. |

### Product Matcher (`utils/matcher.js`)

| Function | Description |
|---|---|
| `matchProducts(eposProducts, wooProducts)` | Matches products by: 1) normalized SKU, 2) barcode, 3) exact name. Returns `{ matched: [{ epos, woo, method }], unmatched }`. Prevents duplicate matches. |

### SKU Utility (`utils/sku.util.js`)

| Function | Description |
|---|---|
| `normalize(sku)` | Strips dashes, spaces, dots, slashes; lowercases. `"303-2281"` → `"3032281"`. |
| `match(skuA, skuB)` | Returns `true` if normalized SKUs are equal and non-empty. |

### Cache (`utils/cache.js`)

| Function | Description |
|---|---|
| `get(key)` | JSON-parsed Redis GET. Returns `null` on miss or error. |
| `set(key, value, ttl)` | JSON-serialized Redis SET with TTL (default 300s). |
| `del(key)` | Delete a cache key. |
| `invalidateStore(storeId)` | Delete all keys matching `store:{storeId}:*`. |
| `close()` | Quit the Redis client. |

### Logger (`utils/logger.js`)

`info(msg)`, `warn(msg)`, `error(msg)`, `debug(msg)` — writes to console and daily log file `sync-YYYY-MM-DD.log`.

### Auth Middleware (`middleware/auth.js`)

`apiKeyAuth` — validates `X-API-Key` header against `API_KEY` env var. Skipped if `API_KEY` is not set.

### Database (`db/db.js`)

| Function | Description |
|---|---|
| `query(sql, params)` | Execute parameterized query, return rows. |
| `insertAndGetId(sql, params)` | Execute INSERT, return `insertId`. |
| `close()` | Close the connection pool. |

---

## Database Schema

| Table | Purpose |
|---|---|
| `stores` | Store config: name, EPOS branch ID, WooCommerce credentials, sync direction, active flag. |
| `product_mappings` | Per-store EPOS ↔ WooCommerce product links. Unique on `(store_id, epos_product_id)`. Tracks match method. |
| `sync_logs` | Append-only log of every sync action per product (success/failed/skipped). |
| `sync_runs` | One row per store sync invocation with aggregate stats and timestamps. |

---

## Sync Flow

### Scheduled / Manual Trigger

```
Cron tick (or POST /api/sync/trigger)
  └→ Queue: sync-all-stores
       └→ syncAllStores()
            ├→ Queue: sync-store {storeId: 1}
            ├→ Queue: sync-store {storeId: 2}
            └→ Queue: sync-store {storeId: 3}

Worker picks up sync-store:
  1. Fetch EPOS products  (paginated, cached)
  2. Fetch WooCommerce products  (paginated, cached)
  3. Match: SKU → Barcode → Name
  4. Diff: compare price + stock
  5. Batch update WooCommerce  (chunks of BATCH_SIZE)
  6. On batch failure → queue individual sync-product retries
  7. Unmatched EPOS products → queue sync-product (create)
  8. Log everything to sync_logs + sync_runs
```

### Webhook (Real-Time)

```
POST /webhooks/woo/1/product-updated
  └→ Verify signature
  └→ Queue: webhook-sync {storeId: 1, source: 'woo', productId: 42}
       └→ Worker: syncProductFromWebhook()
            └→ Queue: sync-store (re-sync the store)
```

---

## Error Handling

| HTTP Status | Behavior |
|---|---|
| `5xx` / network | Retry (up to 3 attempts, exponential back-off) |
| `400` | Permanent failure — `UnrecoverableError`, no retry |
| `401` | Log auth alert, retry (credentials may be temporarily invalid) |

---

## License

ISC

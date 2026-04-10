# EPOS ↔ WooCommerce Multi-Store Sync Engine

Production-grade product synchronization between **EPOS Now** and **WooCommerce** for a multi-store business. Supports real-time webhooks, scheduled sync, queue-based processing with BullMQ, automated alerts (Telegram / Email), failure detection, sync analytics, anomaly detection, and a React admin dashboard.

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Setup Guide](#setup-guide)
- [Configuration](#configuration)
- [Running the System](#running-the-system)
- [Admin Dashboard](#admin-dashboard)
- [API Reference](#api-reference)
- [Webhook Endpoints](#webhook-endpoints)
- [Project Structure](#project-structure)
- [Module Reference](#module-reference)
- [Database Schema](#database-schema)
- [Sync Flow](#sync-flow)
- [Alerts & Intelligence](#alerts--intelligence)

---

## Features

- **Multi-store** — each store syncs independently with its own WooCommerce instance
- **Fully queue-driven** — every product sync goes through BullMQ (NEVER called directly)
- **Mapping-driven** — check `product_mappings` → update if mapped, search & link if found, create if new
- **Delta sync** — incremental fetch using `last_synced_at` per store (only changed products)
- **Real-time webhooks** — instant sync on product changes; unified `/webhooks/product` endpoint
- **Scheduled sync** — configurable cron interval (default every 10 minutes)
- **Per-product queuing** — `syncStore` queues individual `sync-product` jobs (no batch coupling)
- **Rate limiting** — configurable delay between product syncs to avoid API throttling
- **Smart error handling** — 500=retry, 400=permanent fail, 401=auth alert (no retry)
- **Retry with back-off** — exponential retry (3 attempts, 2s base) via BullMQ
- **Dry-run mode** — preview all changes without writing to WooCommerce
- **Redis caching** — product lookups cached with 5-minute TTL (skipped during delta fetch)
- **Sync direction** — configurable per store: `EPOS_TO_WOO`, `WOO_TO_EPOS`, `BIDIRECTIONAL`
- **API key auth** — protect admin routes with `X-API-Key` header
- **Webhook signature verification** — HMAC-SHA256 validation for both WooCommerce and EPOS
- **Detailed logging** — per-product logs to file and database; per-run aggregate stats
- **Admin dashboard** — React-based monitoring UI with real-time store overview, failed job management, log viewer, and system health checks
- **Dashboard polling** — auto-refreshing stats, charts, and live queue activity feed
- **Alert system** — Telegram Bot API + Email (nodemailer) with debounce to prevent spam
- **Failure detection** — recurring failure tracking per SKU; auto-escalation at 3 and 10 failures
- **Sync analytics** — per-store metrics: synced, failed, created, skipped, avg duration
- **Daily reports** — cron job (8 AM) sends daily summary via Telegram / Email
- **Anomaly detection** — failure spikes, stale stores, zero-sync days, queue backlog alerts

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
                    │         delta fetch        mapping check
                    │         (EPOS API)              │
                    │                │          ┌─────┴──────┐
                    │         queue per-product  │  mapped?   │
                    │         sync-product jobs  ├─ yes→UPDATE│
                    │                │           ├─ SKU→ LINK │
                    │                │           └─ no → CREATE
                    │                │                │
                    ▼                ▼                ▼
               ┌─────────┐   ┌───────────┐   ┌───────────┐
               │  MySQL   │   │   Redis   │   │ WOO API   │
               │ (state)  │   │  (cache)  │   │ (writes)  │
               └─────────┘   └───────────┘   └───────────┘
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
| `SYNC_RATE_LIMIT_MS` | Delay (ms) between product sync jobs | `200` |
| `LOG_DIR` | Log file directory | `./logs` |
| `LOG_LEVEL` | `info` or `debug` | `info` |
| `DASHBOARD_USER` | Dashboard basic-auth username | — |
| `DASHBOARD_PASS` | Dashboard basic-auth password | — |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for alerts | — |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for alerts | — |
| `SMTP_HOST` | SMTP server for email alerts | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `ALERT_EMAIL_TO` | Email recipient for alerts | — |
| `ALERT_COOLDOWN_MINUTES` | Alert debounce window | `30` |
| `QUEUE_BACKLOG_THRESHOLD` | Alert if waiting > N jobs | `1000` |
| `STALE_SYNC_HOURS` | Alert if store not synced in N hours | `24` |
| `DAILY_REPORT_CRON` | Daily report cron expression | `0 8 * * *` |

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
| `dashboard:dev` | `npm run dashboard:dev` | Start dashboard dev server (Vite, port 5173) |
| `dashboard:build` | `npm run dashboard:build` | Build dashboard for production |

Sync a single store: `node src/run-once.js <storeId>`

---

## Admin Dashboard

A built-in React monitoring UI served at `/dashboard/` by the Express server.

### Tech Stack

- **React 19** + **Vite** — fast dev & optimized production builds
- **Tailwind CSS v4** — utility-first styling
- **Recharts** — bar charts for sync activity visualization
- **react-hot-toast** — toast notifications
- **Polling-based** — auto-refreshing data (configurable intervals)

### Pages

| Page | Description |
|---|---|
| **Dashboard** | 4 stat cards (stores, products synced, failed jobs, last sync) + 7-day bar chart |
| **Stores** | Store table with product counts, last sync time, status, and "Sync Now" button |
| **Failed Jobs** | Failed BullMQ jobs with error details, individual + bulk retry |
| **Logs** | Filterable sync log viewer (by store, status); latest 100 entries |
| **Health** | DB / Redis / Queue health checks, job count breakdown, live activity feed |
| **Analytics** | 5 KPI cards (7d), success vs failed line chart (30d), failures bar chart (14d), store performance table |
| **Alerts** | Recurring failure table, alert history, on-demand anomaly check + daily report trigger |

### Quick Start

```bash
# Development (hot-reload on :5173, proxies API to :3000)
npm run dashboard:dev

# Production build (served automatically by Express at /dashboard/)
npm run dashboard:build
npm start
```

After building, navigate to `http://localhost:3000/dashboard/`. On first visit you'll be prompted for your API key (stored in `localStorage`).

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

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard/summary` | Total stores, products synced, failed jobs, last sync, 7-day chart data |
| `GET` | `/api/dashboard/stores` | Stores with product count and last sync status |
| `GET` | `/api/dashboard/jobs/failed` | List failed BullMQ jobs |
| `POST` | `/api/dashboard/jobs/retry/:jobId` | Retry a specific failed job |
| `POST` | `/api/dashboard/jobs/retry-all` | Retry all failed jobs (max 500) |
| `GET` | `/api/dashboard/logs` | Sync logs with store name. Filter: `?store_id=1&status=failed` |
| `GET` | `/api/dashboard/health` | DB, Redis, Queue health status + job counts |
| `GET` | `/api/dashboard/activity` | Live feed of active/waiting/completed jobs |
| `GET` | `/api/dashboard/analytics/success-rate` | Synced/failed/created per day. Query: `?days=30` |
| `GET` | `/api/dashboard/analytics/failures` | Failures per day. Query: `?days=14` |
| `GET` | `/api/dashboard/analytics/store-performance` | Per-store stats (30 days) |
| `GET` | `/api/dashboard/analytics/daily-stats` | Aggregate stats. Query: `?days=1` |
| `GET` | `/api/dashboard/failures` | Open recurring failures. Filter: `?store_id=1` |
| `GET` | `/api/dashboard/alerts` | Alert history. Query: `?limit=50` |
| `POST` | `/api/dashboard/anomaly/check` | Run anomaly checks on demand |
| `POST` | `/api/dashboard/report/daily` | Trigger daily report now |

---

## Webhook Endpoints

Webhook routes do **not** require API key auth (they use signature verification).

| Method | Path | Trigger |
|---|---|---|
| `POST` | `/webhooks/product` | **Unified** — accepts any source (preferred) |
| `POST` | `/webhooks/woo/:storeId/product-updated` | WooCommerce product update (legacy) |
| `POST` | `/webhooks/epos/:storeId/product-updated` | EPOS Now product update (legacy) |

### Unified Webhook (`POST /webhooks/product`)

```json
{
  "storeId": 1,
  "source": "epos",
  "product": { "Id": 12345, "Name": "Widget", ... }
}
```

Signature header: `X-Webhook-Signature` (also accepts `X-WC-Webhook-Signature` or `X-EPOS-Signature`).

### Legacy Endpoints

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
    │   ├── dashboard.routes.js   # Dashboard API endpoints
    │   └── webhook.routes.js     # Webhook routes
    ├── alerts/
    │   ├── alert.service.js      # Telegram + Email sender (debounced)
    │   ├── failure.detector.js   # Recurring failure tracker + escalation
    │   ├── analytics.js          # Sync metrics queries
    │   ├── anomaly.detector.js   # Spike / stale / zero-sync / backlog checks
    │   └── daily.report.js       # 8 AM daily report cron
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
├── dashboard/                    # React admin UI (Vite)
│   ├── vite.config.js            # Vite config (Tailwind, proxy, base path)
│   └── src/
│       ├── main.jsx              # Entry point (BrowserRouter + Toaster)
│       ├── App.jsx               # Sidebar layout + route definitions
│       ├── api.js                # API helper (auto API key, 401 handling)
│       ├── usePolling.js         # Custom polling hook
│       └── pages/
│           ├── Dashboard.jsx     # Stats + 7-day bar chart
│           ├── Stores.jsx        # Store table + sync triggers
│           ├── Analytics.jsx     # Line/bar charts + store performance
│           ├── Alerts.jsx        # Recurring failures + alert history
│           ├── FailedJobs.jsx    # Failed job list + retry
│           ├── Logs.jsx          # Filterable sync log viewer
│           └── Health.jsx        # Health checks + live activity
```

---

## Module Reference

### Sync Engine (`sync/sync.engine.js`)

| Function | Description |
|---|---|
| `syncAllStores()` | Fetches all active stores, queues a `sync-store` job for each. |
| `syncStore(storeId, { dryRun })` | Delta fetch from EPOS (using `last_synced_at`), queues individual `sync-product` jobs per product. Returns `{ storeId, queued }`. NEVER calls `syncProduct` directly. |
| `syncProduct(data)` | **Mapping-driven** single-product sync. Checks `product_mappings` → update if mapped → search WooCommerce by SKU if unmapped → link or create. Throws `UnrecoverableError` on HTTP 400/401. |
| `syncProductFromWebhook(data)` | Handle incoming webhook events. Normalizes EPOS product data and queues a `sync-product` job (or falls back to `sync-store` if no product data). |
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

BullMQ worker with concurrency 5. Handles job types: `sync-all-stores`, `sync-store`, `sync-product`, `webhook-sync`. Applies a configurable rate-limit delay (`SYNC_RATE_LIMIT_MS`, default 200ms) between product sync jobs. Run as a separate process: `npm run worker`.

### EPOS Service (`services/epos.service.js`)

| Function | Description |
|---|---|
| `fetchAllProducts(store, opts)` | Paginated fetch of EPOS products (200/page, cached 5min). Pass `{ updatedSince }` for delta sync (skips cache). |
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
| `getMapping(storeId, eposProductId)` | Look up a product mapping by store + EPOS ID. Returns row or `null`. |
| `updateStoreSyncTime(storeId)` | Set `last_synced_at = NOW()` for the given store. |
| `close()` | Close the connection pool. |

---

## Database Schema

| Table | Purpose |
|---|---|
| `stores` | Store config: name, EPOS branch ID, WooCommerce credentials, sync direction, active flag, `last_synced_at` for delta sync. |
| `product_mappings` | Per-store EPOS ↔ WooCommerce product links. Unique on `(store_id, epos_product_id)`. Tracks match method. |
| `sync_logs` | Append-only log of every sync action per product (success/failed/skipped). |
| `sync_runs` | One row per store sync invocation with aggregate stats and timestamps. |
| `failure_logs` | Recurring failure tracking per SKU per store. Unique on `(store_id, sku)`. Tracks count, resolved flag. |
| `sync_metrics` | Aggregated sync metrics per store per run. Used for analytics charts and daily reports. |
| `alert_log` | Alert history with type, key, channel, and debounce support. |

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
  1. Delta fetch from EPOS  (updated_since = store.last_synced_at)
  2. For each EPOS product → Queue: sync-product job
  3. Update store last_synced_at
  4. Invalidate cache

Worker picks up sync-product:
  1. Check product_mappings for existing mapping
  2a. Mapped     → UPDATE WooCommerce product
  2b. Not mapped → Search WooCommerce by SKU
  3a. Found      → LINK mapping + UPDATE
  3b. Not found  → CREATE new WooCommerce product + mapping
  4. Rate-limit delay (200ms default)
  5. Log to sync_logs
```

### Webhook (Real-Time)

```
POST /webhooks/product  (or legacy /webhooks/epos/:storeId/product-updated)
  └→ Verify HMAC-SHA256 signature
  └→ Queue: webhook-sync {storeId, source, productId, productData}
       └→ Worker: syncProductFromWebhook()
            └→ Normalize product data
            └→ Queue: sync-product {storeId, eposProduct}
```

### Dashboard Routes (`routes/dashboard.routes.js`)

| Endpoint | Description |
|---|---|
| `GET /summary` | Aggregate stats: total stores, synced products, failed jobs count, last sync timestamp, 7-day activity breakdown (grouped by date, success vs failed). |
| `GET /stores` | All stores with `total_products` (from `product_mappings`) and `last_status` (from latest `sync_runs` row). |
| `GET /jobs/failed` | Failed BullMQ jobs: id, name, storeId, sku, error message, attempts, failedAt timestamp. |
| `POST /jobs/retry/:jobId` | Retry a single failed job by BullMQ job ID. |
| `POST /jobs/retry-all` | Retry all failed jobs (capped at 500). Returns count of retried jobs. |
| `GET /logs` | Sync logs joined with store name. Filterable by `store_id` and `status`. Limit 100. |
| `GET /health` | Checks DB (`SELECT 1`), Redis (`PING`), Queue (`getJobCounts`). Returns per-service status + queue breakdown. |
| `GET /activity` | Live feed of active, waiting, and completed jobs from BullMQ (up to 10 each). |

---

## Error Handling

| HTTP Status | Behavior |
|---|---|
| `5xx` / network | Retry (up to 3 attempts, exponential back-off) |
| `400` | Permanent failure — `UnrecoverableError`, no retry |
| `401` | Auth alert logged — `UnrecoverableError`, no retry |

---

## Alerts & Intelligence

### Alert Channels

| Channel | Config | Description |
|---|---|---|
| **Telegram** | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Recommended. Instant push via Bot API. |
| **Email** | `SMTP_*` + `ALERT_EMAIL_TO` | Optional. Via nodemailer (SMTP). |

Both channels fire simultaneously when configured. Alerts are **debounced** — the same `(alert_type, alert_key)` pair won't repeat within `ALERT_COOLDOWN_MINUTES` (default 30).

### Alert Triggers

| Alert | Condition | Severity |
|---|---|---|
| Repeated failure | Same SKU fails 3 times | Warning |
| Critical failure | Same SKU fails 10+ times | Critical |
| Store sync failed | A `sync-store` job exhausts retries | Error |
| Auth failure | WooCommerce returns HTTP 401 | Critical |
| Queue backlog | Waiting jobs > `QUEUE_BACKLOG_THRESHOLD` | Warning |
| Failure spike | Today's failures > 2× yesterday | Anomaly |
| Stale store | Active store not synced in N hours | Anomaly |
| Zero sync | No products synced today | Anomaly |

### Daily Report

Runs at 8 AM (configurable via `DAILY_REPORT_CRON`). Sends a summary:

```
📊 Daily Sync Report

Stores active: 3
Products synced: 847
Products created: 12
Failed: 5
Success rate: 99%
Avg duration: 1.2s
```

Trigger on-demand: `POST /api/dashboard/report/daily`

### Anomaly Detection

Runs automatically after the daily report. Also available on-demand: `POST /api/dashboard/anomaly/check`.

---

## License

ISC

const { UnrecoverableError } = require('bullmq');
const eposService            = require('../services/epos.service');
const wooService             = require('../services/woo.service');
const { matchProducts }      = require('../utils/matcher');
const skuUtil                = require('../utils/sku.util');
const logger                 = require('../utils/logger');
const db                     = require('../db/db');
const cache                  = require('../utils/cache');
const syncQueue              = require('./sync.queue');
const config                 = require('../config');

const BATCH_SIZE = config.sync.batchSize;

// ------------------------------------------------------------------
//  Store helpers
// ------------------------------------------------------------------

async function getActiveStores() {
  return db.query('SELECT * FROM stores WHERE is_active = 1');
}

async function getStore(storeId) {
  const rows = await db.query('SELECT * FROM stores WHERE id = ?', [storeId]);
  return rows[0] || null;
}

// ------------------------------------------------------------------
//  DB logging
// ------------------------------------------------------------------

async function logSync(storeId, sku, action, status, message) {
  try {
    await db.query(
      'INSERT INTO sync_logs (store_id, sku, action, status, message) VALUES (?, ?, ?, ?, ?)',
      [storeId, sku || null, action, status, message]
    );
  } catch (err) {
    logger.error(`[SYNC-LOG] DB write failed: ${err.message}`);
  }
  const level = status === 'failed' ? 'error' : 'info';
  logger[level](`[Store:${storeId}] [${action}] ${status} — ${message}`);
}

// ------------------------------------------------------------------
//  Run tracking
// ------------------------------------------------------------------

async function startRun(storeId, dryRun) {
  return db.insertAndGetId(
    "INSERT INTO sync_runs (store_id, started_at, dry_run, status) VALUES (?, NOW(), ?, 'running')",
    [storeId, dryRun ? 1 : 0]
  );
}

async function finishRun(runId, stats, failed = false) {
  await db.query(
    `UPDATE sync_runs
        SET finished_at = NOW(), total_products = ?, synced = ?, created = ?,
            failed = ?, skipped = ?, status = ?
      WHERE id = ?`,
    [stats.total, stats.synced, stats.created, stats.failed, stats.skipped,
     failed ? 'failed' : 'completed', runId]
  );
}

// ------------------------------------------------------------------
//  Mapping helpers
// ------------------------------------------------------------------

async function upsertMapping(storeId, eposProduct, wooProduct, method) {
  const normSku = skuUtil.normalize(eposProduct.sku || eposProduct.barcode || '');

  const existing = await db.query(
    'SELECT id FROM product_mappings WHERE store_id = ? AND epos_product_id = ?',
    [storeId, eposProduct.eposId]
  );

  if (existing.length > 0) {
    await db.query(
      `UPDATE product_mappings
          SET woo_product_id = ?, sku = ?, barcode = ?,
              normalized_sku = ?, match_method = ?, last_synced_at = NOW()
        WHERE id = ?`,
      [wooProduct ? wooProduct.id : null, eposProduct.sku, eposProduct.barcode,
       normSku, method, existing[0].id]
    );
    return existing[0].id;
  }

  return db.insertAndGetId(
    `INSERT INTO product_mappings
       (store_id, epos_product_id, woo_product_id, sku, barcode, normalized_sku, match_method, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [storeId, eposProduct.eposId, wooProduct ? wooProduct.id : null,
     eposProduct.sku, eposProduct.barcode, normSku, method]
  );
}

// ------------------------------------------------------------------
//  Sync all stores  (fan-out to individual store jobs)
// ------------------------------------------------------------------

async function syncAllStores() {
  const stores = await getActiveStores();
  logger.info(`[SYNC] Queuing sync for ${stores.length} active store(s)`);

  for (const store of stores) {
    await syncQueue.addSyncStoreJob(store.id);
  }

  return { storesQueued: stores.length };
}

// ------------------------------------------------------------------
//  Sync single store
// ------------------------------------------------------------------

async function syncStore(storeId, { dryRun = false } = {}) {
  const store = await getStore(storeId);
  if (!store) throw new Error(`Store ${storeId} not found`);
  if (!store.is_active) throw new Error(`Store ${storeId} is inactive`);

  const direction = store.sync_direction || config.sync.direction;
  const mode      = dryRun ? 'DRY-RUN' : 'LIVE';
  logger.info(`=== Store "${store.name}" sync started [${mode}] [${direction}] ===`);

  const runId = await startRun(storeId, dryRun);
  const stats = { total: 0, synced: 0, created: 0, failed: 0, skipped: 0 };

  try {
    // 1. Fetch products from both systems in parallel
    const [eposRaw, wooProducts] = await Promise.all([
      eposService.fetchAllProducts(store),
      wooService.fetchAllProducts(store),
    ]);

    const eposProducts = eposRaw.map(eposService.normalizeProduct);
    stats.total = eposProducts.length;

    logger.info(`[SYNC] Store ${storeId}: EPOS ${eposProducts.length} | WOO ${wooProducts.length}`);

    // 2. Match products  (SKU → Barcode → Name)
    const { matched, unmatched } = matchProducts(eposProducts, wooProducts);

    // 3. Detect changes and build batch updates
    const batchUpdates = [];
    const batchMeta    = [];

    for (const { epos: ep, woo: wp, method } of matched) {
      const currentPrice = parseFloat(wp.regular_price) || 0;
      const currentStock = parseInt(wp.stock_quantity, 10) || 0;
      const priceChanged = ep.price !== currentPrice;
      const stockChanged = ep.stock !== currentStock;

      if (!priceChanged && !stockChanged) {
        stats.skipped++;
        continue;
      }

      batchUpdates.push({
        id:             wp.id,
        regular_price:  String(ep.price),
        stock_quantity: ep.stock,
        manage_stock:   true,
      });
      batchMeta.push({ ep, wp, method, priceChanged, stockChanged });
    }

    logger.info(
      `[SYNC] Store ${storeId}: ${batchUpdates.length} updates, ` +
      `${unmatched.length} unmatched, ${stats.skipped} unchanged`
    );

    // 4. Push batch updates to WooCommerce
    for (let i = 0; i < batchUpdates.length; i += BATCH_SIZE) {
      const chunk     = batchUpdates.slice(i, i + BATCH_SIZE);
      const metaChunk = batchMeta.slice(i, i + BATCH_SIZE);

      if (dryRun) {
        for (const m of metaChunk) {
          const changes = [];
          if (m.priceChanged) changes.push(`price ${m.wp.regular_price} → ${m.ep.price}`);
          if (m.stockChanged) changes.push(`stock ${m.wp.stock_quantity} → ${m.ep.stock}`);
          logger.info(`[DRY-RUN] Store ${storeId}: WOO#${m.wp.id} (${m.ep.sku}): ${changes.join(', ')}`);
          stats.synced++;
        }
        continue;
      }

      try {
        await wooService.batchUpdate(store, chunk);

        for (const m of metaChunk) {
          await upsertMapping(storeId, m.ep, m.wp, m.method);
          const changes = [];
          if (m.priceChanged) changes.push(`price → ${m.ep.price}`);
          if (m.stockChanged) changes.push(`stock → ${m.ep.stock}`);
          await logSync(storeId, m.ep.sku, 'update', 'success', changes.join(', '));
          stats.synced++;
        }
      } catch (err) {
        // Batch failed — queue individual product retries
        for (const m of metaChunk) {
          stats.failed++;
          await logSync(storeId, m.ep.sku, 'update', 'failed', err.message);
          await syncQueue.addSyncProductJob({
            storeId,
            eposProduct: m.ep,
            wooProductId: m.wp.id,
            action: 'update',
          });
        }
      }
    }

    // 5. Handle unmatched EPOS products (create in WooCommerce)
    if (direction !== 'WOO_TO_EPOS') {
      for (const ep of unmatched) {
        if (!ep.sku && !ep.barcode) {
          stats.skipped++;
          continue;
        }

        if (dryRun) {
          logger.info(`[DRY-RUN] Store ${storeId}: would create "${ep.name}" (${ep.sku || ep.barcode})`);
          stats.created++;
          continue;
        }

        await syncQueue.addSyncProductJob({
          storeId,
          eposProduct: ep,
          wooProductId: null,
          action: 'create',
        });
        stats.created++;
      }
    }

    // 6. Invalidate product cache for this store
    await cache.invalidateStore(storeId);

    await finishRun(runId, stats);
    logger.info(
      `=== Store "${store.name}" sync done — ` +
      `synced:${stats.synced} created:${stats.created} failed:${stats.failed} skipped:${stats.skipped} ===`
    );
    return stats;

  } catch (err) {
    logger.error(`[SYNC] Store ${storeId} fatal: ${err.message}`);
    await finishRun(runId, stats, true);
    throw err;
  }
}

// ------------------------------------------------------------------
//  Sync individual product  (called by worker for retries / creates)
// ------------------------------------------------------------------

async function syncProduct(data) {
  const { storeId, eposProduct, wooProductId, action } = data;
  const store = await getStore(storeId);
  if (!store) throw new Error(`Store ${storeId} not found`);

  const sku = eposProduct.sku || eposProduct.barcode || '';

  try {
    if (action === 'create') {
      const newProduct = await wooService.createProduct(store, {
        name:           eposProduct.name,
        sku:            eposProduct.sku || eposProduct.barcode,
        regular_price:  String(eposProduct.price),
        stock_quantity: eposProduct.stock,
        manage_stock:   true,
        status:         'publish',
      });
      await upsertMapping(storeId, eposProduct, newProduct, 'sku');
      await logSync(storeId, sku, 'create', 'success', `Created WOO#${newProduct.id}`);
      return { created: newProduct.id };
    }

    if (action === 'update') {
      await wooService.updateProduct(store, wooProductId, {
        regular_price:  String(eposProduct.price),
        stock_quantity: eposProduct.stock,
        manage_stock:   true,
      });
      await logSync(storeId, sku, 'update', 'success', `Updated WOO#${wooProductId}`);
      return { updated: wooProductId };
    }

    throw new Error(`Unknown sync action: ${action}`);

  } catch (err) {
    await logSync(storeId, sku, action, 'failed', err.message);

    // Smart retry logic based on HTTP status
    const status = err.response?.status;
    if (status === 401) {
      logger.error(`[SYNC] Store ${storeId}: AUTH FAILURE — check WooCommerce credentials`);
    }
    if (status === 400) {
      // Permanent failure — do NOT retry
      throw new UnrecoverableError(`Permanent failure (400): ${err.message}`);
    }
    // 5xx / network errors will be retried automatically by BullMQ
    throw err;
  }
}

// ------------------------------------------------------------------
//  Webhook-triggered sync
// ------------------------------------------------------------------

async function syncProductFromWebhook(data) {
  const { storeId, source, productId } = data;
  const store = await getStore(storeId);
  if (!store) throw new Error(`Store ${storeId} not found`);

  const direction = store.sync_direction || config.sync.direction;

  if (source === 'woo' && (direction === 'WOO_TO_EPOS' || direction === 'BIDIRECTIONAL')) {
    logger.info(`[WEBHOOK] WooCommerce update for store ${storeId}, product ${productId}`);
    // WOO → EPOS: placeholder for EPOS push API integration
    await logSync(storeId, null, 'webhook_woo', 'skipped', 'WOO_TO_EPOS push not yet implemented');
    return;
  }

  if (source === 'epos' && (direction === 'EPOS_TO_WOO' || direction === 'BIDIRECTIONAL')) {
    logger.info(`[WEBHOOK] EPOS update for store ${storeId}, product ${productId}`);

    // Look up existing mapping
    const mappings = await db.query(
      'SELECT * FROM product_mappings WHERE store_id = ? AND epos_product_id = ?',
      [storeId, String(productId)]
    );

    if (mappings.length > 0 && mappings[0].woo_product_id) {
      // Queue a store sync to pick up the fresh data
      await syncQueue.addSyncStoreJob(storeId);
    }
    return;
  }

  logger.info(`[WEBHOOK] Ignored — direction ${direction} does not match source ${source}`);
}

module.exports = {
  syncAllStores,
  syncStore,
  syncProduct,
  syncProductFromWebhook,
  getActiveStores,
  getStore,
};

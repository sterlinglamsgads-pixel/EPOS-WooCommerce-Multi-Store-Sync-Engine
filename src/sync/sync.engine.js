const { UnrecoverableError } = require('bullmq');
const eposService            = require('../services/epos.service');
const wooService             = require('../services/woo.service');
const skuUtil                = require('../utils/sku.util');
const logger                 = require('../utils/logger');
const db                     = require('../db/db');
const cache                  = require('../utils/cache');
const syncQueue              = require('./sync.queue');
const config                 = require('../config');

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
//  Sync single store  (delta fetch + queue per-product jobs)
// ------------------------------------------------------------------

async function syncStore(storeId, { dryRun = false } = {}) {
  const store = await getStore(storeId);
  if (!store) throw new Error(`Store ${storeId} not found`);
  if (!store.is_active) throw new Error(`Store ${storeId} is inactive`);

  const direction = store.sync_direction || config.sync.direction;
  if (direction === 'WOO_TO_EPOS') {
    logger.info(`[SYNC] Store "${store.name}": direction is WOO_TO_EPOS — skipping EPOS→WOO sync`);
    return { storeId, queued: 0 };
  }

  logger.info(`=== Store "${store.name}" sync started [${direction}] ===`);

  // Delta: use last_synced_at for incremental fetch
  const fetchOpts = {};
  if (store.last_synced_at) {
    fetchOpts.updatedSince = store.last_synced_at;
    logger.info(`[SYNC] Store ${storeId}: delta sync since ${store.last_synced_at}`);
  } else {
    logger.info(`[SYNC] Store ${storeId}: full sync (no previous sync timestamp)`);
  }

  const eposRaw = await eposService.fetchAllProducts(store, fetchOpts);
  const eposProducts = eposRaw.map(eposService.normalizeProduct);

  logger.info(`[SYNC] Store ${storeId}: ${eposProducts.length} product(s) to sync`);

  // Queue individual sync-product jobs (NEVER call syncProduct directly)
  let queued = 0;
  for (const ep of eposProducts) {
    await syncQueue.addSyncProductJob({
      storeId,
      eposProduct: ep,
      dryRun,
    });
    queued++;
  }

  // Update store's last_synced_at
  await db.updateStoreSyncTime(storeId);

  // Invalidate product cache for this store
  await cache.invalidateStore(storeId);

  logger.info(`=== Store "${store.name}" sync done — queued ${queued} product job(s) ===`);
  return { storeId, queued };
}

// ------------------------------------------------------------------
//  Sync individual product  (mapping-driven: check → create or update)
// ------------------------------------------------------------------

async function syncProduct(data) {
  const { storeId, eposProduct, dryRun } = data;
  const store = await getStore(storeId);
  if (!store) throw new Error(`Store ${storeId} not found`);

  const sku = eposProduct.sku || eposProduct.barcode || '';

  try {
    // 1. Check existing mapping
    const mapping = await db.getMapping(storeId, eposProduct.eposId);

    if (mapping && mapping.woo_product_id) {
      // ── UPDATE existing mapped product ──
      if (dryRun) {
        logger.info(`[DRY-RUN] Store ${storeId}: would update WOO#${mapping.woo_product_id} (${sku})`);
        return { action: 'update', dryRun: true };
      }

      await wooService.updateProduct(store, mapping.woo_product_id, {
        regular_price:  String(eposProduct.price),
        stock_quantity: eposProduct.stock,
        manage_stock:   true,
      });
      await upsertMapping(storeId, eposProduct, { id: mapping.woo_product_id }, mapping.match_method || 'sku');
      await logSync(storeId, sku, 'update', 'success', `Updated WOO#${mapping.woo_product_id}`);
      return { action: 'update', wooProductId: mapping.woo_product_id };
    }

    // 2. No mapping — try to find in WooCommerce by SKU/barcode
    const searchSku = eposProduct.sku || eposProduct.barcode;
    let wooProduct  = null;
    if (searchSku) {
      wooProduct = await wooService.findBySku(store, searchSku);
    }

    if (wooProduct) {
      // ── LINK & UPDATE existing WooCommerce product ──
      if (dryRun) {
        logger.info(`[DRY-RUN] Store ${storeId}: would link & update WOO#${wooProduct.id} (${sku})`);
        return { action: 'link', dryRun: true };
      }

      await wooService.updateProduct(store, wooProduct.id, {
        regular_price:  String(eposProduct.price),
        stock_quantity: eposProduct.stock,
        manage_stock:   true,
      });
      await upsertMapping(storeId, eposProduct, wooProduct, 'sku');
      await logSync(storeId, sku, 'link', 'success', `Linked & updated WOO#${wooProduct.id}`);
      return { action: 'link', wooProductId: wooProduct.id };
    }

    // 3. No match anywhere — create new product in WooCommerce
    if (!searchSku) {
      await logSync(storeId, sku, 'create', 'skipped', 'No SKU or barcode — cannot create');
      return { action: 'skipped' };
    }

    if (dryRun) {
      logger.info(`[DRY-RUN] Store ${storeId}: would create "${eposProduct.name}" (${searchSku})`);
      return { action: 'create', dryRun: true };
    }

    const newProduct = await wooService.createProduct(store, {
      name:           eposProduct.name,
      sku:            searchSku,
      regular_price:  String(eposProduct.price),
      stock_quantity: eposProduct.stock,
      manage_stock:   true,
      status:         'publish',
    });
    await upsertMapping(storeId, eposProduct, newProduct, 'sku');
    await logSync(storeId, sku, 'create', 'success', `Created WOO#${newProduct.id}`);
    return { action: 'create', wooProductId: newProduct.id };

  } catch (err) {
    await logSync(storeId, sku, 'sync', 'failed', err.message);

    // Smart error handling based on HTTP status
    const status = err.response?.status;
    if (status === 401) {
      logger.error(`[SYNC] Store ${storeId}: AUTH FAILURE — check WooCommerce credentials`);
      throw new UnrecoverableError(`Auth failure (401): ${err.message}`);
    }
    if (status === 400) {
      // Permanent failure — do NOT retry
      throw new UnrecoverableError(`Permanent failure (400): ${err.message}`);
    }
    // 5xx / network errors — BullMQ will retry automatically
    throw err;
  }
}

// ------------------------------------------------------------------
//  Webhook-triggered sync  (always goes through the queue)
// ------------------------------------------------------------------

async function syncProductFromWebhook(data) {
  const { storeId, source, productId, productData } = data;
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

    // Normalize the incoming EPOS product and queue a sync-product job
    if (productData) {
      const eposProduct = eposService.normalizeProduct(productData);
      await syncQueue.addSyncProductJob({ storeId, eposProduct });
      logger.info(`[WEBHOOK] Queued sync-product for EPOS#${eposProduct.eposId} → store ${storeId}`);
    } else {
      // No product data — trigger a full store sync to pick up the change
      await syncQueue.addSyncStoreJob(storeId);
      logger.info(`[WEBHOOK] No product data — queued full store sync for store ${storeId}`);
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

/**
 * Self-Healing Module
 * Automatically fixes common sync issues without human intervention
 *
 * Safety rules:
 *  - Never auto-fix destructive issues
 *  - Log every auto-action to healing_logs table
 *  - No infinite healing loops (max 1 heal attempt per SKU per hour)
 *  - Allow manual override via dashboard
 */

const db     = require('../db/db');
const logger = require('../utils/logger');
const alerts = require('../alerts/alert.service');
const skuUtil = require('../utils/sku.util');

// Cooldown: don't re-heal same SKU+store within this window
const HEAL_COOLDOWN_MINUTES = 60;

// ------------------------------------------------------------------
//  Check if a healing action was recently performed
// ------------------------------------------------------------------

async function wasRecentlyHealed(storeId, sku, actionType) {
  const rows = await db.query(
    `SELECT id FROM healing_logs
      WHERE store_id = ? AND sku = ? AND action_type = ?
        AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
      LIMIT 1`,
    [storeId, sku || '', actionType, HEAL_COOLDOWN_MINUTES]
  );
  return rows.length > 0;
}

// ------------------------------------------------------------------
//  Log a healing action
// ------------------------------------------------------------------

async function logHeal(storeId, sku, actionType, description, success) {
  try {
    await db.query(
      `INSERT INTO healing_logs (store_id, sku, action_type, description, success)
       VALUES (?, ?, ?, ?, ?)`,
      [storeId, sku || '', actionType, description, success ? 1 : 0]
    );
  } catch (err) {
    logger.error(`[SELF-HEAL] Log failed: ${err.message}`);
  }
}

// ------------------------------------------------------------------
//  Heal: Auto-create missing mapping
// ------------------------------------------------------------------

async function healMissingMapping(storeId, eposProduct) {
  const sku = eposProduct.sku || eposProduct.barcode || '';
  const actionType = 'auto_create_mapping';

  if (await wasRecentlyHealed(storeId, sku, actionType)) {
    logger.debug(`[SELF-HEAL] Skipping ${actionType} for ${sku} — recently healed`);
    return false;
  }

  try {
    const normSku = skuUtil.normalize(sku);
    await db.query(
      `INSERT IGNORE INTO product_mappings
         (store_id, epos_product_id, sku, barcode, normalized_sku, match_method)
       VALUES (?, ?, ?, ?, ?, 'sku')`,
      [storeId, eposProduct.eposId, eposProduct.sku, eposProduct.barcode, normSku]
    );

    await logHeal(storeId, sku, actionType, `Auto-created mapping for EPOS#${eposProduct.eposId}`, true);
    logger.info(`[SELF-HEAL] Created missing mapping for SKU ${sku} (store ${storeId})`);
    return true;
  } catch (err) {
    await logHeal(storeId, sku, actionType, `Failed: ${err.message}`, false);
    logger.error(`[SELF-HEAL] healMissingMapping failed: ${err.message}`);
    return false;
  }
}

// ------------------------------------------------------------------
//  Heal: Generate fallback SKU when missing
// ------------------------------------------------------------------

async function healMissingSku(storeId, eposProduct) {
  const actionType = 'generate_fallback_sku';
  const tempSku = `EPOS-${storeId}-${eposProduct.eposId}`;

  if (await wasRecentlyHealed(storeId, tempSku, actionType)) {
    return null;
  }

  try {
    eposProduct.sku = tempSku;
    await logHeal(storeId, tempSku, actionType, `Generated fallback SKU: ${tempSku}`, true);
    logger.info(`[SELF-HEAL] Generated fallback SKU "${tempSku}" for EPOS#${eposProduct.eposId}`);
    return tempSku;
  } catch (err) {
    await logHeal(storeId, '', actionType, `Failed: ${err.message}`, false);
    return null;
  }
}

// ------------------------------------------------------------------
//  Heal: Attempt to recreate WooCommerce product after 404
// ------------------------------------------------------------------

async function healMissingWooProduct(storeId, mapping, eposProduct) {
  const sku = eposProduct.sku || eposProduct.barcode || '';
  const actionType = 'recreate_woo_product';

  if (await wasRecentlyHealed(storeId, sku, actionType)) {
    logger.debug(`[SELF-HEAL] Skipping ${actionType} for ${sku} — recently healed`);
    return false;
  }

  try {
    // Clear the stale WooCommerce mapping so next sync creates fresh
    await db.query(
      'UPDATE product_mappings SET woo_product_id = NULL, match_method = NULL WHERE id = ?',
      [mapping.id]
    );

    await logHeal(storeId, sku, actionType,
      `Cleared stale WOO mapping #${mapping.woo_product_id} — will recreate on next sync`, true);
    logger.info(`[SELF-HEAL] Cleared stale WOO mapping for SKU ${sku} (store ${storeId})`);

    await alerts.send(
      'self_heal',
      `store:${storeId}:sku:${sku}:recreate`,
      `🔧 <b>Self-Heal: Product Recreate</b>\n\nStore: ${storeId}\nSKU: <code>${sku}</code>\nCleared stale WOO product mapping — will recreate on next sync.`
    );

    return true;
  } catch (err) {
    await logHeal(storeId, sku, actionType, `Failed: ${err.message}`, false);
    logger.error(`[SELF-HEAL] healMissingWooProduct failed: ${err.message}`);
    return false;
  }
}

// ------------------------------------------------------------------
//  Heal: Fix duplicate SKU conflict
// ------------------------------------------------------------------

async function healDuplicateSku(storeId, eposProduct) {
  const sku = eposProduct.sku || eposProduct.barcode || '';
  const actionType = 'fix_duplicate_sku';

  if (await wasRecentlyHealed(storeId, sku, actionType)) {
    return null;
  }

  try {
    // Append store ID + timestamp to make SKU unique
    const uniqueSku = `${sku}-S${storeId}-${Date.now().toString(36)}`;
    const oldSku = eposProduct.sku;
    eposProduct.sku = uniqueSku;

    await logHeal(storeId, sku, actionType,
      `Renamed duplicate SKU "${oldSku}" → "${uniqueSku}"`, true);
    logger.info(`[SELF-HEAL] Fixed duplicate SKU: "${oldSku}" → "${uniqueSku}" (store ${storeId})`);
    return uniqueSku;
  } catch (err) {
    await logHeal(storeId, sku, actionType, `Failed: ${err.message}`, false);
    return null;
  }
}

// ------------------------------------------------------------------
//  Main: Attempt to heal based on error classification
// ------------------------------------------------------------------

async function attemptHeal(storeId, eposProduct, errorClassification, mapping) {
  const { type, message } = errorClassification;

  // Only heal DATA errors — never heal AUTH/NETWORK automatically
  if (type !== 'DATA') return { healed: false };

  // Missing SKU → generate fallback
  if (!eposProduct.sku && !eposProduct.barcode) {
    const newSku = await healMissingSku(storeId, eposProduct);
    if (newSku) return { healed: true, action: 'generated_sku', newSku };
  }

  // Duplicate SKU error
  if (/duplicate.*sku/i.test(message) || /product_invalid_sku/i.test(message)) {
    const newSku = await healDuplicateSku(storeId, eposProduct);
    if (newSku) return { healed: true, action: 'fixed_duplicate_sku', newSku };
  }

  // 404 on update → product was deleted from WooCommerce
  if (errorClassification.httpStatus === 404 && mapping) {
    const ok = await healMissingWooProduct(storeId, mapping, eposProduct);
    if (ok) return { healed: true, action: 'cleared_stale_mapping' };
  }

  // Missing mapping
  if (/mapping/i.test(message) || /not found/i.test(message)) {
    const ok = await healMissingMapping(storeId, eposProduct);
    if (ok) return { healed: true, action: 'created_mapping' };
  }

  return { healed: false };
}

// ------------------------------------------------------------------
//  Dashboard: get healing history
// ------------------------------------------------------------------

async function getHealingHistory(limit = 50) {
  return db.query(
    `SELECT hl.*, s.name AS store_name
       FROM healing_logs hl
       LEFT JOIN stores s ON hl.store_id = s.id
      ORDER BY hl.created_at DESC
      LIMIT ?`,
    [limit]
  );
}

async function getHealingStats() {
  return db.query(
    `SELECT action_type,
            COUNT(*) AS total,
            SUM(success) AS succeeded,
            COUNT(*) - SUM(success) AS failed
       FROM healing_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY action_type
      ORDER BY total DESC`
  );
}

module.exports = {
  attemptHeal,
  healMissingMapping,
  healMissingSku,
  healMissingWooProduct,
  healDuplicateSku,
  getHealingHistory,
  getHealingStats,
};

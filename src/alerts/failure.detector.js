const db     = require('../db/db');
const logger = require('../utils/logger');
const alerts = require('./alert.service');

// ------------------------------------------------------------------
//  Track a product sync failure — upsert into failure_logs
// ------------------------------------------------------------------

async function trackFailure(storeId, sku, errorMessage) {
  if (!sku) return;

  try {
    // Upsert: increment count if exists, insert otherwise
    await db.query(
      `INSERT INTO failure_logs (store_id, sku, error, fail_count, first_seen, last_occurred)
       VALUES (?, ?, ?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         fail_count    = fail_count + 1,
         error         = VALUES(error),
         last_occurred = NOW(),
         resolved      = 0`,
      [storeId, sku, errorMessage]
    );

    // Check if threshold exceeded → escalate
    const rows = await db.query(
      'SELECT fail_count FROM failure_logs WHERE store_id = ? AND sku = ? AND resolved = 0',
      [storeId, sku]
    );
    const count = rows[0]?.fail_count || 0;

    if (count === 3) {
      await alerts.send(
        'repeated_failure',
        `store:${storeId}:sku:${sku}`,
        `⚠️ <b>Repeated Failure Detected</b>\n\nSKU: <code>${sku}</code>\nStore: ${storeId}\nFailed ${count} times\nError: ${truncate(errorMessage, 200)}`
      );
    }
    if (count === 10) {
      await alerts.send(
        'critical_failure',
        `store:${storeId}:sku:${sku}:critical`,
        `🚨 <b>Critical: 10+ Failures</b>\n\nSKU: <code>${sku}</code>\nStore: ${storeId}\nFailed ${count} times\nThis product needs manual attention.`
      );
    }
  } catch (err) {
    logger.error(`[FAILURE] trackFailure error: ${err.message}`);
  }
}

// ------------------------------------------------------------------
//  Mark a SKU as resolved (successful sync clears it)
// ------------------------------------------------------------------

async function markResolved(storeId, sku) {
  if (!sku) return;
  try {
    await db.query(
      'UPDATE failure_logs SET resolved = 1 WHERE store_id = ? AND sku = ? AND resolved = 0',
      [storeId, sku]
    );
  } catch (err) {
    logger.error(`[FAILURE] markResolved error: ${err.message}`);
  }
}

// ------------------------------------------------------------------
//  Alert on store-level sync failure
// ------------------------------------------------------------------

async function storeFailure(storeId, storeName, errorMessage) {
  await alerts.send(
    'store_sync_failed',
    `store:${storeId}`,
    `❌ <b>Store Sync Failed</b>\n\nStore: ${storeName || storeId}\nError: ${truncate(errorMessage, 300)}`
  );
}

// ------------------------------------------------------------------
//  Alert on auth error
// ------------------------------------------------------------------

async function authFailure(storeId, storeName) {
  await alerts.send(
    'auth_failure',
    `store:${storeId}:auth`,
    `🔐 <b>Authentication Failure</b>\n\nStore: ${storeName || storeId}\nWooCommerce credentials are invalid — sync halted.\nPlease update credentials ASAP.`
  );
}

// ------------------------------------------------------------------
//  Alert on queue backlog
// ------------------------------------------------------------------

async function queueBacklog(waitingCount) {
  await alerts.send(
    'queue_backlog',
    'global',
    `📋 <b>Queue Backlog Alert</b>\n\n${waitingCount} jobs waiting in the queue.\nThis may indicate a stuck worker or API outage.`
  );
}

// ------------------------------------------------------------------
//  Get open failures for dashboard
// ------------------------------------------------------------------

async function getOpenFailures(storeId) {
  let sql = `SELECT fl.*, s.name AS store_name
               FROM failure_logs fl
               LEFT JOIN stores s ON fl.store_id = s.id
              WHERE fl.resolved = 0`;
  const params = [];
  if (storeId) {
    sql += ' AND fl.store_id = ?';
    params.push(storeId);
  }
  sql += ' ORDER BY fl.fail_count DESC LIMIT 100';
  return db.query(sql, params);
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

module.exports = {
  trackFailure,
  markResolved,
  storeFailure,
  authFailure,
  queueBacklog,
  getOpenFailures,
};

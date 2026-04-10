const db     = require('../db/db');
const logger = require('../utils/logger');
const alerts = require('./alert.service');
const syncQueue = require('../sync/sync.queue');

const QUEUE_BACKLOG_THRESHOLD = parseInt(process.env.QUEUE_BACKLOG_THRESHOLD, 10) || 1000;
const STALE_SYNC_HOURS        = parseInt(process.env.STALE_SYNC_HOURS, 10) || 24;

// ------------------------------------------------------------------
//  Run all anomaly checks — called by the daily report cron
//  + can be triggered via API
// ------------------------------------------------------------------

async function runChecks() {
  const results = [];
  results.push(await checkFailureSpike());
  results.push(await checkStaleStores());
  results.push(await checkZeroSync());
  results.push(await checkQueueBacklog());
  return results.filter(Boolean);
}

// ------------------------------------------------------------------
//  1. Failure spike: today's failures > 2× yesterday's
// ------------------------------------------------------------------

async function checkFailureSpike() {
  try {
    const rows = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE()             THEN total_failed ELSE 0 END), 0) AS today,
         COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() - INTERVAL 1 DAY THEN total_failed ELSE 0 END), 0) AS yesterday
       FROM sync_metrics
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)`
    );
    const { today, yesterday } = rows[0];

    if (yesterday > 0 && today > yesterday * 2) {
      const msg = `📈 <b>Failure Spike Detected</b>\n\nToday: ${today} failures\nYesterday: ${yesterday} failures\n${Math.round((today / yesterday) * 100)}% increase`;
      await alerts.send('anomaly_failure_spike', 'daily', msg);
      return { type: 'failure_spike', today, yesterday };
    }
  } catch (err) {
    logger.error(`[ANOMALY] checkFailureSpike error: ${err.message}`);
  }
  return null;
}

// ------------------------------------------------------------------
//  2. Stale stores: active stores not synced in N hours
// ------------------------------------------------------------------

async function checkStaleStores() {
  try {
    const rows = await db.query(
      `SELECT id, name, last_synced_at
         FROM stores
        WHERE is_active = 1
          AND (last_synced_at IS NULL OR last_synced_at < DATE_SUB(NOW(), INTERVAL ? HOUR))`,
      [STALE_SYNC_HOURS]
    );

    if (rows.length > 0) {
      const names = rows.map(r => r.name).join(', ');
      const msg = `⏰ <b>Stale Stores</b>\n\n${rows.length} store(s) haven't synced in ${STALE_SYNC_HOURS}h:\n${names}`;
      await alerts.send('anomaly_stale_stores', 'daily', msg);
      return { type: 'stale_stores', stores: rows.map(r => r.name) };
    }
  } catch (err) {
    logger.error(`[ANOMALY] checkStaleStores error: ${err.message}`);
  }
  return null;
}

// ------------------------------------------------------------------
//  3. Zero sync: no products synced today at all
// ------------------------------------------------------------------

async function checkZeroSync() {
  try {
    const rows = await db.query(
      `SELECT COALESCE(SUM(total_synced), 0) AS synced
         FROM sync_metrics
        WHERE DATE(created_at) = CURDATE()`
    );

    // Only alert if there are active stores (otherwise expected)
    const storeRows = await db.query('SELECT COUNT(*) AS cnt FROM stores WHERE is_active = 1');
    const activeStores = storeRows[0].cnt;

    if (activeStores > 0 && rows[0].synced === 0) {
      const msg = `⚠️ <b>Zero Products Synced</b>\n\nNo products have been synced today despite ${activeStores} active store(s).\nCheck EPOS API connectivity and worker status.`;
      await alerts.send('anomaly_zero_sync', 'daily', msg);
      return { type: 'zero_sync', activeStores };
    }
  } catch (err) {
    logger.error(`[ANOMALY] checkZeroSync error: ${err.message}`);
  }
  return null;
}

// ------------------------------------------------------------------
//  4. Queue backlog: too many waiting jobs
// ------------------------------------------------------------------

async function checkQueueBacklog() {
  try {
    const counts = await syncQueue.queue.getJobCounts('waiting');
    const waiting = counts.waiting || 0;

    if (waiting > QUEUE_BACKLOG_THRESHOLD) {
      const failureDetector = require('./failure.detector');
      await failureDetector.queueBacklog(waiting);
      return { type: 'queue_backlog', waiting };
    }
  } catch (err) {
    logger.error(`[ANOMALY] checkQueueBacklog error: ${err.message}`);
  }
  return null;
}

module.exports = { runChecks, checkFailureSpike, checkStaleStores, checkZeroSync, checkQueueBacklog };

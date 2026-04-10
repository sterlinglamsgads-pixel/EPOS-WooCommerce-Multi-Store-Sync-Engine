const db     = require('../db/db');
const logger = require('../utils/logger');

// ------------------------------------------------------------------
//  Record metrics after a sync run completes
// ------------------------------------------------------------------

async function record(storeId, { synced = 0, failed = 0, created = 0, skipped = 0, durationMs = null } = {}) {
  try {
    const avgDuration = durationMs != null ? durationMs / 1000 : null;
    await db.query(
      `INSERT INTO sync_metrics (store_id, total_synced, total_failed, total_created, total_skipped, avg_duration)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [storeId, synced, failed, created, skipped, avgDuration]
    );
  } catch (err) {
    logger.error(`[METRICS] record error: ${err.message}`);
  }
}

// ------------------------------------------------------------------
//  Queries for dashboard / reports
// ------------------------------------------------------------------

async function getDailyStats(daysBack = 1) {
  const rows = await db.query(
    `SELECT
       COUNT(DISTINCT sm.store_id)             AS total_stores,
       COALESCE(SUM(sm.total_synced), 0)       AS total_synced,
       COALESCE(SUM(sm.total_failed), 0)       AS total_failed,
       COALESCE(SUM(sm.total_created), 0)      AS total_created,
       COALESCE(ROUND(AVG(sm.avg_duration), 2), 0) AS avg_duration
     FROM sync_metrics sm
     WHERE sm.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [daysBack]
  );
  const s = rows[0];
  const total = s.total_synced + s.total_failed;
  s.success_rate = total > 0 ? Math.round((s.total_synced / total) * 100) : 100;
  return s;
}

async function getSuccessRateOverTime(days = 30) {
  return db.query(
    `SELECT DATE(created_at) AS date,
            COALESCE(SUM(total_synced), 0)  AS synced,
            COALESCE(SUM(total_failed), 0)  AS failed,
            COALESCE(SUM(total_created), 0) AS created
       FROM sync_metrics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date`,
    [days]
  );
}

async function getStorePerformance() {
  return db.query(
    `SELECT sm.store_id, s.name AS store_name,
            COUNT(*)                                  AS total_runs,
            COALESCE(SUM(sm.total_synced), 0)         AS synced,
            COALESCE(SUM(sm.total_failed), 0)         AS failed,
            COALESCE(ROUND(AVG(sm.avg_duration), 2), 0) AS avg_duration
       FROM sync_metrics sm
       LEFT JOIN stores s ON sm.store_id = s.id
      WHERE sm.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY sm.store_id, s.name
      ORDER BY failed DESC`
  );
}

async function getFailuresOverTime(days = 14) {
  return db.query(
    `SELECT DATE(created_at) AS date,
            COALESCE(SUM(total_failed), 0) AS failed
       FROM sync_metrics
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY date`,
    [days]
  );
}

module.exports = { record, getDailyStats, getSuccessRateOverTime, getStorePerformance, getFailuresOverTime };

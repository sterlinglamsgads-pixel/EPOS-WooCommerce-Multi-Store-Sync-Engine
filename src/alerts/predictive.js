/**
 * Predictive Alerts Module
 * Detects trends and warns before problems become critical
 *
 * Checks:
 *  1. Failure rate trending up (3-day moving average)
 *  2. Queue growth rate acceleration
 *  3. Store sync duration degradation
 *  4. Approaching rate limits (failure frequency)
 */

const db     = require('../db/db');
const logger = require('../utils/logger');
const alerts = require('./alert.service');
const syncQueue = require('../sync/sync.queue');

// ------------------------------------------------------------------
//  Record a data point for trend analysis
// ------------------------------------------------------------------

async function recordMetric(metricType, storeId, value) {
  try {
    await db.query(
      'INSERT INTO predictive_metrics (metric_type, store_id, value) VALUES (?, ?, ?)',
      [metricType, storeId, value]
    );
  } catch (err) {
    logger.error(`[PREDICTIVE] recordMetric error: ${err.message}`);
  }
}

// ------------------------------------------------------------------
//  Run all predictive checks
// ------------------------------------------------------------------

async function runAll() {
  const results = [];
  results.push(await checkFailureTrend());
  results.push(await checkQueueGrowth());
  results.push(await checkStoreDegradation());
  results.push(await checkRateLimitApproaching());
  return results.filter(Boolean);
}

// ------------------------------------------------------------------
//  1. Failure rate trending up over 3 days
// ------------------------------------------------------------------

async function checkFailureTrend() {
  try {
    const rows = await db.query(
      `SELECT DATE(created_at) AS day,
              COALESCE(SUM(total_failed), 0) AS failures
         FROM sync_metrics
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
        GROUP BY DATE(created_at)
        ORDER BY day`
    );

    if (rows.length < 2) return null;

    // Check if each day is worse than the previous
    let increasing = true;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].failures <= rows[i - 1].failures) {
        increasing = false;
        break;
      }
    }

    if (increasing && rows[rows.length - 1].failures > 5) {
      const trend = rows.map(r => `${r.day}: ${r.failures}`).join(', ');
      const msg = `📈 <b>Predictive: Failure Trend Rising</b>\n\nFailures are increasing day-over-day:\n${trend}\n\nInvestigate before it becomes critical.`;
      await alerts.send('predictive_failure_trend', 'global', msg);
      return { type: 'failure_trend', data: rows };
    }
  } catch (err) {
    logger.error(`[PREDICTIVE] checkFailureTrend error: ${err.message}`);
  }
  return null;
}

// ------------------------------------------------------------------
//  2. Queue growth rate accelerating
// ------------------------------------------------------------------

async function checkQueueGrowth() {
  try {
    const counts = await syncQueue.queue.getJobCounts('waiting', 'active', 'delayed');
    const total = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);

    // Record the current queue size
    await recordMetric('queue_size', null, total);

    // Get last 6 readings
    const readings = await db.query(
      `SELECT value, recorded_at
         FROM predictive_metrics
        WHERE metric_type = 'queue_size'
        ORDER BY recorded_at DESC
        LIMIT 6`
    );

    if (readings.length < 3) return null;

    // Check if queue is consistently growing
    let growthCount = 0;
    for (let i = 0; i < readings.length - 1; i++) {
      if (readings[i].value > readings[i + 1].value) growthCount++;
    }

    if (growthCount >= Math.min(readings.length - 1, 4) && total > 100) {
      const msg = `📊 <b>Predictive: Queue Growing</b>\n\nQueue size: ${total}\nGrowing in ${growthCount}/${readings.length - 1} recent checks.\n\nWorkers may not be keeping up with demand.`;
      await alerts.send('predictive_queue_growth', 'global', msg);
      return { type: 'queue_growth', total, growthCount };
    }
  } catch (err) {
    logger.error(`[PREDICTIVE] checkQueueGrowth error: ${err.message}`);
  }
  return null;
}

// ------------------------------------------------------------------
//  3. Store sync duration degrading
// ------------------------------------------------------------------

async function checkStoreDegradation() {
  try {
    const stores = await db.query(
      `SELECT sm.store_id, s.name,
              AVG(CASE WHEN sm.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
                       THEN sm.avg_duration END) AS recent_avg,
              AVG(CASE WHEN sm.created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
                        AND sm.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                       THEN sm.avg_duration END) AS historical_avg
         FROM sync_metrics sm
         LEFT JOIN stores s ON sm.store_id = s.id
        WHERE sm.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND sm.avg_duration IS NOT NULL
        GROUP BY sm.store_id, s.name
       HAVING recent_avg IS NOT NULL AND historical_avg IS NOT NULL`
    );

    const degraded = stores.filter(s =>
      s.recent_avg > s.historical_avg * 2 && s.recent_avg > 5
    );

    if (degraded.length > 0) {
      const details = degraded.map(s =>
        `• ${s.name}: ${s.recent_avg.toFixed(1)}s avg (was ${s.historical_avg.toFixed(1)}s)`
      ).join('\n');
      const msg = `🐌 <b>Predictive: Store Slowdown</b>\n\n${degraded.length} store(s) slowing down:\n${details}`;
      await alerts.send('predictive_store_degradation', 'global', msg);
      return { type: 'store_degradation', stores: degraded };
    }
  } catch (err) {
    logger.error(`[PREDICTIVE] checkStoreDegradation error: ${err.message}`);
  }
  return null;
}

// ------------------------------------------------------------------
//  4. Approaching rate limits (high failure frequency)
// ------------------------------------------------------------------

async function checkRateLimitApproaching() {
  try {
    const rows = await db.query(
      `SELECT store_id, s.name,
              COUNT(*) AS recent_failures
         FROM failure_logs fl
         LEFT JOIN stores s ON fl.store_id = s.id
        WHERE fl.last_occurred >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
          AND fl.error LIKE '%429%' OR fl.error LIKE '%rate%' OR fl.error LIKE '%throttle%'
        GROUP BY store_id, s.name
       HAVING recent_failures >= 3`
    );

    if (rows.length > 0) {
      const details = rows.map(r => `• ${r.name}: ${r.recent_failures} rate-limit hits`).join('\n');
      const msg = `⚡ <b>Predictive: Rate Limits Approaching</b>\n\n${rows.length} store(s) hitting rate limits:\n${details}\n\nConsider reducing sync frequency.`;
      await alerts.send('predictive_rate_limit', 'global', msg);
      return { type: 'rate_limit_approaching', stores: rows };
    }
  } catch (err) {
    logger.error(`[PREDICTIVE] checkRateLimitApproaching error: ${err.message}`);
  }
  return null;
}

// ------------------------------------------------------------------
//  Dashboard: get prediction history
// ------------------------------------------------------------------

async function getPredictionHistory(days = 7) {
  return db.query(
    `SELECT metric_type, store_id, value, recorded_at
       FROM predictive_metrics
      WHERE recorded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY recorded_at DESC
      LIMIT 200`,
    [days]
  );
}

module.exports = {
  runAll,
  recordMetric,
  checkFailureTrend,
  checkQueueGrowth,
  checkStoreDegradation,
  checkRateLimitApproaching,
  getPredictionHistory,
};

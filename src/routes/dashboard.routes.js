const { Router }     = require('express');
const { apiKeyAuth } = require('../middleware/auth');
const db             = require('../db/db');
const syncQueue      = require('../sync/sync.queue');
const cache          = require('../utils/cache');
const logger         = require('../utils/logger');
const analytics      = require('../alerts/analytics');
const failureDetector = require('../alerts/failure.detector');
const anomalyDetector = require('../alerts/anomaly.detector');
const dailyReport    = require('../alerts/daily.report');

const router = Router();
router.use(apiKeyAuth);

// ------------------------------------------------------------------
//  Dashboard summary
// ------------------------------------------------------------------

router.get('/summary', async (_req, res) => {
  try {
    const [storeRows]   = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM stores WHERE is_active = 1'),
    ]);

    const totalStores = storeRows[0].count;

    const [syncedRows] = await Promise.all([
      db.query(
        `SELECT COALESCE(SUM(synced + created), 0) AS total
           FROM sync_runs WHERE status = 'completed'`
      ),
    ]);
    const totalProductsSynced = syncedRows[0].total;

    const failedCounts = await syncQueue.queue.getJobCounts('failed');
    const failedJobs   = failedCounts.failed || 0;

    const [lastSyncRows] = await Promise.all([
      db.query(
        'SELECT MAX(finished_at) AS last_sync FROM sync_runs WHERE finished_at IS NOT NULL'
      ),
    ]);
    const lastSyncTime = lastSyncRows[0].last_sync || null;

    // Sync activity last 7 days
    const activity = await db.query(
      `SELECT DATE(created_at) AS date,
              SUM(status = 'success') AS success,
              SUM(status = 'failed')  AS failed
         FROM sync_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date`
    );

    res.json({
      totalStores,
      totalProductsSynced,
      failedJobs,
      lastSyncTime,
      activity,
    });
  } catch (err) {
    logger.error(`[DASHBOARD] summary error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Stores list (with sync status)
// ------------------------------------------------------------------

router.get('/stores', async (_req, res) => {
  try {
    const stores = await db.query(
      `SELECT s.id, s.name, s.sync_direction, s.is_active, s.last_synced_at,
              (SELECT COUNT(*) FROM product_mappings pm WHERE pm.store_id = s.id) AS total_products,
              (SELECT sr.status FROM sync_runs sr WHERE sr.store_id = s.id
                ORDER BY sr.id DESC LIMIT 1) AS last_status
         FROM stores s
        ORDER BY s.id`
    );
    res.json({ stores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Failed jobs
// ------------------------------------------------------------------

router.get('/jobs/failed', async (_req, res) => {
  try {
    const failed = await syncQueue.queue.getFailed(0, 100);
    const jobs = failed.map((job) => ({
      id:         job.id,
      name:       job.name,
      storeId:    job.data.storeId || null,
      sku:        job.data.eposProduct?.sku || null,
      error:      job.failedReason || '',
      attempts:   job.attemptsMade,
      failedAt:   job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      data:       job.data,
    }));
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Retry a failed job
// ------------------------------------------------------------------

router.post('/jobs/retry/:jobId', async (req, res) => {
  try {
    const job = await syncQueue.queue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    await job.retry();
    logger.info(`[DASHBOARD] Retried job ${job.id}`);
    res.json({ retried: true, jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Retry ALL failed jobs
// ------------------------------------------------------------------

router.post('/jobs/retry-all', async (_req, res) => {
  try {
    const failed = await syncQueue.queue.getFailed(0, 500);
    let count = 0;
    for (const job of failed) {
      await job.retry();
      count++;
    }
    logger.info(`[DASHBOARD] Retried ${count} failed jobs`);
    res.json({ retried: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Sync logs (paginated, filterable)
// ------------------------------------------------------------------

router.get('/logs', async (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const storeId = req.query.store_id;
    const status  = req.query.status;

    let sql      = 'SELECT l.*, s.name AS store_name FROM sync_logs l LEFT JOIN stores s ON l.store_id = s.id';
    const where  = [];
    const params = [];

    if (storeId) { where.push('l.store_id = ?'); params.push(parseInt(storeId, 10)); }
    if (status)  { where.push('l.status = ?');    params.push(status); }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY l.id DESC LIMIT ?';
    params.push(limit);

    const logs = await db.query(sql, params);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  System health
// ------------------------------------------------------------------

router.get('/health', async (_req, res) => {
  const health = { db: 'disconnected', redis: 'disconnected', queue: 'unknown' };

  // DB check
  try {
    await db.query('SELECT 1');
    health.db = 'connected';
  } catch { /* stays disconnected */ }

  // Redis check
  try {
    const Redis = require('ioredis');
    const { connection } = require('../config/redis');
    const client = new Redis({ ...connection, lazyConnect: true, connectTimeout: 3000 });
    await client.connect();
    await client.ping();
    health.redis = 'connected';
    await client.quit();
  } catch { /* stays disconnected */ }

  // Queue check
  try {
    const counts = await syncQueue.queue.getJobCounts();
    health.queue = 'running';
    health.queueCounts = counts;
  } catch {
    health.queue = 'error';
  }

  res.json(health);
});

// ------------------------------------------------------------------
//  Live activity feed
// ------------------------------------------------------------------

router.get('/activity', async (_req, res) => {
  try {
    const active    = await syncQueue.queue.getActive(0, 10);
    const waiting   = await syncQueue.queue.getWaiting(0, 10);
    const completed = await syncQueue.queue.getCompleted(0, 10);

    const format = (job, state) => ({
      id:      job.id,
      name:    job.name,
      state,
      storeId: job.data.storeId || null,
      sku:     job.data.eposProduct?.sku || null,
      ts:      job.processedOn || job.timestamp,
    });

    const items = [
      ...active.map((j) => format(j, 'active')),
      ...waiting.map((j) => format(j, 'waiting')),
      ...completed.map((j) => format(j, 'completed')),
    ].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 20);

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Analytics: success rate over time
// ------------------------------------------------------------------

router.get('/analytics/success-rate', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const data = await analytics.getSuccessRateOverTime(days);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Analytics: failures over time
// ------------------------------------------------------------------

router.get('/analytics/failures', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 14, 90);
    const data = await analytics.getFailuresOverTime(days);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Analytics: store performance comparison
// ------------------------------------------------------------------

router.get('/analytics/store-performance', async (_req, res) => {
  try {
    const data = await analytics.getStorePerformance();
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Analytics: daily stats
// ------------------------------------------------------------------

router.get('/analytics/daily-stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 1;
    const data = await analytics.getDailyStats(days);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Failure logs (recurring failures)
// ------------------------------------------------------------------

router.get('/failures', async (req, res) => {
  try {
    const storeId = req.query.store_id ? parseInt(req.query.store_id, 10) : null;
    const data = await failureDetector.getOpenFailures(storeId);
    res.json({ failures: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Run anomaly checks on demand
// ------------------------------------------------------------------

router.post('/anomaly/check', async (_req, res) => {
  try {
    const results = await anomalyDetector.runChecks();
    res.json({ anomalies: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Trigger daily report on demand
// ------------------------------------------------------------------

router.post('/report/daily', async (_req, res) => {
  try {
    await dailyReport.sendDailyReport();
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Alert history
// ------------------------------------------------------------------

router.get('/alerts', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = await db.query(
      'SELECT * FROM alert_log ORDER BY sent_at DESC LIMIT ?',
      [limit]
    );
    res.json({ alerts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const { Router }     = require('express');
const db             = require('../db/db');
const syncQueue      = require('../sync/sync.queue');
const syncEngine     = require('../sync/sync.engine');
const audit          = require('../utils/audit');
const { requireAdmin, requireManager, requireViewer } = require('../middleware/jwt-auth');

const router = Router();

// ------------------------------------------------------------------
//  Stores CRUD
// ------------------------------------------------------------------

router.get('/stores', async (_req, res) => {
  try {
    const stores = await db.query(
      `SELECT id, name, epos_branch_id, woo_url, sync_direction,
              is_active, created_at
         FROM stores ORDER BY id`
    );
    res.json({ stores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stores', async (req, res) => {
  try {
    const { name, epos_branch_id, epos_api_url, epos_api_token,
            woo_url, woo_key, woo_secret, sync_direction } = req.body;

    if (!name || !epos_branch_id || !woo_url || !woo_key || !woo_secret) {
      return res.status(400).json({
        error: 'Required: name, epos_branch_id, woo_url, woo_key, woo_secret',
      });
    }

    const id = await db.insertAndGetId(
      `INSERT INTO stores
         (name, epos_branch_id, epos_api_url, epos_api_token,
          woo_url, woo_key, woo_secret, sync_direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, epos_branch_id, epos_api_url || null, epos_api_token || null,
       woo_url, woo_key, woo_secret, sync_direction || 'EPOS_TO_WOO']
    );
    res.status(201).json({ id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stores/:id', async (req, res) => {
  try {
    const store = await syncEngine.getStore(parseInt(req.params.id, 10));
    if (!store) return res.status(404).json({ error: 'Store not found' });
    // Strip credentials from response
    const { woo_key, woo_secret, epos_api_token, ...safe } = store;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/stores/:id', async (req, res) => {
  try {
    const allowed = [
      'name', 'epos_branch_id', 'epos_api_url', 'epos_api_token',
      'woo_url', 'woo_key', 'woo_secret', 'sync_direction', 'is_active',
    ];
    const fields = [];
    const values = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(parseInt(req.params.id, 10));
    await db.query(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Sync status & logs
// ------------------------------------------------------------------

router.get('/sync/status', async (req, res) => {
  try {
    const storeId = req.query.store_id;
    let sql    = 'SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20';
    let params = [];

    if (storeId) {
      sql    = 'SELECT * FROM sync_runs WHERE store_id = ? ORDER BY id DESC LIMIT 20';
      params = [parseInt(storeId, 10)];
    }

    const runs = await db.query(sql, params);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sync/logs', async (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const storeId = req.query.store_id;
    const status  = req.query.status;

    let sql        = 'SELECT * FROM sync_logs';
    const where    = [];
    const params   = [];

    if (storeId) { where.push('store_id = ?'); params.push(parseInt(storeId, 10)); }
    if (status)  { where.push('status = ?');   params.push(status); }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const logs = await db.query(sql, params);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Sync triggers
// ------------------------------------------------------------------

router.post('/sync/trigger', requireManager, async (req, res) => {
  try {
    await syncQueue.addSyncAllStoresJob();
    await audit.log(req, 'trigger_sync_all', 'sync', null, {});
    res.json({ message: 'Sync queued for all active stores' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync/trigger/:storeId', requireManager, async (req, res) => {
  try {
    const storeId = parseInt(req.params.storeId, 10);
    const store   = await syncEngine.getStore(storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });

    await syncQueue.addSyncStoreJob(storeId);
    await audit.log(req, 'trigger_sync_store', 'store', storeId, { storeName: store.name });
    res.json({ message: `Sync queued for store "${store.name}"` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Queue info
// ------------------------------------------------------------------

router.get('/sync/queue', async (_req, res) => {
  try {
    const counts = await syncQueue.queue.getJobCounts();
    res.json({ queue: counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

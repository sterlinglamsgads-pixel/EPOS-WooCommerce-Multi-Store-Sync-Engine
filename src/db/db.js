const mysql  = require('mysql2/promise');
const config = require('../config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:              config.db.host,
      port:              config.db.port,
      user:              config.db.user,
      password:          config.db.password,
      database:          config.db.database,
      waitForConnections: true,
      connectionLimit:   20,
      queueLimit:        0,
      charset:           'utf8mb4',
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function insertAndGetId(sql, params = []) {
  const [result] = await getPool().execute(sql, params);
  return result.insertId;
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ------------------------------------------------------------------
//  Mapping helpers
// ------------------------------------------------------------------

async function getMapping(storeId, eposProductId) {
  const rows = await query(
    'SELECT * FROM product_mappings WHERE store_id = ? AND epos_product_id = ? LIMIT 1',
    [storeId, String(eposProductId)]
  );
  return rows[0] || null;
}

// ------------------------------------------------------------------
//  Store sync-time helper
// ------------------------------------------------------------------

async function updateStoreSyncTime(storeId) {
  await query('UPDATE stores SET last_synced_at = NOW() WHERE id = ?', [storeId]);
}

module.exports = { getPool, query, insertAndGetId, close, getMapping, updateStoreSyncTime };

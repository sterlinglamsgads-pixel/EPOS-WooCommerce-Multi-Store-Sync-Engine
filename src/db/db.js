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

module.exports = { getPool, query, insertAndGetId, close };

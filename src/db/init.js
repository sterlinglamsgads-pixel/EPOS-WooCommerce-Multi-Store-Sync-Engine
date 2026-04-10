/**
 * Initialise the database schema by running schema.sql.
 * Usage: node src/db/init.js
 */
require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host:               process.env.DB_HOST || '127.0.0.1',
    port:               parseInt(process.env.DB_PORT, 10) || 3306,
    user:               process.env.DB_USER || 'root',
    password:           process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('[db:init] Schema applied successfully.');
  await conn.end();
  process.exit(0);
})();

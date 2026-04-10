/**
 * Audit Log Service
 * Records every significant user action for compliance and debugging
 */

const db     = require('../db/db');
const logger = require('../utils/logger');

// ------------------------------------------------------------------
//  Record an audit entry
// ------------------------------------------------------------------

async function log(req, action, resource, resourceId, details) {
  try {
    const userId   = req.user?.id || null;
    const username = req.user?.username || 'system';
    const ip       = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null;

    await db.query(
      `INSERT INTO audit_logs (user_id, username, action, resource, resource_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        username,
        action,
        resource || null,
        resourceId != null ? String(resourceId) : null,
        details ? JSON.stringify(details) : null,
        ip,
      ]
    );
  } catch (err) {
    logger.error(`[AUDIT] Log failed: ${err.message}`);
  }
}

// ------------------------------------------------------------------
//  System-level audit (no request context)
// ------------------------------------------------------------------

async function logSystem(action, resource, resourceId, details) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, username, action, resource, resource_id, details)
       VALUES (NULL, 'system', ?, ?, ?, ?)`,
      [action, resource || null, resourceId != null ? String(resourceId) : null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    logger.error(`[AUDIT] System log failed: ${err.message}`);
  }
}

// ------------------------------------------------------------------
//  Query audit logs (for dashboard)
// ------------------------------------------------------------------

async function getAuditLogs({ limit = 50, userId, action, resource } = {}) {
  let sql = 'SELECT * FROM audit_logs';
  const where = [];
  const params = [];

  if (userId)   { where.push('user_id = ?');   params.push(userId); }
  if (action)   { where.push('action = ?');     params.push(action); }
  if (resource) { where.push('resource = ?');   params.push(resource); }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(limit, 500));

  return db.query(sql, params);
}

// ------------------------------------------------------------------
//  Get distinct actions (for dashboard filter)
// ------------------------------------------------------------------

async function getDistinctActions() {
  return db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
}

module.exports = { log, logSystem, getAuditLogs, getDistinctActions };

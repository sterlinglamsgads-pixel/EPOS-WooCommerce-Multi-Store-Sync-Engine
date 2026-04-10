/**
 * JWT Authentication Middleware
 * Supports role-based access: admin, manager, viewer
 *
 * - Admin: full access (CRUD users, trigger syncs, manage stores, view everything)
 * - Manager: trigger syncs, manage stores, view everything
 * - Viewer: read-only access to dashboard
 *
 * Falls back to API key auth if no JWT token is present (backwards compat)
 */

const jwt    = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || config.apiKey || 'change-me-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// ------------------------------------------------------------------
//  Generate a JWT token
// ------------------------------------------------------------------

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

// ------------------------------------------------------------------
//  Verify JWT and attach user to request
// ------------------------------------------------------------------

function jwtAuth(req, res, next) {
  // Check for Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  // Fallback: API key auth (backwards compatibility)
  if (config.apiKey) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === config.apiKey) {
      req.user = { id: 0, username: 'api-key', role: 'admin' };
      return next();
    }
  }

  // No auth configured → open access (dev mode)
  if (!config.apiKey && !process.env.JWT_SECRET) {
    req.user = { id: 0, username: 'anonymous', role: 'admin' };
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
}

// ------------------------------------------------------------------
//  Role-based access control middleware factories
// ------------------------------------------------------------------

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

const requireAdmin   = requireRole('admin');
const requireManager = requireRole('admin', 'manager');
const requireViewer  = requireRole('admin', 'manager', 'viewer');

module.exports = {
  generateToken,
  jwtAuth,
  requireRole,
  requireAdmin,
  requireManager,
  requireViewer,
  JWT_SECRET,
};

/**
 * User Management Routes
 * - Login (get JWT token)
 * - Register (admin only)
 * - List / update / delete users (admin only)
 * - Change own password
 * - Get current user profile
 */

const { Router }      = require('express');
const bcrypt          = require('bcryptjs');
const db              = require('../db/db');
const logger          = require('../utils/logger');
const audit           = require('../utils/audit');
const { generateToken, jwtAuth, requireAdmin } = require('../middleware/jwt-auth');

const router = Router();

const SALT_ROUNDS = 10;

// ------------------------------------------------------------------
//  Login (public — no auth required)
// ------------------------------------------------------------------

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const rows = await db.query(
      'SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1',
      [username]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const token = generateToken(user);

    // Audit
    const fakeReq = { user: { id: user.id, username: user.username }, ip: req.ip, headers: req.headers, connection: req.connection };
    await audit.log(fakeReq, 'login', 'user', user.id, { username: user.username });

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error(`[AUTH] Login error: ${err.message}`);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ------------------------------------------------------------------
//  Get current user profile
// ------------------------------------------------------------------

router.get('/me', jwtAuth, async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, username, email, role, is_active, last_login, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Change own password
// ------------------------------------------------------------------

router.put('/me/password', jwtAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const rows = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);

    await audit.log(req, 'change_password', 'user', req.user.id, {});
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  List all users (admin only)
// ------------------------------------------------------------------

router.get('/', jwtAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await db.query(
      'SELECT id, username, email, role, is_active, last_login, created_at FROM users ORDER BY id'
    );
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Create user (admin only)
// ------------------------------------------------------------------

router.post('/', jwtAuth, requireAdmin, async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const validRoles = ['admin', 'manager', 'viewer'];
    const userRole = validRoles.includes(role) ? role : 'viewer';

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = await db.insertAndGetId(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, hash, userRole]
    );

    await audit.log(req, 'create_user', 'user', id, { username, email, role: userRole });
    res.status(201).json({ id, username, email, role: userRole });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Update user (admin only)
// ------------------------------------------------------------------

router.put('/:id', jwtAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { username, email, role, is_active, password } = req.body;

    const fields = [];
    const values = [];

    if (username !== undefined) { fields.push('username = ?'); values.push(username); }
    if (email !== undefined)    { fields.push('email = ?');    values.push(email); }
    if (role !== undefined) {
      const validRoles = ['admin', 'manager', 'viewer'];
      if (validRoles.includes(role)) { fields.push('role = ?'); values.push(role); }
    }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      fields.push('password_hash = ?');
      values.push(hash);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    await audit.log(req, 'update_user', 'user', userId, { fields: fields.map(f => f.split(' ')[0]) });
    res.json({ updated: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Delete user (admin only, cannot delete self)
// ------------------------------------------------------------------

router.delete('/:id', jwtAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await db.query('DELETE FROM users WHERE id = ?', [userId]);
    await audit.log(req, 'delete_user', 'user', userId, {});
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
//  Bootstrap: create default admin if no users exist
// ------------------------------------------------------------------

async function ensureDefaultAdmin() {
  try {
    const rows = await db.query('SELECT COUNT(*) AS cnt FROM users');
    if (rows[0].cnt === 0) {
      const defaultPass = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123!';
      const hash = await bcrypt.hash(defaultPass, SALT_ROUNDS);
      await db.query(
        "INSERT INTO users (username, email, password_hash, role) VALUES ('admin', 'admin@localhost', ?, 'admin')",
        [hash]
      );
      logger.info('[AUTH] Default admin created (username: admin)');
    }
  } catch (err) {
    // Table might not exist yet — that's okay
    logger.debug(`[AUTH] ensureDefaultAdmin: ${err.message}`);
  }
}

module.exports = { router, ensureDefaultAdmin };

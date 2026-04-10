const config = require('../config');

function apiKeyAuth(req, res, next) {
  if (!config.apiKey) return next(); // no key configured → open access
  const key = req.headers['x-api-key'];
  if (key && key === config.apiKey) return next();
  return res.status(401).json({ error: 'Invalid or missing API key' });
}

module.exports = { apiKeyAuth };

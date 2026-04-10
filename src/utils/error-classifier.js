/**
 * Error Classification System
 * Categorizes sync errors into types with recommended actions
 */

const ERROR_TYPES = {
  NETWORK:    'NETWORK',
  AUTH:       'AUTH',
  DATA:       'DATA',
  RATE_LIMIT: 'RATE_LIMIT',
  UNKNOWN:    'UNKNOWN',
};

const RETRY_STRATEGIES = {
  NETWORK:    { shouldRetry: true,  delay: 5000,  maxAttempts: 5, action: 'retry' },
  AUTH:       { shouldRetry: false, delay: 0,     maxAttempts: 0, action: 'stop_and_alert' },
  DATA:       { shouldRetry: false, delay: 0,     maxAttempts: 0, action: 'stop_and_log' },
  RATE_LIMIT: { shouldRetry: true,  delay: 10000, maxAttempts: 8, action: 'retry_with_backoff' },
  UNKNOWN:    { shouldRetry: true,  delay: 3000,  maxAttempts: 3, action: 'retry' },
};

// Network error patterns
const NETWORK_PATTERNS = [
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNABORTED/i,
  /socket hang up/i,
  /network error/i,
  /getaddrinfo/i,
  /EHOSTUNREACH/i,
  /EAI_AGAIN/i,
  /timeout/i,
  /EPIPE/i,
];

// Auth error patterns
const AUTH_PATTERNS = [
  /401/,
  /403/,
  /unauthorized/i,
  /forbidden/i,
  /invalid.*token/i,
  /invalid.*key/i,
  /authentication/i,
  /consumer_key/i,
  /consumer_secret/i,
  /woocommerce_rest_authentication_error/i,
];

// Data / validation error patterns
const DATA_PATTERNS = [
  /400/,
  /422/,
  /invalid.*sku/i,
  /duplicate.*sku/i,
  /product_invalid_sku/i,
  /rest_invalid_param/i,
  /invalid.*price/i,
  /missing.*field/i,
  /validation/i,
];

// Rate limit patterns
const RATE_LIMIT_PATTERNS = [
  /429/,
  /too many requests/i,
  /rate limit/i,
  /throttle/i,
  /quota exceeded/i,
];

/**
 * Classify an error into a known type
 */
function classify(error) {
  const message = typeof error === 'string' ? error : (error?.message || '');
  const status  = error?.response?.status || error?.status || null;

  // Check HTTP status codes first (most reliable)
  if (status === 401 || status === 403) {
    return buildResult(ERROR_TYPES.AUTH, message, status);
  }
  if (status === 429) {
    return buildResult(ERROR_TYPES.RATE_LIMIT, message, status);
  }
  if (status === 400 || status === 422) {
    return buildResult(ERROR_TYPES.DATA, message, status);
  }

  // Check message patterns
  if (matchesAny(message, RATE_LIMIT_PATTERNS)) {
    return buildResult(ERROR_TYPES.RATE_LIMIT, message, status);
  }
  if (matchesAny(message, AUTH_PATTERNS)) {
    return buildResult(ERROR_TYPES.AUTH, message, status);
  }
  if (matchesAny(message, DATA_PATTERNS)) {
    return buildResult(ERROR_TYPES.DATA, message, status);
  }
  if (matchesAny(message, NETWORK_PATTERNS)) {
    return buildResult(ERROR_TYPES.NETWORK, message, status);
  }

  // Server errors (5xx) → treat as network/transient
  if (status >= 500 && status < 600) {
    return buildResult(ERROR_TYPES.NETWORK, message, status);
  }

  return buildResult(ERROR_TYPES.UNKNOWN, message, status);
}

function buildResult(type, message, httpStatus) {
  const strategy = RETRY_STRATEGIES[type];
  return {
    type,
    message,
    httpStatus,
    shouldRetry: strategy.shouldRetry,
    delay:       strategy.delay,
    maxAttempts: strategy.maxAttempts,
    action:      strategy.action,
  };
}

function matchesAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

module.exports = { classify, ERROR_TYPES, RETRY_STRATEGIES };

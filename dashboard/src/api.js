const BASE = '/api/dashboard';
const AUTH_BASE = '/api/users';

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('jwtToken');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Fallback: API key
  const key = localStorage.getItem('apiKey');
  if (key) headers['X-API-Key'] = key;
  return headers;
}

async function request(path, opts = {}) {
  const headers = getAuthHeaders();
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    // Clear stale token
    localStorage.removeItem('jwtToken');
    window.dispatchEvent(new Event('auth-required'));
    throw new Error('Unauthorized');
  }
  if (res.status === 403) {
    throw new Error('Insufficient permissions');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function authRequest(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('jwtToken');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${AUTH_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  login:              (username, password) => authRequest('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  getMe:              ()          => authRequest('/me'),
  changePassword:     (currentPassword, newPassword) => authRequest('/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),

  // User management (admin)
  getUsers:           ()          => authRequest('/', ),
  createUser:         (data)      => authRequest('/', { method: 'POST', body: JSON.stringify(data) }),
  updateUser:         (id, data)  => authRequest(`/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser:         (id)        => authRequest(`/${id}`, { method: 'DELETE' }),

  // Dashboard
  getSummary:         ()          => request('/summary'),
  getStores:          ()          => request('/stores'),
  getFailedJobs:      ()          => request('/jobs/failed'),
  retryJob:           (id)        => request(`/jobs/retry/${encodeURIComponent(id)}`, { method: 'POST' }),
  retryAll:           ()          => request('/jobs/retry-all', { method: 'POST' }),
  getLogs:            (params)    => request(`/logs?${new URLSearchParams(params)}`),
  getHealth:          ()          => request('/health'),
  getActivity:        ()          => request('/activity'),
  getSuccessRate:     (days = 30) => request(`/analytics/success-rate?days=${days}`),
  getFailuresOverTime:(days = 14) => request(`/analytics/failures?days=${days}`),
  getStorePerformance:()          => request('/analytics/store-performance'),
  getDailyStats:      (days = 1)  => request(`/analytics/daily-stats?days=${days}`),
  getFailures:        (storeId)   => request(`/failures${storeId ? `?store_id=${storeId}` : ''}`),
  runAnomalyCheck:    ()          => request('/anomaly/check', { method: 'POST' }),
  sendDailyReport:    ()          => request('/report/daily', { method: 'POST' }),
  getAlerts:          (limit = 50)=> request(`/alerts?limit=${limit}`),

  // Self-Healing
  getHealingHistory:  (limit = 50)=> request(`/healing/history?limit=${limit}`),
  getHealingStats:    ()          => request('/healing/stats'),

  // Predictive
  runPredictiveCheck: ()          => request('/predictive/check', { method: 'POST' }),
  getPredictiveHistory:(days = 7) => request(`/predictive/history?days=${days}`),

  // Audit
  getAuditLogs:       (params={}) => request(`/audit?${new URLSearchParams(params)}`),
  getAuditActions:    ()          => request('/audit/actions'),

  // Insights
  getInsights:        ()          => request('/insights'),

  triggerSync:        (storeId)   => {
    const headers = getAuthHeaders();
    return fetch(`/api/sync/trigger/${storeId}`, { method: 'POST', headers })
      .then(r => r.json());
  },
};

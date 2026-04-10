const BASE = '/api/dashboard';

const API_KEY = localStorage.getItem('apiKey') || '';

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;

  const key = localStorage.getItem('apiKey');
  if (key) headers['X-API-Key'] = key;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    const newKey = prompt('Enter API Key:');
    if (newKey) {
      localStorage.setItem('apiKey', newKey);
      window.location.reload();
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
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
  triggerSync:        (storeId)   => {
    const base = '/api';
    const headers = { 'Content-Type': 'application/json' };
    const key = localStorage.getItem('apiKey');
    if (key) headers['X-API-Key'] = key;
    return fetch(`${base}/sync/trigger/${storeId}`, { method: 'POST', headers })
      .then(r => r.json());
  },
};

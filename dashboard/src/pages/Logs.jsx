import { useState, useCallback } from 'react';
import { api } from '../api';
import { usePolling } from '../usePolling';

function Badge({ status }) {
  const map = {
    success: 'bg-green-100 text-green-700',
    failed:  'bg-red-100 text-red-700',
    skipped: 'bg-gray-100 text-gray-600',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-600';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

export default function Logs() {
  const [storeId, setStoreId] = useState('');
  const [status, setStatus]   = useState('');

  const fetcher = useCallback(
    () => {
      const params = {};
      if (storeId) params.store_id = storeId;
      if (status)  params.status = status;
      params.limit = 100;
      return api.getLogs(params);
    },
    [storeId, status]
  );
  const { data, loading, error } = usePolling(fetcher, 8000);

  // Also fetch stores for the filter dropdown
  const storesFetcher = useCallback(() => api.getStores(), []);
  const { data: storesData } = usePolling(storesFetcher, 60000);
  const stores = storesData?.stores || [];

  const logs = data?.logs || [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Sync Logs</h2>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading && !data ? (
          <div className="p-10 text-center text-gray-400 animate-pulse">Loading…</div>
        ) : error ? (
          <div className="p-4 text-red-600 text-sm">{error}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-10">No logs found</td></tr>
              ) : logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(l.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">{l.store_name || l.store_id}</td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-600">{l.sku || '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{l.action}</td>
                  <td className="px-4 py-2"><Badge status={l.status} /></td>
                  <td className="px-4 py-2 text-sm text-gray-600 max-w-md truncate" title={l.message}>
                    {l.message || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

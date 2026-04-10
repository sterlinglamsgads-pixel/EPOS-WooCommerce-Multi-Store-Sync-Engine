import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api';
import { usePolling } from '../usePolling';

function Badge({ status }) {
  const map = {
    completed: 'bg-green-100 text-green-700',
    running:   'bg-blue-100 text-blue-700',
    failed:    'bg-red-100 text-red-700',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status || 'N/A'}
    </span>
  );
}

export default function Stores() {
  const fetcher = useCallback(() => api.getStores(), []);
  const { data, loading, error, refetch } = usePolling(fetcher, 10000);

  async function handleSync(storeId, name) {
    try {
      await api.triggerSync(storeId);
      toast.success(`Sync queued for "${name}"`);
      setTimeout(refetch, 1000);
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    }
  }

  if (loading) return <TableSkeleton />;
  if (error)   return <ErrorMsg msg={error} />;

  const stores = data?.stores || [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Stores</h2>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Products</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Sync</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {stores.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-10">No stores configured</td></tr>
            ) : stores.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {s.name}
                  {!s.is_active && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.sync_direction}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.total_products}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {s.last_synced_at ? new Date(s.last_synced_at).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3"><Badge status={s.last_status} /></td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleSync(s.id, s.name)}
                    disabled={!s.is_active}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Sync Now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-32 bg-gray-200 rounded mb-6" />
      <div className="bg-gray-200 h-80 rounded-lg" />
    </div>
  );
}

function ErrorMsg({ msg }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
      <p className="font-medium">Error loading stores</p>
      <p className="text-sm mt-1">{msg}</p>
    </div>
  );
}

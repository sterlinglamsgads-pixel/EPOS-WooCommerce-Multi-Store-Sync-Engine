import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api';
import { usePolling } from '../usePolling';

export default function FailedJobs() {
  const fetcher = useCallback(() => api.getFailedJobs(), []);
  const { data, loading, error, refetch } = usePolling(fetcher, 5000);

  async function handleRetry(jobId) {
    try {
      await api.retryJob(jobId);
      toast.success(`Job ${jobId} re-queued`);
      setTimeout(refetch, 800);
    } catch (err) {
      toast.error(`Retry failed: ${err.message}`);
    }
  }

  async function handleRetryAll() {
    try {
      const result = await api.retryAll();
      toast.success(`${result.retried} job(s) re-queued`);
      setTimeout(refetch, 800);
    } catch (err) {
      toast.error(`Retry all failed: ${err.message}`);
    }
  }

  if (loading) return <SkeletonBlock />;
  if (error)   return <ErrorMsg msg={error} />;

  const jobs = data?.jobs || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Failed Jobs</h2>
        {jobs.length > 0 && (
          <button
            onClick={handleRetryAll}
            className="px-4 py-2 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Retry All ({jobs.length})
          </button>
        )}
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attempts</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-10">
                  No failed jobs — all clear! ✅
                </td>
              </tr>
            ) : jobs.map((j) => (
              <tr key={j.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono text-gray-600">{j.id}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{j.name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{j.storeId || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{j.sku || '—'}</td>
                <td className="px-4 py-3 text-sm text-red-600 max-w-xs truncate" title={j.error}>
                  {j.error || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{j.attempts}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleRetry(j.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                  >
                    Retry
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

function SkeletonBlock() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-40 bg-gray-200 rounded mb-6" />
      <div className="bg-gray-200 h-72 rounded-lg" />
    </div>
  );
}

function ErrorMsg({ msg }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
      <p className="font-medium">Error loading failed jobs</p>
      <p className="text-sm mt-1">{msg}</p>
    </div>
  );
}

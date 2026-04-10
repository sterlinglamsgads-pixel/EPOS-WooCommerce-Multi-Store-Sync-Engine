import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api';
import { usePolling } from '../usePolling';

export default function Alerts() {
  const alertsFetcher   = useCallback(() => api.getAlerts(100), []);
  const failuresFetcher = useCallback(() => api.getFailures(), []);

  const { data: alertsData, loading: aLoad }     = usePolling(alertsFetcher, 10000);
  const { data: failuresData, loading: fLoad, refetch } = usePolling(failuresFetcher, 10000);

  async function handleAnomalyCheck() {
    try {
      const result = await api.runAnomalyCheck();
      const count  = result.anomalies?.filter(Boolean).length || 0;
      toast.success(count > 0 ? `${count} anomaly(ies) detected — alerts sent` : 'No anomalies detected');
      setTimeout(refetch, 1000);
    } catch (err) {
      toast.error(`Check failed: ${err.message}`);
    }
  }

  async function handleSendReport() {
    try {
      await api.sendDailyReport();
      toast.success('Daily report sent');
    } catch (err) {
      toast.error(`Report failed: ${err.message}`);
    }
  }

  const alerts   = alertsData?.alerts || [];
  const failures = failuresData?.failures || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Alerts & Failures</h2>
        <div className="flex gap-2">
          <button
            onClick={handleAnomalyCheck}
            className="px-4 py-2 text-sm font-medium rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors"
          >
            Run Anomaly Check
          </button>
          <button
            onClick={handleSendReport}
            className="px-4 py-2 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Send Daily Report
          </button>
        </div>
      </div>

      {/* Recurring failures */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700">Recurring Failures (Unresolved)</h3>
        </div>
        {fLoad && !failuresData ? (
          <div className="p-10 text-center text-gray-400 animate-pulse">Loading…</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Failures</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">First Seen</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Occurred</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {failures.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-10">No recurring failures — all clear!</td></tr>
              ) : failures.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-700">{f.store_name || f.store_id}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">{f.sku || '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`font-bold ${f.fail_count >= 10 ? 'text-red-600' : f.fail_count >= 3 ? 'text-amber-600' : 'text-gray-600'}`}>
                      {f.fail_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-red-600 max-w-xs truncate" title={f.error}>
                    {f.error || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {f.first_seen ? new Date(f.first_seen).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {f.last_occurred ? new Date(f.last_occurred).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Alert history */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700">Alert History</h3>
        </div>
        {aLoad && !alertsData ? (
          <div className="p-10 text-center text-gray-400 animate-pulse">Loading…</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {alerts.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-gray-400 py-10">No alerts sent yet</td></tr>
              ) : alerts.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(a.sent_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    <TypeBadge type={a.alert_type} />
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-gray-600 max-w-xs truncate">{a.alert_key}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{a.channel}</td>
                  <td className="px-4 py-2 text-sm text-gray-600 max-w-md truncate" title={stripHtml(a.message)}>
                    {stripHtml(a.message)}
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

function TypeBadge({ type }) {
  const colors = {
    repeated_failure:      'bg-amber-100 text-amber-700',
    critical_failure:      'bg-red-100 text-red-700',
    store_sync_failed:     'bg-red-100 text-red-700',
    auth_failure:          'bg-purple-100 text-purple-700',
    queue_backlog:         'bg-yellow-100 text-yellow-700',
    anomaly_failure_spike: 'bg-orange-100 text-orange-700',
    anomaly_stale_stores:  'bg-orange-100 text-orange-700',
    anomaly_zero_sync:     'bg-orange-100 text-orange-700',
    daily_report:          'bg-blue-100 text-blue-700',
  };
  const cls = colors[type] || 'bg-gray-100 text-gray-600';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{type}</span>;
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '');
}

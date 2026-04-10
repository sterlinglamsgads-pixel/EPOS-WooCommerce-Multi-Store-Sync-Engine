import { useCallback } from 'react';
import { api } from '../api';
import { usePolling } from '../usePolling';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';

export default function Analytics() {
  const rateFetcher  = useCallback(() => api.getSuccessRate(30), []);
  const failFetcher  = useCallback(() => api.getFailuresOverTime(14), []);
  const perfFetcher  = useCallback(() => api.getStorePerformance(), []);
  const statsFetcher = useCallback(() => api.getDailyStats(7), []);

  const { data: rateData, loading: rLoad }  = usePolling(rateFetcher, 30000);
  const { data: failData, loading: fLoad }  = usePolling(failFetcher, 30000);
  const { data: perfData, loading: pLoad }  = usePolling(perfFetcher, 30000);
  const { data: statsData, loading: sLoad } = usePolling(statsFetcher, 30000);

  const stats = statsData?.data;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h2>

      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <MiniStat label="Synced (7d)" value={stats.total_synced} />
          <MiniStat label="Created (7d)" value={stats.total_created} />
          <MiniStat label="Failed (7d)" value={stats.total_failed} color="text-red-600" />
          <MiniStat label="Success Rate" value={`${stats.success_rate}%`} color={stats.success_rate >= 95 ? 'text-green-600' : 'text-amber-600'} />
          <MiniStat label="Avg Duration" value={`${stats.avg_duration}s`} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Success rate over time */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Sync Success vs Failed (30 Days)</h3>
          {rLoad && !rateData ? <ChartSkeleton /> : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={rateData?.data || []} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="synced"  stroke="#4f46e5" name="Synced"  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="failed"  stroke="#ef4444" name="Failed"  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="created" stroke="#10b981" name="Created" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Failures over time */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Failures (14 Days)</h3>
          {fLoad && !failData ? <ChartSkeleton /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={failData?.data || []} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="failed" fill="#ef4444" name="Failed" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Store performance table */}
      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Store Performance (30 Days)</h3>
        {pLoad && !perfData ? (
          <div className="animate-pulse h-40 bg-gray-100 rounded" />
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Runs</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Synced</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Failed</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Success %</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(perfData?.data || []).length === 0 ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-10">No data yet</td></tr>
              ) : (perfData?.data || []).map((s) => {
                const total = s.synced + s.failed;
                const rate  = total > 0 ? Math.round((s.synced / total) * 100) : 100;
                return (
                  <tr key={s.store_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.store_name || `Store #${s.store_id}`}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.total_runs}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.synced}</td>
                    <td className="px-4 py-3 text-sm text-red-600">{s.failed}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={rate >= 95 ? 'text-green-600' : rate >= 80 ? 'text-amber-600' : 'text-red-600'}>
                        {rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.avg_duration}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-lg shadow p-4 text-center">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value ?? '—'}</div>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="animate-pulse h-64 bg-gray-100 rounded" />;
}

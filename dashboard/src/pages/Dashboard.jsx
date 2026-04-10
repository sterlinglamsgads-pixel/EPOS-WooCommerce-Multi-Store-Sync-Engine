import { useCallback } from 'react';
import { api } from '../api';
import { usePolling } from '../usePolling';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

function StatCard({ label, value, color = 'text-gray-900', sub }) {
  return (
    <div className="bg-white rounded-lg shadow p-5 flex flex-col">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-3xl font-bold mt-1 ${color}`}>{value ?? '—'}</span>
      {sub && <span className="text-xs text-gray-400 mt-1">{sub}</span>}
    </div>
  );
}

function formatTime(ts) {
  if (!ts) return 'Never';
  const d = new Date(ts);
  return d.toLocaleString();
}

export default function Dashboard() {
  const fetcher = useCallback(() => api.getSummary(), []);
  const { data, loading, error } = usePolling(fetcher, 10000);

  if (loading) return <Skeleton />;
  if (error)   return <ErrorMsg msg={error} />;

  const { totalStores, totalProductsSynced, failedJobs, lastSyncTime, activity } = data;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Stores"     value={totalStores} />
        <StatCard label="Products Synced"  value={totalProductsSynced.toLocaleString()} color="text-indigo-600" />
        <StatCard label="Failed Jobs"      value={failedJobs} color={failedJobs > 0 ? 'text-red-600' : 'text-green-600'} />
        <StatCard label="Last Sync"        value={formatTime(lastSyncTime)} sub="" />
      </div>

      {/* Activity chart */}
      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Sync Activity (Last 7 Days)</h3>
        {activity && activity.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={activity} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="success" fill="#4f46e5" name="Success" radius={[4,4,0,0]} />
              <Bar dataKey="failed"  fill="#ef4444" name="Failed"  radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-400 text-sm py-10 text-center">No sync activity yet</p>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-40 bg-gray-200 rounded mb-6" />
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-lg" />)}
      </div>
      <div className="h-72 bg-gray-200 rounded-lg" />
    </div>
  );
}

function ErrorMsg({ msg }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
      <p className="font-medium">Error loading dashboard</p>
      <p className="text-sm mt-1">{msg}</p>
    </div>
  );
}

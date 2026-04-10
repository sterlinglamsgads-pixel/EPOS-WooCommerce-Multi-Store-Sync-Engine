import { useState, useEffect } from 'react';
import { api } from '../api';
import toast from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function InsightsPage() {
  const [insights, setInsights]           = useState(null);
  const [healHistory, setHealHistory]     = useState([]);
  const [predictions, setPredictions]     = useState([]);
  const [loading, setLoading]             = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [insData, healData, predData] = await Promise.all([
        api.getInsights(),
        api.getHealingHistory(20),
        api.getPredictiveHistory(7),
      ]);
      setInsights(insData);
      setHealHistory(healData.history);
      setPredictions(predData.history);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const runPredictive = async () => {
    try {
      const result = await api.runPredictiveCheck();
      toast.success(`${result.predictions.length} prediction(s) generated`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <p className="text-gray-500">Loading insights…</p>;

  const healStats = insights?.healStats || [];
  const dailyStats = insights?.dailyStats || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Insights & Predictions</h2>
        <button onClick={runPredictive} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors">
          Run Predictive Check
        </button>
      </div>

      {/* Daily Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Success Rate', value: `${dailyStats.success_rate || 0}%`, color: 'text-green-600' },
          { label: 'Synced Today', value: dailyStats.total_synced || 0, color: 'text-indigo-600' },
          { label: 'Failed Today', value: dailyStats.total_failed || 0, color: 'text-red-600' },
          { label: 'Created Today', value: dailyStats.total_created || 0, color: 'text-blue-600' },
          { label: 'Avg Duration', value: `${dailyStats.avg_duration || 0}s`, color: 'text-gray-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Self-Healing Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Self-Healing Actions (7d)</h3>
          {healStats.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={healStats.map(s => ({ name: s.action_type, value: Number(s.total) }))}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {healStats.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-sm">No self-healing actions recorded</p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Predictive Metrics (7d)</h3>
          {predictions.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={predictions.slice(0, 20)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="metric_type" tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-sm">No predictive metrics recorded yet</p>
          )}
        </div>
      </div>

      {/* Recent Self-Healing Actions */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">Recent Self-Healing Actions</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-2 text-left">Time</th>
              <th className="px-4 py-2 text-left">Store</th>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Action</th>
              <th className="px-4 py-2 text-left">Result</th>
              <th className="px-4 py-2 text-left">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {healHistory.map((h) => (
              <tr key={h.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{new Date(h.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">{h.store_name || h.store_id}</td>
                <td className="px-4 py-2 font-mono text-xs">{h.sku || '—'}</td>
                <td className="px-4 py-2">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700">{h.action_type}</span>
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${h.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {h.success ? 'Success' : 'Failed'}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate">{h.description}</td>
              </tr>
            ))}
            {healHistory.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No self-healing actions recorded</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

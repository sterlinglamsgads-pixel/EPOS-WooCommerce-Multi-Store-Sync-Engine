import { useState, useEffect } from 'react';
import { api } from '../api';
import toast from 'react-hot-toast';

export default function AuditPage() {
  const [logs, setLogs]       = useState([]);
  const [actions, setActions] = useState([]);
  const [filter, setFilter]   = useState({ action: '', limit: 50 });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [logsData, actionsData] = await Promise.all([
        api.getAuditLogs(filter),
        api.getAuditActions(),
      ]);
      setLogs(logsData.logs);
      setActions(actionsData.actions);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter.action]);

  const actionBadge = (action) => {
    const colors = {
      login: 'bg-blue-100 text-blue-700',
      create_user: 'bg-green-100 text-green-700',
      update_user: 'bg-yellow-100 text-yellow-700',
      delete_user: 'bg-red-100 text-red-700',
      trigger_sync_all: 'bg-purple-100 text-purple-700',
      trigger_sync_store: 'bg-purple-100 text-purple-700',
      change_password: 'bg-gray-100 text-gray-700',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[action] || 'bg-gray-100 text-gray-600'}`}>
        {action}
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Audit Logs</h2>
        <div className="flex gap-2">
          <select
            value={filter.action}
            onChange={(e) => setFilter({ ...filter, action: e.target.value })}
            className="px-3 py-1.5 border rounded-lg text-sm"
          >
            <option value="">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button onClick={load} className="px-3 py-1.5 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading audit logs…</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Resource</th>
                <th className="px-4 py-3 text-left">Details</th>
                <th className="px-4 py-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium">{log.username || '—'}</td>
                  <td className="px-4 py-3">{actionBadge(log.action)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {log.resource}{log.resource_id ? ` #${log.resource_id}` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">
                    {log.details ? (typeof log.details === 'string' ? log.details : JSON.stringify(log.details)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{log.ip_address || '—'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No audit logs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

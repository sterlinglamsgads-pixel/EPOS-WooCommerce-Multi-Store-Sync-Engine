import { useCallback } from 'react';
import { api } from '../api';
import { usePolling } from '../usePolling';

function StatusDot({ ok }) {
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
  );
}

export default function Health() {
  const healthFetcher   = useCallback(() => api.getHealth(), []);
  const activityFetcher = useCallback(() => api.getActivity(), []);

  const { data: health, loading: hLoad }  = usePolling(healthFetcher, 5000);
  const { data: activity, loading: aLoad } = usePolling(activityFetcher, 3000);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">System Health</h2>

      {/* Health cards */}
      {hLoad && !health ? (
        <div className="animate-pulse grid grid-cols-3 gap-4 mb-8">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-lg" />)}
        </div>
      ) : health ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <HealthCard label="Database" status={health.db} />
          <HealthCard label="Redis" status={health.redis} />
          <HealthCard label="Queue" status={health.queue} counts={health.queueCounts} />
        </div>
      ) : null}

      {/* Queue counts */}
      {health?.queueCounts && (
        <div className="bg-white shadow rounded-lg p-5 mb-8">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Queue Breakdown</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(health.queueCounts).map(([key, val]) => (
              <div key={key} className="text-center">
                <div className="text-2xl font-bold text-gray-900">{val}</div>
                <div className="text-xs text-gray-500 capitalize">{key}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live activity */}
      <div className="bg-white shadow rounded-lg p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          Live Activity
          <span className="ml-2 inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        </h3>
        {aLoad && !activity ? (
          <div className="animate-pulse h-40 bg-gray-100 rounded" />
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {(activity?.items || []).length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">No active jobs</p>
            ) : activity.items.map((item, i) => (
              <div key={`${item.id}-${i}`} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-gray-50">
                <ActivityBadge state={item.state} />
                <span className="text-sm text-gray-700 flex-1">
                  <span className="font-medium">{item.name}</span>
                  {item.storeId && <span className="text-gray-400 ml-1">(store {item.storeId})</span>}
                  {item.sku && <span className="text-gray-500 ml-1">— {item.sku}</span>}
                </span>
                <span className="text-xs text-gray-400">
                  {item.ts ? new Date(item.ts).toLocaleTimeString() : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HealthCard({ label, status, counts }) {
  const ok     = status === 'connected' || status === 'running';
  const bgCls  = ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50';
  const txtCls = ok ? 'text-green-700' : 'text-red-700';

  return (
    <div className={`rounded-lg border p-4 ${bgCls}`}>
      <div className="flex items-center gap-2 mb-1">
        <StatusDot ok={ok} />
        <span className="text-sm font-medium text-gray-800">{label}</span>
      </div>
      <div className={`text-lg font-bold capitalize ${txtCls}`}>{status}</div>
    </div>
  );
}

function ActivityBadge({ state }) {
  const map = {
    active:    'bg-blue-500',
    waiting:   'bg-amber-400',
    completed: 'bg-green-500',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${map[state] || 'bg-gray-400'}`} title={state} />
  );
}

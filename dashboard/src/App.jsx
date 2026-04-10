import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import DashboardPage from './pages/Dashboard';
import StoresPage    from './pages/Stores';
import FailedPage    from './pages/FailedJobs';
import LogsPage      from './pages/Logs';
import HealthPage    from './pages/Health';

const links = [
  { to: '/',        label: 'Dashboard',   icon: '📊' },
  { to: '/stores',  label: 'Stores',      icon: '🏪' },
  { to: '/failed',  label: 'Failed Jobs', icon: '❌' },
  { to: '/logs',    label: 'Logs',        icon: '📜' },
  { to: '/health',  label: 'Health',      icon: '❤️' },
];

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="px-4 py-5 border-b border-gray-700">
          <h1 className="text-lg font-bold tracking-tight">EPOS ↔ WOO</h1>
          <p className="text-xs text-gray-400 mt-0.5">Sync Dashboard</p>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {links.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
          v3.0 — Phase 3
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          <Routes>
            <Route path="/"       element={<DashboardPage />} />
            <Route path="/stores" element={<StoresPage />} />
            <Route path="/failed" element={<FailedPage />} />
            <Route path="/logs"   element={<LogsPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="*"       element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

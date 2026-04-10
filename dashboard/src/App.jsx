import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import DashboardPage  from './pages/Dashboard';
import StoresPage     from './pages/Stores';
import FailedPage     from './pages/FailedJobs';
import LogsPage       from './pages/Logs';
import HealthPage     from './pages/Health';
import AnalyticsPage  from './pages/Analytics';
import AlertsPage     from './pages/Alerts';
import UsersPage      from './pages/Users';
import AuditPage      from './pages/Audit';
import InsightsPage   from './pages/Insights';
import LoginPage      from './pages/Login';

const allLinks = [
  { to: '/',          label: 'Dashboard',   icon: '📊', roles: ['admin','manager','viewer'] },
  { to: '/stores',    label: 'Stores',      icon: '🏪', roles: ['admin','manager','viewer'] },
  { to: '/analytics', label: 'Analytics',   icon: '📈', roles: ['admin','manager','viewer'] },
  { to: '/insights',  label: 'Insights',    icon: '🧠', roles: ['admin','manager','viewer'] },
  { to: '/alerts',    label: 'Alerts',      icon: '🚨', roles: ['admin','manager','viewer'] },
  { to: '/failed',    label: 'Failed Jobs', icon: '❌', roles: ['admin','manager'] },
  { to: '/logs',      label: 'Logs',        icon: '📜', roles: ['admin','manager'] },
  { to: '/health',    label: 'Health',      icon: '❤️', roles: ['admin','manager'] },
  { to: '/users',     label: 'Users',       icon: '👥', roles: ['admin'] },
  { to: '/audit',     label: 'Audit Log',   icon: '📋', roles: ['admin'] },
];

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('auth-required', handler);
    return () => window.removeEventListener('auth-required', handler);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('jwtToken');
    localStorage.removeItem('user');
    setUser(null);
  };

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  const links = allLinks.filter(l => l.roles.includes(user.role));

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
        <div className="px-4 py-3 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-300">{user.username}</p>
              <p className="text-xs text-gray-500">{user.role}</p>
            </div>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-white transition-colors" title="Sign out">
              ↪ Out
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">v5.0 — Phase 5</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          <Routes>
            <Route path="/"          element={<DashboardPage />} />
            <Route path="/stores"    element={<StoresPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/insights"  element={<InsightsPage />} />
            <Route path="/alerts"    element={<AlertsPage />} />
            <Route path="/failed"    element={<FailedPage />} />
            <Route path="/logs"      element={<LogsPage />} />
            <Route path="/health"    element={<HealthPage />} />
            <Route path="/users"     element={<UsersPage />} />
            <Route path="/audit"     element={<AuditPage />} />
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

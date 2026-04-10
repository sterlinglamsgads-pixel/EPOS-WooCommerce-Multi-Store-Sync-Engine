import { useState, useEffect } from 'react';
import { api } from '../api';
import toast from 'react-hot-toast';

export default function UsersPage() {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ username: '', email: '', password: '', role: 'viewer' });

  const load = async () => {
    try {
      const data = await api.getUsers();
      setUsers(data.users);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.createUser(form);
      toast.success('User created');
      setShowForm(false);
      setForm({ username: '', email: '', password: '', role: 'viewer' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (user) => {
    try {
      await api.updateUser(user.id, { is_active: !user.is_active });
      toast.success(`User ${user.is_active ? 'deactivated' : 'activated'}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeRole = async (user, newRole) => {
    try {
      await api.updateUser(user.id, { role: newRole });
      toast.success('Role updated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteUser = async (user) => {
    if (!confirm(`Delete user "${user.username}"?`)) return;
    try {
      await api.deleteUser(user.id);
      toast.success('User deleted');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const roleBadge = (role) => {
    const colors = { admin: 'bg-red-100 text-red-700', manager: 'bg-yellow-100 text-yellow-700', viewer: 'bg-blue-100 text-blue-700' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[role] || 'bg-gray-100'}`}>{role}</span>;
  };

  if (loading) return <p className="text-gray-500">Loading users…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">User Management</h2>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors">
          {showForm ? 'Cancel' : '+ New User'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white p-4 rounded-lg shadow mb-6 grid grid-cols-2 gap-4">
          <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} placeholder="Username" className="px-3 py-2 border rounded-lg" required />
          <input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="Email" type="email" className="px-3 py-2 border rounded-lg" required />
          <input value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="Password (min 8)" type="password" className="px-3 py-2 border rounded-lg" required minLength={8} />
          <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="px-3 py-2 border rounded-lg">
            <option value="viewer">Viewer</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className="col-span-2 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">Create User</button>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">Username</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Last Login</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{u.username}</td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={e => changeRole(u, e.target.value)} className="text-xs border rounded px-1 py-0.5">
                    <option value="viewer">viewer</option>
                    <option value="manager">manager</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{u.last_login ? new Date(u.last_login).toLocaleString() : '—'}</td>
                <td className="px-4 py-3 space-x-2">
                  <button onClick={() => toggleActive(u)} className="text-xs text-indigo-600 hover:underline">
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => deleteUser(u)} className="text-xs text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

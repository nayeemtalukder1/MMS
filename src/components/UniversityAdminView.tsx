import React, { useState } from 'react';
import { Building2, Plus, Shield, Trash2, Users } from 'lucide-react';
import { apiFetch, formatRoleLabel } from '../lib/api';
import type {
  ActivityLog,
  Department,
  Designation,
  Faculty,
  UniversityProfile,
  User,
  UserRole,
} from '../types/utmms';

interface UniversityAdminViewProps {
  currentUser: User;
  university: UniversityProfile | null;
  faculties: Faculty[];
  departments: Department[];
  designations: Designation[];
  users: User[];
  activityLogs: ActivityLog[];
  onRefresh: () => void;
}

export const UniversityAdminView: React.FC<UniversityAdminViewProps> = ({
  currentUser,
  university,
  faculties,
  departments,
  designations,
  users,
  activityLogs,
  onRefresh,
}) => {
  const isSuperAdmin = currentUser.role === 'super_admin';
  const [tab, setTab] = useState<'directory' | 'structure' | 'settings' | 'logs'>('directory');

  // Faculty & Dept forms
  const [facName, setFacName] = useState('');
  const [facCode, setFacCode] = useState('');
  const [facDean, setFacDean] = useState('');

  const [deptFacId, setDeptFacId] = useState<string>(faculties[0] ? String(faculties[0].id) : '');
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptHeadId, setDeptHeadId] = useState<string>('');

  // New user form
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('Campus#2026');
  const [uRole, setURole] = useState<UserRole>('teacher');
  const [uDeptId, setUDeptId] = useState<string>('');
  const [uDesigId, setUDesigId] = useState<string>('');

  // University settings form
  const [uniForm, setUniForm] = useState({
    name: university?.name || 'Northbridge University',
    code: university?.code || 'NBU',
    domain: university?.domain || 'northbridge.edu',
    address: university?.address || '',
    min_attendance_percent: university?.min_attendance_percent ?? 75,
    email_notifications_enabled: Boolean(university?.email_notifications_enabled ?? 1),
    reminder_lead_minutes: university?.reminder_lead_minutes ?? 30,
    waiting_room_default: Boolean(university?.waiting_room_default ?? 1),
  });

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleCreateFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch('/api/faculties', {
        method: 'POST',
        body: JSON.stringify({ name: facName, code: facCode, dean_name: facDean }),
      });
      setFacName('');
      setFacCode('');
      setFacDean('');
      setMsg('Faculty created.');
      onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to create faculty.');
    }
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch('/api/departments', {
        method: 'POST',
        body: JSON.stringify({
          faculty_id: Number(deptFacId || faculties[0]?.id),
          name: deptName,
          code: deptCode,
          head_user_id: deptHeadId ? Number(deptHeadId) : null,
        }),
      });
      setDeptName('');
      setDeptCode('');
      setMsg('Department created.');
      onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to create department.');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const dept = departments.find((d) => d.id === Number(uDeptId));
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: uName,
          email: uEmail,
          password: uPassword,
          role: uRole,
          faculty_id: dept?.faculty_id ?? null,
          department_id: uDeptId ? Number(uDeptId) : null,
          designation_id: uDesigId ? Number(uDesigId) : null,
        }),
      });
      setUName('');
      setUEmail('');
      setMsg('User account created.');
      onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to create user.');
    }
  };

  const handleSaveUniSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch('/api/university', {
        method: 'PUT',
        body: JSON.stringify(uniForm),
      });
      setMsg('University governance & notification rules updated.');
      onRefresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to update settings.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl px-5 flex items-center gap-6 overflow-x-auto text-xs font-medium">
        <button
          type="button"
          onClick={() => setTab('directory')}
          className={`py-3.5 border-b-2 whitespace-nowrap ${
            tab === 'directory' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500'
          }`}
        >
          Faculty & Teacher Directory ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('structure')}
          className={`py-3.5 border-b-2 whitespace-nowrap ${
            tab === 'structure' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500'
          }`}
        >
          Faculties & Departments
        </button>
        {isSuperAdmin && (
          <>
            <button
              type="button"
              onClick={() => setTab('settings')}
              className={`py-3.5 border-b-2 whitespace-nowrap ${
                tab === 'settings' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500'
              }`}
            >
              University Rules & Notifications
            </button>
            <button
              type="button"
              onClick={() => setTab('logs')}
              className={`py-3.5 border-b-2 whitespace-nowrap ${
                tab === 'logs' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500'
              }`}
            >
              System Activity Logs
            </button>
          </>
        )}
      </div>

      {msg && (
        <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900 flex justify-between">
          <span>{msg}</span>
          <button type="button" onClick={() => setMsg(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}
      {err && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {err}
        </div>
      )}

      {tab === 'directory' && (
        <div className="space-y-5">
          {isSuperAdmin && (
            <form onSubmit={handleCreateUser} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-700" />
                <h3 className="font-display text-sm font-semibold text-slate-900">Create University User Account</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  value={uName}
                  onChange={(e) => setUName(e.target.value)}
                  placeholder="Full Name"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <input
                  type="email"
                  required
                  value={uEmail}
                  onChange={(e) => setUEmail(e.target.value)}
                  placeholder="Email (@northbridge.edu)"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={uPassword}
                  onChange={(e) => setUPassword(e.target.value)}
                  placeholder="Initial Password"
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <select
                  value={uRole}
                  onChange={(e) => setURole(e.target.value as UserRole)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="teacher">University Teacher</option>
                  <option value="meeting_organizer">Meeting Organizer</option>
                  <option value="department_head">Department Head</option>
                  <option value="super_admin">Super Administrator</option>
                </select>
                <select
                  value={uDeptId}
                  onChange={(e) => setUDeptId(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Assign Department...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={uDesigId}
                  onChange={(e) => setUDesigId(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Academic Designation...</option>
                  {designations.map((des) => (
                    <option key={des.id} value={des.id}>
                      {des.title}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Provision Account</span>
              </button>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">Name & Email</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Designation</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{u.name}</p>
                        <p className="text-[11px] font-mono text-slate-500">{u.email}</p>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{u.department_name || '—'}</td>
                      <td className="py-3 px-4 text-slate-600">{u.designation_title || '—'}</td>
                      <td className="py-3 px-4">
                        {isSuperAdmin && u.id !== currentUser.id ? (
                          <select
                            value={u.role}
                            onChange={async (e) => {
                              await apiFetch(`/api/users/${u.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ role: e.target.value }),
                              });
                              onRefresh();
                            }}
                            className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                          >
                            <option value="super_admin">Super Administrator</option>
                            <option value="department_head">Department Head</option>
                            <option value="meeting_organizer">Meeting Organizer</option>
                            <option value="teacher">University Teacher</option>
                          </select>
                        ) : (
                          <span>{formatRoleLabel(u.role)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {isSuperAdmin && u.id !== currentUser.id ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/users/${u.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ is_active: u.is_active ? 0 : 1 }),
                              });
                              onRefresh();
                            }}
                            className={`px-2.5 py-1 rounded text-xs font-medium ${
                              u.is_active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {u.is_active ? 'Active' : 'Deactivated'}
                          </button>
                        ) : (
                          <span className={u.is_active ? 'text-emerald-700 font-medium' : 'text-red-700'}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'structure' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Faculties */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-700" />
              <h3 className="font-display text-sm font-semibold text-slate-900">Faculties ({faculties.length})</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {faculties.map((f) => (
                <div key={f.id} className="py-3 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {f.name} ({f.code})
                    </p>
                    <p className="text-slate-500">
                      Dean: {f.dean_name || 'Unassigned'} · {f.department_count ?? 0} departments
                    </p>
                  </div>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/faculties/${f.id}`, { method: 'DELETE' });
                        onRefresh();
                      }}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isSuperAdmin && (
              <form onSubmit={handleCreateFaculty} className="pt-3 border-t border-slate-200 space-y-2.5">
                <p className="text-xs font-semibold text-slate-800">Add Faculty</p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    required
                    value={facName}
                    onChange={(e) => setFacName(e.target.value)}
                    placeholder="Faculty Name"
                    className="col-span-2 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    required
                    value={facCode}
                    onChange={(e) => setFacCode(e.target.value)}
                    placeholder="Code (e.g. FAH)"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={facDean}
                    onChange={(e) => setFacDean(e.target.value)}
                    placeholder="Dean Name"
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <button type="submit" className="px-3 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg">
                    Add Faculty
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Departments */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold text-slate-900">Departments ({departments.length})</h3>
            <div className="divide-y divide-slate-100">
              {departments.map((d) => (
                <div key={d.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {d.name} ({d.code})
                    </p>
                    <p className="text-slate-500">
                      {d.faculty_name} · {d.teacher_count ?? 0} teachers
                    </p>
                  </div>
                  {isSuperAdmin ? (
                    <select
                      value={d.head_user_id ? String(d.head_user_id) : ''}
                      onChange={async (e) => {
                        await apiFetch(`/api/departments/${d.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ head_user_id: e.target.value ? Number(e.target.value) : null }),
                        });
                        onRefresh();
                      }}
                      className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                    >
                      <option value="">Assign Dept Head...</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-600">Head: {d.head_name || 'Unassigned'}</span>
                  )}
                </div>
              ))}
            </div>

            {isSuperAdmin && (
              <form onSubmit={handleCreateDepartment} className="pt-3 border-t border-slate-200 space-y-2.5">
                <p className="text-xs font-semibold text-slate-800">Add Department</p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={deptFacId}
                    onChange={(e) => setDeptFacId(e.target.value)}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {faculties.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    required
                    value={deptCode}
                    onChange={(e) => setDeptCode(e.target.value)}
                    placeholder="Code (e.g. BIO)"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    placeholder="Department Name"
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <select
                    value={deptHeadId}
                    onChange={(e) => setDeptHeadId(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Head (optional)</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="px-3 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg">
                    Add
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && isSuperAdmin && (
        <form onSubmit={handleSaveUniSettings} className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-teal-700" />
            <h3 className="font-display text-sm font-semibold text-slate-900">
              University Configuration & Governance Rules
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">University Name</label>
              <input
                type="text"
                value={uniForm.name}
                onChange={(e) => setUniForm({ ...uniForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Short Code</label>
              <input
                type="text"
                value={uniForm.code}
                onChange={(e) => setUniForm({ ...uniForm, code: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Institutional Domain</label>
              <input
                type="text"
                value={uniForm.domain}
                onChange={(e) => setUniForm({ ...uniForm, domain: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Min Online Attendance (%)</label>
              <input
                type="number"
                min={10}
                max={100}
                value={uniForm.min_attendance_percent}
                onChange={(e) => setUniForm({ ...uniForm, min_attendance_percent: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Reminder Lead Time (minutes)</label>
              <input
                type="number"
                min={5}
                max={1440}
                value={uniForm.reminder_lead_minutes}
                onChange={(e) => setUniForm({ ...uniForm, reminder_lead_minutes: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Campus Address</label>
              <input
                type="text"
                value={uniForm.address}
                onChange={(e) => setUniForm({ ...uniForm, address: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={uniForm.email_notifications_enabled}
                onChange={(e) => setUniForm({ ...uniForm, email_notifications_enabled: e.target.checked })}
                className="accent-teal-700"
              />
              <span>Enable automated email + in-app invitation and deadline notifications</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={uniForm.waiting_room_default}
                onChange={(e) => setUniForm({ ...uniForm, waiting_room_default: e.target.checked })}
                className="accent-teal-700"
              />
              <span>Require host waiting room admission for online meetings by default</span>
            </label>
          </div>

          <button
            type="submit"
            className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
          >
            Save University Settings
          </button>
        </form>
      )}

      {tab === 'logs' && isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activityLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{log.user_name || 'System'}</td>
                    <td className="py-2.5 px-4 font-mono text-teal-800">{log.action}</td>
                    <td className="py-2.5 px-4 text-slate-600">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

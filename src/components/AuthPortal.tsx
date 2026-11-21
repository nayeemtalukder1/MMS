import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, Lock, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { apiFetch, formatRoleLabel, setAuthToken } from '../lib/api';
import type { Department, Faculty, User, UserRole } from '../types/utmms';

interface DemoAccount {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  department_name: string | null;
  designation_title: string | null;
}

interface AuthPortalProps {
  onAuthenticated: (user: User, token: string) => void;
}

export const AuthPortal: React.FC<AuthPortalProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('admin@northbridge.edu');
  const [password, setPassword] = useState('Campus#2026');
  const [name, setName] = useState('');
  const [facultyId, setFacultyId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [officeRoom, setOfficeRoom] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [codePreview, setCodePreview] = useState<string | null>(null);

  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ accounts: DemoAccount[] }>('/api/auth/demo-directory')
      .then((res) => setDemoAccounts(res.accounts))
      .catch(() => {});
    apiFetch<{ faculties: Faculty[]; departments: Department[] }>('/api/university')
      .then((res) => {
        setFaculties(res.faculties || []);
        setDepartments(res.departments || []);
      })
      .catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRoleSignIn = async (accEmail: string) => {
    setEmail(accEmail);
    setPassword('Campus#2026');
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: accEmail, password: 'Campus#2026' }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          password,
          faculty_id: facultyId ? Number(facultyId) : null,
          department_id: departmentId ? Number(departmentId) : null,
          phone,
          office_room: officeRoom,
        }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ message: string; verificationCodePreview?: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setNotice(res.message);
      if (res.verificationCodePreview) {
        setCodePreview(res.verificationCodePreview);
        setResetToken(res.verificationCodePreview);
      }
      setMode('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, token: resetToken, newPassword }),
      });
      setNotice(res.message);
      setPassword(newPassword);
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  const primaryRoleSamples = [
    demoAccounts.find((a) => a.role === 'super_admin'),
    demoAccounts.find((a) => a.role === 'department_head'),
    demoAccounts.find((a) => a.role === 'meeting_organizer'),
    demoAccounts.find((a) => a.role === 'teacher'),
  ].filter(Boolean) as DemoAccount[];

  const filteredDepartments = facultyId
    ? departments.filter((d) => d.faculty_id === Number(facultyId))
    : departments;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Institutional Overview Panel */}
        <div className="lg:col-span-6 bg-[#0F2942] text-white rounded-xl p-8 sm:p-10 flex flex-col justify-between border border-slate-800">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center font-display font-bold text-lg text-white">
                NB
              </div>
              <div>
                <p className="font-display font-semibold text-base tracking-tight text-white">
                  Northbridge University
                </p>
                <p className="text-xs text-slate-300">Academic Administration Portal</p>
              </div>
            </div>

            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight leading-tight text-balance mb-4">
              University Teacher Meeting Management System
            </h1>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-8">
              Centralized scheduling, smart faculty availability detection, integrated browser audio and video conferencing, digital attendance, official minutes, and decision tracking.
            </p>

            <div className="space-y-4 border-t border-white/10 pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">Availability-First Smart Scheduling</p>
                  <p className="text-xs text-slate-300">Detects overlapping classes and meetings before invitations go out.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">Integrated WebRTC Meeting Rooms</p>
                  <p className="text-xs text-slate-300">Join live audio, video, and screen-sharing sessions directly in-browser.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">Governance, Attendance & Action Tracking</p>
                  <p className="text-xs text-slate-300">Automatic online duration logging, published minutes, and assigned task progress.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/10">
            <p className="text-xs font-medium text-teal-300 mb-3">Quick Role Access (Demo Password: Campus#2026)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {primaryRoleSamples.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => handleQuickRoleSignIn(acc.email)}
                  disabled={loading}
                  className="text-left px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-teal-300 truncate">
                      {formatRoleLabel(acc.role)}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-white shrink-0" />
                  </div>
                  <p className="text-xs text-white font-medium truncate mt-0.5">{acc.name}</p>
                  <p className="text-[11px] text-slate-400 truncate font-mono">{acc.email}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Form Card */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-8 sm:p-10 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {mode === 'login' && 'Sign in to UTMMS'}
                {mode === 'register' && 'Teacher Account Registration'}
                {mode === 'forgot' && 'Password Recovery'}
                {mode === 'reset' && 'Set New Password'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'login' && 'Use your institutional email and password to access your dashboard.'}
                {mode === 'register' && 'Create a University Teacher account linked to your faculty and department.'}
                {mode === 'forgot' && 'Enter your institutional email to receive a verification code.'}
                {mode === 'reset' && 'Enter the verification code and choose a new password.'}
              </p>
            </div>
            <ShieldCheck className="w-6 h-6 text-teal-700 shrink-0" />
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}
          {notice && (
            <div className="mb-4 p-3 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900">
              <p>{notice}</p>
              {codePreview && (
                <p className="mt-1 font-mono font-semibold">Verification Code: {codePreview}</p>
              )}
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Institutional Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="faculty@northbridge.edu"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-700">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setMode('forgot');
                    }}
                    className="text-xs font-medium text-teal-700 hover:text-teal-900"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700 focus:border-teal-700"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? 'Authenticating...' : 'Sign In to Workspace'}
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <span>New faculty member?</span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setEmail('');
                    setPassword('');
                    setMode('register');
                  }}
                  className="font-medium text-teal-700 hover:text-teal-900 inline-flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Create Teacher Account
                </button>
              </div>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr. Jordan Mercer"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Institutional Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="j.mercer@northbridge.edu"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Faculty</label>
                  <select
                    value={facultyId}
                    onChange={(e) => {
                      setFacultyId(e.target.value);
                      setDepartmentId('');
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-700"
                  >
                    <option value="">Select Faculty</option>
                    {faculties.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-700"
                  >
                    <option value="">Select Department</option>
                    {filteredDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Office Room</label>
                  <input
                    type="text"
                    value={officeRoom}
                    onChange={(e) => setOfficeRoom(e.target.value)}
                    placeholder="Eng Block C-204"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone Extension</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1-555-0190"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password (min 8 characters)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Creating Account...' : 'Register Account'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode('login');
                }}
                className="w-full py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Institutional Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Issuing Code...' : 'Send Reset Verification Code'}
              </button>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="w-full py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Verification Code</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">New Password (8+ characters)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? 'Updating Password...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Calendar, Clock, Plus, Trash2, Users } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { AvailabilitySlot, Department, User } from '../types/utmms';

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

interface AvailabilityViewProps {
  currentUser: User;
  departments: Department[];
}

export const AvailabilityView: React.FC<AvailabilityViewProps> = ({ currentUser, departments }) => {
  const [mySlots, setMySlots] = useState<AvailabilitySlot[]>([]);
  const [deptSlots, setDeptSlots] = useState<Array<AvailabilitySlot & { department_name?: string }>>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>(
    currentUser.department_id ? String(currentUser.department_id) : ''
  );

  const [mode, setMode] = useState<'recurring' | 'custom'>('recurring');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [specificDate, setSpecificDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [status, setStatus] = useState<'available' | 'busy'>('available');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canViewDepartmentOverview = ['super_admin', 'department_head', 'meeting_organizer'].includes(currentUser.role);

  const loadAvailability = async () => {
    const mine = await apiFetch<{ slots: AvailabilitySlot[] }>('/api/availability');
    setMySlots(mine.slots || []);

    if (canViewDepartmentOverview) {
      const qs = selectedDeptId ? `?department_id=${selectedDeptId}` : '';
      const dept = await apiFetch<{ slots: Array<AvailabilitySlot & { department_name?: string }> }>(
        `/api/availability/department${qs}`
      );
      setDeptSlots(dept.slots || []);
    }
  };

  useEffect(() => {
    loadAvailability().catch(() => {});
  }, [selectedDeptId]);

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/availability', {
        method: 'POST',
        body: JSON.stringify({
          day_of_week: mode === 'recurring' ? dayOfWeek : null,
          specific_date: mode === 'custom' ? specificDate : null,
          start_time: startTime,
          end_time: endTime,
          status,
          label: label.trim() || (status === 'available' ? 'Open for Meetings' : 'Teaching / Busy'),
          is_recurring: mode === 'recurring',
        }),
      });
      setLabel('');
      await loadAvailability();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save availability slot.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await apiFetch(`/api/availability/${id}`, { method: 'DELETE' });
    await loadAvailability();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Add Slot Form */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 h-fit">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-teal-700" />
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Add Availability / Busy Window
            </h3>
          </div>

          {error && (
            <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleAddSlot} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => setMode('recurring')}
                className={`py-1.5 rounded-md ${mode === 'recurring' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
              >
                Weekly Recurring
              </button>
              <button
                type="button"
                onClick={() => setMode('custom')}
                className={`py-1.5 rounded-md ${mode === 'custom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
              >
                Custom Date
              </button>
            </div>

            {mode === 'recurring' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Day of Week</label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Specific Date</label>
                <input
                  type="date"
                  required
                  value={specificDate}
                  onChange={(e) => setSpecificDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">From</label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">To</label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Availability Type</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'available' | 'busy')}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="available">Available for Meetings</option>
                <option value="busy">Busy / Lecture / Unavailable</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Label / Note</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., CS-301 Lecture or Office Hours"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2 px-4 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Time Slot'}</span>
            </button>
          </form>
        </div>

        {/* Right: Weekly Calendar Grid */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-teal-700" />
              <h3 className="font-display text-sm font-semibold text-slate-900">
                My Weekly & Custom Availability Schedule
              </h3>
            </div>
            <span className="text-xs text-slate-500">Used by Smart Conflict Detection</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {DAYS.slice(0, 6).map((day) => {
              const daySlots = mySlots.filter((s) => s.is_recurring === 1 && s.day_of_week === day.value);
              return (
                <div key={day.value} className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                  <p className="text-xs font-semibold text-slate-800">{day.label}</p>
                  {daySlots.length === 0 ? (
                    <p className="text-[11px] text-slate-400">No slots configured</p>
                  ) : (
                    daySlots.map((slot) => (
                      <div
                        key={slot.id}
                        className={`p-2 rounded border text-xs flex items-start justify-between gap-2 ${
                          slot.status === 'available'
                            ? 'bg-white border-teal-200 text-slate-800'
                            : 'bg-red-50/60 border-red-200 text-red-900'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-mono tabular-nums font-medium">
                            {slot.start_time} – {slot.end_time}
                          </p>
                          <p className="text-[11px] truncate opacity-80">
                            {slot.status === 'available' ? 'Available' : 'Busy'} · {slot.label || 'Scheduled'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDelete(slot.id)}
                          className="text-slate-400 hover:text-red-600 shrink-0"
                          title="Delete slot"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom Date Overrides */}
          {mySlots.some((s) => s.is_recurring === 0) && (
            <div className="mt-5 pt-4 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-800 mb-2">Custom Date Overrides</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mySlots
                  .filter((s) => s.is_recurring === 0)
                  .map((slot) => (
                    <div
                      key={slot.id}
                      className="p-2.5 rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-mono tabular-nums font-medium text-slate-900">
                          {slot.specific_date} · {slot.start_time}–{slot.end_time}
                        </span>
                        <p className="text-[11px] text-slate-500">
                          {slot.status === 'available' ? 'Available' : 'Busy'} · {slot.label}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(slot.id)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Organizer / Department Head Availability Overview */}
      {canViewDepartmentOverview && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-700" />
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Faculty Availability Comparison Overview
              </h3>
            </div>
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">Teacher</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3">Schedule</th>
                  <th className="py-2.5 px-3">Time Window</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deptSlots.slice(0, 30).map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 px-3 font-medium text-slate-900">{s.user_name}</td>
                    <td className="py-2 px-3 text-slate-600">{s.department_name || '—'}</td>
                    <td className="py-2 px-3 text-slate-600">
                      {s.is_recurring
                        ? DAYS.find((d) => d.value === s.day_of_week)?.label || 'Weekly'
                        : s.specific_date}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-700">
                      {s.start_time} – {s.end_time}
                    </td>
                    <td className="py-2 px-3">
                      <span className={s.status === 'available' ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                        {s.status === 'available' ? 'Available' : 'Busy'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-500">{s.label || '—'}</td>
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

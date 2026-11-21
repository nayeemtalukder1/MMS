import React, { useState } from 'react';
import { CheckCircle2, Download, FileText, MessageSquare, Search } from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, formatDuration } from '../lib/api';
import type { ActionItem, AttendanceRecord, MeetingDocument, MeetingMinutes, User } from '../types/utmms';

export const ActionItemsView: React.FC<{
  currentUser: User;
  actionItems: ActionItem[];
  onRefresh: () => void;
}> = ({ currentUser, actionItems, onRefresh }) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});

  const filtered = actionItems.filter((a) => (statusFilter === 'all' ? true : a.status === statusFilter));

  const updateTask = async (id: number, payload: Record<string, unknown>) => {
    await apiFetch(`/api/action-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    onRefresh();
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">Decisions & Action Item Tracker</h3>
          <p className="text-xs text-slate-500">Update task progress, add status notes, and monitor deadlines.</p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'pending', 'in_progress', 'completed'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap ${
                statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
          No action items found for this filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => {
            const canEdit =
              item.assigned_to === currentUser.id ||
              ['super_admin', 'department_head', 'meeting_organizer'].includes(currentUser.role);
            return (
              <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {item.meeting_title} · Assigned to {item.assigned_to_name}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium capitalize shrink-0 ${
                      item.status === 'completed'
                        ? 'text-emerald-700'
                        : item.status === 'in_progress'
                        ? 'text-teal-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {item.status.replace('_', ' ')}
                  </span>
                </div>

                {item.decision_title && (
                  <p className="text-xs text-slate-600">Decision: {item.decision_title}</p>
                )}

                <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
                  <span>Deadline: {item.deadline}</span>
                  <span className="font-mono font-medium">{item.progress_percent}%</span>
                </div>

                {canEdit ? (
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={item.progress_percent}
                      onChange={(e) => updateTask(item.id, { progress_percent: Number(e.target.value) })}
                      className="flex-1 accent-teal-700"
                    />
                    {item.status !== 'completed' && (
                      <button
                        type="button"
                        onClick={() => updateTask(item.id, { status: 'completed', progress_percent: 100 })}
                        className="px-2.5 py-1 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1 shrink-0"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Complete</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-700 rounded-full" style={{ width: `${item.progress_percent}%` }} />
                  </div>
                )}

                {item.comments && item.comments.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    {item.comments.map((c, i) => (
                      <div key={i} className="text-xs bg-slate-50 rounded-lg p-2">
                        <span className="font-medium text-slate-800">{c.author_name}: </span>
                        <span className="text-slate-600">{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {canEdit && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = (commentInputs[item.id] || '').trim();
                      if (!text) return;
                      updateTask(item.id, { comment: text });
                      setCommentInputs((prev) => ({ ...prev, [item.id]: '' }));
                    }}
                    className="flex gap-2 pt-1"
                  >
                    <input
                      type="text"
                      value={commentInputs[item.id] || ''}
                      onChange={(e) => setCommentInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      placeholder="Add progress update comment..."
                      className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Post</span>
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const MinutesDocsView: React.FC<{
  minutesList: Array<MeetingMinutes & { meeting_title?: string; scheduled_start?: string; department_name?: string }>;
  documents: MeetingDocument[];
  onOpenMeeting: (meetingId: number) => void;
}> = ({ minutesList, documents, onOpenMeeting }) => {
  const [search, setSearch] = useState('');

  const filteredMinutes = minutesList.filter((m) =>
    `${m.meeting_title || ''} ${m.summary} ${m.resolutions}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredDocs = documents.filter((d) =>
    `${d.title} ${d.file_name} ${d.meeting_title || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">Official Meeting Minutes & Document Repository</h3>
          <p className="text-xs text-slate-500">Search historical meeting resolutions and download authorized attachments.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search minutes or files..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-3">
          <h4 className="text-xs font-semibold text-slate-700">Published & Draft Minutes ({filteredMinutes.length})</h4>
          {filteredMinutes.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
              No meeting minutes match your search.
            </div>
          ) : (
            filteredMinutes.map((min) => (
              <div key={min.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(min.meeting_id)}
                      className="text-sm font-semibold text-slate-900 hover:text-teal-700 text-left"
                    >
                      {min.meeting_title || `Meeting #${min.meeting_id}`}
                    </button>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {min.department_name || 'University-Wide'} · Author: {min.author_name} · Status: {min.status}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenMeeting(min.meeting_id)}
                    className="px-2.5 py-1 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-slate-50 shrink-0"
                  >
                    Open Meeting
                  </button>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{min.summary}</p>
                {min.resolutions && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-700 whitespace-pre-line">
                    {min.resolutions}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="lg:col-span-5 space-y-3">
          <h4 className="text-xs font-semibold text-slate-700">Attached Documents ({filteredDocs.length})</h4>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {filteredDocs.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-500">No documents uploaded yet.</p>
            ) : (
              filteredDocs.map((doc) => (
                <div key={doc.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-teal-700 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{doc.title}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {doc.meeting_title} · {doc.file_name}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadAuthorizedFile(doc.id, doc.file_name)}
                    className="px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const AttendanceView: React.FC<{
  records: AttendanceRecord[];
  onOpenMeeting: (meetingId: number) => void;
}> = ({ records, onOpenMeeting }) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'late' | 'absent' | 'excused'>('all');

  const filtered = records.filter((r) => (statusFilter === 'all' ? true : r.status === statusFilter));

  const exportCsv = () => {
    const header = 'Meeting,Participant,Department,Status,Duration,Notes\n';
    const rows = filtered
      .map((r) =>
        [
          `"${r.meeting_title || ''}"`,
          `"${r.user_name || ''}"`,
          `"${r.department_name || ''}"`,
          r.status,
          formatDuration(r.duration_seconds),
          `"${(r.notes || '').replace(/"/g, '""')}"`,
        ].join(',')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'utmms-attendance-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">Digital Attendance Ledger</h3>
          <p className="text-xs text-slate-500">Physical sign-ins and verified online WebRTC session durations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'present', 'late', 'excused', 'absent'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize ${
                  statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4">Meeting</th>
                <th className="py-3 px-4">Participant</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    No attendance records found.
                  </td>
                </tr>
              ) : (
                filtered.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(rec.meeting_id)}
                        className="font-medium text-teal-700 hover:text-teal-900 text-left"
                      >
                        {rec.meeting_title}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">{rec.user_name}</td>
                    <td className="py-3 px-4 text-slate-600">{rec.department_name || '—'}</td>
                    <td className="py-3 px-4 tabular-nums text-slate-600">
                      {rec.scheduled_start ? new Date(rec.scheduled_start).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                      {formatDuration(rec.duration_seconds)}
                    </td>
                    <td className="py-3 px-4 capitalize font-medium">
                      <span
                        className={
                          rec.status === 'present'
                            ? 'text-emerald-700'
                            : rec.status === 'late'
                            ? 'text-amber-700'
                            : rec.status === 'excused'
                            ? 'text-slate-600'
                            : 'text-red-700'
                        }
                      >
                        {rec.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500">{rec.notes || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

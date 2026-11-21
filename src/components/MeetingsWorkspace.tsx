import React, { useEffect, useState } from 'react';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Filter,
  List,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile, formatDuration } from '../lib/api';
import type {
  ActionItem,
  AgendaItem,
  AttendanceRecord,
  AttendanceStatus,
  Department,
  Faculty,
  Meeting,
  MeetingCategory,
  MeetingDecision,
  MeetingDocument,
  MeetingMinutes,
  MeetingParticipant,
  MeetingType,
  SchedulingSlotAnalysis,
  User,
} from '../types/utmms';

const MEETING_CATEGORIES: MeetingCategory[] = [
  'Departmental Meeting',
  'Faculty Meeting',
  'Academic Committee Meeting',
  'Examination Committee Meeting',
  'Research Committee Meeting',
  'Administrative Meeting',
  'Emergency Meeting',
  'General Meeting',
];

interface MeetingDetailData {
  meeting: Meeting;
  participants: MeetingParticipant[];
  agendas: AgendaItem[];
  attendance: AttendanceRecord[];
  minutes: MeetingMinutes | null;
  documents: MeetingDocument[];
  decisions: MeetingDecision[];
  actionItems: ActionItem[];
}

interface MeetingsWorkspaceProps {
  currentUser: User;
  meetings: Meeting[];
  users: User[];
  faculties: Faculty[];
  departments: Department[];
  selectedMeetingId: number | null;
  openCreateInitially?: boolean;
  onCloseCreateInitially?: () => void;
  onSelectMeeting: (id: number | null) => void;
  onJoinRoom: (meeting: Meeting) => void;
  onRefresh: () => void;
}

export const MeetingsWorkspace: React.FC<MeetingsWorkspaceProps> = ({
  currentUser,
  meetings,
  users,
  faculties,
  departments,
  selectedMeetingId,
  openCreateInitially,
  onCloseCreateInitially,
  onSelectMeeting,
  onJoinRoom,
  onRefresh,
}) => {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | MeetingType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'live' | 'completed'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  // Create Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MeetingCategory>('Departmental Meeting');
  const [meetingType, setMeetingType] = useState<MeetingType>('online');
  const [facultyId, setFacultyId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [location, setLocation] = useState('UTMMS Integrated Video Room');
  const [recurrence, setRecurrence] = useState<'none' | 'weekly' | 'biweekly' | 'monthly'>('none');
  const [waitingRoom, setWaitingRoom] = useState(true);
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);
  const [proposalDate, setProposalDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState('10:00');
  const [durationMins, setDurationMins] = useState(60);
  const [slotAnalysis, setSlotAnalysis] = useState<SchedulingSlotAnalysis[] | null>(null);
  const [analyzingSlots, setAnalyzingSlots] = useState(false);
  const [initialAgendaTitle, setInitialAgendaTitle] = useState('');
  const [initialAgendas, setInitialAgendas] = useState<Array<{ title: string; duration_minutes: number }>>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Detail state
  const [detail, setDetail] = useState<MeetingDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'agenda' | 'attendance' | 'minutes' | 'decisions'>('overview');

  // Detail interactive states
  const [rescheduleMode, setRescheduleMode] = useState(false);
  const [proposedAltTime, setProposedAltTime] = useState('');
  const [responseNote, setResponseNote] = useState('');

  const [newAgendaTitle, setNewAgendaTitle] = useState('');
  const [newAgendaDesc, setNewAgendaDesc] = useState('');
  const [newAgendaDuration, setNewAgendaDuration] = useState(15);
  const [newAgendaPresenter, setNewAgendaPresenter] = useState<string>('');

  const [attDraft, setAttDraft] = useState<Record<number, { status: AttendanceStatus; notes: string }>>({});
  const [savingAtt, setSavingAtt] = useState(false);

  const [minSummary, setMinSummary] = useState('');
  const [minDiscussions, setMinDiscussions] = useState('');
  const [minResolutions, setMinResolutions] = useState('');
  const [savingMinutes, setSavingMinutes] = useState(false);

  const [docTitle, setDocTitle] = useState('');
  const [docScope, setDocScope] = useState<'participants' | 'department' | 'university'>('participants');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const [decisionTitle, setDecisionTitle] = useState('');
  const [decisionDesc, setDecisionDesc] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [actionAssignee, setActionAssignee] = useState<string>('');
  const [actionDeadline, setActionDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [actionDecisionId, setActionDecisionId] = useState<string>('');

  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const canManageMeetings = ['super_admin', 'department_head', 'meeting_organizer'].includes(currentUser.role);

  useEffect(() => {
    if (openCreateInitially) {
      setShowCreateModal(true);
      onCloseCreateInitially?.();
    }
  }, [openCreateInitially, onCloseCreateInitially]);

  const loadDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const data = await apiFetch<MeetingDetailData>(`/api/meetings/${id}`);
      setDetail(data);
      const draft: Record<number, { status: AttendanceStatus; notes: string }> = {};
      data.participants.forEach((p) => {
        const existing = data.attendance.find((a) => a.user_id === p.user_id);
        draft[p.user_id] = {
          status: existing?.status || 'absent',
          notes: existing?.notes || '',
        };
      });
      setAttDraft(draft);
      setMinSummary(data.minutes?.summary || '');
      setMinDiscussions(data.minutes?.discussions || '');
      setMinResolutions(data.minutes?.resolutions || '');
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (selectedMeetingId) {
      loadDetail(selectedMeetingId);
      setDetailTab('overview');
      setRescheduleMode(false);
    } else {
      setDetail(null);
    }
  }, [selectedMeetingId]);

  const filteredMeetings = meetings.filter((m) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const hit =
        m.title.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        (m.department_name || '').toLowerCase().includes(q) ||
        (m.organizer_name || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (typeFilter !== 'all' && m.meeting_type !== typeFilter) return false;
    if (statusFilter === 'live' && m.room_status !== 'live') return false;
    if (statusFilter === 'completed' && m.room_status !== 'ended' && m.approval_status !== 'completed') return false;
    if (statusFilter === 'upcoming' && (m.room_status === 'ended' || m.approval_status === 'cancelled')) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredMeetings.length / pageSize));
  const pagedMeetings = filteredMeetings.slice((page - 1) * pageSize, page * pageSize);

  const handleAnalyzeAvailability = async () => {
    if (selectedParticipants.length === 0) {
      setCreateError('Select at least one participant before analyzing availability.');
      return;
    }
    setCreateError(null);
    setAnalyzingSlots(true);
    try {
      const candidateHours = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
      const candidate_slots = candidateHours.map((hhmm) => {
        const start = new Date(`${proposalDate}T${hhmm}:00`);
        const end = new Date(start.getTime() + durationMins * 60 * 1000);
        return { start: start.toISOString(), end: end.toISOString() };
      });
      const res = await apiFetch<{ analysis: SchedulingSlotAnalysis[] }>('/api/scheduling/analyze', {
        method: 'POST',
        body: JSON.stringify({
          participant_ids: selectedParticipants,
          candidate_slots,
        }),
      });
      setSlotAnalysis(res.analysis);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to analyze availability.');
    } finally {
      setAnalyzingSlots(false);
    }
  };

  const handleApplyRecommendedSlot = (slot: SchedulingSlotAnalysis) => {
    const d = new Date(slot.slot_start);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    setProposalDate(`${yyyy}-${mm}-${dd}`);
    setStartTime(`${hh}:${min}`);
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedParticipants.length === 0) {
      setCreateError('Please select at least one participant.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const start = new Date(`${proposalDate}T${startTime}:00`);
      const end = new Date(start.getTime() + durationMins * 60 * 1000);
      await apiFetch('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          category,
          faculty_id: facultyId ? Number(facultyId) : null,
          department_id: departmentId ? Number(departmentId) : null,
          meeting_type: meetingType,
          location,
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          recurrence,
          waiting_room_enabled: waitingRoom,
          participant_ids: selectedParticipants,
          agenda_items: initialAgendas,
        }),
      });
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      setSelectedParticipants([]);
      setSlotAnalysis(null);
      setInitialAgendas([]);
      setFeedbackBanner('Meeting scheduled and invitations dispatched to participants.');
      onRefresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create meeting.');
    } finally {
      setCreating(false);
    }
  };

  const handleRoomStatusAction = async (meetingId: number, action: 'start' | 'end') => {
    await apiFetch(`/api/meetings/${meetingId}/room-status`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    await loadDetail(meetingId);
    onRefresh();
    setFeedbackBanner(action === 'start' ? 'Online meeting room activated.' : 'Meeting room ended and attendance finalized.');
  };

  const handleCancelMeeting = async (meetingId: number) => {
    await apiFetch(`/api/meetings/${meetingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ approval_status: 'cancelled', room_status: 'cancelled' }),
    });
    await loadDetail(meetingId);
    onRefresh();
    setFeedbackBanner('Meeting cancelled and participants notified.');
  };

  const handleRespond = async (status: 'accepted' | 'rejected' | 'reschedule_requested') => {
    if (!detail) return;
    await apiFetch(`/api/meetings/${detail.meeting.id}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        invitation_status: status,
        proposed_time: status === 'reschedule_requested' ? proposedAltTime : null,
        response_note: responseNote || null,
      }),
    });
    setRescheduleMode(false);
    setResponseNote('');
    await loadDetail(detail.meeting.id);
    onRefresh();
    setFeedbackBanner('Your invitation response has been recorded.');
  };

  const handleAddAgenda = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !newAgendaTitle.trim()) return;
    await apiFetch(`/api/meetings/${detail.meeting.id}/agenda`, {
      method: 'POST',
      body: JSON.stringify({
        title: newAgendaTitle,
        description: newAgendaDesc,
        duration_minutes: newAgendaDuration,
        presenter_id: newAgendaPresenter ? Number(newAgendaPresenter) : null,
      }),
    });
    setNewAgendaTitle('');
    setNewAgendaDesc('');
    await loadDetail(detail.meeting.id);
  };

  const handleDeleteAgenda = async (agendaId: number) => {
    if (!detail) return;
    await apiFetch(`/api/agenda/${agendaId}`, { method: 'DELETE' });
    await loadDetail(detail.meeting.id);
  };

  const handleSaveAttendance = async () => {
    if (!detail) return;
    setSavingAtt(true);
    try {
      const records = Object.entries(attDraft).map(([uid, val]) => ({
        user_id: Number(uid),
        status: val.status,
        notes: val.notes,
      }));
      await apiFetch(`/api/meetings/${detail.meeting.id}/attendance`, {
        method: 'POST',
        body: JSON.stringify({ records }),
      });
      await loadDetail(detail.meeting.id);
      setFeedbackBanner('Attendance records verified and saved.');
    } finally {
      setSavingAtt(false);
    }
  };

  const handleSaveMinutes = async (publishStatus: 'draft' | 'published') => {
    if (!detail || !minSummary.trim()) return;
    setSavingMinutes(true);
    try {
      await apiFetch(`/api/meetings/${detail.meeting.id}/minutes`, {
        method: 'POST',
        body: JSON.stringify({
          summary: minSummary,
          discussions: minDiscussions,
          resolutions: minResolutions,
          status: publishStatus,
        }),
      });
      await loadDetail(detail.meeting.id);
      onRefresh();
      setFeedbackBanner(publishStatus === 'published' ? 'Official minutes published and participants notified.' : 'Minutes draft saved.');
    } finally {
      setSavingMinutes(false);
    }
  };

  const handleUploadDocument = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detail) return;
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('docFile') as HTMLInputElement | null;
    if (!fileInput?.files?.[0]) return;
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('title', docTitle || fileInput.files[0].name);
      fd.append('access_scope', docScope);
      await apiFetch(`/api/meetings/${detail.meeting.id}/documents`, {
        method: 'POST',
        body: fd,
      });
      setDocTitle('');
      fileInput.value = '';
      await loadDetail(detail.meeting.id);
      setFeedbackBanner('Document uploaded and linked to meeting archive.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleAddDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !decisionTitle.trim()) return;
    await apiFetch(`/api/meetings/${detail.meeting.id}/decisions`, {
      method: 'POST',
      body: JSON.stringify({ title: decisionTitle, description: decisionDesc }),
    });
    setDecisionTitle('');
    setDecisionDesc('');
    await loadDetail(detail.meeting.id);
  };

  const handleAddActionItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !actionTitle.trim() || !actionAssignee) return;
    await apiFetch('/api/action-items', {
      method: 'POST',
      body: JSON.stringify({
        meeting_id: detail.meeting.id,
        decision_id: actionDecisionId ? Number(actionDecisionId) : null,
        title: actionTitle,
        assigned_to: Number(actionAssignee),
        deadline: actionDeadline,
      }),
    });
    setActionTitle('');
    await loadDetail(detail.meeting.id);
    onRefresh();
    setFeedbackBanner('Action item assigned and teacher notified.');
  };

  const exportMeetingAttendanceCsv = () => {
    if (!detail) return;
    const header = 'Name,Email,Department,Status,Joined,Left,Duration,Notes\n';
    const rows = detail.participants
      .map((p) => {
        const rec = detail.attendance.find((a) => a.user_id === p.user_id);
        return [
          `"${p.user_name}"`,
          `"${p.user_email}"`,
          `"${p.department_name || ''}"`,
          rec?.status || 'absent',
          rec?.joined_at || '',
          rec?.left_at || '',
          formatDuration(rec?.duration_seconds || 0),
          `"${(rec?.notes || '').replace(/"/g, '""')}"`,
        ].join(',');
      })
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-meeting-${detail.meeting.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calendar grouping for current month
  const now = new Date();
  const calYear = now.getFullYear();
  const calMonth = now.getMonth();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstWeekday = new Date(calYear, calMonth, 1).getDay();

  return (
    <div className="space-y-5">
      {feedbackBanner && (
        <div className="bg-teal-50 border border-teal-200 text-teal-900 rounded-xl px-4 py-3 text-xs flex items-center justify-between">
          <span>{feedbackBanner}</span>
          <button type="button" onClick={() => setFeedbackBanner(null)} className="font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search meetings, categories, departments..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'upcoming', 'live', 'completed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setStatusFilter(st);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap transition-colors ${
                  statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as 'all' | MeetingType);
                setPage(1);
              }}
              className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
            >
              <option value="all">All Formats</option>
              <option value="online">Online</option>
              <option value="physical">Physical</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1 ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1 ${
                viewMode === 'calendar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>Calendar</span>
            </button>
          </div>

          {canManageMeetings && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Create Meeting</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Split: Meetings List/Calendar + Selected Meeting Detail */}
      <div className={`grid grid-cols-1 ${detail || detailLoading ? 'xl:grid-cols-12' : ''} gap-6`}>
        <div className={detail || detailLoading ? 'xl:col-span-5' : ''}>
          {viewMode === 'list' ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                      <th className="py-3 px-4">Meeting</th>
                      {!detail && <th className="py-3 px-4">Department</th>}
                      <th className="py-3 px-4">Schedule</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {pagedMeetings.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-10 text-center text-slate-500">
                          No meetings match your current filters.
                        </td>
                      </tr>
                    ) : (
                      pagedMeetings.map((m) => (
                        <tr
                          key={m.id}
                          onClick={() => onSelectMeeting(m.id)}
                          className={`cursor-pointer transition-colors ${
                            selectedMeetingId === m.id ? 'bg-teal-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <p className="font-medium text-slate-900">{m.title}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {m.category} · {m.meeting_type} · {m.accepted_count ?? 0}/{m.participant_count ?? 0} confirmed
                            </p>
                          </td>
                          {!detail && (
                            <td className="py-3 px-4 text-slate-600">{m.department_name || 'University-Wide'}</td>
                          )}
                          <td className="py-3 px-4 tabular-nums text-slate-600 whitespace-nowrap">
                            <div>{new Date(m.scheduled_start).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                            <div className="text-[11px] text-slate-500">
                              {new Date(m.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {(m.meeting_type === 'online' || m.meeting_type === 'hybrid') &&
                            m.room_status !== 'ended' &&
                            m.room_status !== 'cancelled' ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onJoinRoom(m);
                                }}
                                className={`px-2.5 py-1.5 rounded-md text-xs font-medium ${
                                  m.room_status === 'live'
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                    : 'bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100'
                                }`}
                              >
                                {m.room_status === 'live' ? 'Join Live' : 'Room'}
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-500 capitalize">
                                {m.approval_status.replace('_', ' ')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                  <span className="tabular-nums">
                    Page {page} of {totalPages} ({filteredMeetings.length} meetings)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="px-2.5 py-1 border border-slate-200 rounded disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-2.5 py-1 border border-slate-200 rounded disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h3>
                <span className="text-xs text-slate-500">Click any meeting to open full workspace</span>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: firstWeekday }).map((_, i) => (
                  <div key={`empty-${i}`} className="min-h-[82px] bg-slate-50/50 rounded-lg" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, idx) => {
                  const day = idx + 1;
                  const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayMeetings = filteredMeetings.filter((m) => m.scheduled_start.slice(0, 10) === dateStr);
                  const isToday = day === now.getDate();
                  return (
                    <div
                      key={day}
                      className={`min-h-[82px] p-1.5 rounded-lg border text-left ${
                        isToday ? 'border-teal-600 bg-teal-50/30' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="text-[11px] font-mono tabular-nums font-medium text-slate-700 mb-1">{day}</div>
                      <div className="space-y-1">
                        {dayMeetings.map((dm) => (
                          <button
                            key={dm.id}
                            type="button"
                            onClick={() => onSelectMeeting(dm.id)}
                            className="w-full text-left px-1.5 py-1 rounded bg-[#0F2942] text-white text-[10px] truncate hover:bg-teal-700"
                            title={dm.title}
                          >
                            {dm.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Meeting Detail Workspace */}
        {(detail || detailLoading) && (
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            {detailLoading || !detail ? (
              <div className="p-10 text-center text-xs text-slate-500">Loading meeting workspace...</div>
            ) : (
              <>
                <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-teal-700 font-medium">
                      {detail.meeting.category} · {detail.meeting.department_name || 'University-Wide'}
                    </p>
                    <h3 className="font-display text-lg font-semibold text-slate-900 mt-1">
                      {detail.meeting.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 tabular-nums">
                      {new Date(detail.meeting.scheduled_start).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      –{' '}
                      {new Date(detail.meeting.scheduled_end).toLocaleTimeString([], {
                        timeStyle: 'short',
                      })}{' '}
                      · {detail.meeting.location} · Status: {detail.meeting.approval_status.replace('_', ' ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {(detail.meeting.meeting_type === 'online' || detail.meeting.meeting_type === 'hybrid') &&
                      detail.meeting.room_status !== 'ended' &&
                      detail.meeting.room_status !== 'cancelled' && (
                        <>
                          {canManageMeetings && detail.meeting.room_status === 'scheduled' && (
                            <button
                              type="button"
                              onClick={() => handleRoomStatusAction(detail.meeting.id, 'start')}
                              className="px-3 py-1.5 bg-[#0F2942] hover:bg-slate-800 text-white text-xs font-medium rounded-lg whitespace-nowrap"
                            >
                              Start Meeting
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onJoinRoom(detail.meeting)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>Join Online Room</span>
                          </button>
                        </>
                      )}
                    <button
                      type="button"
                      onClick={() => onSelectMeeting(null)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                      title="Close detail panel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Sub-tabs */}
                <div className="px-5 border-b border-slate-200 flex items-center gap-6 overflow-x-auto text-xs font-medium">
                  {(
                    [
                      ['overview', 'Overview & Invites'],
                      ['agenda', `Agenda (${detail.agendas.length})`],
                      ['attendance', 'Attendance'],
                      ['minutes', 'Minutes & Docs'],
                      ['decisions', `Decisions & Tasks (${detail.actionItems.length})`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDetailTab(key)}
                      className={`py-3 border-b-2 whitespace-nowrap shrink-0 transition-colors ${
                        detailTab === key
                          ? 'border-teal-700 text-teal-800'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="p-5 space-y-5 overflow-y-auto">
                  {detailTab === 'overview' && (
                    <div className="space-y-5">
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1">Description</p>
                        <p className="text-sm text-slate-700 leading-relaxed">
                          {detail.meeting.description || 'No description provided.'}
                        </p>
                      </div>

                      {/* Participant's own RSVP controls */}
                      {detail.participants.some((p) => p.user_id === currentUser.id) && (
                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-800">
                              Your Invitation Status:{' '}
                              <span className="capitalize text-teal-700">
                                {(
                                  detail.participants.find((p) => p.user_id === currentUser.id)?.invitation_status ||
                                  'pending'
                                ).replace('_', ' ')}
                              </span>
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleRespond('accepted')}
                                className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRespond('rejected')}
                                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg"
                              >
                                Decline
                              </button>
                              <button
                                type="button"
                                onClick={() => setRescheduleMode((v) => !v)}
                                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg"
                              >
                                Request Schedule Change
                              </button>
                            </div>
                          </div>

                          {rescheduleMode && (
                            <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input
                                type="datetime-local"
                                value={proposedAltTime}
                                onChange={(e) => setProposedAltTime(e.target.value)}
                                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              />
                              <input
                                type="text"
                                value={responseNote}
                                onChange={(e) => setResponseNote(e.target.value)}
                                placeholder="Reason / preferred window..."
                                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleRespond('reschedule_requested')}
                                className="px-3 py-1.5 bg-[#0F2942] text-white text-xs font-medium rounded-lg"
                              >
                                Submit Request
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Host lifecycle controls */}
                      {canManageMeetings && detail.meeting.approval_status !== 'cancelled' && (
                        <div className="flex flex-wrap items-center gap-2">
                          {detail.meeting.approval_status === 'pending_approval' &&
                            ['super_admin', 'department_head'].includes(currentUser.role) && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/api/meetings/${detail.meeting.id}/approve`, { method: 'POST' });
                                  await loadDetail(detail.meeting.id);
                                  onRefresh();
                                }}
                                className="px-3 py-1.5 bg-teal-700 text-white text-xs font-medium rounded-lg"
                              >
                                Approve & Confirm Schedule
                              </button>
                            )}
                          {detail.meeting.room_status === 'live' && (
                            <button
                              type="button"
                              onClick={() => handleRoomStatusAction(detail.meeting.id, 'end')}
                              className="px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg"
                            >
                              End Online Meeting
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleCancelMeeting(detail.meeting.id)}
                            className="px-3 py-1.5 border border-red-200 text-red-700 hover:bg-red-50 text-xs font-medium rounded-lg"
                          >
                            Cancel Meeting
                          </button>
                        </div>
                      )}

                      {/* Participant responses table */}
                      <div>
                        <p className="text-xs font-semibold text-slate-800 mb-2">
                          Invited Participants ({detail.participants.length})
                        </p>
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                              <tr>
                                <th className="py-2.5 px-3">Faculty Member</th>
                                <th className="py-2.5 px-3">Department</th>
                                <th className="py-2.5 px-3">Response</th>
                                <th className="py-2.5 px-3">Notes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {detail.participants.map((p) => (
                                <tr key={p.id}>
                                  <td className="py-2.5 px-3 font-medium text-slate-900">{p.user_name}</td>
                                  <td className="py-2.5 px-3 text-slate-600">{p.department_name || '—'}</td>
                                  <td className="py-2.5 px-3 capitalize">
                                    <span
                                      className={
                                        p.invitation_status === 'accepted'
                                          ? 'text-emerald-700 font-medium'
                                          : p.invitation_status === 'rejected'
                                          ? 'text-red-700 font-medium'
                                          : p.invitation_status === 'reschedule_requested'
                                          ? 'text-amber-700 font-medium'
                                          : 'text-slate-500'
                                      }
                                    >
                                      {p.invitation_status.replace('_', ' ')}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-500">{p.response_note || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {detailTab === 'agenda' && (
                    <div className="space-y-4">
                      {detail.agendas.length === 0 ? (
                        <p className="text-xs text-slate-500">No agenda items added yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.agendas.map((ag, idx) => (
                            <div
                              key={ag.id}
                              className="p-3.5 rounded-lg border border-slate-200 flex items-start justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-900">
                                  {idx + 1}. {ag.title}{' '}
                                  {ag.is_completed ? <span className="text-emerald-700 font-normal">· Completed</span> : null}
                                </p>
                                {ag.description && <p className="text-xs text-slate-600 mt-1">{ag.description}</p>}
                                <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                                  {ag.duration_minutes} min {ag.presenter_name ? `· Presenter: ${ag.presenter_name}` : ''}
                                </p>
                              </div>
                              {canManageMeetings && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAgenda(ag.id)}
                                  className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {canManageMeetings && (
                        <form onSubmit={handleAddAgenda} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                          <p className="text-xs font-semibold text-slate-800">Add Agenda Topic</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <input
                              type="text"
                              required
                              value={newAgendaTitle}
                              onChange={(e) => setNewAgendaTitle(e.target.value)}
                              placeholder="Topic title"
                              className="sm:col-span-2 px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                            />
                            <input
                              type="number"
                              min={5}
                              max={180}
                              value={newAgendaDuration}
                              onChange={(e) => setNewAgendaDuration(Number(e.target.value))}
                              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              type="text"
                              value={newAgendaDesc}
                              onChange={(e) => setNewAgendaDesc(e.target.value)}
                              placeholder="Discussion scope / notes"
                              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                            />
                            <select
                              value={newAgendaPresenter}
                              onChange={(e) => setNewAgendaPresenter(e.target.value)}
                              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                            >
                              <option value="">Assign presenter (optional)</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="submit"
                            className="px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
                          >
                            Add Agenda Item
                          </button>
                        </form>
                      )}
                    </div>
                  )}

                  {detailTab === 'attendance' && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-600">
                          Online join/leave durations are logged automatically. Organizers confirm final status below.
                        </p>
                        <button
                          type="button"
                          onClick={exportMeetingAttendanceCsv}
                          className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-700 rounded-lg inline-flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Export CSV</span>
                        </button>
                      </div>

                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                            <tr>
                              <th className="py-2.5 px-3">Participant</th>
                              <th className="py-2.5 px-3">Connected Time</th>
                              <th className="py-2.5 px-3">Status</th>
                              <th className="py-2.5 px-3">Remarks</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {detail.participants.map((p) => {
                              const rec = detail.attendance.find((a) => a.user_id === p.user_id);
                              const current = attDraft[p.user_id] || { status: 'absent', notes: '' };
                              return (
                                <tr key={p.user_id}>
                                  <td className="py-2.5 px-3 font-medium text-slate-900">{p.user_name}</td>
                                  <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                                    {formatDuration(rec?.duration_seconds || 0)}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {canManageMeetings ? (
                                      <select
                                        value={current.status}
                                        onChange={(e) =>
                                          setAttDraft((prev) => ({
                                            ...prev,
                                            [p.user_id]: {
                                              ...current,
                                              status: e.target.value as AttendanceStatus,
                                            },
                                          }))
                                        }
                                        className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                                      >
                                        <option value="present">Present</option>
                                        <option value="late">Late</option>
                                        <option value="excused">Excused</option>
                                        <option value="absent">Absent</option>
                                      </select>
                                    ) : (
                                      <span className="capitalize">{current.status}</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {canManageMeetings ? (
                                      <input
                                        type="text"
                                        value={current.notes}
                                        onChange={(e) =>
                                          setAttDraft((prev) => ({
                                            ...prev,
                                            [p.user_id]: { ...current, notes: e.target.value },
                                          }))
                                        }
                                        placeholder="Note..."
                                        className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                                      />
                                    ) : (
                                      <span>{current.notes || '—'}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {canManageMeetings && (
                        <button
                          type="button"
                          disabled={savingAtt}
                          onClick={handleSaveAttendance}
                          className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
                        >
                          {savingAtt ? 'Saving...' : 'Confirm & Save Attendance'}
                        </button>
                      )}
                    </div>
                  )}

                  {detailTab === 'minutes' && (
                    <div className="space-y-6">
                      {/* Minutes Section */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-slate-900">Official Meeting Minutes</h4>
                          {detail.minutes && (
                            <span className="text-xs text-slate-500 capitalize">
                              Status: {detail.minutes.status}
                            </span>
                          )}
                        </div>

                        {canManageMeetings ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Executive Summary</label>
                              <textarea
                                rows={3}
                                value={minSummary}
                                onChange={(e) => setMinSummary(e.target.value)}
                                placeholder="Summarize meeting outcomes..."
                                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Key Discussions</label>
                              <textarea
                                rows={3}
                                value={minDiscussions}
                                onChange={(e) => setMinDiscussions(e.target.value)}
                                placeholder="Document discussion points..."
                                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Resolutions Passed</label>
                              <textarea
                                rows={3}
                                value={minResolutions}
                                onChange={(e) => setMinResolutions(e.target.value)}
                                placeholder="List numbered resolutions..."
                                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                disabled={savingMinutes}
                                onClick={() => handleSaveMinutes('draft')}
                                className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded-lg"
                              >
                                Save Draft
                              </button>
                              <button
                                type="button"
                                disabled={savingMinutes}
                                onClick={() => handleSaveMinutes('published')}
                                className="px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
                              >
                                Publish Minutes & Notify
                              </button>
                            </div>
                          </div>
                        ) : detail.minutes && detail.minutes.status === 'published' ? (
                          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                            <div>
                              <p className="font-semibold text-slate-800">Summary</p>
                              <p className="text-slate-700 mt-1 whitespace-pre-line">{detail.minutes.summary}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800">Discussions</p>
                              <p className="text-slate-700 mt-1 whitespace-pre-line">{detail.minutes.discussions}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800">Resolutions</p>
                              <p className="text-slate-700 mt-1 whitespace-pre-line">{detail.minutes.resolutions}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">Minutes have not been published for this meeting yet.</p>
                        )}
                      </div>

                      {/* Documents Section */}
                      <div className="pt-4 border-t border-slate-200 space-y-3">
                        <h4 className="text-xs font-semibold text-slate-900">Meeting Documents (PDF / DOCX)</h4>
                        {detail.documents.length === 0 ? (
                          <p className="text-xs text-slate-500">No documents uploaded yet.</p>
                        ) : (
                          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                            {detail.documents.map((doc) => (
                              <div key={doc.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <FileText className="w-4 h-4 text-teal-700 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="font-medium text-slate-900 truncate">{doc.title}</p>
                                    <p className="text-[11px] text-slate-500 truncate">
                                      {doc.file_name} · {(doc.file_size / 1024).toFixed(1)} KB · Scope: {doc.access_scope}
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
                            ))}
                          </div>
                        )}

                        {canManageMeetings && (
                          <form onSubmit={handleUploadDocument} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center">
                            <input
                              type="text"
                              value={docTitle}
                              onChange={(e) => setDocTitle(e.target.value)}
                              placeholder="Document title"
                              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                            />
                            <select
                              value={docScope}
                              onChange={(e) => setDocScope(e.target.value as 'participants' | 'department' | 'university')}
                              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                            >
                              <option value="participants">Participants Only</option>
                              <option value="department">Department Access</option>
                              <option value="university">University-Wide</option>
                            </select>
                            <div className="flex items-center gap-2">
                              <input name="docFile" type="file" accept=".pdf,.doc,.docx,.txt,.csv,.png,.jpg" required className="text-xs w-full" />
                              <button
                                type="submit"
                                disabled={uploadingDoc}
                                className="px-3 py-1.5 bg-[#0F2942] text-white text-xs font-medium rounded-lg inline-flex items-center gap-1 shrink-0"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                <span>{uploadingDoc ? '...' : 'Upload'}</span>
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    </div>
                  )}

                  {detailTab === 'decisions' && (
                    <div className="space-y-5">
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900 mb-2">Recorded Decisions</h4>
                        {detail.decisions.length === 0 ? (
                          <p className="text-xs text-slate-500">No decisions recorded yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {detail.decisions.map((dec) => (
                              <div key={dec.id} className="p-3 rounded-lg border border-slate-200 text-xs">
                                <p className="font-semibold text-slate-900">{dec.title}</p>
                                {dec.description && <p className="text-slate-600 mt-1">{dec.description}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {canManageMeetings && (
                        <form onSubmit={handleAddDecision} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                          <p className="text-xs font-semibold text-slate-800">Record New Decision</p>
                          <input
                            type="text"
                            required
                            value={decisionTitle}
                            onChange={(e) => setDecisionTitle(e.target.value)}
                            placeholder="Decision statement..."
                            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                          />
                          <input
                            type="text"
                            value={decisionDesc}
                            onChange={(e) => setDecisionDesc(e.target.value)}
                            placeholder="Context or policy reference (optional)"
                            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                          />
                          <button
                            type="submit"
                            className="px-3.5 py-1.5 bg-[#0F2942] text-white text-xs font-medium rounded-lg"
                          >
                            Save Decision
                          </button>
                        </form>
                      )}

                      <div className="pt-4 border-t border-slate-200">
                        <h4 className="text-xs font-semibold text-slate-900 mb-2">Action Items</h4>
                        {detail.actionItems.length === 0 ? (
                          <p className="text-xs text-slate-500">No action items assigned for this meeting.</p>
                        ) : (
                          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                            {detail.actionItems.map((ai) => (
                              <div key={ai.id} className="p-3 text-xs flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium text-slate-900">{ai.title}</p>
                                  <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                                    Assigned to {ai.assigned_to_name} · Due {ai.deadline} · {ai.status.replace('_', ' ')}
                                  </p>
                                </div>
                                <span className="font-mono tabular-nums font-medium text-teal-700">
                                  {ai.progress_percent}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {canManageMeetings && (
                          <form onSubmit={handleAddActionItem} className="mt-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                            <p className="text-xs font-semibold text-slate-800">Assign Action Item</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <input
                                type="text"
                                required
                                value={actionTitle}
                                onChange={(e) => setActionTitle(e.target.value)}
                                placeholder="Task title..."
                                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              />
                              <select
                                required
                                value={actionAssignee}
                                onChange={(e) => setActionAssignee(e.target.value)}
                                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              >
                                <option value="">Assign to teacher...</option>
                                {users.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <input
                                type="date"
                                required
                                value={actionDeadline}
                                onChange={(e) => setActionDeadline(e.target.value)}
                                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              />
                              <select
                                value={actionDecisionId}
                                onChange={(e) => setActionDecisionId(e.target.value)}
                                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              >
                                <option value="">Link to decision (optional)</option>
                                {detail.decisions.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.title}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              type="submit"
                              className="px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
                            >
                              Assign Task
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Meeting & Smart Scheduling Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Schedule University Meeting & Detect Conflicts
                </h3>
                <p className="text-xs text-slate-500">
                  Select participants and analyze availability slots before finalizing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMeeting} className="p-6 overflow-y-auto space-y-5">
              {createError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Meeting Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Departmental Accreditation & Syllabus Moderation"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as MeetingCategory)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {MEETING_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Meeting Format</label>
                  <select
                    value={meetingType}
                    onChange={(e) => {
                      const val = e.target.value as MeetingType;
                      setMeetingType(val);
                      if (val === 'online') setLocation('UTMMS Integrated Video Room');
                      if (val === 'physical') setLocation('Senate Boardroom 201');
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="online">Online Meeting (WebRTC Room)</option>
                    <option value="physical">Physical Meeting</option>
                    <option value="hybrid">Hybrid Meeting</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Faculty</label>
                  <select
                    value={facultyId}
                    onChange={(e) => {
                      setFacultyId(e.target.value);
                      setDepartmentId('');
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">University-Wide / All Faculties</option>
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
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">All / Cross-Departmental</option>
                    {departments
                      .filter((d) => !facultyId || d.faculty_id === Number(facultyId))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Location / Room Label</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Recurrence</label>
                  <select
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value as 'none' | 'weekly' | 'biweekly' | 'monthly')}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="none">One-Time Meeting</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Meeting purpose and preparation notes..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Participant Selection */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-800">
                    Select Participants ({selectedParticipants.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const deptUsers = users
                        .filter((u) => !departmentId || u.department_id === Number(departmentId))
                        .map((u) => u.id);
                      setSelectedParticipants(deptUsers);
                    }}
                    className="text-xs font-medium text-teal-700 hover:text-teal-900"
                  >
                    Select {departmentId ? 'Department' : 'All'} Faculty
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200">
                  {users.map((u) => {
                    const checked = selectedParticipants.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className={`flex items-center gap-2 p-2 rounded-md border text-xs cursor-pointer ${
                          checked ? 'bg-teal-50 border-teal-300 text-teal-950' : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedParticipants((prev) => [...prev, u.id]);
                            else setSelectedParticipants((prev) => prev.filter((id) => id !== u.id));
                          }}
                          className="accent-teal-700"
                        />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{u.name}</p>
                          <p className="text-[10px] text-slate-500 truncate">{u.department_name || u.role}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Date/Time & Smart Conflict Detection */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Proposed Date</label>
                    <input
                      type="date"
                      required
                      value={proposalDate}
                      onChange={(e) => setProposalDate(e.target.value)}
                      className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Start Time</label>
                    <input
                      type="time"
                      required
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Duration</label>
                    <select
                      value={durationMins}
                      onChange={(e) => setDurationMins(Number(e.target.value))}
                      className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value={30}>30 minutes</option>
                      <option value={45}>45 minutes</option>
                      <option value={60}>60 minutes</option>
                      <option value={90}>90 minutes</option>
                      <option value={120}>120 minutes</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={analyzingSlots}
                    onClick={handleAnalyzeAvailability}
                    className="px-3.5 py-2 bg-[#0F2942] hover:bg-slate-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-teal-300" />
                    <span>{analyzingSlots ? 'Checking...' : 'Check Availability & Conflicts'}</span>
                  </button>
                </div>

                {slotAnalysis && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-900">
                        Smart Scheduling Availability Matrix ({proposalDate})
                      </p>
                      <span className="text-[11px] text-slate-500">
                        Sorted by highest participant availability — click a slot to apply
                      </span>
                    </div>

                    <div className="space-y-2">
                      {slotAnalysis.map((slot) => (
                        <div
                          key={slot.slot_start}
                          className="p-3 rounded-lg bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs">
                              <Clock className="w-3.5 h-3.5 text-teal-700" />
                              <span className="font-semibold text-slate-900 tabular-nums">{slot.label}</span>
                              <span
                                className={`font-mono tabular-nums font-medium ${
                                  slot.availability_percent === 100
                                    ? 'text-emerald-700'
                                    : slot.availability_percent >= 70
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                                }`}
                              >
                                · {slot.available_count}/{slot.total_count} available ({slot.availability_percent}%)
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                              {slot.participants.map((p) => (
                                <span
                                  key={p.user_id}
                                  className={p.status === 'available' ? 'text-slate-600' : 'text-red-700'}
                                  title={p.reason}
                                >
                                  {p.name}: {p.status === 'available' ? 'Available' : `Busy (${p.reason})`}
                                </span>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleApplyRecommendedSlot(slot)}
                            className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-medium rounded-lg shrink-0"
                          >
                            Use This Time
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Initial Agenda Items */}
              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <label className="block text-xs font-semibold text-slate-800">Initial Agenda Topics (Optional)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={initialAgendaTitle}
                    onChange={(e) => setInitialAgendaTitle(e.target.value)}
                    placeholder="Add agenda item..."
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!initialAgendaTitle.trim()) return;
                      setInitialAgendas((prev) => [...prev, { title: initialAgendaTitle.trim(), duration_minutes: 15 }]);
                      setInitialAgendaTitle('');
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg"
                  >
                    Add Topic
                  </button>
                </div>
                {initialAgendas.length > 0 && (
                  <div className="space-y-1">
                    {initialAgendas.map((ag, i) => (
                      <div key={i} className="text-xs text-slate-700 flex items-center justify-between px-2.5 py-1.5 bg-slate-50 rounded">
                        <span>
                          {i + 1}. {ag.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => setInitialAgendas((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-slate-400 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(meetingType === 'online' || meetingType === 'hybrid') && (
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={waitingRoom}
                    onChange={(e) => setWaitingRoom(e.target.checked)}
                    className="accent-teal-700"
                  />
                  <span>Enable waiting room admission control for this online meeting</span>
                </label>
              )}

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{creating ? 'Scheduling...' : 'Confirm & Send Invitations'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

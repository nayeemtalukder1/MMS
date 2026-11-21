import React from 'react';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  ListChecks,
  Video,
} from 'lucide-react';
import { formatRoleLabel } from '../lib/api';
import type {
  ActionItem,
  ActivityLog,
  AppNotification,
  AttendanceRecord,
  Meeting,
  MeetingMinutes,
  User,
} from '../types/utmms';

interface DashboardHomeProps {
  user: User;
  meetings: Meeting[];
  actionItems: ActionItem[];
  minutesList: MeetingMinutes[];
  attendanceHistory: AttendanceRecord[];
  notifications: AppNotification[];
  activityLogs: ActivityLog[];
  reportSummary: {
    totalTeachers: number;
    totalFaculties: number;
    totalDepartments: number;
    totalMeetings: number;
    upcomingMeetings: number;
    liveMeetings: number;
    completedMeetings: number;
    pendingActions: number;
  } | null;
  onNavigate: (tab: string) => void;
  onOpenMeeting: (meetingId: number) => void;
  onJoinRoom: (meeting: Meeting) => void;
  onOpenCreateMeeting: () => void;
  onRespondInvitation: (meetingId: number, status: 'accepted' | 'rejected') => void;
  onApproveMeeting: (meetingId: number) => void;
}

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  user,
  meetings,
  actionItems,
  minutesList,
  attendanceHistory,
  notifications,
  activityLogs,
  reportSummary,
  onNavigate,
  onOpenMeeting,
  onJoinRoom,
  onOpenCreateMeeting,
  onRespondInvitation,
  onApproveMeeting,
}) => {
  const liveMeetings = meetings.filter((m) => m.room_status === 'live');
  const upcomingMeetings = meetings.filter(
    (m) => m.room_status !== 'ended' && m.room_status !== 'cancelled' && m.approval_status !== 'cancelled'
  );
  const pendingInvitations = meetings.filter((m) => m.my_invitation_status === 'pending');
  const pendingApprovals = meetings.filter((m) => m.approval_status === 'pending_approval');
  const openTasks = actionItems.filter((a) => a.status !== 'completed');
  const unreadNotifs = notifications.filter((n) => !n.is_read);

  const canCreateMeeting = ['super_admin', 'department_head', 'meeting_organizer'].includes(user.role);

  const kpiCards = (() => {
    if (user.role === 'super_admin') {
      return [
        { label: 'Total Faculty & Staff', value: reportSummary?.totalTeachers ?? 0, sub: 'Active university accounts' },
        { label: 'Faculties & Departments', value: `${reportSummary?.totalFaculties ?? 0} / ${reportSummary?.totalDepartments ?? 0}`, sub: 'Academic hierarchy units' },
        { label: 'Active & Upcoming Meetings', value: upcomingMeetings.length, sub: `${liveMeetings.length} live online now` },
        { label: 'Pending Action Items', value: reportSummary?.pendingActions ?? openTasks.length, sub: 'Tracked across committees' },
      ];
    }
    if (user.role === 'department_head') {
      return [
        { label: 'Departmental Meetings', value: upcomingMeetings.length, sub: `${pendingApprovals.length} awaiting confirmation` },
        { label: 'Pending Invitations', value: pendingInvitations.length, sub: 'Require your RSVP' },
        { label: 'Live Online Rooms', value: liveMeetings.length, sub: 'Join directly from dashboard' },
        { label: 'Open Department Tasks', value: openTasks.length, sub: 'Assigned deliverables' },
      ];
    }
    if (user.role === 'meeting_organizer') {
      return [
        { label: 'Scheduled Meetings', value: upcomingMeetings.length, sub: `${pendingApprovals.length} awaiting approval` },
        { label: 'Live Video Rooms', value: liveMeetings.length, sub: 'Active online sessions' },
        { label: 'Open Action Items', value: openTasks.length, sub: 'Follow-ups in progress' },
        { label: 'Published Minutes', value: minutesList.filter((m) => m.status === 'published').length, sub: 'Official records archived' },
      ];
    }
    const presentCount = attendanceHistory.filter((a) => a.status === 'present' || a.status === 'late').length;
    const attRate = attendanceHistory.length > 0 ? Math.round((presentCount / attendanceHistory.length) * 100) : 100;
    return [
      { label: 'Upcoming Meetings', value: upcomingMeetings.length, sub: `${liveMeetings.length} active right now` },
      { label: 'Pending Invitations', value: pendingInvitations.length, sub: 'Awaiting your response' },
      { label: 'Assigned Action Items', value: openTasks.length, sub: 'Tasks in your queue' },
      { label: 'Attendance Rate', value: `${attRate}%`, sub: `${attendanceHistory.length} recorded sessions` },
    ];
  })();

  return (
    <div className="space-y-6">
      {/* Header Welcome Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-teal-700">
            {formatRoleLabel(user.role)} {user.department_name ? `· ${user.department_name}` : ''}
          </p>
          <h2 className="font-display text-2xl font-semibold text-slate-900 mt-1">
            Welcome back, {user.name}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {liveMeetings.length > 0
              ? `${liveMeetings.length} online meeting room is currently live.`
              : `You have ${upcomingMeetings.length} active or upcoming meetings and ${openTasks.length} open action items.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {liveMeetings[0] && (
            <button
              type="button"
              onClick={() => onJoinRoom(liveMeetings[0])}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Video className="w-4 h-4" />
              <span>Join Live Meeting</span>
            </button>
          )}
          {canCreateMeeting ? (
            <button
              type="button"
              onClick={onOpenCreateMeeting}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Calendar className="w-4 h-4" />
              <span>Schedule Meeting</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('availability')}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Clock className="w-4 h-4" />
              <span>Update Availability</span>
            </button>
          )}
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
            <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums mt-2">
              {kpi.value}
            </p>
            <p className="text-xs text-slate-500 mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Primary Two-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Upcoming Meetings & Invitations */}
        <div className="lg:col-span-7 space-y-6">
          {pendingInvitations.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Pending Meeting Invitations ({pendingInvitations.length})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('meetings')}
                  className="text-xs font-medium text-teal-700 hover:text-teal-900"
                >
                  View all
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {pendingInvitations.map((m) => (
                  <div key={m.id} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(m.id)}
                        className="text-sm font-medium text-slate-900 hover:text-teal-700 text-left truncate block w-full"
                      >
                        {m.title}
                      </button>
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {new Date(m.scheduled_start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {m.meeting_type} · {m.organizer_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onRespondInvitation(m.id, 'accepted')}
                        className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg whitespace-nowrap"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => onRespondInvitation(m.id, 'rejected')}
                        className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg whitespace-nowrap"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {['super_admin', 'department_head'].includes(user.role) && pendingApprovals.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
                Meetings Awaiting Confirmation ({pendingApprovals.length})
              </h3>
              <div className="divide-y divide-slate-100">
                {pendingApprovals.map((m) => (
                  <div key={m.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(m.id)}
                        className="text-sm font-medium text-slate-900 hover:text-teal-700 truncate block text-left"
                      >
                        {m.title}
                      </button>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {m.department_name || 'University-Wide'} · Proposed by {m.organizer_name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onApproveMeeting(m.id)}
                      className="px-3 py-1.5 bg-[#0F2942] hover:bg-slate-800 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                    >
                      Approve Schedule
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Upcoming & Active Schedule
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('meetings')}
                className="text-xs font-medium text-teal-700 hover:text-teal-900 inline-flex items-center gap-1"
              >
                <span>Open Schedule</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {upcomingMeetings.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">No upcoming meetings scheduled.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {upcomingMeetings.slice(0, 5).map((m) => (
                  <div key={m.id} className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenMeeting(m.id)}
                          className="text-sm font-medium text-slate-900 hover:text-teal-700 truncate text-left"
                        >
                          {m.title}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 tabular-nums">
                        {new Date(m.scheduled_start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        {' · '}
                        {m.category}
                        {' · '}
                        <span className={m.room_status === 'live' ? 'text-emerald-700 font-medium' : ''}>
                          {m.room_status === 'live' ? 'Live Now' : m.meeting_type}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(m.meeting_type === 'online' || m.meeting_type === 'hybrid') && m.room_status !== 'ended' && (
                        <button
                          type="button"
                          onClick={() => onJoinRoom(m)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap ${
                            m.room_status === 'live'
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200'
                          }`}
                        >
                          {m.room_status === 'live' ? 'Join Live' : 'Enter Room'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenMeeting(m.id)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded-lg whitespace-nowrap"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right 5 cols: Action Items, Recent Minutes / System Activity */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-teal-700" />
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Assigned Action Items
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('actions')}
                className="text-xs font-medium text-teal-700 hover:text-teal-900"
              >
                Manage
              </button>
            </div>
            {openTasks.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mx-auto mb-1.5" />
                All assigned action items are completed.
              </div>
            ) : (
              <div className="space-y-3">
                {openTasks.slice(0, 4).map((task) => (
                  <div key={task.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50/70">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-slate-900">{task.title}</p>
                      <span className="text-[11px] font-mono tabular-nums text-slate-600 shrink-0">
                        {task.progress_percent}%
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      {task.assigned_to_name} · Due {task.deadline} · {task.status.replace('_', ' ')}
                    </p>
                    <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                      <div
                        className="h-full bg-teal-700 rounded-full"
                        style={{ width: `${task.progress_percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-teal-700" />
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  {user.role === 'super_admin' ? 'Recent System Activity' : 'Recent Meeting Minutes & Alerts'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(user.role === 'super_admin' ? 'admin' : 'minutes')}
                className="text-xs font-medium text-teal-700 hover:text-teal-900"
              >
                View all
              </button>
            </div>

            {user.role === 'super_admin' ? (
              <div className="divide-y divide-slate-100">
                {activityLogs.slice(0, 5).map((log) => (
                  <div key={log.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="text-xs font-medium text-slate-800">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{log.details}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {unreadNotifs.slice(0, 3).map((n) => (
                  <div key={n.id} className="py-2.5 first:pt-0">
                    <p className="text-xs font-medium text-slate-900">{n.title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{n.message}</p>
                  </div>
                ))}
                {minutesList.slice(0, 3).map((min) => (
                  <div key={min.id} className="py-2.5 last:pb-0">
                    <button
                      type="button"
                      onClick={() => onOpenMeeting(min.meeting_id)}
                      className="text-xs font-medium text-teal-700 hover:text-teal-900 text-left"
                    >
                      Minutes: {(min as MeetingMinutes & { meeting_title?: string }).meeting_title || `Meeting #${min.meeting_id}`}
                    </button>
                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{min.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

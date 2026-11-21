import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckSquare,
  Clock,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  User as UserIcon,
  UserCheck,
  X,
} from 'lucide-react';
import { ActionItemsView, AttendanceView, MinutesDocsView } from './components/ActionsAndMinutesView';
import { AuthPortal } from './components/AuthPortal';
import { AvailabilityView } from './components/AvailabilityView';
import { DashboardHome } from './components/DashboardHome';
import { MeetingsWorkspace } from './components/MeetingsWorkspace';
import { OnlineMeetingRoom } from './components/OnlineMeetingRoom';
import { ReportsAnalyticsView, type ReportsOverviewData } from './components/ReportsAnalyticsView';
import { UniversityAdminView } from './components/UniversityAdminView';
import { apiFetch, buildWsUrl, formatRoleLabel, setAuthToken } from './lib/api';
import type {
  ActionItem,
  ActivityLog,
  AppNotification,
  AttendanceRecord,
  Department,
  Designation,
  Faculty,
  Meeting,
  MeetingDocument,
  MeetingMinutes,
  UniversityProfile,
  User,
} from './types/utmms';

type ActiveTab =
  | 'dashboard'
  | 'meetings'
  | 'availability'
  | 'attendance'
  | 'minutes'
  | 'actions'
  | 'reports'
  | 'admin';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [university, setUniversity] = useState<UniversityProfile | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [minutesList, setMinutesList] = useState<MeetingMinutes[]>([]);
  const [documents, setDocuments] = useState<MeetingDocument[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [reportsData, setReportsData] = useState<ReportsOverviewData | null>(null);

  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [activeRoomMeeting, setActiveRoomMeeting] = useState<Meeting | null>(null);

  const [showNotifDrawer, setShowNotifDrawer] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileOffice, setProfileOffice] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async (loggedUser: User) => {
    try {
      const [uniRes, usersRes, meetingsRes, actionsRes, minsRes, docsRes, notifsRes, reportsRes] =
        await Promise.all([
          apiFetch<{
            university: UniversityProfile;
            faculties: Faculty[];
            departments: Department[];
            designations: Designation[];
          }>('/api/university'),
          apiFetch<{ users: User[] }>('/api/users'),
          apiFetch<{ meetings: Meeting[] }>('/api/meetings'),
          apiFetch<{ actionItems: ActionItem[] }>('/api/action-items'),
          apiFetch<{ minutes: MeetingMinutes[] }>('/api/minutes'),
          apiFetch<{ documents: MeetingDocument[] }>('/api/documents'),
          apiFetch<{ notifications: AppNotification[] }>('/api/notifications'),
          apiFetch<ReportsOverviewData>('/api/reports/overview'),
        ]);

      setUniversity(uniRes.university);
      setFaculties(uniRes.faculties);
      setDepartments(uniRes.departments);
      setDesignations(uniRes.designations);
      setUsers(usersRes.users);
      setMeetings(meetingsRes.meetings);
      setActionItems(actionsRes.actionItems);
      setMinutesList(minsRes.minutes);
      setDocuments(docsRes.documents);
      setNotifications(notifsRes.notifications);
      setReportsData(reportsRes);

      if (['super_admin', 'department_head', 'meeting_organizer'].includes(loggedUser.role)) {
        const attAll = await apiFetch<{ records: AttendanceRecord[] }>('/api/attendance/all');
        setAttendanceRecords(attAll.records);
      } else {
        const attMine = await apiFetch<{ records: AttendanceRecord[] }>('/api/attendance/history');
        setAttendanceRecords(attMine.records);
      }

      if (loggedUser.role === 'super_admin') {
        const logsRes = await apiFetch<{ logs: ActivityLog[] }>('/api/activity-logs');
        setActivityLogs(logsRes.logs);
      }
    } catch {
      // ignore transient load failures
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadWorkspaceData(user);
    setProfileName(user.name);
    setProfilePhone(user.phone || '');
    setProfileOffice(user.office_room || '');

    // Real-time notification WebSocket listener
    const ws = new WebSocket(buildWsUrl());
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type?: string; notification?: AppNotification };
        if (msg.type === 'notification:new' && msg.notification) {
          setNotifications((prev) => [msg.notification!, ...prev]);
          loadWorkspaceData(user);
        }
      } catch {
        // ignore
      }
    };
    return () => {
      ws.close();
    };
  }, [user, loadWorkspaceData]);

  const handleAuthenticated = (loggedUser: User, token: string) => {
    setAuthToken(token);
    setUser(loggedUser);
    setActiveTab('dashboard');
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
    setActiveRoomMeeting(null);
    setSelectedMeetingId(null);
  };

  if (!user) {
    return <AuthPortal onAuthenticated={handleAuthenticated} />;
  }

  if (activeRoomMeeting) {
    return (
      <OnlineMeetingRoom
        meeting={activeRoomMeeting}
        currentUser={user}
        onExit={() => {
          setActiveRoomMeeting(null);
          loadWorkspaceData(user);
        }}
      />
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const allNavItems: Array<{ id: ActiveTab; label: string; icon: React.ReactNode; roles?: string[] }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'meetings', label: 'Meetings', icon: <Calendar className="w-4 h-4" /> },
    { id: 'availability', label: 'Availability', icon: <Clock className="w-4 h-4" /> },
    { id: 'attendance', label: 'Attendance', icon: <UserCheck className="w-4 h-4" /> },
    { id: 'minutes', label: 'Minutes & Docs', icon: <FileText className="w-4 h-4" /> },
    { id: 'actions', label: 'Action Items', icon: <CheckSquare className="w-4 h-4" /> },
    {
      id: 'reports',
      label: 'Reports',
      icon: <BarChart3 className="w-4 h-4" />,
      roles: ['super_admin', 'department_head', 'meeting_organizer'],
    },
    {
      id: 'admin',
      label: 'University Admin',
      icon: <Building2 className="w-4 h-4" />,
      roles: ['super_admin', 'department_head'],
    },
  ];
  const navItems = allNavItems.filter((item) => !item.roles || item.roles.includes(user.role));

  const tabTitles: Record<ActiveTab, string> = {
    dashboard: 'Dashboard Overview',
    meetings: 'Meetings & Smart Scheduling',
    availability: 'Teacher Availability',
    attendance: 'Attendance Ledger',
    minutes: 'Minutes & Documents',
    actions: 'Decisions & Action Items',
    reports: 'Reports & Analytics',
    admin: 'University Governance',
  };

  const handleOpenMeeting = (meetingId: number) => {
    setSelectedMeetingId(meetingId);
    setActiveTab('meetings');
  };

  const handleRespondInvitation = async (meetingId: number, status: 'accepted' | 'rejected') => {
    await apiFetch(`/api/meetings/${meetingId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ invitation_status: status }),
    });
    await loadWorkspaceData(user);
  };

  const handleApproveMeeting = async (meetingId: number) => {
    await apiFetch(`/api/meetings/${meetingId}/approve`, { method: 'POST' });
    await loadWorkspaceData(user);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    try {
      const res = await apiFetch<{ user: User }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name: profileName,
          phone: profilePhone,
          office_room: profileOffice,
          ...(newPassword ? { currentPassword, newPassword } : {}),
        }),
      });
      setUser(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setProfileMsg('Profile updated.');
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex w-64 bg-[#0F2942] text-slate-200 flex-col shrink-0 border-r border-slate-800">
        <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-600 flex items-center justify-center font-display font-bold text-sm text-white shrink-0">
            {university?.code || 'NBU'}
          </div>
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold text-white truncate">UTMMS</p>
            <p className="text-[11px] text-slate-300 truncate">{university?.name || 'Northbridge University'}</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id !== 'meetings') setSelectedMeetingId(null);
                }}
                className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-3 transition-colors whitespace-nowrap ${
                  active ? 'bg-teal-700 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3">
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="w-full text-left flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-teal-800 flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">{user.name}</p>
              <p className="text-[11px] text-teal-300 truncate">{formatRoleLabel(user.role)}</p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-[#0F2942] text-white flex flex-col h-full p-4">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <span className="font-display font-semibold text-sm">UTMMS Menu</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 py-4 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-3 ${
                    activeTab === item.id ? 'bg-teal-700 text-white' : 'text-slate-300'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-2 rounded-lg text-xs font-medium text-slate-300 flex items-center gap-2 border-t border-white/10 pt-4"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
          <div className="flex-1 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-6 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0 truncate">
              <span className="hidden sm:inline">{university?.name || 'Northbridge University'}</span>
              <span className="hidden sm:inline">/</span>
              <span className="font-display font-semibold text-sm text-slate-900 truncate">
                {tabTitles[activeTab]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowNotifDrawer((v) => !v)}
              className="relative p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-700 text-white text-[10px] font-mono font-semibold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowProfileModal(true)}
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium text-slate-700 whitespace-nowrap"
            >
              <UserIcon className="w-3.5 h-3.5 text-teal-700" />
              <span>{user.name}</span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1400px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardHome
              user={user}
              meetings={meetings}
              actionItems={actionItems}
              minutesList={minutesList}
              attendanceHistory={attendanceRecords}
              notifications={notifications}
              activityLogs={activityLogs}
              reportSummary={reportsData?.summary ?? null}
              onNavigate={(tab) => setActiveTab(tab as ActiveTab)}
              onOpenMeeting={handleOpenMeeting}
              onJoinRoom={(m) => setActiveRoomMeeting(m)}
              onOpenCreateMeeting={() => {
                setOpenCreateModal(true);
                setActiveTab('meetings');
              }}
              onRespondInvitation={handleRespondInvitation}
              onApproveMeeting={handleApproveMeeting}
            />
          )}

          {activeTab === 'meetings' && (
            <MeetingsWorkspace
              currentUser={user}
              meetings={meetings}
              users={users}
              faculties={faculties}
              departments={departments}
              selectedMeetingId={selectedMeetingId}
              openCreateInitially={openCreateModal}
              onCloseCreateInitially={() => setOpenCreateModal(false)}
              onSelectMeeting={setSelectedMeetingId}
              onJoinRoom={(m) => setActiveRoomMeeting(m)}
              onRefresh={() => loadWorkspaceData(user)}
            />
          )}

          {activeTab === 'availability' && (
            <AvailabilityView currentUser={user} departments={departments} />
          )}

          {activeTab === 'attendance' && (
            <AttendanceView records={attendanceRecords} onOpenMeeting={handleOpenMeeting} />
          )}

          {activeTab === 'minutes' && (
            <MinutesDocsView minutesList={minutesList} documents={documents} onOpenMeeting={handleOpenMeeting} />
          )}

          {activeTab === 'actions' && (
            <ActionItemsView
              currentUser={user}
              actionItems={actionItems}
              onRefresh={() => loadWorkspaceData(user)}
            />
          )}

          {activeTab === 'reports' && <ReportsAnalyticsView data={reportsData} />}

          {activeTab === 'admin' && (
            <UniversityAdminView
              currentUser={user}
              university={university}
              faculties={faculties}
              departments={departments}
              designations={designations}
              users={users}
              activityLogs={activityLogs}
              onRefresh={() => loadWorkspaceData(user)}
            />
          )}
        </main>
      </div>

      {/* Notification Center Drawer */}
      {showNotifDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">Notification Center</h3>
                <p className="text-xs text-slate-500">{unreadCount} unread alerts</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/notifications/read-all', { method: 'PATCH' });
                    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
                  }}
                  className="text-xs font-medium text-teal-700 hover:text-teal-900"
                >
                  Mark all read
                </button>
                <button type="button" onClick={() => setShowNotifDrawer(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">No notifications yet.</p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={async () => {
                      if (!n.is_read) {
                        await apiFetch(`/api/notifications/${n.id}/read`, { method: 'PATCH' });
                        setNotifications((prev) =>
                          prev.map((item) => (item.id === n.id ? { ...item, is_read: 1 } : item))
                        );
                      }
                      setShowNotifDrawer(false);
                      if (n.related_meeting_id && n.link_tab === 'meetings') {
                        handleOpenMeeting(n.related_meeting_id);
                      } else if (n.link_tab) {
                        setActiveTab(n.link_tab as ActiveTab);
                      }
                    }}
                    className={`w-full text-left p-4 hover:bg-slate-50 transition-colors ${
                      !n.is_read ? 'bg-teal-50/40' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                      <span className="text-[11px] font-mono text-slate-400">
                        {new Date(n.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{n.message}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Channel: {n.channel}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile & Password Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">Account Profile & Security</h3>
                <p className="text-xs text-slate-500">
                  {formatRoleLabel(user.role)} · {user.email}
                </p>
              </div>
              <button type="button" onClick={() => setShowProfileModal(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {profileMsg && (
              <div className="p-2.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900">
                {profileMsg}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Office Room</label>
                  <input
                    type="text"
                    value={profileOffice}
                    onChange={(e) => setProfileOffice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <p className="font-medium text-slate-700">Change Password (Optional)</p>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (8+ chars)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium"
                >
                  Close
                </button>
                <button type="submit" className="px-4 py-2 bg-teal-700 text-white rounded-lg font-medium">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

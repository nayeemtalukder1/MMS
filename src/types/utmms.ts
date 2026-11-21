export type UserRole = 'super_admin' | 'department_head' | 'meeting_organizer' | 'teacher';

export type MeetingType = 'physical' | 'online' | 'hybrid';

export type MeetingCategory =
  | 'Departmental Meeting'
  | 'Faculty Meeting'
  | 'Academic Committee Meeting'
  | 'Examination Committee Meeting'
  | 'Research Committee Meeting'
  | 'Administrative Meeting'
  | 'Emergency Meeting'
  | 'General Meeting';

export type RoomStatus = 'scheduled' | 'waiting' | 'live' | 'ended' | 'cancelled';

export type ApprovalStatus = 'pending_approval' | 'confirmed' | 'cancelled' | 'completed';

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'reschedule_requested';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export type ActionStatus = 'pending' | 'in_progress' | 'completed';

export interface UniversityProfile {
  id: number;
  name: string;
  code: string;
  domain: string;
  address: string;
  min_attendance_percent: number;
  email_notifications_enabled: number;
  reminder_lead_minutes: number;
  waiting_room_default: number;
}

export interface Faculty {
  id: number;
  name: string;
  code: string;
  dean_name: string;
  description: string;
  department_count?: number;
  teacher_count?: number;
}

export interface Department {
  id: number;
  faculty_id: number;
  faculty_name?: string;
  name: string;
  code: string;
  head_user_id: number | null;
  head_name?: string | null;
  teacher_count?: number;
}

export interface Designation {
  id: number;
  title: string;
  rank_order: number;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  faculty_id: number | null;
  department_id: number | null;
  designation_id: number | null;
  faculty_name?: string | null;
  department_name?: string | null;
  designation_title?: string | null;
  phone: string;
  office_room: string;
  is_active: number;
  created_at: string;
}

export interface MeetingParticipant {
  id: number;
  meeting_id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  user_role: UserRole;
  department_name?: string | null;
  designation_title?: string | null;
  invitation_status: InvitationStatus;
  proposed_time: string | null;
  response_note: string | null;
  responded_at: string | null;
}

export interface Meeting {
  id: number;
  title: string;
  description: string;
  category: MeetingCategory;
  organizer_id: number;
  organizer_name?: string;
  faculty_id: number | null;
  faculty_name?: string | null;
  department_id: number | null;
  department_name?: string | null;
  meeting_type: MeetingType;
  location: string;
  meeting_room_id: string | null;
  room_status: RoomStatus;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  recurrence: 'none' | 'weekly' | 'biweekly' | 'monthly';
  approval_status: ApprovalStatus;
  waiting_room_enabled: number;
  created_at: string;
  participant_count?: number;
  accepted_count?: number;
  my_invitation_status?: InvitationStatus | null;
}

export interface AvailabilitySlot {
  id: number;
  user_id: number;
  user_name?: string;
  day_of_week: number | null; // 0 (Sun) - 6 (Sat)
  specific_date: string | null; // YYYY-MM-DD
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  status: 'available' | 'busy';
  label: string;
  is_recurring: number;
}

export interface SchedulingSlotAnalysis {
  slot_start: string;
  slot_end: string;
  label: string;
  available_count: number;
  total_count: number;
  availability_percent: number;
  participants: Array<{
    user_id: number;
    name: string;
    department_name: string | null;
    status: 'available' | 'busy' | 'meeting_conflict';
    reason: string;
  }>;
}

export interface AgendaItem {
  id: number;
  meeting_id: number;
  sort_order: number;
  title: string;
  description: string;
  presenter_id: number | null;
  presenter_name?: string | null;
  duration_minutes: number;
  attachment_doc_id: number | null;
  attachment_name?: string | null;
  is_completed: number;
}

export interface AttendanceRecord {
  id: number;
  meeting_id: number;
  meeting_title?: string;
  scheduled_start?: string;
  meeting_type?: MeetingType;
  user_id: number;
  user_name?: string;
  user_email?: string;
  department_name?: string | null;
  status: AttendanceStatus;
  joined_at: string | null;
  left_at: string | null;
  duration_seconds: number;
  verified_by: number | null;
  verified_by_name?: string | null;
  notes: string;
}

export interface MeetingMinutes {
  id: number;
  meeting_id: number;
  summary: string;
  discussions: string;
  resolutions: string;
  status: 'draft' | 'published';
  author_id: number;
  author_name?: string;
  published_at: string | null;
  updated_at: string;
}

export interface MeetingDocument {
  id: number;
  meeting_id: number;
  meeting_title?: string;
  title: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by: number;
  uploaded_by_name?: string;
  access_scope: 'participants' | 'department' | 'university';
  created_at: string;
}

export interface MeetingDecision {
  id: number;
  meeting_id: number;
  meeting_title?: string;
  title: string;
  description: string;
  decided_at: string;
  created_by: number;
  created_by_name?: string;
}

export interface ActionComment {
  author_id: number;
  author_name: string;
  text: string;
  created_at: string;
}

export interface ActionItem {
  id: number;
  meeting_id: number;
  meeting_title?: string;
  decision_id: number | null;
  decision_title?: string | null;
  title: string;
  description: string;
  assigned_to: number;
  assigned_to_name?: string;
  department_name?: string | null;
  deadline: string;
  status: ActionStatus;
  progress_percent: number;
  comments: ActionComment[];
  updated_at: string;
}

export interface AppNotification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  link_tab: string;
  related_meeting_id: number | null;
  is_read: number;
  channel: string;
  created_at: string;
}

export interface ActivityLog {
  id: number;
  user_id: number | null;
  user_name?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

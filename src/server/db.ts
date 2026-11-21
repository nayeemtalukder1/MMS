import Database from 'better-sqlite3';
import path from 'path';
import { hashPassword } from './auth';

const DB_PATH = path.resolve(process.cwd(), 'utmms.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS universities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      domain TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      min_attendance_percent INTEGER NOT NULL DEFAULT 75,
      email_notifications_enabled INTEGER NOT NULL DEFAULT 1,
      reminder_lead_minutes INTEGER NOT NULL DEFAULT 30,
      waiting_room_default INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS faculties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      dean_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faculty_id INTEGER NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      head_user_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS designations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      rank_order INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin','department_head','meeting_organizer','teacher')),
      faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      designation_id INTEGER REFERENCES designations(id) ON DELETE SET NULL,
      phone TEXT NOT NULL DEFAULT '',
      office_room TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'General Meeting',
      organizer_id INTEGER NOT NULL REFERENCES users(id),
      faculty_id INTEGER REFERENCES faculties(id) ON DELETE SET NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      meeting_type TEXT NOT NULL CHECK(meeting_type IN ('physical','online','hybrid')),
      location TEXT NOT NULL DEFAULT '',
      meeting_room_id TEXT,
      room_status TEXT NOT NULL DEFAULT 'scheduled' CHECK(room_status IN ('scheduled','waiting','live','ended','cancelled')),
      scheduled_start TEXT NOT NULL,
      scheduled_end TEXT NOT NULL,
      actual_start TEXT,
      actual_end TEXT,
      recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','weekly','biweekly','monthly')),
      approval_status TEXT NOT NULL DEFAULT 'confirmed' CHECK(approval_status IN ('pending_approval','confirmed','cancelled','completed')),
      waiting_room_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meeting_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitation_status TEXT NOT NULL DEFAULT 'pending' CHECK(invitation_status IN ('pending','accepted','rejected','reschedule_requested')),
      proposed_time TEXT,
      response_note TEXT,
      responded_at TEXT,
      UNIQUE(meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS teacher_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_of_week INTEGER,
      specific_date TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('available','busy')),
      label TEXT NOT NULL DEFAULT '',
      is_recurring INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS meeting_agendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      presenter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 15,
      attachment_doc_id INTEGER,
      is_completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'absent' CHECK(status IN ('present','absent','late','excused')),
      joined_at TEXT,
      left_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS meeting_minutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
      summary TEXT NOT NULL DEFAULT '',
      discussions TEXT NOT NULL DEFAULT '',
      resolutions TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
      author_id INTEGER NOT NULL REFERENCES users(id),
      published_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meeting_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      storage_path TEXT NOT NULL,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      access_scope TEXT NOT NULL DEFAULT 'participants' CHECK(access_scope IN ('participants','department','university')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meeting_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      decision_id INTEGER REFERENCES meeting_decisions(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assigned_to INTEGER NOT NULL REFERENCES users(id),
      deadline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
      progress_percent INTEGER NOT NULL DEFAULT 0,
      comments_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_tab TEXT NOT NULL DEFAULT 'meetings',
      related_meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
      is_read INTEGER NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'in_app',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meeting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      left_at TEXT,
      connection_status TEXT NOT NULL DEFAULT 'connected',
      audio_enabled INTEGER NOT NULL DEFAULT 1,
      video_enabled INTEGER NOT NULL DEFAULT 1,
      screen_sharing INTEGER NOT NULL DEFAULT 0
    );
  `);

  const uniCount = (db.prepare('SELECT COUNT(*) as c FROM universities').get() as { c: number }).c;
  if (uniCount === 0) {
    seedDatabase();
  }
}

export function logActivity(userId: number | null, action: string, entityType: string, entityId: string | number, details: string, ip = '') {
  db.prepare(
    'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, action, entityType, String(entityId), details, ip);
}

export function createNotification(
  userId: number,
  type: string,
  title: string,
  message: string,
  linkTab = 'meetings',
  relatedMeetingId: number | null = null,
  channel = 'in_app+email'
) {
  const res = db
    .prepare(
      'INSERT INTO notifications (user_id, type, title, message, link_tab, related_meeting_id, channel) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(userId, type, title, message, linkTab, relatedMeetingId, channel);
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(res.lastInsertRowid);
}

function isoOffsetDays(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dateOffsetDays(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function seedDatabase() {
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO universities (name, code, domain, address, min_attendance_percent, email_notifications_enabled, reminder_lead_minutes, waiting_room_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'Northbridge University',
      'NBU',
      'northbridge.edu',
      '1400 University Crescent, Academic District',
      75,
      1,
      30,
      1
    );

    const insertRole = db.prepare('INSERT INTO roles (slug, display_name, description) VALUES (?, ?, ?)');
    insertRole.run('super_admin', 'Super Administrator', 'Full platform governance, university hierarchy, user roles, and audit oversight');
    insertRole.run('department_head', 'Department Head', 'Departmental meetings, teacher oversight, schedule approval, minutes publication');
    insertRole.run('meeting_organizer', 'Meeting Organizer', 'Meeting creation, smart scheduling, live room hosting, attendance, and documentation');
    insertRole.run('teacher', 'University Teacher', 'Availability management, invitation responses, online meeting participation, and task tracking');

    const insertFaculty = db.prepare('INSERT INTO faculties (name, code, dean_name, description) VALUES (?, ?, ?, ?)');
    const fEng = insertFaculty.run('Faculty of Engineering & Computing', 'FEC', 'Prof. Eleanor Vance', 'Computer Science, Electrical Engineering, and Applied Systems').lastInsertRowid as number;
    const fSci = insertFaculty.run('Faculty of Natural Sciences', 'FNS', 'Prof. Marcus Thorne', 'Mathematics, Physics, and Computational Biology').lastInsertRowid as number;
    const fBus = insertFaculty.run('Faculty of Business & Governance', 'FBG', 'Prof. Claire Sterling', 'Economics, Academic Administration, and Policy').lastInsertRowid as number;

    const insertDept = db.prepare('INSERT INTO departments (faculty_id, name, code, head_user_id) VALUES (?, ?, ?, ?)');
    const dCse = insertDept.run(fEng, 'Computer Science & Engineering', 'CSE', null).lastInsertRowid as number;
    const dEee = insertDept.run(fEng, 'Electrical & Electronic Engineering', 'EEE', null).lastInsertRowid as number;
    const dMath = insertDept.run(fSci, 'Applied Mathematics', 'MATH', null).lastInsertRowid as number;
    const dPhys = insertDept.run(fSci, 'Physics & Instrumentation', 'PHYS', null).lastInsertRowid as number;
    const dEcon = insertDept.run(fBus, 'Economics & Management', 'ECON', null).lastInsertRowid as number;

    const insertDesig = db.prepare('INSERT INTO designations (title, rank_order) VALUES (?, ?)');
    const desDean = insertDesig.run('Professor & Chair', 1).lastInsertRowid as number;
    const desProf = insertDesig.run('Professor', 2).lastInsertRowid as number;
    const desAssoc = insertDesig.run('Associate Professor', 3).lastInsertRowid as number;
    const desAsst = insertDesig.run('Assistant Professor', 4).lastInsertRowid as number;
    const desAdmin = insertDesig.run('Administrative Officer', 5).lastInsertRowid as number;

    const defaultPassHash = hashPassword(process.env.DEMO_SEED_PASSWORD || 'Campus#2026');

    const insertUser = db.prepare(
      'INSERT INTO users (name, email, password_hash, role, faculty_id, department_id, designation_id, phone, office_room, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    );

    const uAdmin = insertUser.run('Dr. Arthur Pendelton', 'admin@northbridge.edu', defaultPassHash, 'super_admin', fEng, dCse, desAdmin, '+1-555-0100', 'Senate Hall 101').lastInsertRowid as number;
    const uHeadCse = insertUser.run('Prof. Alan Turing-Vance', 'head.cse@northbridge.edu', defaultPassHash, 'department_head', fEng, dCse, desDean, '+1-555-0101', 'Eng Block B-302').lastInsertRowid as number;
    const uHeadEee = insertUser.run('Prof. Nadia Al-Mansoor', 'head.eee@northbridge.edu', defaultPassHash, 'department_head', fEng, dEee, desDean, '+1-555-0102', 'Eng Block A-210').lastInsertRowid as number;
    const uOrganizer = insertUser.run('Helena Lindqvist', 'organizer@northbridge.edu', defaultPassHash, 'meeting_organizer', fEng, dCse, desAdmin, '+1-555-0103', 'Admin Wing 204').lastInsertRowid as number;
    const uTeacher1 = insertUser.run('Dr. Sarah Chen', 'sarah.chen@northbridge.edu', defaultPassHash, 'teacher', fEng, dCse, desAssoc, '+1-555-0104', 'Eng Block B-314').lastInsertRowid as number;
    const uTeacher2 = insertUser.run('Dr. David Okafor', 'david.okafor@northbridge.edu', defaultPassHash, 'teacher', fEng, dCse, desAsst, '+1-555-0105', 'Eng Block B-318').lastInsertRowid as number;
    const uTeacher3 = insertUser.run('Prof. Priya Nair', 'priya.nair@northbridge.edu', defaultPassHash, 'teacher', fEng, dEee, desProf, '+1-555-0106', 'Eng Block A-219').lastInsertRowid as number;
    const uTeacher4 = insertUser.run('Dr. Henrik Lindholm', 'henrik.lindholm@northbridge.edu', defaultPassHash, 'teacher', fSci, dMath, desAssoc, '+1-555-0107', 'Science Hall 408').lastInsertRowid as number;
    const uTeacher5 = insertUser.run('Dr. Mei-Ling Zhou', 'meiling.zhou@northbridge.edu', defaultPassHash, 'teacher', fBus, dEcon, desAsst, '+1-555-0108', 'Commerce 115').lastInsertRowid as number;

    db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?').run(uHeadCse, dCse);
    db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?').run(uHeadEee, dEee);
    db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?').run(uTeacher4, dMath);
    db.prepare('UPDATE departments SET head_user_id = ? WHERE id = ?').run(uTeacher5, dEcon);

    // Seed weekly availability for teachers
    const insertAvail = db.prepare(
      'INSERT INTO teacher_availability (user_id, day_of_week, specific_date, start_time, end_time, status, label, is_recurring) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const allFacultyUsers = [uHeadCse, uHeadEee, uTeacher1, uTeacher2, uTeacher3, uTeacher4, uTeacher5];
    for (const uid of allFacultyUsers) {
      for (const dow of [1, 2, 3, 4, 5]) {
        insertAvail.run(uid, dow, null, '09:00', '12:00', 'available', 'Morning Consultation & Meetings', 1);
        insertAvail.run(uid, dow, null, '14:00', '16:30', 'available', 'Afternoon Academic Window', 1);
      }
    }
    // Add realistic busy blocks so conflict detection demonstrates 4/5 or 3/5 smart recommendations
    insertAvail.run(uTeacher1, 1, null, '10:00', '11:00', 'busy', 'CS-301 Algorithms Lecture', 1);
    insertAvail.run(uTeacher2, 2, null, '10:00', '11:30', 'busy', 'Systems Lab Supervision', 1);
    insertAvail.run(uTeacher3, 3, null, '14:00', '15:00', 'busy', 'Circuits Seminar', 1);
    insertAvail.run(uTeacher4, 4, null, '09:00', '10:30', 'busy', 'Linear Algebra Office Hours', 1);

    // Seed Meetings
    const insertMeeting = db.prepare(
      `INSERT INTO meetings (title, description, category, organizer_id, faculty_id, department_id, meeting_type, location, meeting_room_id, room_status, scheduled_start, scheduled_end, actual_start, actual_end, recurrence, approval_status, waiting_room_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const m1 = insertMeeting.run(
      'Fall Semester Curriculum & Accreditation Review',
      'Review revised undergraduate computer science syllabi, outcome-based education rubrics, and accreditation compliance targets.',
      'Departmental Meeting',
      uOrganizer,
      fEng,
      dCse,
      'online',
      'UTMMS Virtual Senate Room A',
      'nbu-cse-fall-review',
      'live',
      isoOffsetDays(0, 10, 0),
      isoOffsetDays(0, 11, 30),
      isoOffsetDays(0, 10, 0),
      null,
      'none',
      'confirmed',
      1
    ).lastInsertRowid as number;

    const m2 = insertMeeting.run(
      'Final Examination Moderation & Routine Committee',
      'Coordinate invigilation roster, moderation of question papers, and grading deadline enforcement across Engineering departments.',
      'Examination Committee Meeting',
      uHeadCse,
      fEng,
      dCse,
      'hybrid',
      'Senate Boardroom 201 + Live Stream',
      'nbu-exam-mod-2026',
      'scheduled',
      isoOffsetDays(1, 14, 0),
      isoOffsetDays(1, 15, 30),
      null,
      null,
      'none',
      'confirmed',
      1
    ).lastInsertRowid as number;

    const m3 = insertMeeting.run(
      'Interdisciplinary AI & Robotics Grant Proposal',
      'Align research milestones, lab budget allocations, and co-investigator deliverables for the national research council submission.',
      'Research Committee Meeting',
      uOrganizer,
      fEng,
      dEee,
      'online',
      'UTMMS Virtual Lab Room',
      'nbu-research-grant',
      'scheduled',
      isoOffsetDays(2, 11, 0),
      isoOffsetDays(2, 12, 0),
      null,
      null,
      'weekly',
      'pending_approval',
      1
    ).lastInsertRowid as number;

    const m4 = insertMeeting.run(
      'Faculty of Engineering Quarterly Academic Board',
      'Review semester enrollment metrics, faculty workload distribution, and laboratory modernization budget.',
      'Faculty Meeting',
      uHeadEee,
      fEng,
      null,
      'physical',
      'Engineering Auditorium Hall 104',
      null,
      'ended',
      isoOffsetDays(-4, 10, 0),
      isoOffsetDays(-4, 11, 30),
      isoOffsetDays(-4, 10, 2),
      isoOffsetDays(-4, 11, 25),
      'monthly',
      'completed',
      0
    ).lastInsertRowid as number;

    const m5 = insertMeeting.run(
      'Graduate Thesis Defense Scheduling & Rubric Alignment',
      'Assign external examiners and standardize MSc thesis defense evaluation rubrics.',
      'Academic Committee Meeting',
      uOrganizer,
      fSci,
      dMath,
      'online',
      'UTMMS Academic Room 3',
      'nbu-thesis-rubric',
      'ended',
      isoOffsetDays(-9, 14, 0),
      isoOffsetDays(-9, 15, 0),
      isoOffsetDays(-9, 14, 0),
      isoOffsetDays(-9, 14, 58),
      'none',
      'completed',
      1
    ).lastInsertRowid as number;

    const insertPart = db.prepare(
      'INSERT INTO meeting_participants (meeting_id, user_id, invitation_status, response_note, responded_at) VALUES (?, ?, ?, ?, ?)'
    );
    // m1 participants
    insertPart.run(m1, uHeadCse, 'accepted', 'Confirmed participation', isoOffsetDays(-1, 9, 0));
    insertPart.run(m1, uTeacher1, 'accepted', 'Will present algorithms module update', isoOffsetDays(-1, 10, 15));
    insertPart.run(m1, uTeacher2, 'accepted', 'Joined and prepared', isoOffsetDays(-1, 11, 0));
    insertPart.run(m1, uOrganizer, 'accepted', 'Hosting room', isoOffsetDays(-1, 8, 30));

    // m2 participants
    insertPart.run(m2, uHeadCse, 'accepted', 'Chairing committee', isoOffsetDays(-1, 14, 0));
    insertPart.run(m2, uHeadEee, 'accepted', null, isoOffsetDays(-1, 16, 0));
    insertPart.run(m2, uTeacher1, 'pending', null, null);
    insertPart.run(m2, uTeacher2, 'accepted', null, isoOffsetDays(0, 8, 0));
    insertPart.run(m2, uTeacher3, 'reschedule_requested', 'Have Circuits lab until 14:30 — can join at 14:30 or move to 15:00.', isoOffsetDays(0, 9, 10));

    // m3 participants
    insertPart.run(m3, uHeadEee, 'accepted', null, isoOffsetDays(0, 8, 0));
    insertPart.run(m3, uTeacher1, 'pending', null, null);
    insertPart.run(m3, uTeacher3, 'accepted', null, isoOffsetDays(0, 9, 0));
    insertPart.run(m3, uTeacher4, 'pending', null, null);

    // m4 participants
    for (const uid of [uHeadCse, uHeadEee, uTeacher1, uTeacher2, uTeacher3, uOrganizer]) {
      insertPart.run(m4, uid, 'accepted', null, isoOffsetDays(-5, 12, 0));
    }

    // m5 participants
    for (const uid of [uTeacher4, uTeacher1, uTeacher5, uOrganizer]) {
      insertPart.run(m5, uid, 'accepted', null, isoOffsetDays(-10, 11, 0));
    }

    // Agendas
    const insertAgenda = db.prepare(
      'INSERT INTO meeting_agendas (meeting_id, sort_order, title, description, presenter_id, duration_minutes, is_completed) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insertAgenda.run(m1, 1, 'Review of Core CS-300 Series Learning Outcomes', 'Evaluate alignment with updated ACM/IEEE 2026 curriculum guidelines.', uTeacher1, 25, 1);
    insertAgenda.run(m1, 2, 'Lab Equipment & Cloud Compute Quota Allocation', 'Confirm student sandbox resources for Distributed Systems.', uTeacher2, 20, 0);
    insertAgenda.run(m1, 3, 'Accreditation Documentation Timeline & Sign-Off', 'Assign department owners for self-assessment dossiers.', uHeadCse, 30, 0);

    insertAgenda.run(m2, 1, 'Final Examination Timetable Draft', 'Review clash-free exam slots for 400+ enrolled students.', uHeadCse, 30, 0);
    insertAgenda.run(m2, 2, 'Question Paper Moderation Checklist', 'Verify blind moderation assignments across CSE and EEE.', uHeadEee, 30, 0);

    insertAgenda.run(m4, 1, 'Spring Intake Enrollment Summary', 'Presentation of admissions & retention metrics.', uHeadEee, 25, 1);
    insertAgenda.run(m4, 2, 'Laboratory Safety & Upgrade Budget', 'Allocation of capital grant across 4 labs.', uHeadCse, 35, 1);

    // Attendance for completed meetings & live meeting
    const insertAtt = db.prepare(
      'INSERT INTO attendance (meeting_id, user_id, status, joined_at, left_at, duration_seconds, verified_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertAtt.run(m4, uHeadCse, 'present', isoOffsetDays(-4, 10, 2), isoOffsetDays(-4, 11, 25), 4980, uHeadEee, 'Attended full session');
    insertAtt.run(m4, uHeadEee, 'present', isoOffsetDays(-4, 10, 0), isoOffsetDays(-4, 11, 25), 5100, uHeadEee, 'Chair');
    insertAtt.run(m4, uTeacher1, 'present', isoOffsetDays(-4, 10, 4), isoOffsetDays(-4, 11, 25), 4860, uHeadEee, 'On time');
    insertAtt.run(m4, uTeacher2, 'late', isoOffsetDays(-4, 10, 18), isoOffsetDays(-4, 11, 25), 4020, uHeadEee, 'Arrived 16m late due to lecture');
    insertAtt.run(m4, uTeacher3, 'excused', null, null, 0, uHeadEee, 'Approved conference travel');
    insertAtt.run(m4, uOrganizer, 'present', isoOffsetDays(-4, 10, 0), isoOffsetDays(-4, 11, 25), 5100, uHeadEee, 'Minute taker');

    insertAtt.run(m5, uTeacher4, 'present', isoOffsetDays(-9, 14, 0), isoOffsetDays(-9, 14, 58), 3480, uOrganizer, 'Verified online attendance (96%)');
    insertAtt.run(m5, uTeacher1, 'present', isoOffsetDays(-9, 14, 1), isoOffsetDays(-9, 14, 58), 3420, uOrganizer, 'Verified online attendance (95%)');
    insertAtt.run(m5, uTeacher5, 'absent', null, null, 0, uOrganizer, 'Did not join');
    insertAtt.run(m5, uOrganizer, 'present', isoOffsetDays(-9, 14, 0), isoOffsetDays(-9, 14, 58), 3480, uOrganizer, 'Host');

    // Minutes
    const insertMinutes = db.prepare(
      'INSERT INTO meeting_minutes (meeting_id, summary, discussions, resolutions, status, author_id, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insertMinutes.run(
      m4,
      'The Faculty of Engineering Quarterly Academic Board convened to review spring enrollment trends and approve laboratory upgrades across CSE and EEE.',
      'Prof. Al-Mansoor presented a 9.4% enrollment increase in Computing tracks. Prof. Turing-Vance noted increased GPU lab utilization and proposed staggered lab sections. Dr. Chen recommended expanding peer-tutoring hours.',
      '1. Approved $48,000 equipment refresh for Embedded Systems Lab.\n2. Adopted standardized rubric template for capstone evaluations.\n3. Scheduled mid-semester syllabus audit for Week 7.',
      'published',
      uOrganizer,
      isoOffsetDays(-3, 15, 0)
    );
    insertMinutes.run(
      m5,
      'Academic Committee finalized the graduate thesis defense calendar and unified rubric scoring weights.',
      'Dr. Lindholm reviewed inter-departmental examiner assignments. Committee agreed on 40% technical rigor, 35% methodology, 25% oral defense weighting.',
      '1. Published final defense rubric v2.1.\n2. Assigned external reviewers for 18 MSc candidates.',
      'published',
      uOrganizer,
      isoOffsetDays(-8, 16, 30)
    );

    // Decisions & Action Items
    const insertDecision = db.prepare(
      'INSERT INTO meeting_decisions (meeting_id, title, description, decided_at, created_by) VALUES (?, ?, ?, ?, ?)'
    );
    const dec1 = insertDecision.run(m4, 'Standardize Examination Routine & Moderation Schedule', 'All courses must submit moderated exam papers 14 days prior to finals.', isoOffsetDays(-4, 11, 15), uHeadEee).lastInsertRowid as number;
    const dec2 = insertDecision.run(m4, 'Update CS-301 & EE-204 Course Outlines', 'Incorporate updated laboratory safety and AI ethics modules into syllabus documents.', isoOffsetDays(-4, 11, 20), uHeadCse).lastInsertRowid as number;
    const dec3 = insertDecision.run(m5, 'Approve Graduate Thesis Defense Rubric v2.1', 'Adopt unified 40/35/25 assessment weighting across Mathematics and Engineering.', isoOffsetDays(-9, 14, 50), uTeacher4).lastInsertRowid as number;

    const insertAction = db.prepare(
      'INSERT INTO action_items (meeting_id, decision_id, title, description, assigned_to, deadline, status, progress_percent, comments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertAction.run(
      m4,
      dec1,
      'Prepare departmental examination routine',
      'Draft clash-free final examination schedule for CSE undergraduate courses and circulate for peer review.',
      uTeacher1,
      dateOffsetDays(5),
      'in_progress',
      65,
      JSON.stringify([
        { author_id: uTeacher1, author_name: 'Dr. Sarah Chen', text: 'First draft completed for 3rd and 4th year courses; resolving 2nd year elective overlaps.', created_at: isoOffsetDays(-1, 14, 20) }
      ])
    );
    insertAction.run(
      m4,
      dec2,
      'Submit updated CS-301 course outline',
      'Upload revised syllabus PDF with new distributed labs and ethics reading list.',
      uTeacher2,
      dateOffsetDays(3),
      'pending',
      20,
      JSON.stringify([])
    );
    insertAction.run(
      m4,
      dec2,
      'Review Embedded Systems lab procurement quotes',
      'Compare three vendor proposals for oscilloscope and FPGA boards.',
      uTeacher3,
      dateOffsetDays(-1),
      'completed',
      100,
      JSON.stringify([
        { author_id: uTeacher3, author_name: 'Prof. Priya Nair', text: 'Vendor B selected with 3-year academic warranty; PO forwarded to Finance.', created_at: isoOffsetDays(-2, 16, 0) }
      ])
    );
    insertAction.run(
      m5,
      dec3,
      'Distribute thesis defense rubric to MSc advisors',
      'Notify all graduate supervisors and attach rubric packet to portal.',
      uTeacher4,
      dateOffsetDays(7),
      'in_progress',
      50,
      JSON.stringify([])
    );

    // Notifications
    createNotification(
      uTeacher1,
      'meeting_live',
      'Online Meeting Now Live',
      'Fall Semester Curriculum & Accreditation Review is active in Virtual Senate Room A.',
      'meetings',
      m1
    );
    createNotification(
      uTeacher1,
      'meeting_invitation',
      'New Meeting Invitation',
      'You have been invited to Final Examination Moderation & Routine Committee.',
      'meetings',
      m2
    );
    createNotification(
      uTeacher1,
      'action_assigned',
      'Action Item Deadline Approaching',
      'Prepare departmental examination routine is due in 5 days.',
      'actions',
      m4
    );
    createNotification(
      uHeadCse,
      'schedule_change_request',
      'Schedule Change Requested',
      'Prof. Priya Nair requested a 30-minute shift for Final Examination Moderation & Routine Committee.',
      'meetings',
      m2
    );
    createNotification(
      uOrganizer,
      'approval_pending',
      'Meeting Awaiting Confirmation',
      'Interdisciplinary AI & Robotics Grant Proposal is pending Department Head approval.',
      'meetings',
      m3
    );

    logActivity(uAdmin, 'SYSTEM_INITIALIZED', 'university', 1, 'Northbridge University UTMMS workspace initialized with faculties, departments, and faculty accounts.');
  });

  tx();
}

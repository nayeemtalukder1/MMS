import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import {
  type AuthenticatedRequest,
  createRoomToken,
  createSessionToken,
  hashPassword,
  requireAuth,
  requireRole,
  verifyPassword,
} from './src/server/auth';
import { createNotification, db, initDatabase, logActivity } from './src/server/db';
import { analyzeSchedulingSlots } from './src/server/scheduler';
import { attachWebSocketServer, pushNotificationToUser } from './src/server/ws';
import type { UserRole } from './src/types/utmms';

initDatabase();

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'text/csv',
      'image/png',
      'image/jpeg',
    ];
    if (allowed.includes(file.mimetype) || /\.(pdf|docx?|txt|csv|png|jpe?g)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Upload PDF, DOCX, TXT, CSV, PNG, or JPG.'));
    }
  },
});

const app = express();
app.use(express.json({ limit: '4mb' }));

function sendAndPushNotification(
  userId: number,
  type: string,
  title: string,
  message: string,
  linkTab = 'meetings',
  relatedMeetingId: number | null = null
) {
  const notif = createNotification(userId, type, title, message, linkTab, relatedMeetingId);
  pushNotificationToUser(userId, notif);
}

function getUserSafe(userId: number) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.faculty_id, u.department_id, u.designation_id,
              f.name as faculty_name, d.name as department_name, des.title as designation_title,
              u.phone, u.office_room, u.is_active, u.created_at
       FROM users u
       LEFT JOIN faculties f ON f.id = u.faculty_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN designations des ON des.id = u.designation_id
       WHERE u.id = ?`
    )
    .get(userId);
}

function canAccessMeeting(userId: number, role: UserRole, meetingId: number): boolean {
  if (role === 'super_admin') return true;
  const m = db.prepare('SELECT organizer_id, department_id FROM meetings WHERE id = ?').get(meetingId) as
    | { organizer_id: number; department_id: number | null }
    | undefined;
  if (!m) return false;
  if (m.organizer_id === userId) return true;
  if (role === 'meeting_organizer') return true;
  if (role === 'department_head') {
    const u = db.prepare('SELECT department_id FROM users WHERE id = ?').get(userId) as { department_id: number | null } | undefined;
    if (u?.department_id && m.department_id === u.department_id) return true;
  }
  const part = db
    .prepare('SELECT id FROM meeting_participants WHERE meeting_id = ? AND user_id = ?')
    .get(meetingId, userId);
  return Boolean(part);
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ==================== MODULE 1: AUTH & USER MANAGEMENT ====================

app.get('/api/auth/demo-directory', (_req, res) => {
  const accounts = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, d.name as department_name, des.title as designation_title
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN designations des ON des.id = u.designation_id
       WHERE u.is_active = 1
       ORDER BY CASE u.role
         WHEN 'super_admin' THEN 1
         WHEN 'department_head' THEN 2
         WHEN 'meeting_organizer' THEN 3
         ELSE 4 END, u.id ASC`
    )
    .all();
  res.json({ accounts });
});

app.post('/api/auth/login', (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid email and password are required.' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) as
    | { id: number; name: string; email: string; password_hash: string; role: UserRole; is_active: number }
    | undefined;

  if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (!row.is_active) {
    res.status(403).json({ error: 'This account has been deactivated. Contact a Super Administrator.' });
    return;
  }

  const token = createSessionToken({
    sub: row.id,
    email: row.email,
    role: row.role,
    name: row.name,
  });

  logActivity(row.id, 'USER_LOGIN', 'user', row.id, `${row.name} signed in (${row.role}).`, req.ip);
  res.json({ token, user: getUserSafe(row.id) });
});

app.post('/api/auth/register', (req, res) => {
  const schema = z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8),
    faculty_id: z.number().int().positive().nullable().optional(),
    department_id: z.number().int().positive().nullable().optional(),
    phone: z.string().max(40).optional(),
    office_room: z.string().max(80).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid registration details. Password must be at least 8 characters.' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const passwordHash = hashPassword(parsed.data.password);
  const result = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, faculty_id, department_id, phone, office_room, is_active)
       VALUES (?, ?, ?, 'teacher', ?, ?, ?, ?, 1)`
    )
    .run(
      parsed.data.name.trim(),
      email,
      passwordHash,
      parsed.data.faculty_id ?? null,
      parsed.data.department_id ?? null,
      parsed.data.phone ?? '',
      parsed.data.office_room ?? ''
    );

  const userId = Number(result.lastInsertRowid);
  const token = createSessionToken({
    sub: userId,
    email,
    role: 'teacher',
    name: parsed.data.name.trim(),
  });

  logActivity(userId, 'USER_REGISTERED', 'user', userId, `${parsed.data.name.trim()} registered as University Teacher.`, req.ip);
  res.status(201).json({ token, user: getUserSafe(userId) });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid email is required.' });
    return;
  }
  const user = db.prepare('SELECT id, name, email FROM users WHERE LOWER(email) = ?').get(parsed.data.email.trim().toLowerCase()) as
    | { id: number; name: string; email: string }
    | undefined;
  if (!user) {
    res.json({ message: 'If an account matches this email, a reset verification code has been issued.' });
    return;
  }

  const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').run(
    user.id,
    resetToken,
    expiresAt
  );
  logActivity(user.id, 'PASSWORD_RESET_REQUESTED', 'user', user.id, 'Password reset code generated.', req.ip);
  res.json({
    message: 'Verification code generated for institutional password reset.',
    verificationCodePreview: resetToken,
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    token: z.string().min(4),
    newPassword: z.string().min(8),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid email, verification code, and password (8+ chars) are required.' });
    return;
  }

  const user = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(parsed.data.email.trim().toLowerCase()) as
    | { id: number }
    | undefined;
  if (!user) {
    res.status(400).json({ error: 'Invalid reset request.' });
    return;
  }

  const record = db
    .prepare(
      'SELECT * FROM password_reset_tokens WHERE user_id = ? AND token = ? AND used = 0 ORDER BY id DESC LIMIT 1'
    )
    .get(user.id, parsed.data.token.trim().toUpperCase()) as { id: number; expires_at: string } | undefined;

  if (!record || new Date(record.expires_at) < new Date()) {
    res.status(400).json({ error: 'Verification code is invalid or expired.' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(parsed.data.newPassword), user.id);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(record.id);
  logActivity(user.id, 'PASSWORD_RESET_COMPLETED', 'user', user.id, 'User reset their password.', req.ip);
  res.json({ message: 'Password updated successfully. You may now sign in.' });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = getUserSafe(req.user!.sub);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user });
});

app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2).max(120),
    phone: z.string().max(40).optional(),
    office_room: z.string().max(80).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid profile fields.' });
    return;
  }

  const userId = req.user!.sub;
  if (parsed.data.newPassword) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string };
    if (!parsed.data.currentPassword || !verifyPassword(parsed.data.currentPassword, row.password_hash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(parsed.data.newPassword), userId);
  }

  db.prepare('UPDATE users SET name = ?, phone = ?, office_room = ? WHERE id = ?').run(
    parsed.data.name.trim(),
    parsed.data.phone ?? '',
    parsed.data.office_room ?? '',
    userId
  );

  logActivity(userId, 'PROFILE_UPDATED', 'user', userId, 'Updated personal profile details.', req.ip);
  res.json({ user: getUserSafe(userId) });
});

// ==================== MODULE 2: UNIVERSITY & DEPARTMENT MANAGEMENT ====================

app.get('/api/university', (_req, res) => {
  const university = db.prepare('SELECT * FROM universities LIMIT 1').get();
  const faculties = db
    .prepare(
      `SELECT f.*,
              (SELECT COUNT(*) FROM departments d WHERE d.faculty_id = f.id) as department_count,
              (SELECT COUNT(*) FROM users u WHERE u.faculty_id = f.id AND u.is_active = 1) as teacher_count
       FROM faculties f ORDER BY f.name`
    )
    .all();
  const departments = db
    .prepare(
      `SELECT d.*, f.name as faculty_name, u.name as head_name,
              (SELECT COUNT(*) FROM users us WHERE us.department_id = d.id AND us.is_active = 1) as teacher_count
       FROM departments d
       JOIN faculties f ON f.id = d.faculty_id
       LEFT JOIN users u ON u.id = d.head_user_id
       ORDER BY f.name, d.name`
    )
    .all();
  const designations = db.prepare('SELECT * FROM designations ORDER BY rank_order, title').all();
  res.json({ university, faculties, departments, designations });
});

app.put('/api/university', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2),
    code: z.string().min(2).max(16),
    domain: z.string().min(3),
    address: z.string().optional(),
    min_attendance_percent: z.number().int().min(10).max(100),
    email_notifications_enabled: z.boolean().or(z.number()),
    reminder_lead_minutes: z.number().int().min(5).max(1440),
    waiting_room_default: z.boolean().or(z.number()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid university configuration.' });
    return;
  }
  const d = parsed.data;
  db.prepare(
    `UPDATE universities
     SET name = ?, code = ?, domain = ?, address = ?, min_attendance_percent = ?,
         email_notifications_enabled = ?, reminder_lead_minutes = ?, waiting_room_default = ?
     WHERE id = (SELECT id FROM universities LIMIT 1)`
  ).run(
    d.name,
    d.code,
    d.domain,
    d.address ?? '',
    d.min_attendance_percent,
    d.email_notifications_enabled ? 1 : 0,
    d.reminder_lead_minutes,
    d.waiting_room_default ? 1 : 0
  );
  logActivity(req.user!.sub, 'UNIVERSITY_SETTINGS_UPDATED', 'university', 1, `Updated settings for ${d.name}`, req.ip);
  res.json({ university: db.prepare('SELECT * FROM universities LIMIT 1').get() });
});

app.post('/api/faculties', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2),
    code: z.string().min(2).max(16),
    dean_name: z.string().optional(),
    description: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Faculty name and code are required.' });
    return;
  }
  try {
    const r = db
      .prepare('INSERT INTO faculties (name, code, dean_name, description) VALUES (?, ?, ?, ?)')
      .run(parsed.data.name, parsed.data.code.toUpperCase(), parsed.data.dean_name ?? '', parsed.data.description ?? '');
    logActivity(req.user!.sub, 'FACULTY_CREATED', 'faculty', r.lastInsertRowid.toString(), parsed.data.name, req.ip);
    res.status(201).json({ faculty: db.prepare('SELECT * FROM faculties WHERE id = ?').get(r.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Faculty code already exists.' });
  }
});

app.delete('/api/faculties/:id', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM faculties WHERE id = ?').run(id);
  logActivity(req.user!.sub, 'FACULTY_DELETED', 'faculty', id, 'Removed faculty', req.ip);
  res.json({ ok: true });
});

app.post('/api/departments', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    faculty_id: z.number().int().positive(),
    name: z.string().min(2),
    code: z.string().min(2).max(16),
    head_user_id: z.number().int().positive().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Faculty, department name, and code are required.' });
    return;
  }
  try {
    const r = db
      .prepare('INSERT INTO departments (faculty_id, name, code, head_user_id) VALUES (?, ?, ?, ?)')
      .run(parsed.data.faculty_id, parsed.data.name, parsed.data.code.toUpperCase(), parsed.data.head_user_id ?? null);
    if (parsed.data.head_user_id) {
      db.prepare("UPDATE users SET role = 'department_head', department_id = ?, faculty_id = ? WHERE id = ?").run(
        r.lastInsertRowid,
        parsed.data.faculty_id,
        parsed.data.head_user_id
      );
    }
    logActivity(req.user!.sub, 'DEPARTMENT_CREATED', 'department', r.lastInsertRowid.toString(), parsed.data.name, req.ip);
    res.status(201).json({ department: db.prepare('SELECT * FROM departments WHERE id = ?').get(r.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Department code already exists.' });
  }
});

app.patch('/api/departments/:id', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().min(2).optional(),
    head_user_id: z.number().int().positive().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid department update.' });
    return;
  }
  const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as
    | { id: number; faculty_id: number; name: string; head_user_id: number | null }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Department not found.' });
    return;
  }
  db.prepare('UPDATE departments SET name = ?, head_user_id = ? WHERE id = ?').run(
    parsed.data.name ?? existing.name,
    parsed.data.head_user_id !== undefined ? parsed.data.head_user_id : existing.head_user_id,
    id
  );
  if (parsed.data.head_user_id) {
    db.prepare("UPDATE users SET role = 'department_head', department_id = ?, faculty_id = ? WHERE id = ?").run(
      id,
      existing.faculty_id,
      parsed.data.head_user_id
    );
  }
  logActivity(req.user!.sub, 'DEPARTMENT_UPDATED', 'department', id, `Updated department ${parsed.data.name ?? existing.name}`, req.ip);
  res.json({ ok: true });
});

app.post('/api/designations', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    title: z.string().min(2).max(80),
    rank_order: z.number().int().min(1).max(20).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Designation title is required.' });
    return;
  }
  try {
    const r = db
      .prepare('INSERT INTO designations (title, rank_order) VALUES (?, ?)')
      .run(parsed.data.title.trim(), parsed.data.rank_order ?? 5);
    res.status(201).json({ designation: db.prepare('SELECT * FROM designations WHERE id = ?').get(r.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Designation already exists.' });
  }
});

// ==================== USERS DIRECTORY & ADMIN USER MANAGEMENT ====================

app.get('/api/users', requireAuth, (req: AuthenticatedRequest, res) => {
  const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
  const facultyId = req.query.faculty_id ? Number(req.query.faculty_id) : null;
  let sql = `
    SELECT u.id, u.name, u.email, u.role, u.faculty_id, u.department_id, u.designation_id,
           f.name as faculty_name, d.name as department_name, des.title as designation_title,
           u.phone, u.office_room, u.is_active, u.created_at
    FROM users u
    LEFT JOIN faculties f ON f.id = u.faculty_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN designations des ON des.id = u.designation_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (departmentId) {
    sql += ' AND u.department_id = ?';
    params.push(departmentId);
  }
  if (facultyId) {
    sql += ' AND u.faculty_id = ?';
    params.push(facultyId);
  }
  sql += ' ORDER BY u.name ASC';
  const users = db.prepare(sql).all(...params);
  res.json({ users });
});

app.post('/api/users', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['super_admin', 'department_head', 'meeting_organizer', 'teacher']),
    faculty_id: z.number().int().positive().nullable().optional(),
    department_id: z.number().int().positive().nullable().optional(),
    designation_id: z.number().int().positive().nullable().optional(),
    phone: z.string().optional(),
    office_room: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid user payload. Password must be at least 8 characters.' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email)) {
    res.status(409).json({ error: 'Email already exists.' });
    return;
  }
  const r = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, faculty_id, department_id, designation_id, phone, office_room, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      parsed.data.name.trim(),
      email,
      hashPassword(parsed.data.password),
      parsed.data.role,
      parsed.data.faculty_id ?? null,
      parsed.data.department_id ?? null,
      parsed.data.designation_id ?? null,
      parsed.data.phone ?? '',
      parsed.data.office_room ?? ''
    );
  const id = Number(r.lastInsertRowid);
  logActivity(req.user!.sub, 'USER_CREATED', 'user', id, `Created ${parsed.data.role} account for ${email}`, req.ip);
  res.status(201).json({ user: getUserSafe(id) });
});

app.patch('/api/users/:id', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    role: z.enum(['super_admin', 'department_head', 'meeting_organizer', 'teacher']).optional(),
    faculty_id: z.number().int().positive().nullable().optional(),
    department_id: z.number().int().positive().nullable().optional(),
    designation_id: z.number().int().positive().nullable().optional(),
    is_active: z.number().int().min(0).max(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid user update.' });
    return;
  }
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | {
        id: number;
        role: UserRole;
        faculty_id: number | null;
        department_id: number | null;
        designation_id: number | null;
        is_active: number;
      }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  db.prepare(
    'UPDATE users SET role = ?, faculty_id = ?, department_id = ?, designation_id = ?, is_active = ? WHERE id = ?'
  ).run(
    parsed.data.role ?? existing.role,
    parsed.data.faculty_id !== undefined ? parsed.data.faculty_id : existing.faculty_id,
    parsed.data.department_id !== undefined ? parsed.data.department_id : existing.department_id,
    parsed.data.designation_id !== undefined ? parsed.data.designation_id : existing.designation_id,
    parsed.data.is_active !== undefined ? parsed.data.is_active : existing.is_active,
    id
  );
  logActivity(req.user!.sub, 'USER_UPDATED', 'user', id, `Updated role/status for user #${id}`, req.ip);
  res.json({ user: getUserSafe(id) });
});

// ==================== MODULE 4 & 5: AVAILABILITY & SMART SCHEDULING ====================

app.get('/api/availability', requireAuth, (req: AuthenticatedRequest, res) => {
  const targetUserId = req.query.user_id ? Number(req.query.user_id) : req.user!.sub;
  const slots = db
    .prepare(
      `SELECT ta.*, u.name as user_name
       FROM teacher_availability ta
       JOIN users u ON u.id = ta.user_id
       WHERE ta.user_id = ?
       ORDER BY ta.is_recurring DESC, ta.day_of_week ASC, ta.specific_date ASC, ta.start_time ASC`
    )
    .all(targetUserId);
  res.json({ slots });
});

app.get('/api/availability/department', requireAuth, (req: AuthenticatedRequest, res) => {
  const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
  let sql = `
    SELECT ta.*, u.name as user_name, d.name as department_name
    FROM teacher_availability ta
    JOIN users u ON u.id = ta.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.is_active = 1
  `;
  const params: unknown[] = [];
  if (departmentId) {
    sql += ' AND u.department_id = ?';
    params.push(departmentId);
  }
  sql += ' ORDER BY u.name, ta.day_of_week, ta.start_time';
  res.json({ slots: db.prepare(sql).all(...params) });
});

app.post('/api/availability', requireAuth, (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    user_id: z.number().int().positive().optional(),
    day_of_week: z.number().int().min(0).max(6).nullable().optional(),
    specific_date: z.string().nullable().optional(),
    start_time: z.string().regex(/^\d{2}:\d{2}$/),
    end_time: z.string().regex(/^\d{2}:\d{2}$/),
    status: z.enum(['available', 'busy']),
    label: z.string().max(120).optional(),
    is_recurring: z.boolean().or(z.number()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || parsed.data.start_time >= parsed.data.end_time) {
    res.status(400).json({ error: 'Valid start/end time range (HH:mm) is required.' });
    return;
  }

  const targetUserId =
    parsed.data.user_id && req.user!.role === 'super_admin' ? parsed.data.user_id : req.user!.sub;
  const isRecurring = parsed.data.specific_date ? 0 : parsed.data.is_recurring === false || parsed.data.is_recurring === 0 ? 0 : 1;

  const r = db
    .prepare(
      `INSERT INTO teacher_availability (user_id, day_of_week, specific_date, start_time, end_time, status, label, is_recurring)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      targetUserId,
      parsed.data.specific_date ? null : parsed.data.day_of_week ?? 1,
      parsed.data.specific_date ?? null,
      parsed.data.start_time,
      parsed.data.end_time,
      parsed.data.status,
      parsed.data.label ?? '',
      isRecurring
    );

  res.status(201).json({ slot: db.prepare('SELECT * FROM teacher_availability WHERE id = ?').get(r.lastInsertRowid) });
});

app.delete('/api/availability/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const slot = db.prepare('SELECT user_id FROM teacher_availability WHERE id = ?').get(id) as { user_id: number } | undefined;
  if (!slot) {
    res.status(404).json({ error: 'Availability slot not found.' });
    return;
  }
  if (slot.user_id !== req.user!.sub && req.user!.role !== 'super_admin') {
    res.status(403).json({ error: 'You can only manage your own availability.' });
    return;
  }
  db.prepare('DELETE FROM teacher_availability WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/scheduling/analyze', requireAuth, (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    participant_ids: z.array(z.number().int().positive()).min(1),
    candidate_slots: z
      .array(
        z.object({
          start: z.string(),
          end: z.string(),
        })
      )
      .min(1)
      .max(20),
    exclude_meeting_id: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Select at least one participant and candidate time slot.' });
    return;
  }
  const analysis = analyzeSchedulingSlots(
    parsed.data.participant_ids,
    parsed.data.candidate_slots,
    parsed.data.exclude_meeting_id
  );
  res.json({ analysis });
});

// ==================== MODULE 3, 6, 8, 9, 10, 11: MEETINGS & LIFECYCLE ====================

app.get('/api/meetings', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub;
  const role = req.user!.role;

  let sql = `
    SELECT m.*,
           org.name as organizer_name,
           f.name as faculty_name,
           d.name as department_name,
           (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.id) as participant_count,
           (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.invitation_status = 'accepted') as accepted_count,
           (SELECT mp.invitation_status FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = ?) as my_invitation_status
    FROM meetings m
    JOIN users org ON org.id = m.organizer_id
    LEFT JOIN faculties f ON f.id = m.faculty_id
    LEFT JOIN departments d ON d.id = m.department_id
  `;

  const params: unknown[] = [userId];
  if (role === 'teacher') {
    sql += ` WHERE (m.organizer_id = ? OR EXISTS (SELECT 1 FROM meeting_participants mp2 WHERE mp2.meeting_id = m.id AND mp2.user_id = ?))`;
    params.push(userId, userId);
  } else if (role === 'department_head') {
    const u = db.prepare('SELECT department_id FROM users WHERE id = ?').get(userId) as { department_id: number | null } | undefined;
    sql += ` WHERE (m.organizer_id = ? OR m.department_id = ? OR EXISTS (SELECT 1 FROM meeting_participants mp2 WHERE mp2.meeting_id = m.id AND mp2.user_id = ?))`;
    params.push(userId, u?.department_id ?? -1, userId);
  }

  sql += ' ORDER BY m.scheduled_start DESC';
  const meetings = db.prepare(sql).all(...params);
  res.json({ meetings });
});

app.post(
  '/api/meetings',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      title: z.string().min(3).max(200),
      description: z.string().max(2000).optional(),
      category: z.string().min(2),
      faculty_id: z.number().int().positive().nullable().optional(),
      department_id: z.number().int().positive().nullable().optional(),
      meeting_type: z.enum(['physical', 'online', 'hybrid']),
      location: z.string().max(200).optional(),
      scheduled_start: z.string(),
      scheduled_end: z.string(),
      recurrence: z.enum(['none', 'weekly', 'biweekly', 'monthly']).optional(),
      waiting_room_enabled: z.boolean().or(z.number()).optional(),
      participant_ids: z.array(z.number().int().positive()).min(1),
      agenda_items: z
        .array(
          z.object({
            title: z.string().min(1),
            description: z.string().optional(),
            presenter_id: z.number().int().positive().nullable().optional(),
            duration_minutes: z.number().int().min(5).max(180).optional(),
          })
        )
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please complete all required meeting fields and select participants.' });
      return;
    }

    const d = parsed.data;
    if (new Date(d.scheduled_start) >= new Date(d.scheduled_end)) {
      res.status(400).json({ error: 'End time must be after start time.' });
      return;
    }

    const roomId =
      d.meeting_type === 'online' || d.meeting_type === 'hybrid'
        ? `nbu-${crypto.randomBytes(4).toString('hex')}`
        : null;
    const approvalStatus = req.user!.role === 'meeting_organizer' && d.department_id ? 'pending_approval' : 'confirmed';

    const tx = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO meetings (title, description, category, organizer_id, faculty_id, department_id, meeting_type, location, meeting_room_id, room_status, scheduled_start, scheduled_end, recurrence, approval_status, waiting_room_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`
        )
        .run(
          d.title.trim(),
          d.description?.trim() ?? '',
          d.category,
          req.user!.sub,
          d.faculty_id ?? null,
          d.department_id ?? null,
          d.meeting_type,
          d.location?.trim() || (d.meeting_type === 'online' ? 'UTMMS Integrated Video Room' : 'Campus Conference Hall'),
          roomId,
          d.scheduled_start,
          d.scheduled_end,
          d.recurrence ?? 'none',
          approvalStatus,
          d.waiting_room_enabled === false || d.waiting_room_enabled === 0 ? 0 : 1
        );
      const meetingId = Number(r.lastInsertRowid);

      const uniqueParticipants = Array.from(new Set([...d.participant_ids, req.user!.sub]));
      const insertPart = db.prepare(
        'INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id, invitation_status, responded_at) VALUES (?, ?, ?, ?)'
      );
      for (const pid of uniqueParticipants) {
        const status = pid === req.user!.sub ? 'accepted' : 'pending';
        insertPart.run(meetingId, pid, status, pid === req.user!.sub ? new Date().toISOString() : null);
      }

      if (d.agenda_items && d.agenda_items.length > 0) {
        const insertAg = db.prepare(
          'INSERT INTO meeting_agendas (meeting_id, sort_order, title, description, presenter_id, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)'
        );
        d.agenda_items.forEach((ag, idx) => {
          insertAg.run(meetingId, idx + 1, ag.title.trim(), ag.description ?? '', ag.presenter_id ?? null, ag.duration_minutes ?? 15);
        });
      }

      return { meetingId, uniqueParticipants };
    });

    const { meetingId, uniqueParticipants } = tx();

    for (const pid of uniqueParticipants) {
      if (pid !== req.user!.sub) {
        sendAndPushNotification(
          pid,
          'meeting_invitation',
          'New Meeting Invitation',
          `${req.user!.name} invited you to "${d.title.trim()}" (${d.meeting_type}).`,
          'meetings',
          meetingId
        );
      }
    }

    logActivity(req.user!.sub, 'MEETING_CREATED', 'meeting', meetingId, `Scheduled "${d.title.trim()}"`, req.ip);
    res.status(201).json({ meeting: db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) });
  }
);

app.get('/api/meetings/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!canAccessMeeting(req.user!.sub, req.user!.role, id)) {
    res.status(403).json({ error: 'Access denied to this meeting.' });
    return;
  }

  const meeting = db
    .prepare(
      `SELECT m.*, org.name as organizer_name, f.name as faculty_name, d.name as department_name
       FROM meetings m
       JOIN users org ON org.id = m.organizer_id
       LEFT JOIN faculties f ON f.id = m.faculty_id
       LEFT JOIN departments d ON d.id = m.department_id
       WHERE m.id = ?`
    )
    .get(id);

  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found.' });
    return;
  }

  const participants = db
    .prepare(
      `SELECT mp.*, u.name as user_name, u.email as user_email, u.role as user_role,
              d.name as department_name, des.title as designation_title
       FROM meeting_participants mp
       JOIN users u ON u.id = mp.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN designations des ON des.id = u.designation_id
       WHERE mp.meeting_id = ?
       ORDER BY u.name`
    )
    .all(id);

  const agendas = db
    .prepare(
      `SELECT ma.*, u.name as presenter_name, md.file_name as attachment_name
       FROM meeting_agendas ma
       LEFT JOIN users u ON u.id = ma.presenter_id
       LEFT JOIN meeting_documents md ON md.id = ma.attachment_doc_id
       WHERE ma.meeting_id = ?
       ORDER BY ma.sort_order ASC, ma.id ASC`
    )
    .all(id);

  const attendance = db
    .prepare(
      `SELECT a.*, u.name as user_name, u.email as user_email, d.name as department_name, v.name as verified_by_name
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN users v ON v.id = a.verified_by
       WHERE a.meeting_id = ?
       ORDER BY u.name`
    )
    .all(id);

  const minutes = db
    .prepare(
      `SELECT mm.*, u.name as author_name
       FROM meeting_minutes mm
       JOIN users u ON u.id = mm.author_id
       WHERE mm.meeting_id = ?`
    )
    .get(id);

  const documents = db
    .prepare(
      `SELECT md.id, md.meeting_id, md.title, md.file_name, md.mime_type, md.file_size,
              md.uploaded_by, u.name as uploaded_by_name, md.access_scope, md.created_at
       FROM meeting_documents md
       JOIN users u ON u.id = md.uploaded_by
       WHERE md.meeting_id = ?
       ORDER BY md.created_at DESC`
    )
    .all(id);

  const decisions = db
    .prepare(
      `SELECT md.*, u.name as created_by_name
       FROM meeting_decisions md
       JOIN users u ON u.id = md.created_by
       WHERE md.meeting_id = ?
       ORDER BY md.decided_at DESC`
    )
    .all(id);

  const rawActions = db
    .prepare(
      `SELECT ai.*, u.name as assigned_to_name, d.name as department_name, dec.title as decision_title
       FROM action_items ai
       JOIN users u ON u.id = ai.assigned_to
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN meeting_decisions dec ON dec.id = ai.decision_id
       WHERE ai.meeting_id = ?
       ORDER BY ai.deadline ASC`
    )
    .all(id) as Array<Record<string, unknown>>;

  const actionItems = rawActions.map((a) => ({
    ...a,
    comments: JSON.parse(String(a.comments_json || '[]')),
  }));

  res.json({
    meeting,
    participants,
    agendas,
    attendance,
    minutes: minutes ?? null,
    documents,
    decisions,
    actionItems,
  });
});

app.patch(
  '/api/meetings/:id',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
      | { id: number; title: string; organizer_id: number; scheduled_start: string; scheduled_end: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Meeting not found.' });
      return;
    }

    const schema = z.object({
      title: z.string().min(3).optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      scheduled_start: z.string().optional(),
      scheduled_end: z.string().optional(),
      approval_status: z.enum(['pending_approval', 'confirmed', 'cancelled', 'completed']).optional(),
      room_status: z.enum(['scheduled', 'waiting', 'live', 'ended', 'cancelled']).optional(),
      waiting_room_enabled: z.number().int().min(0).max(1).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid meeting update.' });
      return;
    }

    const d = parsed.data;
    db.prepare(
      `UPDATE meetings
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           location = COALESCE(?, location),
           scheduled_start = COALESCE(?, scheduled_start),
           scheduled_end = COALESCE(?, scheduled_end),
           approval_status = COALESCE(?, approval_status),
           room_status = COALESCE(?, room_status),
           waiting_room_enabled = COALESCE(?, waiting_room_enabled)
       WHERE id = ?`
    ).run(
      d.title ?? null,
      d.description ?? null,
      d.location ?? null,
      d.scheduled_start ?? null,
      d.scheduled_end ?? null,
      d.approval_status ?? null,
      d.room_status ?? null,
      d.waiting_room_enabled ?? null,
      id
    );

    if (d.scheduled_start || d.approval_status === 'cancelled') {
      const parts = db.prepare('SELECT user_id FROM meeting_participants WHERE meeting_id = ?').all(id) as Array<{ user_id: number }>;
      for (const p of parts) {
        if (p.user_id !== req.user!.sub) {
          sendAndPushNotification(
            p.user_id,
            d.approval_status === 'cancelled' ? 'meeting_cancelled' : 'schedule_updated',
            d.approval_status === 'cancelled' ? 'Meeting Cancelled' : 'Meeting Schedule Updated',
            `${existing.title} has been ${d.approval_status === 'cancelled' ? 'cancelled' : 'updated'} by ${req.user!.name}.`,
            'meetings',
            id
          );
        }
      }
    }

    logActivity(req.user!.sub, 'MEETING_UPDATED', 'meeting', id, `Updated "${d.title ?? existing.title}"`, req.ip);
    res.json({ meeting: db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) });
  }
);

app.post('/api/meetings/:id/respond', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    invitation_status: z.enum(['accepted', 'rejected', 'reschedule_requested']),
    proposed_time: z.string().nullable().optional(),
    response_note: z.string().max(500).nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid invitation response.' });
    return;
  }

  const part = db
    .prepare('SELECT id FROM meeting_participants WHERE meeting_id = ? AND user_id = ?')
    .get(id, req.user!.sub);
  if (!part) {
    res.status(403).json({ error: 'You are not a listed participant for this meeting.' });
    return;
  }

  db.prepare(
    `UPDATE meeting_participants
     SET invitation_status = ?, proposed_time = ?, response_note = ?, responded_at = ?
     WHERE meeting_id = ? AND user_id = ?`
  ).run(
    parsed.data.invitation_status,
    parsed.data.proposed_time ?? null,
    parsed.data.response_note ?? null,
    new Date().toISOString(),
    id,
    req.user!.sub
  );

  const meeting = db.prepare('SELECT title, organizer_id FROM meetings WHERE id = ?').get(id) as {
    title: string;
    organizer_id: number;
  };
  if (meeting && meeting.organizer_id !== req.user!.sub) {
    sendAndPushNotification(
      meeting.organizer_id,
      'invitation_response',
      'Participant Response Received',
      `${req.user!.name} responded (${parsed.data.invitation_status.replace('_', ' ')}) for "${meeting.title}".`,
      'meetings',
      id
    );
  }

  logActivity(req.user!.sub, 'INVITATION_RESPONDED', 'meeting', id, parsed.data.invitation_status, req.ip);
  res.json({ ok: true });
});

app.post(
  '/api/meetings/:id/approve',
  requireAuth,
  requireRole('super_admin', 'department_head'),
  (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const meeting = db.prepare('SELECT title, organizer_id FROM meetings WHERE id = ?').get(id) as
      | { title: string; organizer_id: number }
      | undefined;
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found.' });
      return;
    }
    db.prepare("UPDATE meetings SET approval_status = 'confirmed' WHERE id = ?").run(id);
    sendAndPushNotification(
      meeting.organizer_id,
      'meeting_confirmed',
      'Meeting Schedule Confirmed',
      `${req.user!.name} confirmed the schedule for "${meeting.title}".`,
      'meetings',
      id
    );
    logActivity(req.user!.sub, 'MEETING_APPROVED', 'meeting', id, `Confirmed "${meeting.title}"`, req.ip);
    res.json({ ok: true });
  }
);

app.post('/api/meetings/:id/room-token', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!canAccessMeeting(req.user!.sub, req.user!.role, id)) {
    res.status(403).json({ error: 'You are not authorized to enter this online meeting room.' });
    return;
  }

  const meeting = db
    .prepare('SELECT id, title, meeting_type, meeting_room_id, room_status, organizer_id FROM meetings WHERE id = ?')
    .get(id) as
    | {
        id: number;
        title: string;
        meeting_type: string;
        meeting_room_id: string | null;
        room_status: string;
        organizer_id: number;
      }
    | undefined;

  if (!meeting || meeting.meeting_type === 'physical') {
    res.status(400).json({ error: 'Online meeting room is not configured for this physical meeting.' });
    return;
  }
  if (meeting.room_status === 'cancelled' || meeting.room_status === 'ended') {
    res.status(400).json({ error: 'This meeting room has already ended or been cancelled.' });
    return;
  }

  const isHost =
    meeting.organizer_id === req.user!.sub ||
    req.user!.role === 'super_admin' ||
    req.user!.role === 'department_head';

  const roomId = meeting.meeting_room_id || `nbu-room-${meeting.id}`;
  const roomToken = createRoomToken({
    sub: req.user!.sub,
    name: req.user!.name,
    role: req.user!.role,
    meetingId: meeting.id,
    roomId,
    isHost,
  });

  res.json({ roomToken, roomId, isHost });
});

app.post(
  '/api/meetings/:id/room-status',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const schema = z.object({ action: z.enum(['start', 'end']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid room action.' });
      return;
    }

    const meeting = db.prepare('SELECT id, title FROM meetings WHERE id = ?').get(id) as { id: number; title: string } | undefined;
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found.' });
      return;
    }

    const now = new Date().toISOString();
    if (parsed.data.action === 'start') {
      db.prepare("UPDATE meetings SET room_status = 'live', actual_start = COALESCE(actual_start, ?) WHERE id = ?").run(now, id);
      const parts = db.prepare('SELECT user_id FROM meeting_participants WHERE meeting_id = ?').all(id) as Array<{ user_id: number }>;
      for (const p of parts) {
        if (p.user_id !== req.user!.sub) {
          sendAndPushNotification(
            p.user_id,
            'meeting_live',
            'Online Meeting Started',
            `"${meeting.title}" is now live. Join directly from your dashboard.`,
            'meetings',
            id
          );
        }
      }
      logActivity(req.user!.sub, 'ONLINE_ROOM_STARTED', 'meeting', id, `Started room for "${meeting.title}"`, req.ip);
    } else {
      db.prepare("UPDATE meetings SET room_status = 'ended', approval_status = 'completed', actual_end = ? WHERE id = ?").run(now, id);
      logActivity(req.user!.sub, 'ONLINE_ROOM_ENDED', 'meeting', id, `Ended room for "${meeting.title}"`, req.ip);
    }

    res.json({ meeting: db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) });
  }
);

// ==================== MODULE 8: AGENDA MANAGEMENT ====================

app.post(
  '/api/meetings/:id/agenda',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const meetingId = Number(req.params.id);
    const schema = z.object({
      title: z.string().min(2).max(200),
      description: z.string().max(1000).optional(),
      presenter_id: z.number().int().positive().nullable().optional(),
      duration_minutes: z.number().int().min(5).max(180).optional(),
      attachment_doc_id: z.number().int().positive().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Agenda item title is required.' });
      return;
    }
    const maxOrder = (
      db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM meeting_agendas WHERE meeting_id = ?').get(meetingId) as {
        m: number;
      }
    ).m;

    const r = db
      .prepare(
        'INSERT INTO meeting_agendas (meeting_id, sort_order, title, description, presenter_id, duration_minutes, attachment_doc_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        meetingId,
        maxOrder + 1,
        parsed.data.title.trim(),
        parsed.data.description ?? '',
        parsed.data.presenter_id ?? null,
        parsed.data.duration_minutes ?? 15,
        parsed.data.attachment_doc_id ?? null
      );

    res.status(201).json({ agenda: db.prepare('SELECT * FROM meeting_agendas WHERE id = ?').get(r.lastInsertRowid) });
  }
);

app.patch('/api/agenda/:agendaId', requireAuth, (req: AuthenticatedRequest, res) => {
  const agendaId = Number(req.params.agendaId);
  const schema = z.object({
    title: z.string().min(2).optional(),
    description: z.string().optional(),
    duration_minutes: z.number().int().min(5).max(180).optional(),
    sort_order: z.number().int().min(1).optional(),
    is_completed: z.number().int().min(0).max(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid agenda update.' });
    return;
  }
  const d = parsed.data;
  db.prepare(
    `UPDATE meeting_agendas
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         duration_minutes = COALESCE(?, duration_minutes),
         sort_order = COALESCE(?, sort_order),
         is_completed = COALESCE(?, is_completed)
     WHERE id = ?`
  ).run(d.title ?? null, d.description ?? null, d.duration_minutes ?? null, d.sort_order ?? null, d.is_completed ?? null, agendaId);
  res.json({ ok: true });
});

app.delete(
  '/api/agenda/:agendaId',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM meeting_agendas WHERE id = ?').run(Number(req.params.agendaId));
    res.json({ ok: true });
  }
);

// ==================== MODULE 9: ATTENDANCE MANAGEMENT ====================

app.post(
  '/api/meetings/:id/attendance',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const meetingId = Number(req.params.id);
    const schema = z.object({
      records: z.array(
        z.object({
          user_id: z.number().int().positive(),
          status: z.enum(['present', 'absent', 'late', 'excused']),
          notes: z.string().max(300).optional(),
        })
      ),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid attendance payload.' });
      return;
    }

    const upsert = db.prepare(
      `INSERT INTO attendance (meeting_id, user_id, status, verified_by, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(meeting_id, user_id) DO UPDATE SET
         status = excluded.status,
         verified_by = excluded.verified_by,
         notes = excluded.notes`
    );

    const tx = db.transaction(() => {
      for (const rec of parsed.data.records) {
        upsert.run(meetingId, rec.user_id, rec.status, req.user!.sub, rec.notes ?? '');
      }
    });
    tx();

    logActivity(req.user!.sub, 'ATTENDANCE_VERIFIED', 'meeting', meetingId, 'Verified/updated meeting attendance', req.ip);
    res.json({ ok: true });
  }
);

app.get('/api/attendance/history', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.query.user_id ? Number(req.query.user_id) : req.user!.sub;
  if (userId !== req.user!.sub && !['super_admin', 'department_head', 'meeting_organizer'].includes(req.user!.role)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const records = db
    .prepare(
      `SELECT a.*, m.title as meeting_title, m.scheduled_start, m.meeting_type,
              u.name as user_name, d.name as department_name, v.name as verified_by_name
       FROM attendance a
       JOIN meetings m ON m.id = a.meeting_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN users v ON v.id = a.verified_by
       WHERE a.user_id = ?
       ORDER BY m.scheduled_start DESC`
    )
    .all(userId);
  res.json({ records });
});

app.get('/api/attendance/all', requireAuth, requireRole('super_admin', 'department_head', 'meeting_organizer'), (_req, res) => {
  const records = db
    .prepare(
      `SELECT a.*, m.title as meeting_title, m.scheduled_start, m.meeting_type,
              u.name as user_name, d.name as department_name, v.name as verified_by_name
       FROM attendance a
       JOIN meetings m ON m.id = a.meeting_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN users v ON v.id = a.verified_by
       ORDER BY m.scheduled_start DESC, u.name ASC`
    )
    .all();
  res.json({ records });
});

// ==================== MODULE 10: MINUTES & DOCUMENTS ====================

app.post(
  '/api/meetings/:id/minutes',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const meetingId = Number(req.params.id);
    const schema = z.object({
      summary: z.string().min(5),
      discussions: z.string().optional(),
      resolutions: z.string().optional(),
      status: z.enum(['draft', 'published']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Minutes summary is required.' });
      return;
    }

    const now = new Date().toISOString();
    const publishedAt = parsed.data.status === 'published' ? now : null;
    db.prepare(
      `INSERT INTO meeting_minutes (meeting_id, summary, discussions, resolutions, status, author_id, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(meeting_id) DO UPDATE SET
         summary = excluded.summary,
         discussions = excluded.discussions,
         resolutions = excluded.resolutions,
         status = excluded.status,
         published_at = COALESCE(meeting_minutes.published_at, excluded.published_at),
         updated_at = excluded.updated_at`
    ).run(
      meetingId,
      parsed.data.summary,
      parsed.data.discussions ?? '',
      parsed.data.resolutions ?? '',
      parsed.data.status,
      req.user!.sub,
      publishedAt,
      now
    );

    if (parsed.data.status === 'published') {
      const meeting = db.prepare('SELECT title FROM meetings WHERE id = ?').get(meetingId) as { title: string } | undefined;
      const parts = db.prepare('SELECT user_id FROM meeting_participants WHERE meeting_id = ?').all(meetingId) as Array<{ user_id: number }>;
      for (const p of parts) {
        if (p.user_id !== req.user!.sub) {
          sendAndPushNotification(
            p.user_id,
            'minutes_published',
            'Meeting Minutes Published',
            `Official minutes for "${meeting?.title || 'Meeting'}" have been published.`,
            'minutes',
            meetingId
          );
        }
      }
    }

    logActivity(req.user!.sub, 'MINUTES_SAVED', 'meeting', meetingId, `Saved minutes (${parsed.data.status})`, req.ip);
    res.json({ minutes: db.prepare('SELECT * FROM meeting_minutes WHERE meeting_id = ?').get(meetingId) });
  }
);

app.get('/api/minutes', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub;
  const role = req.user!.role;
  let sql = `
    SELECT mm.*, m.title as meeting_title, m.scheduled_start, m.category, d.name as department_name, u.name as author_name
    FROM meeting_minutes mm
    JOIN meetings m ON m.id = mm.meeting_id
    JOIN users u ON u.id = mm.author_id
    LEFT JOIN departments d ON d.id = m.department_id
  `;
  const params: unknown[] = [];
  if (role === 'teacher') {
    sql += ` WHERE mm.status = 'published' AND EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = ?)`;
    params.push(userId);
  }
  sql += ' ORDER BY mm.updated_at DESC';
  res.json({ minutes: db.prepare(sql).all(...params) });
});

app.get('/api/documents', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub;
  const role = req.user!.role;
  let sql = `
    SELECT md.id, md.meeting_id, m.title as meeting_title, md.title, md.file_name, md.mime_type, md.file_size,
           md.uploaded_by, u.name as uploaded_by_name, md.access_scope, md.created_at
    FROM meeting_documents md
    JOIN meetings m ON m.id = md.meeting_id
    JOIN users u ON u.id = md.uploaded_by
  `;
  const params: unknown[] = [];
  if (role === 'teacher') {
    sql += ` WHERE (md.access_scope = 'university' OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = ?))`;
    params.push(userId);
  }
  sql += ' ORDER BY md.created_at DESC';
  res.json({ documents: db.prepare(sql).all(...params) });
});

app.post(
  '/api/meetings/:id/documents',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  upload.single('file'),
  (req: AuthenticatedRequest, res) => {
    const meetingId = Number(req.params.id);
    if (!req.file) {
      res.status(400).json({ error: 'Document file is required.' });
      return;
    }
    const title = String(req.body.title || req.file.originalname).trim();
    const accessScope = ['participants', 'department', 'university'].includes(req.body.access_scope)
      ? req.body.access_scope
      : 'participants';

    const r = db
      .prepare(
        `INSERT INTO meeting_documents (meeting_id, title, file_name, mime_type, file_size, storage_path, uploaded_by, access_scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        meetingId,
        title,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.filename,
        req.user!.sub,
        accessScope
      );

    logActivity(req.user!.sub, 'DOCUMENT_UPLOADED', 'document', r.lastInsertRowid.toString(), title, req.ip);
    res.status(201).json({
      document: db
        .prepare('SELECT id, meeting_id, title, file_name, mime_type, file_size, uploaded_by, access_scope, created_at FROM meeting_documents WHERE id = ?')
        .get(r.lastInsertRowid),
    });
  }
);

app.get('/api/documents/:docId/download', requireAuth, (req: AuthenticatedRequest, res) => {
  const docId = Number(req.params.docId);
  const doc = db.prepare('SELECT * FROM meeting_documents WHERE id = ?').get(docId) as
    | { id: number; meeting_id: number; file_name: string; storage_path: string; access_scope: string }
    | undefined;

  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }

  if (doc.access_scope !== 'university' && !canAccessMeeting(req.user!.sub, req.user!.role, doc.meeting_id)) {
    res.status(403).json({ error: 'Access restricted for this document.' });
    return;
  }

  const resolvedPath = path.resolve(UPLOADS_DIR, path.basename(doc.storage_path));
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'File unavailable on storage.' });
    return;
  }

  res.download(resolvedPath, doc.file_name);
});

// ==================== MODULE 11: DECISIONS & ACTION TRACKING ====================

app.post(
  '/api/meetings/:id/decisions',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const meetingId = Number(req.params.id);
    const schema = z.object({
      title: z.string().min(3).max(200),
      description: z.string().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Decision title is required.' });
      return;
    }

    const r = db
      .prepare('INSERT INTO meeting_decisions (meeting_id, title, description, created_by) VALUES (?, ?, ?, ?)')
      .run(meetingId, parsed.data.title.trim(), parsed.data.description ?? '', req.user!.sub);

    logActivity(req.user!.sub, 'DECISION_RECORDED', 'decision', r.lastInsertRowid.toString(), parsed.data.title, req.ip);
    res.status(201).json({ decision: db.prepare('SELECT * FROM meeting_decisions WHERE id = ?').get(r.lastInsertRowid) });
  }
);

app.get('/api/action-items', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub;
  const role = req.user!.role;
  let sql = `
    SELECT ai.*, m.title as meeting_title, u.name as assigned_to_name, d.name as department_name, dec.title as decision_title
    FROM action_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    JOIN users u ON u.id = ai.assigned_to
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN meeting_decisions dec ON dec.id = ai.decision_id
  `;
  const params: unknown[] = [];
  if (role === 'teacher') {
    sql += ' WHERE ai.assigned_to = ?';
    params.push(userId);
  }
  sql += ' ORDER BY ai.deadline ASC';
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json({
    actionItems: rows.map((r) => ({ ...r, comments: JSON.parse(String(r.comments_json || '[]')) })),
  });
});

app.post(
  '/api/action-items',
  requireAuth,
  requireRole('super_admin', 'department_head', 'meeting_organizer'),
  (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      meeting_id: z.number().int().positive(),
      decision_id: z.number().int().positive().nullable().optional(),
      title: z.string().min(3).max(200),
      description: z.string().max(1000).optional(),
      assigned_to: z.number().int().positive(),
      deadline: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Meeting, title, assignee, and deadline are required.' });
      return;
    }

    const d = parsed.data;
    const r = db
      .prepare(
        'INSERT INTO action_items (meeting_id, decision_id, title, description, assigned_to, deadline) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(d.meeting_id, d.decision_id ?? null, d.title.trim(), d.description ?? '', d.assigned_to, d.deadline);

    sendAndPushNotification(
      d.assigned_to,
      'action_assigned',
      'New Action Item Assigned',
      `You were assigned "${d.title.trim()}" (Due ${d.deadline}).`,
      'actions',
      d.meeting_id
    );

    logActivity(req.user!.sub, 'ACTION_ITEM_CREATED', 'action_item', r.lastInsertRowid.toString(), d.title, req.ip);
    res.status(201).json({ id: r.lastInsertRowid });
  }
);

app.patch('/api/action-items/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM action_items WHERE id = ?').get(id) as
    | { id: number; assigned_to: number; status: string; progress_percent: number; comments_json: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Action item not found.' });
    return;
  }

  if (
    existing.assigned_to !== req.user!.sub &&
    !['super_admin', 'department_head', 'meeting_organizer'].includes(req.user!.role)
  ) {
    res.status(403).json({ error: 'Only the assignee or coordinators can update this task.' });
    return;
  }

  const schema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
    progress_percent: z.number().int().min(0).max(100).optional(),
    comment: z.string().min(1).max(600).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid action item update.' });
    return;
  }

  const comments = JSON.parse(existing.comments_json || '[]') as Array<{
    author_id: number;
    author_name: string;
    text: string;
    created_at: string;
  }>;
  if (parsed.data.comment) {
    comments.push({
      author_id: req.user!.sub,
      author_name: req.user!.name,
      text: parsed.data.comment.trim(),
      created_at: new Date().toISOString(),
    });
  }

  const nextStatus =
    parsed.data.status ??
    (parsed.data.progress_percent === 100
      ? 'completed'
      : parsed.data.progress_percent && parsed.data.progress_percent > 0
      ? 'in_progress'
      : existing.status);

  const nextProgress =
    parsed.data.progress_percent !== undefined
      ? parsed.data.progress_percent
      : nextStatus === 'completed'
      ? 100
      : existing.progress_percent;

  db.prepare(
    'UPDATE action_items SET status = ?, progress_percent = ?, comments_json = ?, updated_at = ? WHERE id = ?'
  ).run(nextStatus, nextProgress, JSON.stringify(comments), new Date().toISOString(), id);

  res.json({ ok: true });
});

// ==================== MODULE 12: NOTIFICATIONS ====================

app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(req.user!.sub);
  res.json({ notifications });
});

app.patch('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.sub);
  res.json({ ok: true });
});

app.patch('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.sub);
  res.json({ ok: true });
});

// ==================== MODULE 13: REPORTS, ANALYTICS & ACTIVITY LOGS ====================

app.get('/api/reports/overview', requireAuth, (_req, res) => {
  const summary = {
    totalTeachers: (db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active = 1").get() as { c: number }).c,
    totalFaculties: (db.prepare('SELECT COUNT(*) as c FROM faculties').get() as { c: number }).c,
    totalDepartments: (db.prepare('SELECT COUNT(*) as c FROM departments').get() as { c: number }).c,
    totalMeetings: (db.prepare('SELECT COUNT(*) as c FROM meetings').get() as { c: number }).c,
    upcomingMeetings: (
      db.prepare("SELECT COUNT(*) as c FROM meetings WHERE room_status IN ('scheduled','waiting') AND approval_status != 'cancelled'").get() as { c: number }
    ).c,
    liveMeetings: (db.prepare("SELECT COUNT(*) as c FROM meetings WHERE room_status = 'live'").get() as { c: number }).c,
    completedMeetings: (
      db.prepare("SELECT COUNT(*) as c FROM meetings WHERE approval_status = 'completed' OR room_status = 'ended'").get() as { c: number }
    ).c,
    cancelledMeetings: (
      db.prepare("SELECT COUNT(*) as c FROM meetings WHERE approval_status = 'cancelled' OR room_status = 'cancelled'").get() as { c: number }
    ).c,
    pendingActions: (db.prepare("SELECT COUNT(*) as c FROM action_items WHERE status != 'completed'").get() as { c: number }).c,
    completedActions: (db.prepare("SELECT COUNT(*) as c FROM action_items WHERE status = 'completed'").get() as { c: number }).c,
  };

  const byDepartment = db
    .prepare(
      `SELECT COALESCE(d.name, 'University-Wide') as department,
              COUNT(m.id) as meetings,
              SUM(CASE WHEN m.meeting_type = 'online' THEN 1 ELSE 0 END) as online,
              SUM(CASE WHEN m.meeting_type = 'physical' THEN 1 ELSE 0 END) as physical,
              SUM(CASE WHEN m.meeting_type = 'hybrid' THEN 1 ELSE 0 END) as hybrid
       FROM meetings m
       LEFT JOIN departments d ON d.id = m.department_id
       GROUP BY COALESCE(d.name, 'University-Wide')`
    )
    .all();

  const byType = db
    .prepare('SELECT meeting_type as type, COUNT(*) as count FROM meetings GROUP BY meeting_type')
    .all();

  const attendanceBreakdown = db
    .prepare('SELECT status, COUNT(*) as count FROM attendance GROUP BY status')
    .all();

  const actionBreakdown = db
    .prepare('SELECT status, COUNT(*) as count FROM action_items GROUP BY status')
    .all();

  res.json({ summary, byDepartment, byType, attendanceBreakdown, actionBreakdown });
});

app.get('/api/activity-logs', requireAuth, requireRole('super_admin'), (_req, res) => {
  const logs = db
    .prepare(
      `SELECT al.*, u.name as user_name
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC
       LIMIT 100`
    )
    .all();
  res.json({ logs });
});

// ==================== SERVER STARTUP & VITE INTEGRATION ====================

const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`UTMMS server running on http://localhost:${PORT}`);
  });
}

startServer();

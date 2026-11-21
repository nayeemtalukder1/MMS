import { db } from './db';
import type { SchedulingSlotAnalysis } from '../types/utmms';

interface CandidateSlotInput {
  start: string; // ISO string
  end: string;   // ISO string
}

function toLocalHHMM(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function analyzeSchedulingSlots(
  participantIds: number[],
  candidateSlots: CandidateSlotInput[],
  excludeMeetingId?: number
): SchedulingSlotAnalysis[] {
  if (participantIds.length === 0) return [];

  const placeholders = participantIds.map(() => '?').join(',');
  const users = db
    .prepare(
      `SELECT u.id, u.name, d.name as department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id IN (${placeholders})`
    )
    .all(...participantIds) as Array<{ id: number; name: string; department_name: string | null }>;

  const availRows = db
    .prepare(`SELECT * FROM teacher_availability WHERE user_id IN (${placeholders})`)
    .all(...participantIds) as Array<{
    id: number;
    user_id: number;
    day_of_week: number | null;
    specific_date: string | null;
    start_time: string;
    end_time: string;
    status: 'available' | 'busy';
    label: string;
    is_recurring: number;
  }>;

  const existingMeetings = db
    .prepare(
      `SELECT m.id, m.title, m.scheduled_start, m.scheduled_end, mp.user_id
       FROM meetings m
       JOIN meeting_participants mp ON mp.meeting_id = m.id
       WHERE mp.user_id IN (${placeholders})
         AND m.approval_status != 'cancelled'
         AND m.room_status != 'cancelled'
         AND mp.invitation_status != 'rejected'
         ${excludeMeetingId ? 'AND m.id != ?' : ''}`
    )
    .all(...(excludeMeetingId ? [...participantIds, excludeMeetingId] : participantIds)) as Array<{
    id: number;
    title: string;
    scheduled_start: string;
    scheduled_end: string;
    user_id: number;
  }>;

  const analyses: SchedulingSlotAnalysis[] = candidateSlots.map((slot) => {
    const startDate = new Date(slot.start);
    const endDate = new Date(slot.end);
    const dow = startDate.getDay();
    const dateStr = toLocalDateStr(slot.start);
    const slotStartHHMM = toLocalHHMM(slot.start);
    const slotEndHHMM = toLocalHHMM(slot.end);

    const participantStatuses = users.map((user) => {
      // 1. Check overlapping scheduled meetings first
      const meetingConflict = existingMeetings.find((em) => {
        if (em.user_id !== user.id) return false;
        return new Date(em.scheduled_start) < endDate && startDate < new Date(em.scheduled_end);
      });

      if (meetingConflict) {
        return {
          user_id: user.id,
          name: user.name,
          department_name: user.department_name,
          status: 'meeting_conflict' as const,
          reason: `Scheduled in "${meetingConflict.title}"`,
        };
      }

      // 2. Check specific date busy/available overrides
      const userAvails = availRows.filter((a) => a.user_id === user.id);
      const specificBusy = userAvails.find(
        (a) =>
          a.specific_date === dateStr &&
          a.status === 'busy' &&
          timeRangesOverlap(slotStartHHMM, slotEndHHMM, a.start_time, a.end_time)
      );
      if (specificBusy) {
        return {
          user_id: user.id,
          name: user.name,
          department_name: user.department_name,
          status: 'busy' as const,
          reason: specificBusy.label || 'Marked busy on this date',
        };
      }

      // 3. Check recurring day_of_week busy blocks
      const recurringBusy = userAvails.find(
        (a) =>
          a.is_recurring === 1 &&
          a.day_of_week === dow &&
          a.status === 'busy' &&
          timeRangesOverlap(slotStartHHMM, slotEndHHMM, a.start_time, a.end_time)
      );
      if (recurringBusy) {
        return {
          user_id: user.id,
          name: user.name,
          department_name: user.department_name,
          status: 'busy' as const,
          reason: recurringBusy.label || 'Recurring busy block',
        };
      }

      // 4. Check if teacher has explicit available windows covering this slot (if they set any)
      const specificAvail = userAvails.find(
        (a) =>
          a.specific_date === dateStr &&
          a.status === 'available' &&
          a.start_time <= slotStartHHMM &&
          a.end_time >= slotEndHHMM
      );
      if (specificAvail) {
        return {
          user_id: user.id,
          name: user.name,
          department_name: user.department_name,
          status: 'available' as const,
          reason: specificAvail.label || 'Available (custom date)',
        };
      }

      const dayAvailWindows = userAvails.filter(
        (a) => a.is_recurring === 1 && a.day_of_week === dow && a.status === 'available'
      );

      if (dayAvailWindows.length > 0) {
        const covers = dayAvailWindows.find((a) => a.start_time <= slotStartHHMM && a.end_time >= slotEndHHMM);
        if (covers) {
          return {
            user_id: user.id,
            name: user.name,
            department_name: user.department_name,
            status: 'available' as const,
            reason: covers.label || 'Within available hours',
          };
        }
        return {
          user_id: user.id,
          name: user.name,
          department_name: user.department_name,
          status: 'busy' as const,
          reason: 'Outside preferred availability hours',
        };
      }

      // Default neutral availability during standard weekday business hours if no slots configured
      if (dow >= 1 && dow <= 5 && slotStartHHMM >= '08:30' && slotEndHHMM <= '17:30') {
        return {
          user_id: user.id,
          name: user.name,
          department_name: user.department_name,
          status: 'available' as const,
          reason: 'No conflicts reported',
        };
      }

      return {
        user_id: user.id,
        name: user.name,
        department_name: user.department_name,
        status: 'busy' as const,
        reason: 'Outside standard academic hours',
      };
    });

    const availableCount = participantStatuses.filter((p) => p.status === 'available').length;
    const totalCount = participantStatuses.length;
    const availabilityPercent = totalCount > 0 ? Math.round((availableCount / totalCount) * 100) : 0;

    const label = `${startDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}–${endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

    return {
      slot_start: slot.start,
      slot_end: slot.end,
      label,
      available_count: availableCount,
      total_count: totalCount,
      availability_percent: availabilityPercent,
      participants: participantStatuses,
    };
  });

  // Sort by highest availability count descending, then chronologically
  analyses.sort((a, b) => {
    if (b.available_count !== a.available_count) return b.available_count - a.available_count;
    return new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime();
  });

  return analyses;
}

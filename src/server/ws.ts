import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyRoomToken, verifySessionToken } from './auth';
import { db } from './db';

interface AdmittedPeer {
  userId: number;
  name: string;
  role: string;
  isHost: boolean;
  ws: WebSocket;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  joinedAt: string;
  sessionId: number;
}

interface WaitingPeer {
  userId: number;
  name: string;
  role: string;
  ws: WebSocket;
  requestedAt: string;
}

interface RoomState {
  meetingId: number;
  admitted: Map<number, AdmittedPeer>;
  waiting: Map<number, WaitingPeer>;
}

const userSockets = new Map<number, Set<WebSocket>>();
const rooms = new Map<number, RoomState>();

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function pushNotificationToUser(userId: number, notification: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    safeSend(ws, { type: 'notification:new', notification });
  }
}

function getOrCreateRoom(meetingId: number): RoomState {
  let room = rooms.get(meetingId);
  if (!room) {
    room = {
      meetingId,
      admitted: new Map(),
      waiting: new Map(),
    };
    rooms.set(meetingId, room);
  }
  return room;
}

function serializeRoomState(room: RoomState) {
  return {
    meetingId: room.meetingId,
    participants: Array.from(room.admitted.values()).map((p) => ({
      userId: p.userId,
      name: p.name,
      role: p.role,
      isHost: p.isHost,
      audioEnabled: p.audioEnabled,
      videoEnabled: p.videoEnabled,
      screenSharing: p.screenSharing,
      joinedAt: p.joinedAt,
    })),
    waiting: Array.from(room.waiting.values()).map((w) => ({
      userId: w.userId,
      name: w.name,
      role: w.role,
      requestedAt: w.requestedAt,
    })),
  };
}

function broadcastRoom(room: RoomState, data: unknown, excludeUserId?: number) {
  for (const peer of room.admitted.values()) {
    if (excludeUserId !== undefined && peer.userId === excludeUserId) continue;
    safeSend(peer.ws, data);
  }
}

function recordSessionJoin(meetingId: number, userId: number, audioEnabled: boolean, videoEnabled: boolean): number {
  const now = new Date().toISOString();
  const res = db
    .prepare(
      'INSERT INTO meeting_sessions (meeting_id, user_id, joined_at, connection_status, audio_enabled, video_enabled, screen_sharing) VALUES (?, ?, ?, ?, ?, ?, 0)'
    )
    .run(meetingId, userId, now, 'connected', audioEnabled ? 1 : 0, videoEnabled ? 1 : 0);

  const existingAtt = db
    .prepare('SELECT * FROM attendance WHERE meeting_id = ? AND user_id = ?')
    .get(meetingId, userId) as { id: number; joined_at: string | null } | undefined;

  if (!existingAtt) {
    db.prepare(
      `INSERT INTO attendance (meeting_id, user_id, status, joined_at, duration_seconds, notes)
       VALUES (?, ?, 'present', ?, 0, 'Online session logged')`
    ).run(meetingId, userId, now);
  } else if (!existingAtt.joined_at) {
    db.prepare('UPDATE attendance SET joined_at = ?, status = ? WHERE id = ?').run(now, 'present', existingAtt.id);
  }

  return Number(res.lastInsertRowid);
}

function recordSessionLeave(meetingId: number, userId: number, sessionId: number) {
  const now = new Date().toISOString();
  const session = db
    .prepare('SELECT joined_at FROM meeting_sessions WHERE id = ?')
    .get(sessionId) as { joined_at: string } | undefined;

  db.prepare('UPDATE meeting_sessions SET left_at = ?, connection_status = ? WHERE id = ?').run(now, 'disconnected', sessionId);

  if (session) {
    const deltaSeconds = Math.max(1, Math.round((new Date(now).getTime() - new Date(session.joined_at).getTime()) / 1000));
    const meeting = db
      .prepare('SELECT scheduled_start, scheduled_end FROM meetings WHERE id = ?')
      .get(meetingId) as { scheduled_start: string; scheduled_end: string } | undefined;
    const uni = db.prepare('SELECT min_attendance_percent FROM universities LIMIT 1').get() as { min_attendance_percent: number } | undefined;
    const minPercent = uni?.min_attendance_percent ?? 75;

    const currentAtt = db
      .prepare('SELECT id, duration_seconds, status FROM attendance WHERE meeting_id = ? AND user_id = ?')
      .get(meetingId, userId) as { id: number; duration_seconds: number; status: string } | undefined;

    if (currentAtt) {
      const totalSeconds = (currentAtt.duration_seconds || 0) + deltaSeconds;
      let nextStatus = currentAtt.status;
      if (meeting) {
        const scheduledSeconds = Math.max(
          60,
          Math.round((new Date(meeting.scheduled_end).getTime() - new Date(meeting.scheduled_start).getTime()) / 1000)
        );
        const pct = (totalSeconds / scheduledSeconds) * 100;
        if (pct >= minPercent) {
          nextStatus = 'present';
        } else if (pct >= 25) {
          nextStatus = 'late';
        }
      }
      db.prepare('UPDATE attendance SET left_at = ?, duration_seconds = ?, status = ? WHERE id = ?').run(
        now,
        totalSeconds,
        nextStatus,
        currentAtt.id
      );
    }
  }
}

export function attachWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const token = url.searchParams.get('token') || '';
    const sessionUser = verifySessionToken(token);

    if (!sessionUser) {
      safeSend(ws, { type: 'error', message: 'Unauthorized WebSocket connection' });
      ws.close(1008, 'Unauthorized');
      return;
    }

    const userId = sessionUser.sub;
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(ws);

    let activeRoomId: number | null = null;

    const cleanupFromRoom = () => {
      if (activeRoomId === null) return;
      const room = rooms.get(activeRoomId);
      if (!room) {
        activeRoomId = null;
        return;
      }

      if (room.waiting.has(userId)) {
        const w = room.waiting.get(userId)!;
        if (w.ws === ws) {
          room.waiting.delete(userId);
          broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
        }
      }

      const peer = room.admitted.get(userId);
      if (peer && peer.ws === ws) {
        room.admitted.delete(userId);
        recordSessionLeave(activeRoomId, userId, peer.sessionId);
        broadcastRoom(room, { type: 'room:peer-left', userId, name: peer.name });
        broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
      }

      if (room.admitted.size === 0 && room.waiting.size === 0) {
        rooms.delete(activeRoomId);
      }
      activeRoomId = null;
    };

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'room:join') {
        const roomTokenStr = String(msg.roomToken || '');
        const roomPayload = verifyRoomToken(roomTokenStr);
        if (!roomPayload || roomPayload.sub !== userId) {
          safeSend(ws, { type: 'room:error', message: 'Invalid or expired meeting room access token' });
          return;
        }

        const meeting = db
          .prepare('SELECT id, room_status, waiting_room_enabled, organizer_id FROM meetings WHERE id = ?')
          .get(roomPayload.meetingId) as
          | { id: number; room_status: string; waiting_room_enabled: number; organizer_id: number }
          | undefined;

        if (!meeting || meeting.room_status === 'cancelled' || meeting.room_status === 'ended') {
          safeSend(ws, { type: 'room:error', message: 'This meeting room is closed or cancelled.' });
          return;
        }

        cleanupFromRoom();
        activeRoomId = roomPayload.meetingId;
        const room = getOrCreateRoom(activeRoomId);

        const audioEnabled = Boolean(msg.audioEnabled ?? true);
        const videoEnabled = Boolean(msg.videoEnabled ?? true);

        const needsWaiting = meeting.waiting_room_enabled === 1 && !roomPayload.isHost;
        if (needsWaiting) {
          room.waiting.set(userId, {
            userId,
            name: roomPayload.name,
            role: roomPayload.role,
            ws,
            requestedAt: new Date().toISOString(),
          });
          safeSend(ws, { type: 'room:waiting', meetingId: activeRoomId });
          broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
          return;
        }

        // Host or direct entry
        if (meeting.room_status === 'scheduled' || meeting.room_status === 'waiting') {
          db.prepare("UPDATE meetings SET room_status = 'live', actual_start = COALESCE(actual_start, ?) WHERE id = ?").run(
            new Date().toISOString(),
            activeRoomId
          );
        }

        const sessionId = recordSessionJoin(activeRoomId, userId, audioEnabled, videoEnabled);
        const peer: AdmittedPeer = {
          userId,
          name: roomPayload.name,
          role: roomPayload.role,
          isHost: roomPayload.isHost,
          ws,
          audioEnabled,
          videoEnabled,
          screenSharing: false,
          joinedAt: new Date().toISOString(),
          sessionId,
        };
        room.admitted.set(userId, peer);

        // Send existing peers to the newly joined user so they can send offers
        const existingPeers = Array.from(room.admitted.values())
          .filter((p) => p.userId !== userId)
          .map((p) => ({
            userId: p.userId,
            name: p.name,
            role: p.role,
            isHost: p.isHost,
            audioEnabled: p.audioEnabled,
            videoEnabled: p.videoEnabled,
            screenSharing: p.screenSharing,
          }));

        safeSend(ws, {
          type: 'room:admitted',
          isHost: roomPayload.isHost,
          existingPeers,
          ...serializeRoomState(room),
        });

        broadcastRoom(
          room,
          {
            type: 'room:peer-joined',
            peer: {
              userId: peer.userId,
              name: peer.name,
              role: peer.role,
              isHost: peer.isHost,
              audioEnabled: peer.audioEnabled,
              videoEnabled: peer.videoEnabled,
              screenSharing: peer.screenSharing,
            },
          },
          userId
        );
        broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
        return;
      }

      if (activeRoomId === null) return;
      const room = rooms.get(activeRoomId);
      if (!room) return;
      const currentPeer = room.admitted.get(userId);

      // WebRTC signaling relay (offer / answer / ice-candidate)
      if (type === 'webrtc:offer' || type === 'webrtc:answer' || type === 'webrtc:ice-candidate') {
        if (!currentPeer) return;
        const targetUserId = Number(msg.targetUserId);
        const targetPeer = room.admitted.get(targetUserId);
        if (!targetPeer) return;
        safeSend(targetPeer.ws, {
          type,
          fromUserId: userId,
          fromName: currentPeer.name,
          payload: msg.payload,
        });
        return;
      }

      if (type === 'room:media-state' && currentPeer) {
        currentPeer.audioEnabled = Boolean(msg.audioEnabled);
        currentPeer.videoEnabled = Boolean(msg.videoEnabled);
        currentPeer.screenSharing = Boolean(msg.screenSharing);
        db.prepare(
          'UPDATE meeting_sessions SET audio_enabled = ?, video_enabled = ?, screen_sharing = ? WHERE id = ?'
        ).run(
          currentPeer.audioEnabled ? 1 : 0,
          currentPeer.videoEnabled ? 1 : 0,
          currentPeer.screenSharing ? 1 : 0,
          currentPeer.sessionId
        );
        broadcastRoom(room, {
          type: 'room:peer-media-updated',
          userId,
          audioEnabled: currentPeer.audioEnabled,
          videoEnabled: currentPeer.videoEnabled,
          screenSharing: currentPeer.screenSharing,
        });
        broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
        return;
      }

      if (type === 'room:admit' && currentPeer?.isHost) {
        const targetUserId = Number(msg.targetUserId);
        const waitingPeer = room.waiting.get(targetUserId);
        if (!waitingPeer) return;
        room.waiting.delete(targetUserId);

        const sessionId = recordSessionJoin(activeRoomId, targetUserId, true, true);
        const admittedPeer: AdmittedPeer = {
          userId: waitingPeer.userId,
          name: waitingPeer.name,
          role: waitingPeer.role,
          isHost: false,
          ws: waitingPeer.ws,
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          joinedAt: new Date().toISOString(),
          sessionId,
        };
        room.admitted.set(targetUserId, admittedPeer);

        const existingPeers = Array.from(room.admitted.values())
          .filter((p) => p.userId !== targetUserId)
          .map((p) => ({
            userId: p.userId,
            name: p.name,
            role: p.role,
            isHost: p.isHost,
            audioEnabled: p.audioEnabled,
            videoEnabled: p.videoEnabled,
            screenSharing: p.screenSharing,
          }));

        safeSend(waitingPeer.ws, {
          type: 'room:admitted',
          isHost: false,
          existingPeers,
          ...serializeRoomState(room),
        });

        broadcastRoom(
          room,
          {
            type: 'room:peer-joined',
            peer: {
              userId: admittedPeer.userId,
              name: admittedPeer.name,
              role: admittedPeer.role,
              isHost: false,
              audioEnabled: true,
              videoEnabled: true,
              screenSharing: false,
            },
          },
          targetUserId
        );
        broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
        return;
      }

      if (type === 'room:reject' && currentPeer?.isHost) {
        const targetUserId = Number(msg.targetUserId);
        const waitingPeer = room.waiting.get(targetUserId);
        if (!waitingPeer) return;
        room.waiting.delete(targetUserId);
        safeSend(waitingPeer.ws, { type: 'room:rejected', message: 'Host declined admission to this meeting room.' });
        broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
        return;
      }

      if (type === 'room:mute-participant' && currentPeer?.isHost) {
        const targetUserId = Number(msg.targetUserId);
        const targetPeer = room.admitted.get(targetUserId);
        if (!targetPeer) return;
        targetPeer.audioEnabled = false;
        safeSend(targetPeer.ws, { type: 'room:force-muted', by: currentPeer.name });
        broadcastRoom(room, {
          type: 'room:peer-media-updated',
          userId: targetUserId,
          audioEnabled: false,
          videoEnabled: targetPeer.videoEnabled,
          screenSharing: targetPeer.screenSharing,
        });
        broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
        return;
      }

      if (type === 'room:remove-participant' && currentPeer?.isHost) {
        const targetUserId = Number(msg.targetUserId);
        const targetPeer = room.admitted.get(targetUserId);
        if (!targetPeer || targetUserId === userId) return;
        room.admitted.delete(targetUserId);
        recordSessionLeave(activeRoomId, targetUserId, targetPeer.sessionId);
        safeSend(targetPeer.ws, { type: 'room:removed', message: 'You have been removed from the meeting by the host.' });
        broadcastRoom(room, { type: 'room:peer-left', userId: targetUserId, name: targetPeer.name });
        broadcastRoom(room, { type: 'room:state', ...serializeRoomState(room) });
        return;
      }

      if (type === 'room:chat' && currentPeer) {
        const text = String(msg.text || '').trim().slice(0, 1000);
        if (!text) return;
        broadcastRoom(room, {
          type: 'room:chat',
          userId,
          name: currentPeer.name,
          text,
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (type === 'room:agenda-toggle' && currentPeer) {
        const agendaId = Number(msg.agendaId);
        const isCompleted = msg.isCompleted ? 1 : 0;
        db.prepare('UPDATE meeting_agendas SET is_completed = ? WHERE id = ? AND meeting_id = ?').run(
          isCompleted,
          agendaId,
          activeRoomId
        );
        broadcastRoom(room, { type: 'room:agenda-updated', agendaId, isCompleted });
        return;
      }

      if (type === 'room:end' && currentPeer?.isHost) {
        const now = new Date().toISOString();
        db.prepare("UPDATE meetings SET room_status = 'ended', approval_status = 'completed', actual_end = ? WHERE id = ?").run(
          now,
          activeRoomId
        );
        for (const peer of room.admitted.values()) {
          recordSessionLeave(activeRoomId, peer.userId, peer.sessionId);
          safeSend(peer.ws, { type: 'room:ended', by: currentPeer.name });
        }
        for (const w of room.waiting.values()) {
          safeSend(w.ws, { type: 'room:ended', by: currentPeer.name });
        }
        rooms.delete(activeRoomId);
        activeRoomId = null;
        return;
      }

      if (type === 'room:leave') {
        cleanupFromRoom();
      }
    });

    ws.on('close', () => {
      cleanupFromRoom();
      const set = userSockets.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) userSockets.delete(userId);
      }
    });
  });

  return wss;
}

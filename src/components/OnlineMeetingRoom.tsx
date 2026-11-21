import React, { useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  Copy,
  FileText,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  Radio,
  ShieldAlert,
  Square,
  UserCheck,
  UserMinus,
  Users,
  Video,
  VideoOff,
  Volume2,
  Wifi,
} from 'lucide-react';
import { apiFetch, buildWsUrl, formatRoleLabel } from '../lib/api';
import type { AgendaItem, Meeting, User } from '../types/utmms';

interface RoomPeer {
  userId: number;
  name: string;
  role: string;
  isHost: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
}

interface WaitingEntry {
  userId: number;
  name: string;
  role: string;
  requestedAt: string;
}

interface ChatMessage {
  userId: number;
  name: string;
  text: string;
  createdAt: string;
}

interface OnlineMeetingRoomProps {
  meeting: Meeting;
  currentUser: User;
  onExit: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const PeerVideoTile: React.FC<{
  stream: MediaStream | null;
  name: string;
  role: string;
  isHost?: boolean;
  isSelf?: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
  isSpeaking?: boolean;
  large?: boolean;
}> = ({
  stream,
  name,
  role,
  isHost,
  isSelf,
  audioEnabled,
  videoEnabled,
  screenSharing,
  isSpeaking,
  large,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
    } else {
      el.srcObject = null;
    }
  }, [stream, videoEnabled, screenSharing]);

  const showVideo = Boolean(stream && (videoEnabled || screenSharing) && stream.getVideoTracks().length > 0);
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-slate-900 border transition-colors ${
        isSpeaking ? 'border-teal-400 ring-2 ring-teal-400/50' : 'border-slate-800'
      } ${large ? 'w-full h-full min-h-[340px]' : 'aspect-video w-full'}`}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isSelf}
          className={`w-full h-full ${screenSharing ? 'object-contain bg-black' : 'object-cover'} ${
            isSelf && !screenSharing ? 'scale-x-[-1]' : ''
          }`}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-200 p-4">
          <div className="w-16 h-16 rounded-full bg-[#0F2942] border border-slate-700 flex items-center justify-center font-display font-semibold text-xl text-teal-300">
            {initials}
          </div>
          <p className="mt-3 text-sm font-medium text-white">{name}</p>
          <p className="text-xs text-slate-400">{videoEnabled ? 'Audio / Standby' : 'Camera Off'}</p>
        </div>
      )}

      {/* Subtle bottom scrim */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-white font-medium truncate">
            <span className="truncate">
              {name}
              {isSelf ? ' (You)' : ''}
            </span>
            {isHost && (
              <span className="text-[11px] text-teal-300 font-normal shrink-0">· Host</span>
            )}
            {screenSharing && (
              <span className="text-[11px] text-amber-300 font-normal shrink-0">· Presenting</span>
            )}
          </div>
          <p className="text-[11px] text-slate-300 truncate">{formatRoleLabel(role)}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {audioEnabled ? (
            <Mic className={`w-3.5 h-3.5 ${isSpeaking ? 'text-teal-400' : 'text-slate-200'}`} />
          ) : (
            <MicOff className="w-3.5 h-3.5 text-red-400" />
          )}
        </div>
      </div>
    </div>
  );
};

export const OnlineMeetingRoom: React.FC<OnlineMeetingRoomProps> = ({ meeting, currentUser, onExit }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<'connecting' | 'waiting' | 'admitted' | 'rejected' | 'ended' | 'error'>('connecting');
  const [statusMessage, setStatusMessage] = useState('Verifying secure room access token...');
  const [isHost, setIsHost] = useState(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<number, MediaStream>>(new Map());
  const [participants, setParticipants] = useState<RoomPeer[]>([]);
  const [waitingList, setWaitingList] = useState<WaitingEntry[]>([]);
  const [agendas, setAgendas] = useState<AgendaItem[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioOnlyMode, setAudioOnlyMode] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<number>>(new Set());

  const [sideTab, setSideTab] = useState<'participants' | 'agenda' | 'chat' | 'info'>('participants');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>('');

  // Load meeting agendas
  useEffect(() => {
    apiFetch<{ agendas: AgendaItem[] }>(`/api/meetings/${meeting.id}`)
      .then((res) => setAgendas(res.agendas || []))
      .catch(() => {});
  }, [meeting.id]);

  // Duration timer
  useEffect(() => {
    if (status !== 'admitted') return;
    const id = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // Acquire browser media and connect signaling
  useEffect(() => {
    let mounted = true;
    let audioCtx: AudioContext | null = null;
    let levelInterval: number | null = null;

    async function initRoom() {
      // 1. Get local audio/video gracefully
      let stream: MediaStream | null = null;
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        }
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (mounted) {
            setVideoEnabled(false);
            setMediaNotice('Camera unavailable or permission declined — joined with microphone audio.');
          }
        } catch {
          if (mounted) {
            setAudioEnabled(false);
            setVideoEnabled(false);
            setMediaNotice('No microphone/camera detected — joined in listen & view mode.');
          }
        }
      }

      if (!mounted) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);

      if (navigator.mediaDevices?.enumerateDevices) {
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (mounted) {
              setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'));
            }
          })
          .catch(() => {});
      }

      // Active speaker detection on local mic
      if (stream && stream.getAudioTracks().length > 0 && typeof AudioContext !== 'undefined') {
        try {
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          levelInterval = window.setInterval(() => {
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
            setSpeakingUserIds((prev) => {
              const next = new Set(prev);
              if (avg > 18) next.add(currentUser.id);
              else next.delete(currentUser.id);
              return next;
            });
          }, 300);
        } catch {
          // ignore audio analyzer unsupported
        }
      }

      // 2. Obtain short-lived server room token
      let roomToken = '';
      try {
        const tokenRes = await apiFetch<{ roomToken: string; isHost: boolean }>(
          `/api/meetings/${meeting.id}/room-token`,
          { method: 'POST' }
        );
        roomToken = tokenRes.roomToken;
        if (mounted) setIsHost(tokenRes.isHost);
      } catch (err) {
        if (mounted) {
          setStatus('error');
          setStatusMessage(err instanceof Error ? err.message : 'Unable to obtain meeting room token.');
        }
        return;
      }

      // 3. Connect WebSocket signaling
      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;

      const createPeerConnection = (targetUserId: number, shouldOffer: boolean) => {
        const existing = peerConnectionsRef.current.get(targetUserId);
        if (existing) existing.close();

        const pc = new RTCPeerConnection(RTC_CONFIG);
        peerConnectionsRef.current.set(targetUserId, pc);

        const activeStream = screenStreamRef.current || localStreamRef.current;
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
            if (track.kind === 'video' && screenStreamRef.current) {
              const screenTrack = screenStreamRef.current.getVideoTracks()[0];
              if (screenTrack) {
                pc.addTrack(screenTrack, screenStreamRef.current);
                return;
              }
            }
            pc.addTrack(track, localStreamRef.current!);
          });
        } else if (activeStream) {
          activeStream.getTracks().forEach((track) => pc.addTrack(track, activeStream));
        }

        pc.onicecandidate = (event) => {
          if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'webrtc:ice-candidate',
                targetUserId,
                payload: event.candidate,
              })
            );
          }
        };

        pc.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (remoteStream && mounted) {
            setRemoteStreams((prev) => {
              const next = new Map(prev);
              next.set(targetUserId, remoteStream);
              return next;
            });
          }
        };

        if (shouldOffer) {
          pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer).then(() => offer))
            .then((offer) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'webrtc:offer',
                    targetUserId,
                    payload: offer,
                  })
                );
              }
            })
            .catch(() => {});
        }

        return pc;
      };

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'room:join',
            roomToken,
            audioEnabled: Boolean(stream?.getAudioTracks().length),
            videoEnabled: Boolean(stream?.getVideoTracks().length),
          })
        );
      };

      ws.onmessage = async (event) => {
        if (!mounted) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = String(msg.type || '');
        if (type === 'room:waiting') {
          setStatus('waiting');
          setStatusMessage('Waiting for the meeting host to admit you from the waiting room...');
        } else if (type === 'room:admitted') {
          setStatus('admitted');
          setIsHost(Boolean(msg.isHost));
          setParticipants((msg.participants as RoomPeer[]) || []);
          setWaitingList((msg.waiting as WaitingEntry[]) || []);
          const existingPeers = (msg.existingPeers as RoomPeer[]) || [];
          existingPeers.forEach((p) => createPeerConnection(p.userId, true));
        } else if (type === 'room:state') {
          setParticipants((msg.participants as RoomPeer[]) || []);
          setWaitingList((msg.waiting as WaitingEntry[]) || []);
        } else if (type === 'room:peer-joined') {
          const peer = msg.peer as RoomPeer;
          if (peer && peer.userId !== currentUser.id) {
            createPeerConnection(peer.userId, false);
          }
        } else if (type === 'room:peer-left') {
          const leftId = Number(msg.userId);
          const pc = peerConnectionsRef.current.get(leftId);
          if (pc) {
            pc.close();
            peerConnectionsRef.current.delete(leftId);
          }
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(leftId);
            return next;
          });
        } else if (type === 'webrtc:offer') {
          const fromUserId = Number(msg.fromUserId);
          const pc = createPeerConnection(fromUserId, false);
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'webrtc:answer', targetUserId: fromUserId, payload: answer }));
        } else if (type === 'webrtc:answer') {
          const fromUserId = Number(msg.fromUserId);
          const pc = peerConnectionsRef.current.get(fromUserId);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          }
        } else if (type === 'webrtc:ice-candidate') {
          const fromUserId = Number(msg.fromUserId);
          const pc = peerConnectionsRef.current.get(fromUserId);
          if (pc && msg.payload) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit));
            } catch {
              // ignore late candidate
            }
          }
        } else if (type === 'room:force-muted') {
          localStreamRef.current?.getAudioTracks().forEach((t) => {
            t.enabled = false;
          });
          setAudioEnabled(false);
          setMediaNotice(`Microphone muted by host (${String(msg.by || 'Host')}).`);
        } else if (type === 'room:rejected') {
          setStatus('rejected');
          setStatusMessage(String(msg.message || 'Entry declined by host.'));
        } else if (type === 'room:removed') {
          setStatus('ended');
          setStatusMessage(String(msg.message || 'Removed from meeting room.'));
        } else if (type === 'room:ended') {
          setStatus('ended');
          setStatusMessage(`Meeting ended by ${String(msg.by || 'Host')}. Attendance has been logged.`);
        } else if (type === 'room:error') {
          setStatus('error');
          setStatusMessage(String(msg.message || 'Unable to connect to meeting room.'));
        } else if (type === 'room:chat') {
          setChatMessages((prev) => [
            ...prev,
            {
              userId: Number(msg.userId),
              name: String(msg.name),
              text: String(msg.text),
              createdAt: String(msg.createdAt),
            },
          ]);
        } else if (type === 'room:agenda-updated') {
          const agendaId = Number(msg.agendaId);
          const isCompleted = Number(msg.isCompleted);
          setAgendas((prev) => prev.map((a) => (a.id === agendaId ? { ...a, is_completed: isCompleted } : a)));
        }
      };

      ws.onclose = () => {
        if (mounted && status === 'connecting') {
          setStatus('error');
          setStatusMessage('Connection to meeting signaling server closed.');
        }
      };
    }

    initRoom();

    return () => {
      mounted = false;
      if (levelInterval) window.clearInterval(levelInterval);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'room:leave' }));
        wsRef.current.close();
      }
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [meeting.id, currentUser.id]);

  const syncMediaState = (nextAudio: boolean, nextVideo: boolean, nextScreen: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'room:media-state',
          audioEnabled: nextAudio,
          videoEnabled: nextVideo,
          screenSharing: nextScreen,
        })
      );
    }
  };

  const toggleMic = () => {
    const next = !audioEnabled;
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    setAudioEnabled(next);
    syncMediaState(next, videoEnabled, screenSharing);
  };

  const toggleCamera = () => {
    const next = !videoEnabled;
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    setVideoEnabled(next);
    if (next) setAudioOnlyMode(false);
    syncMediaState(audioEnabled, next, screenSharing);
  };

  const toggleAudioOnly = () => {
    const nextAudioOnly = !audioOnlyMode;
    setAudioOnlyMode(nextAudioOnly);
    if (nextAudioOnly) {
      localStreamRef.current?.getVideoTracks().forEach((t) => {
        t.enabled = false;
      });
      setVideoEnabled(false);
      syncMediaState(audioEnabled, false, screenSharing);
    }
  };

  const toggleScreenShare = async () => {
    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        peerConnectionsRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(camTrack).catch(() => {});
        });
      }
      setScreenSharing(false);
      syncMediaState(audioEnabled, videoEnabled, false);
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = display.getVideoTracks()[0];
      screenStreamRef.current = display;
      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack).catch(() => {});
      });
      screenTrack.onended = () => {
        screenStreamRef.current = null;
        setScreenSharing(false);
        const camTrack = localStreamRef.current?.getVideoTracks()[0];
        if (camTrack) {
          peerConnectionsRef.current.forEach((pc) => {
            const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(camTrack).catch(() => {});
          });
        }
        syncMediaState(audioEnabled, videoEnabled, false);
      };
      setScreenSharing(true);
      syncMediaState(audioEnabled, videoEnabled, true);
    } catch {
      setMediaNotice('Screen sharing was cancelled or is unsupported by this browser.');
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleLeave = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'room:leave' }));
    }
    onExit();
  };

  const handleEndForAll = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'room:end' }));
    }
    onExit();
  };

  const handleAdmit = (targetUserId: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'room:admit', targetUserId }));
  };

  const handleReject = (targetUserId: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'room:reject', targetUserId }));
  };

  const handleMuteParticipant = (targetUserId: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'room:mute-participant', targetUserId }));
  };

  const handleRemoveParticipant = (targetUserId: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'room:remove-participant', targetUserId }));
  };

  const handleToggleAgenda = (item: AgendaItem) => {
    const next = item.is_completed ? 0 : 1;
    setAgendas((prev) => prev.map((a) => (a.id === item.id ? { ...a, is_completed: next } : a)));
    wsRef.current?.send(JSON.stringify({ type: 'room:agenda-toggle', agendaId: item.id, isCompleted: next }));
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    wsRef.current?.send(JSON.stringify({ type: 'room:chat', text: chatInput.trim() }));
    setChatInput('');
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const remotePeers = participants.filter((p) => p.userId !== currentUser.id);
  const presentingPeer = remotePeers.find((p) => p.screenSharing);

  if (status !== 'admitted') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-[#0F2942] border border-teal-700/50 flex items-center justify-center mx-auto mb-4">
            {status === 'waiting' ? (
              <Users className="w-6 h-6 text-teal-400" />
            ) : status === 'rejected' || status === 'error' ? (
              <ShieldAlert className="w-6 h-6 text-red-400" />
            ) : (
              <Radio className="w-6 h-6 text-teal-400" />
            )}
          </div>
          <h2 className="font-display text-lg font-semibold text-white">{meeting.title}</h2>
          <p className="text-xs text-slate-400 mt-1">
            {meeting.category} · Room {meeting.meeting_room_id || `nbu-${meeting.id}`}
          </p>
          <p className="text-sm text-slate-300 mt-5 leading-relaxed">{statusMessage}</p>
          <button
            type="button"
            onClick={onExit}
            className="mt-6 px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Meeting Bar */}
      <header className="px-4 sm:px-6 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
            <h1 className="font-display text-sm sm:text-base font-semibold text-white truncate">
              {meeting.title}
            </h1>
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {meeting.category} · Room ID: <span className="font-mono">{meeting.meeting_room_id}</span> · {participants.length} connected
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-300 font-mono tabular-nums px-2.5 py-1 rounded-md bg-slate-800">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            {formatTimer(elapsedSeconds)}
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {mediaNotice && (
        <div className="px-6 py-2 bg-amber-950/60 border-b border-amber-800/60 text-xs text-amber-200 flex items-center justify-between">
          <span>{mediaNotice}</span>
          <button type="button" onClick={() => setMediaNotice(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Stage + Sidebar */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Video Area */}
        <div className="flex-1 p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto">
          {/* Spotlight Stage */}
          <div className="flex-1 min-h-[340px]">
            {presentingPeer ? (
              <PeerVideoTile
                stream={remoteStreams.get(presentingPeer.userId) || null}
                name={presentingPeer.name}
                role={presentingPeer.role}
                isHost={presentingPeer.isHost}
                audioEnabled={presentingPeer.audioEnabled}
                videoEnabled={presentingPeer.videoEnabled}
                screenSharing
                large
              />
            ) : (
              <PeerVideoTile
                stream={screenSharing && screenStreamRef.current ? screenStreamRef.current : localStream}
                name={currentUser.name}
                role={currentUser.role}
                isHost={isHost}
                isSelf
                audioEnabled={audioEnabled}
                videoEnabled={videoEnabled && !audioOnlyMode}
                screenSharing={screenSharing}
                isSpeaking={speakingUserIds.has(currentUser.id)}
                large
              />
            )}
          </div>

          {/* Remote Participants Grid */}
          {remotePeers.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {remotePeers.map((peer) => (
                <PeerVideoTile
                  key={peer.userId}
                  stream={remoteStreams.get(peer.userId) || null}
                  name={peer.name}
                  role={peer.role}
                  isHost={peer.isHost}
                  audioEnabled={peer.audioEnabled}
                  videoEnabled={peer.videoEnabled}
                  screenSharing={peer.screenSharing}
                  isSpeaking={speakingUserIds.has(peer.userId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Side Panel */}
        <aside className="w-full lg:w-88 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col max-h-[420px] lg:max-h-none">
          <div className="grid grid-cols-4 border-b border-slate-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => setSideTab('participants')}
              className={`py-3 flex items-center justify-center gap-1 border-b-2 transition-colors ${
                sideTab === 'participants' ? 'border-teal-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>People</span>
            </button>
            <button
              type="button"
              onClick={() => setSideTab('agenda')}
              className={`py-3 flex items-center justify-center gap-1 border-b-2 transition-colors ${
                sideTab === 'agenda' ? 'border-teal-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Agenda</span>
            </button>
            <button
              type="button"
              onClick={() => setSideTab('chat')}
              className={`py-3 flex items-center justify-center gap-1 border-b-2 transition-colors ${
                sideTab === 'chat' ? 'border-teal-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setSideTab('info')}
              className={`py-3 flex items-center justify-center gap-1 border-b-2 transition-colors ${
                sideTab === 'info' ? 'border-teal-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Info</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {sideTab === 'participants' && (
              <>
                {isHost && waitingList.length > 0 && (
                  <div className="rounded-lg bg-slate-800/80 border border-amber-500/40 p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-300">
                      Waiting Room ({waitingList.length})
                    </p>
                    {waitingList.map((w) => (
                      <div key={w.userId} className="flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{w.name}</p>
                          <p className="text-[11px] text-slate-400">{formatRoleLabel(w.role)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAdmit(w.userId)}
                            className="px-2 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-[11px] font-medium"
                          >
                            Admit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(w.userId)}
                            className="px-2 py-1 bg-slate-700 hover:bg-red-700 text-slate-200 rounded text-[11px]"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-400">
                    In Room ({participants.length})
                  </p>
                  {participants.map((p) => (
                    <div
                      key={p.userId}
                      className="flex items-center justify-between gap-2 py-2 px-2.5 rounded-lg bg-slate-800/50 border border-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {p.name} {p.userId === currentUser.id ? '(You)' : ''}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {p.isHost ? 'Host · ' : ''}
                          {formatRoleLabel(p.role)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.audioEnabled ? (
                          <Mic className="w-3.5 h-3.5 text-slate-300" />
                        ) : (
                          <MicOff className="w-3.5 h-3.5 text-red-400" />
                        )}
                        {p.videoEnabled ? (
                          <Video className="w-3.5 h-3.5 text-slate-300" />
                        ) : (
                          <VideoOff className="w-3.5 h-3.5 text-slate-500" />
                        )}
                        {isHost && p.userId !== currentUser.id && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleMuteParticipant(p.userId)}
                              title="Mute participant"
                              className="p-1 text-slate-400 hover:text-amber-300"
                            >
                              <MicOff className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveParticipant(p.userId)}
                              title="Remove from meeting"
                              className="p-1 text-slate-400 hover:text-red-400"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sideTab === 'agenda' && (
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-slate-400">Live Meeting Agenda</p>
                {agendas.length === 0 ? (
                  <p className="text-xs text-slate-500">No agenda items attached to this meeting.</p>
                ) : (
                  agendas.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-lg bg-slate-800/60 border border-slate-800 flex items-start gap-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleAgenda(item)}
                        className="mt-0.5 text-teal-400 hover:text-teal-300 shrink-0"
                        title="Toggle agenda completion"
                      >
                        {item.is_completed ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-500" />}
                      </button>
                      <div className="min-w-0">
                        <p className={`text-xs font-medium ${item.is_completed ? 'line-through text-slate-400' : 'text-white'}`}>
                          {idx + 1}. {item.title}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {item.duration_minutes} min {item.presenter_name ? `· ${item.presenter_name}` : ''}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {sideTab === 'chat' && (
              <div className="flex flex-col h-full justify-between gap-3">
                <div className="space-y-2.5 overflow-y-auto">
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-slate-500">No discussion notes yet. Send a message to participants in this room.</p>
                  ) : (
                    chatMessages.map((m, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-slate-800/70 text-xs">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                          <span className="font-medium text-teal-300">{m.name}</span>
                          <span className="font-mono">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-slate-100">{m.text}</p>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={handleSendChat} className="flex gap-2 pt-2 border-t border-slate-800">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Write discussion note..."
                    className="flex-1 px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}

            {sideTab === 'info' && (
              <div className="space-y-3 text-xs">
                <div>
                  <p className="text-slate-400">Meeting Title</p>
                  <p className="text-white font-medium mt-0.5">{meeting.title}</p>
                </div>
                <div>
                  <p className="text-slate-400">Organizer</p>
                  <p className="text-white mt-0.5">{meeting.organizer_name}</p>
                </div>
                <div>
                  <p className="text-slate-400">Description</p>
                  <p className="text-slate-300 mt-0.5 leading-relaxed">{meeting.description || 'No description provided.'}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1">Secure Room ID</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 text-teal-300 font-mono text-[11px]">
                      {meeting.meeting_room_id}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(window.location.href).catch(() => {});
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white inline-flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {copiedLink ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                {audioOutputs.length > 0 && (
                  <div>
                    <label className="block text-slate-400 mb-1">Speaker Output</label>
                    <select
                      value={selectedSpeakerId}
                      onChange={(e) => setSelectedSpeakerId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-slate-800 border border-slate-700 text-white text-xs"
                    >
                      {audioOutputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || 'Default Speaker'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800 flex items-center gap-2 text-[11px] text-emerald-300">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Online attendance duration is logged automatically.</span>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom Controls Bar */}
      <footer className="px-4 sm:px-6 py-3.5 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={toggleMic}
          className={`px-4 py-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
            audioEnabled ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          <span>{audioEnabled ? 'Mute' : 'Unmute'}</span>
        </button>

        <button
          type="button"
          onClick={toggleCamera}
          className={`px-4 py-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
            videoEnabled && !audioOnlyMode ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {videoEnabled && !audioOnlyMode ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          <span>{videoEnabled && !audioOnlyMode ? 'Stop Video' : 'Start Video'}</span>
        </button>

        <button
          type="button"
          onClick={toggleScreenShare}
          className={`px-4 py-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
            screenSharing ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'
          }`}
        >
          <MonitorUp className="w-4 h-4" />
          <span>{screenSharing ? 'Stop Sharing' : 'Share Screen'}</span>
        </button>

        <button
          type="button"
          onClick={toggleAudioOnly}
          className={`px-4 py-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
            audioOnlyMode ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
        >
          <Volume2 className="w-4 h-4" />
          <span>{audioOnlyMode ? 'Audio-Only Active' : 'Audio-Only'}</span>
        </button>

        <button
          type="button"
          onClick={handleLeave}
          className="px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <PhoneOff className="w-4 h-4" />
          <span>Leave Meeting</span>
        </button>

        {isHost && (
          <button
            type="button"
            onClick={handleEndForAll}
            className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-red-800 border border-red-700/50 text-red-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            End Meeting for All
          </button>
        )}
      </footer>
    </div>
  );
};

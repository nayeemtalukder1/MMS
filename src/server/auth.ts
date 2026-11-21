import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../types/utmms';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export interface TokenPayload {
  sub: number;
  email: string;
  role: UserRole;
  name: string;
  exp: number;
}

export interface RoomTokenPayload {
  sub: number;
  name: string;
  role: UserRole;
  meetingId: number;
  roomId: string;
  isHost: boolean;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

function signHmac(dataB64: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(dataB64).digest('base64url');
}

export function createSessionToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds = 60 * 60 * 12): string {
  const fullPayload: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const dataB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = signHmac(dataB64);
  return `${dataB64}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [dataB64, sig] = parts;
    const expectedSig = signHmac(dataB64);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(dataB64, 'base64url').toString('utf8')) as TokenPayload;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function createRoomToken(payload: Omit<RoomTokenPayload, 'exp'>, ttlSeconds = 60 * 60 * 4): string {
  const fullPayload: RoomTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const dataB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = signHmac(dataB64);
  return `${dataB64}.${sig}`;
}

export function verifyRoomToken(token: string): RoomTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [dataB64, sig] = parts;
    const expectedSig = signHmac(dataB64);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(dataB64, 'base64url').toString('utf8')) as RoomTokenPayload;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  req.user = payload;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role permissions for this action' });
      return;
    }
    next();
  };
}

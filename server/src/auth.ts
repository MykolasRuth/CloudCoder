import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import { PIN } from './config.js';

// Optional PIN gate. Tailscale is the real perimeter; this exists for the day
// the tailnet gets a shared device. Off unless CLOUDCODER_PIN is set.

const TOKEN = PIN ? createHash('sha256').update('cloudcoder:' + PIN).digest('hex') : '';

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAuthed(req: IncomingMessage): boolean {
  if (!PIN) return true;
  return parseCookies(req)['ccauth'] === TOKEN;
}

// Deny-by-default: with a PIN set, ONLY the login route and the static shell
// are reachable unauthenticated. Everything else — /api, /p, the preview
// catch-all (which trusts the cc_preview cookie), future routes — is gated.
const OPEN_EXACT = new Set([
  '/',
  '/index.html',
  '/sw.js',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/_cc/api/login',
  '/_cc/api/health',
]);
const OPEN_PREFIXES = ['/_cc/assets/', '/icons/'];

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!PIN) return next();
  if (OPEN_EXACT.has(req.path) || OPEN_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

export function handleLogin(req: Request, res: Response) {
  if (!PIN) {
    res.json({ ok: true, pinRequired: false });
    return;
  }
  if (String(req.body?.pin || '') === PIN) {
    res.setHeader('Set-Cookie', `ccauth=${TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'wrong pin' });
  }
}

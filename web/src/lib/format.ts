import { SessionMeta } from './api';

export function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Compact token count for the context gauge: 142684 -> "143k".
export function fmtTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}

export function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const yest = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function lastActive(s: SessionMeta): number {
  return s.updatedAt || s.createdAt;
}

export type DotKind = 'live' | 'busy' | 'dead';

export function sessionDot(s: SessionMeta): DotKind {
  if (s.kind === 'chat') return s.busy ? 'busy' : 'live';
  return s.status === 'running' ? 'live' : 'dead';
}

export function projectName(cwd: string): string {
  const parts = cwd.split('\\');
  const name = parts.pop() || cwd;
  // projectless sessions live in _scratch/<slug> — label them, not the slug
  if (parts[parts.length - 1] === '_scratch') return 'scratch';
  return name;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

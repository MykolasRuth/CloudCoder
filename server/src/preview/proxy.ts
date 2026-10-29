import httpProxy from 'http-proxy';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { parseCookies } from '../auth.js';
import { PORT } from '../config.js';

// Cookie-keyed catch-all preview proxy.
//
// `GET /p/:port` stores the target dev-server port in a cookie, then every
// request whose path isn't one of the app's reserved namespaces is proxied to
// localhost:<port> with the path UNTOUCHED - so absolute asset paths
// (/src/main.tsx, /_next/static/...) work without any HTML rewriting.
// The app shell itself stays reachable because everything it needs lives
// under the reserved namespaces below.

const proxy = httpProxy.createProxyServer({});
proxy.on('error', (err, _req, res: any) => {
  try {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(
        `<body style="font-family:system-ui;background:#0b0e14;color:#aab" >` +
          `<h3>Preview unreachable</h3><p>${err.message}</p>` +
          `<p>Is the dev server running on that port?</p></body>`,
      );
    } else if (res && typeof res.end === 'function') {
      res.end();
    }
  } catch {}
});

// Everything CloudCoder owns lives under /_cc/ (api, ws, assets) plus a few
// root files iOS requires at fixed paths. Previewed dev servers keep /api,
// /assets, and any other normal path for themselves.
const RESERVED_PREFIXES = ['/_cc/', '/p/', '/icons/'];
const RESERVED_EXACT = new Set(['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/favicon.ico']);

function isReserved(p: string): boolean {
  return RESERVED_EXACT.has(p) || RESERVED_PREFIXES.some((r) => p.startsWith(r));
}

export function getPreviewPort(req: IncomingMessage): number | null {
  const v = Number(parseCookies(req)['cc_preview'] || 0);
  if (v === PORT) return null; // never proxy to ourselves — infinite request loop
  return v >= 1024 && v <= 65535 ? v : null;
}

export function previewSetCookieHandler(req: Request, res: Response) {
  const port = Number(req.params.port);
  if (port === 0) {
    res.setHeader('Set-Cookie', 'cc_preview=; Path=/; Max-Age=0; SameSite=Lax');
    res.json({ ok: true, cleared: true });
    return;
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === PORT) {
    res.status(400).json({ error: 'port must be 1024-65535, not CloudCoder itself (or 0 to clear)' });
    return;
  }
  res.setHeader('Set-Cookie', `cc_preview=${port}; Path=/; SameSite=Lax`);
  if (req.query.redirect === '0') res.json({ ok: true, port });
  else res.redirect('/_preview/');
}

export function previewMiddleware(req: Request, res: Response, next: NextFunction) {
  const port = getPreviewPort(req);
  // /_preview/* always maps to the dev server root, even before assets load
  if (req.path === '/_preview' || req.path.startsWith('/_preview/')) {
    if (!port) {
      res.status(400).send('no preview port set - open /p/<port> first');
      return;
    }
    req.url = req.url.replace(/^\/_preview\/?/, '/');
    proxy.web(req, res, { target: `http://localhost:${port}` });
    return;
  }
  if (!port || isReserved(req.path)) return next();
  proxy.web(req, res, { target: `http://localhost:${port}` });
}

export function handlePreviewUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const port = getPreviewPort(req);
  if (!port) return false;
  if (req.url && (req.url === '/_preview' || req.url.startsWith('/_preview/'))) {
    req.url = req.url.replace(/^\/_preview\/?/, '/');
  }
  proxy.ws(req, socket, head, { target: `http://localhost:${port}` });
  return true;
}

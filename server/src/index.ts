import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { PORT, HOST, WEB_DIST, PIN, ALLOWED_LOGINS } from './config.js';
import { authMiddleware, handleLogin, isAuthed, tailnetAllowed } from './auth.js';
import { initPush } from './notify.js';
import { sessionsRouter } from './routes/sessions.js';
import { chatRouter } from './routes/chat.js';
import { gitRouter } from './routes/git.js';
import { filesRouter } from './routes/files.js';
import { pushRouter } from './routes/push.js';
import { workflowsRouter } from './routes/workflows.js';
import { handleTermUpgrade } from './ws/terminalSocket.js';
import { previewSetCookieHandler, previewMiddleware, handlePreviewUpgrade } from './preview/proxy.js';
import { killAllPtys } from './pty/registry.js';
import { stopAllChats } from './chat/chatRunner.js';

initPush();

const app = express();
app.use(express.json({ limit: '40mb' })); // chat image attachments arrive as base64
app.use(authMiddleware);

// All CloudCoder API/WS/assets live under /_cc/ so previewed dev servers can
// use /api, /assets, or any other normal path without colliding with us.
app.get('/_cc/api/health', (_req, res) => {
  res.json({ ok: true, pinRequired: !!PIN });
});
app.post('/_cc/api/login', handleLogin);
app.use('/_cc/api', sessionsRouter);
app.use('/_cc/api', chatRouter);
app.use('/_cc/api', gitRouter);
app.use('/_cc/api', filesRouter);
app.use('/_cc/api', pushRouter);
app.use('/_cc/api', workflowsRouter);

app.get('/p/:port', previewSetCookieHandler);
app.use(previewMiddleware);

// static app shell: built with Vite base '/_cc/', so hashed assets resolve to
// /_cc/assets/*; the root files iOS needs at fixed paths are served explicitly
if (fs.existsSync(WEB_DIST)) {
  app.use('/_cc', express.static(WEB_DIST));
  const sendRoot = (file: string) => (_req: express.Request, res: express.Response) =>
    res.sendFile(path.join(WEB_DIST, file));
  app.get('/', sendRoot('index.html'));
  app.get('/index.html', sendRoot('index.html'));
  app.get('/sw.js', sendRoot('sw.js'));
  app.get('/manifest.webmanifest', sendRoot('manifest.webmanifest'));
  app.use('/icons', express.static(path.join(WEB_DIST, 'icons')));
} else {
  app.get('/', (_req, res) => {
    res.send('CloudCoder server running. Build the web app first: npm run build');
  });
}

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (!tailnetAllowed(req) || (PIN && !isAuthed(req))) {
    socket.destroy();
    return;
  }
  if (req.url && req.url.startsWith('/_cc/ws/term/')) {
    handleTermUpgrade(req, socket, head);
    return;
  }
  if (!handlePreviewUpgrade(req, socket, head)) socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(
    `CloudCoder server on http://${HOST}:${PORT}` +
      (PIN ? ' (PIN enabled)' : '') +
      (ALLOWED_LOGINS.length ? ` for ${ALLOWED_LOGINS.join(', ')}` : ''),
  );
});

// kill spawned children on shutdown so claude.exe/powershell don't orphan
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    killAllPtys();
    stopAllChats();
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

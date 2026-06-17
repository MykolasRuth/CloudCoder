import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getChat } from '../chat/chatRunner.js';
import { DATA_DIR } from '../config.js';

export const chatRouter = Router();

const UPLOADS_DIR = path.join(DATA_DIR, 'chat', 'uploads');
const MAX_IMAGES = 8;
const MAX_BYTES = 8 * 1024 * 1024; // per image, after the client has already downscaled
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Decode `data:image/...;base64,...` strings to files on disk and return the
// absolute path (for Claude's Read tool) plus a URL (for UI thumbnails).
function saveImages(id: string, raw: unknown): { path: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  const dir = path.join(UPLOADS_DIR, id);
  const out: { path: string; url: string }[] = [];
  for (const item of raw.slice(0, MAX_IMAGES)) {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(typeof item === 'string' ? item : '');
    if (!m) continue;
    const ext = EXT[m[1].toLowerCase()];
    if (!ext) continue;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_BYTES) continue;
    fs.mkdirSync(dir, { recursive: true });
    // index + byte length keeps names unique within a batch without a clock
    const name = `${out.length}-${buf.length}.${ext}`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, buf);
    out.push({ path: file, url: `/_cc/api/chat/${id}/upload/${name}` });
  }
  return out;
}

chatRouter.get('/chat/:id/events', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const after = Number(req.query.after || 0);
  chat.attach(res, Number.isFinite(after) ? after : 0);
});

chatRouter.get('/chat/:id/upload/:name', (req, res) => {
  // basename guards against traversal on both segments
  const file = path.join(UPLOADS_DIR, path.basename(req.params.id), path.basename(req.params.name));
  if (!fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

chatRouter.post('/chat/:id/message', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const text = String(req.body?.text || '').trim();
  const images = saveImages(req.params.id, req.body?.images);
  if (!text && images.length === 0) {
    res.status(400).json({ error: 'empty message' });
    return;
  }
  const r = chat.send(text, images);
  if (r.ok) res.json({ ok: true });
  else res.status(409).json({ error: r.error });
});

chatRouter.post('/chat/:id/stop', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  chat.stop();
  res.json({ ok: true });
});

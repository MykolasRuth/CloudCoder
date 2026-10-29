import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getChat } from '../chat/chatRunner.js';
import { summarizeForSpeech } from '../chat/summarize.js';
import { synthesizeWav } from '../chat/tts.js';
import { getMeta } from '../pty/registry.js';
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

// --- slash-command discovery (skills + custom commands, user + project) ---
interface Command {
  name: string;
  description: string;
  kind: 'skill' | 'command';
}

function frontmatter(text: string): Record<string, string> {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  const fm: Record<string, string> = {};
  if (!m) return fm;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line.trim());
    if (kv) fm[kv[1].toLowerCase()] = kv[2].trim();
  }
  return fm;
}

function readSkills(baseDir: string): Command[] {
  const dir = path.join(baseDir, '.claude', 'skills');
  const out: Command[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const fm = frontmatter(fs.readFileSync(path.join(dir, e.name, 'SKILL.md'), 'utf8'));
      out.push({ name: fm.name || e.name, description: fm.description || '', kind: 'skill' });
    } catch {}
  }
  return out;
}

function readCommands(baseDir: string): Command[] {
  const dir = path.join(baseDir, '.claude', 'commands');
  const out: Command[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    let description = '';
    try {
      const text = fs.readFileSync(path.join(dir, e.name), 'utf8');
      const fm = frontmatter(text);
      description =
        fm.description ||
        (text.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').split('\n').find((l) => l.trim()) || '').slice(0, 120);
    } catch {}
    out.push({ name: e.name.replace(/\.md$/, ''), description, kind: 'command' });
  }
  return out;
}

chatRouter.get('/chat/:id/commands', (req, res) => {
  const meta = getMeta(req.params.id);
  if (!meta || meta.kind !== 'chat') {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const home = os.homedir();
  // project entries override user entries of the same name
  const byName = new Map<string, Command>();
  for (const c of [...readSkills(home), ...readCommands(home), ...readSkills(meta.cwd), ...readCommands(meta.cwd)]) {
    byName.set(c.name, c);
  }
  const commands = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  res.json({ commands });
});

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

chatRouter.post('/chat/:id/text-file', (req, res) => {
  const meta = getMeta(req.params.id);
  if (!meta || meta.kind !== 'chat') {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const text = String(req.body?.text || '');
  if (!text) {
    res.status(400).json({ error: 'empty text' });
    return;
  }
  const dir = path.join(UPLOADS_DIR, req.params.id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = `paste-${Date.now()}.txt`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, text, 'utf8');
    res.json({ ok: true, path: file, name });
  } catch (e: any) {
    res.status(500).json({ error: 'failed to save file: ' + e.message });
  }
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

// Condense a finished reply to a one-line summary, render it to speech audio,
// and return the WAV. The client plays it as media so it routes to whatever the
// device is connected to (CarPlay, Bluetooth, headphones). The summary text is
// returned in a header so the client can show/log it without parsing the audio.
chatRouter.post('/chat/:id/voice', async (req, res) => {
  const meta = getMeta(req.params.id);
  if (!meta || meta.kind !== 'chat') {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const text = String(req.body?.text || '').trim();
  if (!text) {
    res.status(400).json({ error: 'empty text' });
    return;
  }
  try {
    const summary = await summarizeForSpeech(text);
    const wav = await synthesizeWav(summary);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Summary', encodeURIComponent(summary));
    res.send(wav);
  } catch (e: any) {
    res.status(500).json({ error: 'voice failed: ' + (e?.message || String(e)) });
  }
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

chatRouter.post('/chat/:id/compact', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const r = chat.compact();
  if (r.ok) res.json({ ok: true });
  else res.status(409).json({ error: r.error });
});

chatRouter.post('/chat/:id/clear', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const r = chat.clear();
  if (r.ok) res.json({ ok: true });
  else res.status(409).json({ error: r.error });
});

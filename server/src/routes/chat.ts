import { Router } from 'express';
import { getChat } from '../chat/chatRunner.js';

export const chatRouter = Router();

chatRouter.get('/chat/:id/events', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const after = Number(req.query.after || 0);
  chat.attach(res, Number.isFinite(after) ? after : 0);
});

chatRouter.post('/chat/:id/message', (req, res) => {
  const chat = getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: 'no such chat session' });
    return;
  }
  const text = String(req.body?.text || '').trim();
  if (!text) {
    res.status(400).json({ error: 'empty message' });
    return;
  }
  const r = chat.send(text);
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

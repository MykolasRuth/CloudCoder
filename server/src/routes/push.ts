import { Router } from 'express';
import {
  getVapidPublicKey,
  addSubscription,
  removeSubscription,
  sendPush,
  subscriptionCount,
} from '../notify.js';

export const pushRouter = Router();

pushRouter.get('/push/vapid', (_req, res) => {
  res.json({ key: getVapidPublicKey(), subscriptions: subscriptionCount() });
});

pushRouter.post('/push/subscribe', (req, res) => {
  const sub = req.body?.subscription;
  if (!sub || !sub.endpoint) {
    res.status(400).json({ error: 'invalid subscription' });
    return;
  }
  addSubscription(sub);
  res.json({ ok: true });
});

pushRouter.post('/push/unsubscribe', (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (endpoint) removeSubscription(endpoint);
  res.json({ ok: true });
});

pushRouter.post('/push/test', async (_req, res) => {
  await sendPush({ title: 'CloudCoder', body: 'Push notifications are working 🎉' });
  res.json({ ok: true });
});

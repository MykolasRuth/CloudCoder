import path from 'node:path';
import webpush from 'web-push';
import { DATA_DIR } from './config.js';
import { createStore } from './store.js';

interface PushConfig {
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
}

const config = createStore<PushConfig>(path.join(DATA_DIR, 'config.json'), {});
const subs = createStore<webpush.PushSubscription[]>(path.join(DATA_DIR, 'push-subscriptions.json'), []);

export function initPush() {
  if (!config.data.vapidPublicKey || !config.data.vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys();
    config.data.vapidPublicKey = keys.publicKey;
    config.data.vapidPrivateKey = keys.privateKey;
    config.save();
    console.log('generated new VAPID keys');
  }
  webpush.setVapidDetails(
    // Push services want a contact for whoever runs the server; set it with CLOUDCODER_PUSH_CONTACT.
    process.env.CLOUDCODER_PUSH_CONTACT || 'mailto:you@example.com',
    config.data.vapidPublicKey,
    config.data.vapidPrivateKey,
  );
}

export function getVapidPublicKey(): string {
  return config.data.vapidPublicKey || '';
}

export function addSubscription(sub: webpush.PushSubscription) {
  if (!subs.data.find((s) => s.endpoint === sub.endpoint)) {
    subs.data.push(sub);
    subs.save();
  }
}

export function removeSubscription(endpoint: string) {
  const i = subs.data.findIndex((s) => s.endpoint === endpoint);
  if (i >= 0) {
    subs.data.splice(i, 1);
    subs.save();
  }
}

export function subscriptionCount(): number {
  return subs.data.length;
}

export async function sendPush(payload: { title: string; body: string; data?: any }) {
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.data.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
      } catch (e: any) {
        if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(sub.endpoint);
        else console.error('push failed:', e.statusCode || e.message);
      }
    }),
  );
}

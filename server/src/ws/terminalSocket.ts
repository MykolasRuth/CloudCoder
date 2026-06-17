import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { getPty } from '../pty/registry.js';

export const termWss = new WebSocketServer({ noServer: true });

termWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const m = /^\/_cc\/ws\/term\/([\w-]+)/.exec(req.url || '');
  const pty = m ? getPty(m[1]) : undefined;
  if (!pty) {
    ws.send(JSON.stringify({ t: 'error', message: 'no such session' }));
    ws.close();
    return;
  }
  pty.attach(ws);
  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.t === 'input' && typeof msg.d === 'string') pty.write(msg.d);
    else if (msg.t === 'resize') pty.resize(Number(msg.cols), Number(msg.rows));
    else if (msg.t === 'ping') {
      try {
        ws.send(JSON.stringify({ t: 'pong' }));
      } catch {}
    }
  });
});

export function handleTermUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  termWss.handleUpgrade(req, socket, head, (ws) => {
    termWss.emit('connection', ws, req);
  });
}

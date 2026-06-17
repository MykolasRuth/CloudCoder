import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SessionMeta } from '../../lib/api';
import KeyBar from './KeyBar';

type ConnState = 'connecting' | 'open' | 'reconnecting' | 'exited';

export default function TermView({ session, active }: { session: SessionMeta; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctrlLatch = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const statusRef = useRef(session.status);
  statusRef.current = session.status;
  const deadRef = useRef(false);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [ctrlOn, setCtrlOn] = useState(false);

  // single place the ctrl latch is applied, whatever the input path
  const applyCtrlLatch = (d: string): string => {
    if (ctrlLatch.current && d.length === 1) {
      const code = d.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) d = String.fromCharCode(code & 0x1f);
      ctrlLatch.current = false;
      setCtrlOn(false);
    }
    return d;
  };

  const sendInput = (d: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'input', d: applyCtrlLatch(d) }));
  };

  const sendResize = () => {
    const term = termRef.current;
    const ws = wsRef.current;
    if (term && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
    }
  };

  // trailing-debounced: keyboard show/hide fires resize per animation frame,
  // and every server resize makes ConPTY repaint the whole screen
  const refitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refit = () => {
    if (refitTimer.current) clearTimeout(refitTimer.current);
    refitTimer.current = setTimeout(() => {
      refitTimer.current = null;
      if (!activeRef.current) return;
      const el = containerRef.current;
      if (!el || !el.clientWidth || !el.clientHeight) return;
      try {
        fitRef.current?.fit();
        sendResize();
      } catch {}
    }, 100);
  };

  // create terminal once
  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'IBM Plex Mono', Menlo, ui-monospace, monospace",
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#1f1e1b',
        foreground: '#f0eee4',
        cursor: '#d97757',
        cursorAccent: '#1f1e1b',
        selectionBackground: 'rgba(217,119,87,0.30)',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    // keep iOS keyboard from mangling raw terminal input
    const ta = term.textarea;
    if (ta) {
      ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('autocorrect', 'off');
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('spellcheck', 'false');
    }
    term.onData((d) => sendInput(d));
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {}
    return () => {
      if (refitTimer.current) clearTimeout(refitTimer.current);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // websocket with reconnect
  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/_cc/ws/term/${session.id}`);
      wsRef.current = ws;
      setConn(attempt === 0 ? 'connecting' : 'reconnecting');
      ws.onopen = () => {
        attempt = 0;
        setConn('open');
      };
      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        const term = termRef.current;
        if (!term) return;
        if (msg.t === 'replay') {
          term.reset();
          term.write(msg.d, () => {
            refit();
          });
        } else if (msg.t === 'out') {
          term.write(msg.d);
        } else if (msg.t === 'exit') {
          deadRef.current = true;
          setConn('exited');
          term.write(`\r\n\x1b[90m[process exited (${msg.code})]\x1b[m\r\n`);
        } else if (msg.t === 'error') {
          deadRef.current = true;
          setConn('exited');
          term.write(`\r\n\x1b[90m[${msg.message}]\x1b[m\r\n`);
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        if (deadRef.current || statusRef.current === 'exited') {
          setConn('exited');
          return;
        }
        setConn('reconnecting');
        attempt++;
        timer = setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(attempt, 5)));
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // refit when becoming active or when the container resizes (keyboard, rotation)
  useEffect(() => {
    if (active) {
      const t = setTimeout(refit, 50);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => refit());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="term-wrap relative min-h-0 flex-1" ref={containerRef}>
        {conn !== 'open' && conn !== 'exited' && (
          <div className="mono absolute right-2.5 top-2 z-10 flex items-center gap-1.5 rounded-full border border-amb/30 bg-amb/12 px-2.5 py-1 text-[10px] text-amb">
            <span className="spin h-2.5 w-2.5 rounded-full border border-amb border-t-transparent" />
            {conn}
          </div>
        )}
        {conn === 'exited' && (
          <div className="mono absolute right-2.5 top-2 z-10 rounded-full border border-line bg-card px-2.5 py-1 text-[10px] text-faint">
            ended
          </div>
        )}
      </div>
      <KeyBar
        ctrlOn={ctrlOn}
        onCtrl={() => {
          ctrlLatch.current = !ctrlLatch.current;
          setCtrlOn(ctrlLatch.current);
        }}
        onKey={(seq) => {
          sendInput(seq);
          termRef.current?.focus();
        }}
      />
    </div>
  );
}

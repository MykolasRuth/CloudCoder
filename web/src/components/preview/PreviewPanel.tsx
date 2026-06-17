import { useState } from 'react';
import { api } from '../../lib/api';
import Panel from '../Panel';
import Icon from '../Icon';

const QUICK_PORTS = [3000, 5173, 8080, 4321];

export default function PreviewPanel({ onClose }: { onClose: () => void }) {
  const [port, setPort] = useState('');
  const [activePort, setActivePort] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [frameKey, setFrameKey] = useState(0);

  const start = async (p: number) => {
    setError('');
    try {
      await api.setPreview(p);
      setActivePort(p);
      setFrameKey((k) => k + 1);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const stop = async () => {
    try {
      await api.setPreview(0);
    } catch {}
    setActivePort(null);
  };

  return (
    <Panel
      title={activePort ? `Preview :${activePort}` : 'Preview'}
      icon="play"
      onClose={async () => {
        await stop();
        onClose();
      }}
      actions={
        activePort ? (
          <>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-dim active:bg-press"
              onClick={() => setFrameKey((k) => k + 1)}
            >
              <Icon name="refresh" size={13} />
            </button>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-dim active:bg-press"
              onClick={() => window.open('/_preview/', '_blank')}
            >
              <Icon name="external" size={13} />
            </button>
            <button className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-dim active:bg-press" onClick={stop}>
              <Icon name="stop" size={13} />
            </button>
          </>
        ) : undefined
      }
    >
      {!activePort && (
        <div className="p-4">
          <p className="text-[13px] leading-relaxed text-dim">
            Preview a dev server running on the homelab. The port is proxied through CloudCoder, so
            asset paths and hot reload work.
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {QUICK_PORTS.map((p) => (
              <button
                key={p}
                className="mono rounded-xl border border-line bg-card py-2.5 text-[12.5px] text-dim active:bg-press"
                onClick={() => start(p)}
              >
                :{p}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="custom port"
              className="mono min-w-0 flex-1 rounded-xl border border-line bg-card px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-coral/60"
            />
            <button
              disabled={!port}
              className="flex items-center gap-1.5 rounded-xl bg-coral px-4 py-2.5 text-[13px] font-semibold text-bg disabled:opacity-35"
              onClick={() => start(Number(port))}
            >
              <Icon name="play" size={14} /> Open
            </button>
          </div>
          {error && <div className="mt-3 text-[12.5px] text-rd">{error}</div>}
          <p className="mono mt-5 text-[10px] leading-relaxed text-faint">
            One preview port at a time. While active, requests outside /_cc are forwarded to the dev
            server.
          </p>
        </div>
      )}
      {activePort && <iframe key={frameKey} src="/_preview/" className="h-full w-full border-0 bg-white" title="preview" />}
    </Panel>
  );
}

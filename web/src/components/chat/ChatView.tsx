import { useEffect, useRef, useState } from 'react';
import { api, ChangedFile, SessionMeta } from '../../lib/api';
import Markdown from './Markdown';
import ToolCard, { ToolItem } from './ToolCard';
import ChangesCard from './ChangesCard';
import Icon from '../Icon';

const MAX_IMAGES = 8;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Downscale phone photos (often 12MP / several MB) to a sane size before
// base64-uploading them — keeps payloads small and well within Claude's vision
// resolution. Returns a JPEG data URL.
async function downscaleToDataUrl(file: File, max = 1568, quality = 0.82): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

type Item =
  | { kind: 'user'; text: string; images?: string[] }
  | { kind: 'text'; text: string }
  | ToolItem
  | { kind: 'changes'; files: ChangedFile[] }
  | { kind: 'result'; ok: boolean; cost: number; turns: number; durationMs: number }
  | { kind: 'error'; message: string };

export default function ChatView({ session, active }: { session: SessionMeta; active: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [draftText, setDraftText] = useState('');
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string[]>([]); // data URLs of attached images
  const [sendError, setSendError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  // deltas arrive many times per second — buffer and flush at ~12fps so the
  // phone isn't re-rendering (and re-parsing markdown) per token
  const deltaBuf = useRef('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flushDeltas = () => {
      flushTimer.current = null;
      if (deltaBuf.current) {
        const chunk = deltaBuf.current;
        deltaBuf.current = '';
        setDraftText((d) => d + chunk);
      }
    };
    const clearDraft = () => {
      deltaBuf.current = '';
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      setDraftText('');
    };

    const es = new EventSource(`/_cc/api/chat/${session.id}/events?after=0`);
    es.onmessage = (e) => {
      let ev: any;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.seq) {
        if (ev.seq <= lastSeq.current && ev.type !== 'status') return;
        lastSeq.current = Math.max(lastSeq.current, ev.seq);
      }
      switch (ev.type) {
        case 'user':
          setItems((it) => [...it, { kind: 'user', text: ev.text, images: ev.images }]);
          clearDraft();
          break;
        case 'text_delta':
          deltaBuf.current += ev.text;
          if (!flushTimer.current) flushTimer.current = setTimeout(flushDeltas, 80);
          break;
        case 'assistant_text':
          clearDraft();
          setItems((it) => [...it, { kind: 'text', text: ev.text }]);
          break;
        case 'tool_start':
          setItems((it) => [
            ...it,
            { kind: 'tool', toolId: ev.toolId, name: ev.name, label: ev.label, input: ev.input, done: false },
          ]);
          break;
        case 'tool_done':
          setItems((it) =>
            it.map((x) =>
              x.kind === 'tool' && x.toolId === ev.toolId
                ? { ...x, done: true, output: ev.output, isError: ev.isError }
                : x,
            ),
          );
          break;
        case 'changes':
          // only the latest changes card matters — replace any earlier one
          setItems((it) => [
            ...it.filter((x) => x.kind !== 'changes'),
            { kind: 'changes', files: ev.files || [] },
          ]);
          break;
        case 'result':
          clearDraft();
          setItems((it) => [
            ...it,
            { kind: 'result', ok: ev.ok, cost: ev.cost, turns: ev.turns, durationMs: ev.durationMs },
          ]);
          break;
        case 'error':
          setItems((it) => [...it, { kind: 'error', message: ev.message }]);
          break;
        case 'status':
          setRunning(!!ev.running);
          if (!ev.running) clearDraft();
          break;
      }
    };
    return () => {
      es.close();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [session.id]);

  // pin to bottom unless the user scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, draftText]);

  // Sessions stay mounted but hidden (display:none), so the pin-to-bottom above
  // runs while this view has no layout and can't actually scroll. When the
  // session becomes visible, jump to where the conversation left off (latest).
  useEffect(() => {
    if (!active) return;
    stickBottom.current = true;
    const el = scrollRef.current;
    if (!el) return;
    // wait for layout after display flips to block
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    const room = MAX_IMAGES - pending.length;
    if (room <= 0) return;
    const urls = await Promise.all(imgs.slice(0, room).map((f) => downscaleToDataUrl(f).catch(() => '')));
    const ok = urls.filter(Boolean);
    if (ok.length) setPending((p) => [...p, ...ok].slice(0, MAX_IMAGES));
  };

  const send = async () => {
    const text = input.trim();
    const imgs = pending;
    if ((!text && imgs.length === 0) || running) return;
    setInput('');
    setPending([]);
    setSendError('');
    try {
      await api.chatSend(session.id, text, imgs.length ? imgs : undefined);
    } catch (e: any) {
      setSendError(e.message);
      setInput(text);
      setPending(imgs);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {items.length === 0 && !draftText && (
          <div className="mt-12 text-center text-[13px] text-faint">
            Working in
            <div className="mono mt-1 text-[11px]">{session.cwd}</div>
          </div>
        )}
        {items.map((item, i) => {
          if (item.kind === 'user')
            return (
              <div key={i} className="my-2.5 flex justify-end">
                <div className="max-w-[88%] rounded-2xl rounded-br-md border border-line bg-card px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
                  {item.images && item.images.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {item.images.map((src, k) => (
                        <a key={k} href={src} target="_blank" rel="noreferrer">
                          <img src={src} className="max-h-44 rounded-lg border border-line object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {item.text && (
                    <div className={'whitespace-pre-wrap' + (item.images && item.images.length ? ' mt-2' : '')}>
                      {item.text}
                    </div>
                  )}
                </div>
              </div>
            );
          if (item.kind === 'text')
            return (
              <div key={i} className="my-2 text-ink">
                <Markdown text={item.text} />
              </div>
            );
          if (item.kind === 'tool') return <ToolCard key={item.toolId + i} tool={item} />;
          if (item.kind === 'changes') return <ChangesCard key={'ch' + i} cwd={session.cwd} files={item.files} />;
          if (item.kind === 'result')
            return (
              <div key={i} className="mono my-3 text-center text-[10.5px] text-faint">
                {item.ok ? '✓ done' : '✗ failed'} · ${item.cost.toFixed(2)} · {item.turns} turns ·{' '}
                {Math.round(item.durationMs / 1000)}s
              </div>
            );
          return (
            <div key={i} className="my-2 rounded-xl border border-rd/30 bg-rd/8 px-3.5 py-2.5 text-[12px] text-rd">
              {(item as any).message}
            </div>
          );
        })}
        {draftText && (
          <div className="my-2 text-ink">
            <Markdown text={draftText} />
            <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse rounded-[2px] bg-coral align-middle" />
          </div>
        )}
        {running && !draftText && (
          <div className="my-3 flex items-center gap-2.5 text-[12px] text-faint">
            <span className="spin h-3.5 w-3.5 rounded-full border-[1.5px] border-coral border-t-transparent" />
            Claude is working…
          </div>
        )}
      </div>

      {sendError && <div className="px-4 py-1 text-[12px] text-rd">{sendError}</div>}

      <div
        className="shrink-0 border-t border-linesoft bg-raised p-2.5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}
      >
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((src, k) => (
              <div key={k} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
                <img src={src} className="h-full w-full object-cover" />
                <button
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-ink"
                  onClick={() => setPending((p) => p.filter((_, j) => j !== k))}
                >
                  <Icon name="x" size={12} strokeWidth={2.4} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-card text-dim disabled:opacity-35"
            disabled={pending.length >= MAX_IMAGES}
            onClick={() => fileRef.current?.click()}
            aria-label="Attach image"
          >
            <Icon name="image" size={18} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.items || [])
                .filter((it) => it.type.startsWith('image/'))
                .map((it) => it.getAsFile())
                .filter((f): f is File => !!f);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            placeholder={running ? 'Claude is working…' : 'Follow up…'}
            rows={Math.min(4, Math.max(1, input.split('\n').length))}
            className="min-h-0 flex-1 resize-none rounded-2xl border border-line bg-card px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-faint focus:border-coral/60"
            onFocus={() => {
              // keyboard opens → the message list shrinks; keep the latest message
              // pinned just above the keyboard (after the resize settles)
              if (stickBottom.current)
                setTimeout(() => {
                  const el = scrollRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }, 300);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rd/40 bg-rd/15 text-rd"
              onClick={() => api.chatStop(session.id)}
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coral text-bg disabled:opacity-35"
              disabled={!input.trim() && pending.length === 0}
              onClick={send}
            >
              <Icon name="send" size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

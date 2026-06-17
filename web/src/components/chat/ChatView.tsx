import { useEffect, useRef, useState } from 'react';
import { api, ChangedFile, SessionMeta } from '../../lib/api';
import Markdown from './Markdown';
import ToolCard, { ToolItem } from './ToolCard';
import ChangesCard from './ChangesCard';
import Icon from '../Icon';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | ToolItem
  | { kind: 'changes'; files: ChangedFile[] }
  | { kind: 'result'; ok: boolean; cost: number; turns: number; durationMs: number }
  | { kind: 'error'; message: string };

export default function ChatView({ session }: { session: SessionMeta }) {
  const [items, setItems] = useState<Item[]>([]);
  const [draftText, setDraftText] = useState('');
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState('');
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
          setItems((it) => [...it, { kind: 'user', text: ev.text }]);
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

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    setSendError('');
    try {
      await api.chatSend(session.id, text);
    } catch (e: any) {
      setSendError(e.message);
      setInput(text);
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
                <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-line bg-card px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
                  {item.text}
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
        className="flex shrink-0 items-end gap-2 border-t border-linesoft bg-raised p-2.5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
            disabled={!input.trim()}
            onClick={send}
          >
            <Icon name="send" size={18} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

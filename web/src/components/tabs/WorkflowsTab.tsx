import { useCallback, useEffect, useState } from 'react';
import { api, WorkflowRun, WorkflowDetail } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import Icon from '../Icon';

function statusStyle(status: string): { cls: string; label: string; live: boolean } {
  const s = (status || '').toLowerCase();
  if (s === 'running' || s === 'in_progress' || s === 'active')
    return { cls: 'text-amb border-amb/40 bg-amb/12', label: 'running', live: true };
  if (s === 'completed' || s === 'done' || s === 'success')
    return { cls: 'text-grn border-grn/40 bg-grn/12', label: 'completed', live: false };
  if (s === 'killed' || s === 'failed' || s === 'error' || s === 'stopped')
    return { cls: 'text-rd border-rd/40 bg-rd/12', label: s, live: false };
  return { cls: 'text-faint border-line bg-card', label: s || 'unknown', live: false };
}

function fmtDuration(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + (s % 60) + 's';
}

function fmtTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

export default function WorkflowsTab() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.workflows();
      setRuns(r.runs);
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 4000); // pick up live progress
    return () => clearInterval(iv);
  }, [load]);

  if (selected) return <WorkflowDetailView runId={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="rise px-5 pb-1 pt-5">
        <div className="flex items-center gap-2">
          <Icon name="workflow" size={15} className="text-coral" strokeWidth={1.8} />
          <span className="mono text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">Workflows</span>
        </div>
        <h1 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-ink">Orchestrations</h1>
        <p className="mt-0.5 text-[13px] text-faint">
          {runs.length === 0 ? 'Multi-agent runs will appear here.' : `${runs.length} recent run${runs.length > 1 ? 's' : ''}`}
        </p>
      </div>

      {err && <div className="mx-5 mt-3 rounded-xl border border-rd/30 bg-rd/8 px-3.5 py-2 text-[12px] text-rd">{err}</div>}

      {!loading && runs.length === 0 && !err && (
        <div className="mt-16 flex flex-col items-center gap-3 px-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-card text-coral">
            <Icon name="workflow" size={24} />
          </span>
          <div>
            <div className="text-[15px] font-medium text-ink">No workflows yet</div>
            <div className="mt-1 text-[13px] leading-relaxed text-faint">
              When Claude runs a multi-agent workflow, its live progress shows up here.
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pb-8 pt-2">
        {runs.map((r, i) => {
          const st = statusStyle(r.status);
          return (
            <button
              key={r.runId}
              onClick={() => setSelected(r.runId)}
              className="rise mb-2 flex w-full flex-col gap-1.5 rounded-2xl border border-line bg-card p-3.5 text-left active:bg-press"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-ink">
                  {r.name}
                </span>
                <span
                  className={
                    'mono flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] uppercase tracking-wider ' +
                    st.cls
                  }
                >
                  {st.live && <span className="spin h-2 w-2 rounded-full border border-amb border-t-transparent" />}
                  {st.label}
                </span>
              </div>
              <div className="mono flex items-center gap-1.5 text-[10.5px] text-faint">
                <span className="truncate">{r.project}</span>
                <span>·</span>
                <span className="shrink-0">{timeAgo(r.startTime)}</span>
                {r.durationMs > 0 && (
                  <>
                    <span>·</span>
                    <span className="shrink-0">{fmtDuration(r.durationMs)}</span>
                  </>
                )}
              </div>
              <div className="mono mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-dim">
                {r.currentPhase && (
                  <span className={st.live ? 'text-amb' : ''}>
                    {r.currentPhase.title} ({r.currentPhase.index}/{r.phaseCount})
                  </span>
                )}
                {r.agentCount > 0 && <span>{r.agentCount} agents</span>}
                {r.totalTokens > 0 && <span>{fmtTokens(r.totalTokens)} tok</span>}
                {r.totalToolCalls > 0 && <span>{r.totalToolCalls} tools</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowDetailView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [d, setD] = useState<WorkflowDetail | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setD(await api.workflow(runId));
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    }
  }, [runId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  const st = d ? statusStyle(d.status) : null;
  const phaseEvents = (d?.progress || []).filter((p) => p.type === 'workflow_phase' && typeof p.index === 'number');
  const reached = phaseEvents.length ? Math.max(...phaseEvents.map((p) => p.index as number)) : 0;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex shrink-0 items-center gap-1 border-b border-linesoft bg-raised/85 px-2 py-1.5 backdrop-blur">
        <button className="flex h-8 w-8 items-center justify-center text-dim" onClick={onBack}>
          <Icon name="chevronL" size={19} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold tracking-tight text-ink">{d?.name || 'workflow'}</div>
          <div className="mono truncate text-[9.5px] text-faint">{d ? d.project : runId}</div>
        </div>
        {st && (
          <span
            className={
              'mono mr-1 flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] uppercase tracking-wider ' +
              st.cls
            }
          >
            {st.live && <span className="spin h-2 w-2 rounded-full border border-amb border-t-transparent" />}
            {st.label}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        {err && <div className="rounded-xl border border-rd/30 bg-rd/8 px-3.5 py-2 text-[12px] text-rd">{err}</div>}
        {!d && !err && <div className="mono py-8 text-center text-[12px] text-faint">loading…</div>}

        {d && (
          <>
            {/* stats */}
            <div className="mono mb-4 grid grid-cols-4 gap-2 text-center">
              {[
                ['agents', String(d.agentCount)],
                ['tokens', fmtTokens(d.totalTokens)],
                ['tools', String(d.totalToolCalls)],
                ['took', fmtDuration(d.durationMs) || '—'],
              ].map(([label, val]) => (
                <div key={label} className="rounded-xl border border-line bg-card px-1 py-2">
                  <div className="text-[15px] font-semibold text-ink">{val}</div>
                  <div className="text-[9px] uppercase tracking-wider text-faint">{label}</div>
                </div>
              ))}
            </div>

            {/* phases */}
            {d.phases.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Phases</div>
                <div className="rounded-2xl border border-line bg-card">
                  {d.phases.map((p, i) => {
                    const idx = i + 1;
                    const done = d.status === 'completed' || idx < reached || (idx === reached && !st?.live);
                    const active = st?.live && idx === reached;
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 border-b border-linesoft px-3.5 py-2.5 last:border-0"
                      >
                        <span className="mt-0.5 shrink-0">
                          {done ? (
                            <Icon name="check" size={14} className="text-grn" strokeWidth={2.2} />
                          ) : active ? (
                            <span className="spin block h-3.5 w-3.5 rounded-full border-[1.5px] border-amb border-t-transparent" />
                          ) : (
                            <span className="block h-3.5 w-3.5 rounded-full border border-line" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className={'text-[12.5px] font-medium ' + (active ? 'text-amb' : done ? 'text-ink' : 'text-faint')}>
                            {p.title}
                          </div>
                          {p.detail && <div className="text-[11px] leading-snug text-faint">{p.detail}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* logs */}
            {d.logs.length > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Log</div>
                <div className="mono space-y-0.5 overflow-x-auto rounded-2xl border border-line bg-card px-3.5 py-2.5 text-[11px] leading-relaxed text-dim">
                  {d.logs.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap">
                      <span className="text-faint">›</span> {l}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* result */}
            {d.result && (
              <div className="mb-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
                  Result {d.hasError && <span className="text-rd">· error</span>}
                </div>
                <pre className="mono max-h-80 overflow-auto rounded-2xl border border-line bg-card px-3.5 py-2.5 text-[11px] leading-relaxed text-dim">
                  {d.result}
                </pre>
              </div>
            )}

            {d.scriptPath && <div className="mono break-all text-[9.5px] text-faint">{d.scriptPath}</div>}
          </>
        )}
      </div>
    </div>
  );
}

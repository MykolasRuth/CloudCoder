import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { isStandalone, getSubscription, subscribePush, unsubscribePush } from '../../lib/push';
import Icon from '../Icon';

export default function SettingsTab() {
  const [subscribed, setSubscribed] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushSupported(false);
      return;
    }
    getSubscription().then((s) => setSubscribed(!!s)).catch(() => {});
  }, []);

  const standalone = isStandalone();

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="rise px-5 pb-2 pt-5">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Settings</h1>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-10 pt-1">
        <section className="rise rounded-2xl border border-line bg-card p-4" style={{ animationDelay: '50ms' }}>
          <div className="flex items-center gap-2">
            <Icon name="bell" size={16} className="text-coral" />
            <span className="text-[14px] font-semibold">Notifications</span>
          </div>
          {!pushSupported && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-faint">
              Push isn't available here.{' '}
              {!standalone && 'Open the HTTPS URL and add CloudCoder to your Home Screen first.'}
            </p>
          )}
          {pushSupported && !standalone && (
            <p className="mt-2 rounded-xl border border-amb/25 bg-amb/8 p-2.5 text-[12px] leading-relaxed text-amb">
              For push on iOS: open the HTTPS URL in Safari → Share → Add to Home Screen, then enable
              notifications inside the installed app.
            </p>
          )}
          {pushSupported && (
            <div className="mt-3 flex gap-2">
              <button
                disabled={busy}
                className={
                  'flex-1 rounded-xl py-2.5 text-[13px] font-semibold ' +
                  (subscribed ? 'border border-line bg-raised text-dim' : 'bg-coral text-bg')
                }
                onClick={async () => {
                  setBusy(true);
                  setMsg('');
                  try {
                    if (subscribed) {
                      await unsubscribePush();
                      setSubscribed(false);
                      setMsg('Notifications off');
                    } else {
                      await subscribePush();
                      setSubscribed(true);
                      setMsg('Notifications on ✓');
                    }
                  } catch (e: any) {
                    setMsg(e.message);
                  }
                  setBusy(false);
                }}
              >
                {subscribed ? 'Disable push' : 'Enable push'}
              </button>
              {subscribed && (
                <button
                  className="rounded-xl border border-line bg-raised px-4 py-2.5 text-[13px] font-medium text-dim"
                  onClick={async () => {
                    await api.pushTest();
                    setMsg('Test sent — lock your phone to see it');
                  }}
                >
                  Test
                </button>
              )}
            </div>
          )}
          {msg && <div className="mt-2 text-[12px] text-dim">{msg}</div>}
        </section>

        <section className="rise rounded-2xl border border-line bg-card p-4" style={{ animationDelay: '110ms' }}>
          <div className="flex items-center gap-2">
            <Icon name="spark" size={16} className="text-coral" />
            <span className="text-[14px] font-semibold">About</span>
          </div>
          <dl className="mono mt-3 flex flex-col gap-1.5 text-[11px]">
            <div className="flex justify-between">
              <dt className="text-faint">origin</dt>
              <dd className="text-dim">{location.host}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">installed</dt>
              <dd className="text-dim">{standalone ? 'yes — standalone' : 'browser tab'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">app</dt>
              <dd className="text-dim">CloudCoder v0.1</dd>
            </div>
          </dl>
          <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
            Claude Code on your homelab, from your phone. Sessions run on the server — lock your phone
            and they keep working.
          </p>
        </section>
      </div>
    </div>
  );
}

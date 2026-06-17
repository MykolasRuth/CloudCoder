import { ReactNode } from 'react';
import Icon from './Icon';

export default function Panel({
  title,
  icon,
  onClose,
  children,
  actions,
}: {
  title: string;
  icon?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg">
      <div
        className="flex shrink-0 items-center gap-2.5 border-b border-linesoft bg-raised px-3.5 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        {icon && <Icon name={icon} size={15} className="shrink-0 text-coral" />}
        <div className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-ink">{title}</div>
        {actions}
        <button className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-dim active:bg-press" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

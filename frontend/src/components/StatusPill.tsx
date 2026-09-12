import type { ReactNode } from 'react';
import {
  ArrowDown,
  CheckCheck,
  CircleHelp,
  Clock3,
  Flame,
  GitBranch,
  Info,
  ListTodo,
  Minus,
  ShieldAlert,
  Signal,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import styles from './StatusPill.module.css';

export type PillTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'memory';
type Surface = 'light' | 'dark';

// A read-only label. Filter and action controls retain their native buttons.
export default function StatusPill({
  children,
  tone = 'neutral',
  icon: Icon,
  surface = 'light',
  title,
  className = '',
}: {
  children: ReactNode;
  tone?: PillTone;
  icon?: LucideIcon;
  surface?: Surface;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`${styles.pill} ${className}`}
      data-tone={tone}
      data-surface={surface}
      title={title}
    >
      {Icon && <Icon size={12} strokeWidth={1.8} aria-hidden="true" />}
      <span className={styles.label}>{children}</span>
    </span>
  );
}

const classifications: Record<string, { tone: PillTone; icon: LucideIcon }> = {
  Incident: { tone: 'danger', icon: ShieldAlert },
  Escalation: { tone: 'danger', icon: TrendingUp },
  'Approval Request': { tone: 'warning', icon: CheckCheck },
  'Decision Needed': { tone: 'memory', icon: GitBranch },
  'Action Required': { tone: 'success', icon: Zap },
  Question: { tone: 'info', icon: CircleHelp },
  FYI: { tone: 'neutral', icon: Info },
};

export function ClassificationPill({
  classification,
  surface,
}: {
  classification: string;
  surface?: Surface;
}) {
  const meta = classifications[classification] || { tone: 'neutral' as const, icon: Info };
  return (
    <StatusPill {...meta} surface={surface}>
      {classification}
    </StatusPill>
  );
}

export function PriorityPill({
  priority,
  surface,
}: {
  priority: 'high' | 'medium' | 'low';
  surface?: Surface;
}) {
  const meta = {
    high: { tone: 'danger' as const, icon: Flame },
    medium: { tone: 'warning' as const, icon: Minus },
    low: { tone: 'neutral' as const, icon: ArrowDown },
  }[priority];
  return (
    <StatusPill {...meta} surface={surface}>
      {priority[0].toUpperCase() + priority.slice(1)} priority
    </StatusPill>
  );
}

export function ReviewPill({ decision, surface }: { decision: string; surface?: Surface }) {
  const meta = (
    {
      approved: { tone: 'success', icon: CheckCheck },
      deferred: { tone: 'warning', icon: Clock3 },
      dismissed: { tone: 'neutral', icon: X },
      escalated: { tone: 'danger', icon: TrendingUp },
    } satisfies Record<string, { tone: PillTone; icon: LucideIcon }>
  )[decision as 'approved' | 'deferred' | 'dismissed' | 'escalated'];
  return (
    <StatusPill {...(meta || { tone: 'neutral' as const, icon: Info })} surface={surface}>
      {decision ? decision[0].toUpperCase() + decision.slice(1) : 'Review saved'}
    </StatusPill>
  );
}

export function WorkTypePill({ type, surface }: { type: string; surface?: Surface }) {
  const normalized = type.toLowerCase().replace(/[ _]/g, '-');
  const meta =
    normalized === 'risk'
      ? { tone: 'danger' as const, icon: ShieldAlert }
      : normalized === 'follow-up' || normalized === 'followup'
        ? { tone: 'memory' as const, icon: Clock3 }
        : normalized === 'task'
          ? { tone: 'info' as const, icon: ListTodo }
          : { tone: 'neutral' as const, icon: ListTodo };
  return (
    <StatusPill {...meta} surface={surface}>
      {type}
    </StatusPill>
  );
}

export function ConfidencePill({ confidence, surface }: { confidence: string; surface?: Surface }) {
  const level = confidence.trim().toLowerCase();
  const label =
    !level || level === 'not provided'
      ? 'Confidence not provided'
      : `${confidence[0].toUpperCase() + confidence.slice(1)} confidence`;
  return (
    <StatusPill
      icon={Signal}
      tone={level === 'high' ? 'success' : level === 'medium' ? 'warning' : 'neutral'}
      surface={surface}
    >
      {label}
    </StatusPill>
  );
}

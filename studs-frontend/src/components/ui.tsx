import type { CSSProperties, ReactNode } from 'react';

/**
 * STUDS shared UI kit — one source for the app's dark/pink design language
 * so every page looks and behaves the same. Colors match the established
 * palette (#05060f background, #1a1a2e cards, #f472b6 pink accent).
 */

export const C = {
  bg: '#05060f',
  card: '#1a1a2e',
  cardDeep: '#0f0f1f',
  pink: '#f472b6',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#10b981',
  red: '#ef4444',
  blue: '#38bdf8',
  amber: '#fbbf24',
  text: '#f8fafc',
  sub: '#e0e7ff',
  muted: '#94a3b8',
  border: '#334155',
};

export function PageShell(props: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: 'clamp(32px, 6vw, 56px) clamp(16px, 4vw, 24px) clamp(48px, 8vw, 80px)' }}>
      <div style={{ maxWidth: props.maxWidth || 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '20px', marginBottom: '44px' }}>
          <div>
            <h1 style={{ fontSize: 'clamp(38px, 6vw, 56px)', fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1.12 }}>{props.title}</h1>
            {props.subtitle && <p style={{ color: C.pink, fontSize: 'clamp(16px, 2.5vw, 20px)', marginTop: '10px' }}>{props.subtitle}</p>}
          </div>
          {props.actions}
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Card(props: { children: ReactNode; style?: CSSProperties; accent?: string }) {
  return (
    <div
      style={{
        background: C.card,
        borderRadius: '28px',
        padding: 'clamp(20px, 4vw, 32px)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.45)',
        ...(props.accent ? { borderLeft: `8px solid ${props.accent}` } : {}),
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

const btnBase: CSSProperties = {
  border: 'none',
  borderRadius: '999px',
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

export function PrimaryButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={props.type || 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        ...btnBase,
        padding: '16px clamp(24px, 6vw, 40px)',
        background: C.pink,
        color: 'white',
        fontSize: '16px',
        opacity: props.disabled ? 0.55 : 1,
        ...props.style,
      }}
    >
      {props.children}
    </button>
  );
}

export function GhostButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        ...btnBase,
        padding: '12px 26px',
        background: props.danger ? C.red : '#23233d',
        color: 'white',
        fontSize: '15px',
        opacity: props.disabled ? 0.55 : 1,
        ...props.style,
      }}
    >
      {props.children}
    </button>
  );
}

const inputStyle: CSSProperties = {
  padding: '17px 20px',
  borderRadius: '14px',
  border: `1px solid ${C.border}`,
  background: C.cardDeep,
  color: C.text,
  fontSize: '16px',
  width: '100%',
  boxSizing: 'border-box',
};

export function TextInput(props: {
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  style?: CSSProperties;
}) {
  return (
    <input
      type={props.type || 'text'}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={{ ...inputStyle, ...props.style }}
    />
  );
}

export const STATUS_COLORS: Record<string, string> = {
  PENDING: C.blue,
  ASSIGNED: C.amber,
  PICKED_UP: C.pink,
  DELIVERED: C.green,
  DISPUTED: '#fb7185',
  CANCELLED: C.red,
  REFUNDED: C.red,
  RESOLVED: C.muted,
};

export function StatusPill(props: { status: string }) {
  const color = STATUS_COLORS[props.status] || C.muted;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '6px 16px',
        borderRadius: '999px',
        background: `${color}22`,
        border: `1px solid ${color}`,
        color,
        fontWeight: 700,
        fontSize: '13px',
        letterSpacing: '0.4px',
        whiteSpace: 'nowrap',
      }}
    >
      {props.status.replace('_', ' ')}
    </span>
  );
}

export function StatCard(props: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <Card style={{ padding: '26px 28px' }}>
      <p style={{ color: C.muted, fontSize: '14px', fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase' }}>{props.label}</p>
      <p style={{ fontSize: 'clamp(28px, 6vw, 36px)', fontWeight: 900, color: props.accent || C.text, marginTop: '8px', letterSpacing: '-1px' }}>{props.value}</p>
      {props.sub && <p style={{ color: C.sub, marginTop: '6px', fontSize: '15px' }}>{props.sub}</p>}
    </Card>
  );
}

export function EmptyState(props: { title: string; body?: string }) {
  return (
    <Card style={{ padding: 'clamp(40px, 10vw, 90px) clamp(20px, 6vw, 40px)', textAlign: 'center' }}>
      <h3 style={{ fontSize: '26px' }}>{props.title}</h3>
      {props.body && <p style={{ color: C.sub, marginTop: '14px' }}>{props.body}</p>}
    </Card>
  );
}

export function SkeletonCards(props: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {Array.from({ length: props.count || 2 }).map((_, i) => (
        <div key={i} className="studs-skeleton" style={{ height: '180px', borderRadius: '28px' }} />
      ))}
    </div>
  );
}

export type TimelineStep = {
  key: string;
  label: string;
  at: string | null;
  state: 'done' | 'current' | 'pending' | 'terminal';
};

/** Vertical delivery-tracking stepper (student order tracking). */
export function OrderTimeline(props: { steps: TimelineStep[] }) {
  return (
    <div style={{ marginTop: '8px' }}>
      {props.steps.map((step, i) => {
        const last = i === props.steps.length - 1;
        const dotColor =
          step.state === 'done' ? C.green : step.state === 'current' ? C.pink : step.state === 'terminal' ? C.red : '#475569';
        return (
          <div key={step.key} style={{ display: 'flex', gap: '18px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                className={step.state === 'current' ? 'studs-pulse' : undefined}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: step.state === 'pending' ? 'transparent' : dotColor,
                  border: `3px solid ${dotColor}`,
                  flexShrink: 0,
                  marginTop: '3px',
                }}
              />
              {!last && <div style={{ width: '3px', flex: 1, minHeight: '34px', background: step.state === 'done' ? C.green : '#2c2c44', borderRadius: '2px' }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : '22px' }}>
              <p style={{ fontWeight: 700, fontSize: '17px', color: step.state === 'pending' ? C.muted : C.text }}>{step.label}</p>
              <p style={{ color: C.muted, fontSize: '14px', marginTop: '3px' }}>
                {step.at ? new Date(step.at).toLocaleString() : step.state === 'current' ? 'In progress…' : step.state === 'terminal' ? '' : 'Waiting'}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Small admin building blocks: status pills, KPI tiles, tabs, 3-language inputs. */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Localized, OrderStatus, PaymentStatus } from '@/core/types';
import { useI18n } from '@/i18n';

const orderTone: Record<OrderStatus, string> = {
  new: 'pill-info',
  confirmed: 'pill-info',
  in_production: 'pill-warn',
  shipped: 'pill-warn',
  delivered: 'pill-ok',
  cancelled: 'pill-bad',
};
const payTone: Record<PaymentStatus, string> = {
  pending: 'pill-warn',
  awaiting_verification: 'pill-info',
  paid: 'pill-ok',
  failed: 'pill-bad',
  refunded: '',
};

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  return <span className={`pill ${orderTone[status]}`}>{t.orderStatus[status]}</span>;
}

export function PaymentPill({ status }: { status: PaymentStatus }) {
  const { t } = useI18n();
  return <span className={`pill ${payTone[status]}`}>{t.paymentStatus[status]}</span>;
}

/**
 * Mouse click anywhere on a table row opens `to`. Keyboard and screen-reader users
 * get a real link in the row (see `RowLink`); clicks on that link or on any other
 * control in the row are left to it.
 */
export const rowClick = (navigate: (to: string) => void, to: string) => (e: MouseEvent<HTMLElement>) => {
  if ((e.target as Element).closest('a, button, input, select, textarea, label')) return;
  navigate(to);
};

/** The row's main text as a real link, so the row can be reached and opened with the keyboard. */
export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="row-link">
      {children}
    </Link>
  );
}

/**
 * A table's scroll box. When the table is wider than the screen, the box can be
 * focused and scrolled with the arrow keys, and has a name for screen readers
 * (WCAG 2.1.1); otherwise it is a plain box that adds no tab stop.
 */
export function TableWrap({ label, children }: { label?: string; children: ReactNode }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const watch = new ResizeObserver(check);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, []);
  const focusable = scrolls ? { tabIndex: 0, role: 'region', 'aria-label': label ?? t.admin.scrollTable } : {};
  return (
    <div ref={box} className="table-wrap" {...focusable}>
      {children}
    </div>
  );
}

export function Kpi({ label, value, to, tone }: { label: string; value: ReactNode; to?: string; tone?: 'warn' | 'bad' | 'ok' }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
    </>
  );
  return to ? (
    <Link to={to} className="kpi" data-tone={tone}>
      {body}
    </Link>
  ) : (
    <div className="kpi" data-tone={tone}>
      {body}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number }[];
}) {
  return (
    <div className="admin-tabs" role="tablist">
      {items.map((i) => (
        <button key={i.id} type="button" role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}>
          {i.label}
          {i.count !== undefined && <span className="tab-count num">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Three inputs (Arabic, French, English) for one text shown on the site. */
export function LocalizedInput({
  id,
  label,
  value,
  onChange,
  multiline,
}: {
  id: string;
  label: string;
  value: Localized;
  onChange: (v: Localized) => void;
  multiline?: boolean;
}) {
  const langs: { key: keyof Localized; tag: string; dir: 'rtl' | 'ltr' }[] = [
    { key: 'ar', tag: 'ع', dir: 'rtl' },
    { key: 'fr', tag: 'FR', dir: 'ltr' },
    { key: 'en', tag: 'EN', dir: 'ltr' },
  ];
  return (
    <fieldset className="loc-input">
      <legend className="label">{label}</legend>
      {langs.map((lg) => (
        <label key={lg.key} className="loc-row">
          <span className="loc-tag">{lg.tag}</span>
          {multiline ? (
            <textarea
              id={`${id}-${lg.key}`}
              className="textarea"
              dir={lg.dir}
              value={value[lg.key]}
              onChange={(e) => onChange({ ...value, [lg.key]: e.target.value })}
            />
          ) : (
            <input
              id={`${id}-${lg.key}`}
              className="input"
              dir={lg.dir}
              value={value[lg.key]}
              onChange={(e) => onChange({ ...value, [lg.key]: e.target.value })}
            />
          )}
        </label>
      ))}
    </fieldset>
  );
}

/** Two-step button for destructive actions (the artifact viewer has no confirm()). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'btn btn-danger btn-sm',
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function SavedFlash({ show }: { show: boolean }) {
  const { t } = useI18n();
  return show ? <span className="pill pill-ok">{t.common.saved}</span> : null;
}

export function useSavedFlash(): [boolean, () => void] {
  const [show, setShow] = useState(false);
  return [
    show,
    () => {
      setShow(true);
      setTimeout(() => setShow(false), 1800);
    },
  ];
}

export function Switch({ checked, onChange, label, name, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; name?: string; id?: string }) {
  return (
    <label className="switch">
      <input id={id} type="checkbox" checked={checked} aria-label={name && label ? `${name} · ${label}` : name} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span className="small">{label}</span>
    </label>
  );
}

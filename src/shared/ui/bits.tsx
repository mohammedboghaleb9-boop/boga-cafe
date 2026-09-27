/** Small shared pieces used across sections. */
import { useState, type ReactNode } from 'react';
import { blockingRestockDate, findShortages, maxBags, stockRequirements } from '@/core/stock';
import type { OriginIndex } from '@/core/recipe';
import type { PackSize, RecipeLine } from '@/core/types';
import { fmt, useI18n } from '@/i18n';
import { Icon } from './Icon';

export function SpeciesBar({ arabica, robusta }: { arabica: number; robusta: number }) {
  const { t } = useI18n();
  return (
    <div className="species">
      <div className="species-bar" aria-hidden="true">
        <span style={{ inlineSize: `${arabica}%` }} />
        <span style={{ inlineSize: `${robusta}%` }} />
      </div>
      <span className="species-label">{fmt(t.product.splitLabel, { a: arabica, r: robusta })}</span>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  optional,
  htmlFor,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={htmlFor}>
        {label} {optional && <span className="muted">({t.common.optional})</span>}
      </label>
      {children}
      {hint && !error && <span className="muted small">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="−">
        <Icon name="minus" size={16} />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="+">
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

/** "In stock / Only 3 left / Out of stock, back around …" for a recipe + size. */
export function Availability({
  recipe,
  size,
  origins,
  roastLossPercent,
}: {
  recipe: RecipeLine[];
  size: PackSize;
  origins: OriginIndex;
  roastLossPercent: number;
}) {
  const { t, date } = useI18n();
  const bags = maxBags(recipe, size, origins, roastLossPercent);
  if (bags === 0) {
    const back = blockingRestockDate(
      findShortages(stockRequirements([{ recipe, size, qty: 1 }], roastLossPercent), origins),
    );
    return (
      <span className="pill pill-bad">
        {t.common.outOfStock}
        {back ? ` · ${fmt(t.common.backAround, { date: date(back) })}` : ''}
      </span>
    );
  }
  if (bags < 10) return <span className="pill pill-warn">{fmt(t.common.fewLeft, { n: bags })}</span>;
  return <span className="pill pill-ok">{t.common.inStock}</span>;
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {done ? t.common.copied : t.common.copy}
    </button>
  );
}

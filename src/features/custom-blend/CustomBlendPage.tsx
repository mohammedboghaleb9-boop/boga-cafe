import { useMemo, useState } from 'react';
import { balanceBlend, validateBlend } from '@/core/blend';
import { CUSTOM_BLEND_NAME } from '@/core/cart';
import { formatNumber, formatSize } from '@/core/format';
import { customBlendPrice } from '@/core/pricing';
import { composition, recipeTotal } from '@/core/recipe';
import { kgNeeded } from '@/core/stock';
import { PACK_SIZES, type Origin, type PackSize, type RecipeLine } from '@/core/types';
import { useCatalog, useSettings } from '@/data/hooks';
import { useCart } from '@/features/cart/CartProvider';
import { fmt, useI18n } from '@/i18n';
import { recipeView } from '@/shared/recipe-view';
import { customBlendSticker } from '@/shared/sticker';
import { Photo } from '@/shared/ui/Photo';
import { ProductVisual } from '@/shared/ui/ProductVisual';
import { Flag } from '@/shared/ui/Flag';
import { Icon } from '@/shared/ui/Icon';
import { QtyStepper, SpeciesBar } from '@/shared/ui/bits';
import { whatsappLink } from '@/services/notifications';
import { addLine, issueText, removeLine } from './blend-helpers';
import './custom-blend.css';

/** Starts from the concept's example so the builder opens in a working state. */
const EXAMPLE: RecipeLine[] = [
  { originId: 'colombia', percent: 50 },
  { originId: 'brazil', percent: 30 },
  { originId: 'vietnam', percent: 20 },
];

export function CustomBlendPage() {
  const { t, l, money, date } = useI18n();
  const { origins, originIndex } = useCatalog();
  const settings = useSettings();
  const cart = useCart();
  const { minPercent, maxOrigins } = settings.customBlend;

  const [lines, setLines] = useState<RecipeLine[]>(() => EXAMPLE.filter((e) => originIndex[e.originId]));
  const [size, setSize] = useState<PackSize>(1000);
  const [qty, setQty] = useState(1);

  const spec = useMemo(() => ({ lines, size }), [lines, size]);
  const total = recipeTotal(lines);
  const issues = validateBlend(spec, originIndex, settings, qty);
  const price = customBlendPrice(spec, originIndex, settings);
  const grams = composition(lines, size);
  const view = recipeView(lines, originIndex, l);
  const selected = new Set(lines.map((x) => x.originId));

  /** Why an origin cannot be picked right now (null = it can). */
  function blockReason(o: Origin): string | null {
    const back = o.restockDate ? ` · ${fmt(t.common.backAround, { date: date(o.restockDate) })}` : '';
    if (!o.active || !o.customBlendEnabled) return t.common.unavailable + back;
    if (o.stockKg < kgNeeded(size, minPercent, qty, settings.roastLossPercent)) return t.common.outOfStock + back;
    if (!selected.has(o.id) && lines.length >= maxOrigins) return fmt(t.blend.maxReached, { max: maxOrigins });
    return null;
  }

  const setPercent = (originId: string, percent: number) =>
    setLines((cur) =>
      cur.map((x) => (x.originId === originId ? { ...x, percent: Math.max(0, Math.min(100, Math.round(percent || 0))) } : x)),
    );

  if (!settings.customBlend.enabled) {
    return (
      <div className="container page">
        <h1>{t.blend.title}</h1>
        <p className="notice notice-warn" style={{ marginBlockStart: 16 }}>
          {t.blend.disabled}
        </p>
      </div>
    );
  }

  return (
    <div className="container page">
      <div className="page-head">
        <span className="eyebrow">{t.nav.customBlend}</span>
        <h1>{t.blend.title}</h1>
        <p className="lead">{t.blend.intro}</p>
      </div>

      <div className="builder">
        <div className="builder-steps">
          {/* Step 1 — coffees */}
          <section className="builder-step">
            <h2>
              <span className="step-n">1</span> {t.blend.step1}
            </h2>
            <p className="muted small">{fmt(t.blend.step1Hint, { max: maxOrigins })}</p>
            <div className="origin-tiles">
              {origins
                .filter((o) => o.active)
                .map((o) => {
                  const reason = blockReason(o);
                  const isOn = selected.has(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className="origin-tile"
                      aria-pressed={isOn}
                      disabled={!isOn && reason !== null}
                      onClick={() =>
                        setLines((cur) => (isOn ? removeLine(cur, o.id) : addLine(cur, o.id, minPercent)))
                      }
                    >
                      <span className="origin-tile-head">
                        <Flag code={o.countryCode} title={l(o.name)} size={26} />
                        <span className="origin-tile-name">
                          <strong>{l(o.name)}</strong>
                          <span className="small muted">
                            {t.common[o.species]} · {o.region}
                          </span>
                        </span>
                        <span className="origin-tile-check" aria-hidden="true">
                          {isOn && <Icon name="check" size={16} />}
                        </span>
                      </span>
                      <span className="small origin-tile-notes">{l(o.tastingNotes)}</span>
                      <span className="origin-tile-foot small">
                        <span className="num">
                          {money(o.pricePerKg)} {t.common.perKg}
                        </span>
                        {reason && !isOn && <span className="pill pill-bad pill-plain">{reason}</span>}
                      </span>
                    </button>
                  );
                })}
            </div>
          </section>

          {/* Step 2 — proportions */}
          <section className="builder-step">
            <h2>
              <span className="step-n">2</span> {t.blend.step2}
            </h2>
            <p className="muted small">{fmt(t.blend.step2Hint, { min: minPercent })}</p>
            {lines.length === 0 ? (
              <p className="notice">{t.blend.pickFirst}</p>
            ) : (
              <div className="stack">
                {lines.map((line) => {
                  const o = originIndex[line.originId];
                  const g = grams.find((x) => x.originId === line.originId)?.grams ?? 0;
                  return (
                    <div key={line.originId} className="mix-row">
                      <span className="mix-name">
                        <Flag code={o.countryCode} title={l(o.name)} />
                        <strong>{l(o.name)}</strong>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={line.percent}
                        onChange={(e) => setPercent(line.originId, Number(e.target.value))}
                        aria-label={`${l(o.name)} %`}
                        className="mix-range"
                        style={{ ['--p' as string]: `${line.percent}%` }}
                      />
                      <span className="mix-pct">
                        <input
                          id={`pct-${line.originId}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={100}
                          value={line.percent}
                          onChange={(e) => setPercent(line.originId, Number(e.target.value))}
                          className="input num"
                          aria-label={`${l(o.name)} %`}
                        />
                        %
                      </span>
                      <span className="mix-grams num small muted">{formatNumber(g, 1)} g</span>
                      <button
                        type="button"
                        className="btn btn-icon btn-ghost"
                        onClick={() => setLines((cur) => removeLine(cur, line.originId))}
                        aria-label={`${t.common.remove} ${l(o.name)}`}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  );
                })}
                <div className="mix-total spread">
                  <div className="mix-total-bar" data-state={total === 100 ? 'ok' : total > 100 ? 'over' : 'under'}>
                    <span style={{ inlineSize: `${Math.min(total, 100)}%` }} />
                  </div>
                  <strong className={`num ${total === 100 ? 'ok-text' : 'bad-text'}`}>
                    {total === 100
                      ? `✓ ${t.blend.complete}`
                      : total < 100
                        ? fmt(t.blend.remaining, { n: 100 - total })
                        : fmt(t.blend.over, { n: total - 100 })}
                  </strong>
                  {total !== 100 && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((cur) => balanceBlend(cur))}>
                      {t.blend.balance}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Step 3 — weight */}
          <section className="builder-step">
            <h2>
              <span className="step-n">3</span> {t.blend.step3}
            </h2>
            <div className="spread">
              <div className="seg" role="group" aria-label={t.common.size}>
                {PACK_SIZES.map((s) => (
                  <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)}>
                    {formatSize(s)}
                  </button>
                ))}
              </div>
              <QtyStepper value={qty} onChange={setQty} max={50} label={t.common.qty} />
            </div>
          </section>

          <section className="notice roast-note">
            <strong>{t.blend.roastTitle}</strong>
            <p className="small">{t.blend.roastText}</p>
            <a
              className="btn-link small"
              href={whatsappLink(settings.contact.whatsapp, `${t.contact.whatsappText} ${t.blend.roastTitle}`)}
              target="_blank"
              rel="noreferrer"
            >
              {t.blend.roastCta}
            </a>
          </section>
        </div>

        {/* Summary */}
        <aside className="builder-summary panel" aria-live="polite">
          <div className="summary-head">
            <Photo name="seal" alt={t.media.seal} className="summary-seal" />
            <h2 className="summary-title">{t.blend.summary}</h2>
          </div>
          <ProductVisual
            className="summary-visual"
            sticker={customBlendSticker(lines, size, originIndex)}
            alt={fmt(t.media.pouch, { name: l(CUSTOM_BLEND_NAME), size: formatSize(size) })}
          />
          {lines.length > 0 && <SpeciesBar {...view.split} />}

          {lines.length > 0 && (
            <div className="stack summary-block">
              <span className="label">
                {t.blend.gramsTitle} ({formatSize(size)})
              </span>
              <table className="mini-table">
                <tbody>
                  {view.lines.map((x) => {
                    const p = price.lines.find((pl) => pl.originId === x.originId);
                    return (
                      <tr key={x.originId}>
                        <td>
                          <Flag code={x.origin.countryCode} size={16} /> {x.name}
                        </td>
                        <td className="num">{x.percent}%</td>
                        <td className="num">{formatNumber(p?.grams ?? 0, 1)} g</td>
                        <td className="num end">{formatNumber(p?.cost ?? 0, 1)} {t.common.currency}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td colSpan={3}>{t.blend.bagFee}</td>
                    <td className="num end">{formatNumber(price.fee, 1)} {t.common.currency}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="summary-price">
            <span className="spread">
              <span>{t.blend.unitPrice}</span>
              <strong className="num">{money(price.total)}</strong>
            </span>
            <span className="spread big">
              <span>
                {t.common.total} ×{qty}
              </span>
              <strong className="num">{money(price.total * qty)}</strong>
            </span>
          </div>

          {issues.length > 0 && lines.length > 0 && (
            <ul className="issues">
              {issues.map((issue, i) => (
                <li key={i}>{issueText(issue, t, originIndex, l)}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={issues.length > 0}
            onClick={() => cart.addCustom({ lines, size }, qty, `${t.blend.added} · ${formatSize(size)} ×${qty}`)}
          >
            <Icon name="cart" size={18} /> {t.common.addToCart}
          </button>
          <p className="small muted icon-line">
            <Icon name="bean" size={16} /> {t.common.wholeBeansOnly}
          </p>
        </aside>
      </div>
    </div>
  );
}

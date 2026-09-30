import { useState } from 'react';
import { Link } from 'react-router';
import { summarizeCart } from '@/core/cart';
import { formatKg, formatNumber, formatSize } from '@/core/format';
import { useCatalog, useSettings } from '@/data/hooks';
import { QuoteRequestForm } from '@/features/b2b';
import { fmt, useI18n } from '@/i18n';
import { whatsappLink, type MessageDraft } from '@/services/notifications';
import { SendToBoga } from '@/shared/layout/SendToBoga';
import { Icon } from '@/shared/ui/Icon';
import { QtyStepper } from '@/shared/ui/bits';
import { useCart } from '@/shared/cart/CartProvider';
import { LineDetails } from '@/shared/cart/CartLineView';
import './cart.css';
import { usePageTitle } from '@/shared/layout/usePageTitle';

export function CartPage() {
  const { t, l, money, date } = useI18n();
  usePageTitle(t.cart.title);
  const cart = useCart();
  const { products, originIndex } = useCatalog();
  const settings = useSettings();
  const summary = summarizeCart(cart.items, { products, origins: originIndex }, settings);
  const max = settings.b2bThresholdKg;
  const ratio = summary.weightKg / max;
  // kept here: sending the quote empties the cart, and the confirmation must stay on screen
  const [quote, setQuote] = useState<{ ref: string; message: MessageDraft } | null>(null);

  if (quote) {
    return (
      <div className="container page stack quote-done">
        <h1>{t.cart.title}</h1>
        <SendToBoga event="quote.created" draft={quote.message} refNumber={quote.ref} reveal />
        <Link to="/shop" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
          {t.cart.emptyCta}
        </Link>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="container page stack" style={{ alignItems: 'flex-start' }}>
        <h1>{t.cart.title}</h1>
        <p className="lead">{t.cart.empty}</p>
        <Link to="/shop" className="btn btn-primary">
          {t.cart.emptyCta}
        </Link>
      </div>
    );
  }

  const whatsappText = [
    fmt(t.cart.b2bWhatsapp, { w: formatNumber(summary.weightKg, 2) }),
    ...summary.lines.flatMap(({ line }) => (line ? [`- ${l(line.name)} ${formatSize(line.size)} x${line.qty}`] : [])),
  ].join('\n');

  return (
    <div className="container page">
      <h1 className="cart-title">{t.cart.title}</h1>
      <div className="cart-layout">
        <ul className="cart-lines">
          {summary.lines.map(({ item, line, problem }) => (
            <li key={item.id} className="cart-line">
              {line ? <LineDetails line={line} /> : <strong>—</strong>}
              <div className="cart-line-actions">
                <QtyStepper value={item.qty} onChange={(q) => cart.setQty(item.id, q)} label={t.common.qty} />
                <div className="cart-line-price">
                  {line && (
                    <>
                      <strong className="num">{money(line.lineTotal)}</strong>
                      <span className="small muted num">
                        {money(line.unitPrice)} {t.cart.perBag}
                      </span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-icon btn-ghost"
                  onClick={() => cart.remove(item.id)}
                  aria-label={t.common.remove}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
              {problem && <p className="notice notice-bad small cart-line-problem">{t.cart.problems[problem]}</p>}
            </li>
          ))}
        </ul>

        <aside className="cart-summary panel stack">
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            <span className="small">{fmt(t.cart.weightMeter, { w: formatNumber(summary.weightKg, 2), max })}</span>
            <div className="meter" data-level={ratio > 1 ? 'bad' : ratio > 0.8 ? 'warn' : 'ok'}>
              <span style={{ inlineSize: `${Math.min(100, ratio * 100)}%` }} />
            </div>
          </div>
          <div className="spread">
            <span>{t.common.weight}</span>
            <strong className="num">{formatKg(summary.weightKg)}</strong>
          </div>
          <div className="spread">
            <span>{t.common.subtotal}</span>
            <strong className="num cart-subtotal">{money(summary.subtotal)}</strong>
          </div>
          <p className="small muted">{t.cart.deliveryNote}</p>

          {summary.shortages.map((s) => (
            <p key={s.originId} className="notice notice-bad small">
              {fmt(t.cart.shortage, {
                origin: originIndex[s.originId] ? l(originIndex[s.originId].name) : s.originId,
                need: formatNumber(s.neededKg, 2),
                left: formatNumber(s.availableKg, 2),
              })}
              {s.restockDate && ` · ${fmt(t.common.backAround, { date: date(s.restockDate) })}`}
            </p>
          ))}

          {!summary.isB2B && (
            <Link
              to="/checkout"
              className="btn btn-primary btn-block"
              aria-disabled={summary.hasProblems}
              onClick={(e) => summary.hasProblems && e.preventDefault()}
              style={summary.hasProblems ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
            >
              {t.cart.checkout} <Icon name="arrow" size={16} className="flip-rtl" />
            </Link>
          )}
          <Link to="/shop" className="btn btn-ghost btn-block">
            {t.cart.continue}
          </Link>
        </aside>
      </div>

      {summary.isB2B && (
        <section className="b2b-box panel stack">
          <span className="eyebrow">B2B</span>
          <h2>{fmt(t.cart.b2bTitle, { max })}</h2>
          <p className="muted">{fmt(t.cart.b2bText, { w: formatNumber(summary.weightKg, 2), max })}</p>
          <a
            className="btn btn-ghost"
            style={{ alignSelf: 'flex-start' }}
            href={whatsappLink(settings.contact.whatsapp, whatsappText)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="whatsapp" size={18} /> {t.b2b.largeCta}
          </a>
          <QuoteRequestForm
            items={cart.items}
            onSent={(ref, message) => {
              setQuote({ ref, message });
              cart.clear();
            }}
          />
        </section>
      )}
    </div>
  );
}

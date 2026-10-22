import { useId } from 'react';
import { Link } from 'react-router';
import { lowestPrice, offeredSizes } from '@/core/pricing';
import { speciesSplit } from '@/core/recipe';
import type { Product } from '@/core/types';
import { useBrowseOnly, useCatalog, useSettings } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { cardSize, productSticker } from '@/shared/sticker';
import { Icon } from '@/shared/ui/Icon';
import { ProductVisual } from '@/shared/ui/ProductVisual';
import { Availability } from '@/shared/ui/bits';
import './product-card.css';

/** A filled coffee bean, the mark of the Arabica / Robusta line. */
function BeanMark() {
  return (
    <svg className="pcard-mark" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">
      <ellipse cx="16" cy="16" rx="9.5" ry="13" transform="rotate(35 16 16)" fill="currentColor" />
      <path d="M21.8 6.4c-3.6 2.4-2.2 6.6-4.9 9.6s-6.3 2.3-7.6 7" fill="none" stroke="var(--cream-card)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The product card of every shelf (home, shop, Single Origin, B2B, related products): the pouch, the name,
 * Arabica / Robusta and the tasting notes, the whole card opening the product page. Price and stock join
 * it only while the sales are open. `headingLevel`: 2 where the cards come right after the page title.
 */
export function ProductCard({ product, headingLevel = 3 }: { product: Product; headingLevel?: 2 | 3 }) {
  const Title = headingLevel === 2 ? 'h2' : 'h3';
  const { t, l, money } = useI18n();
  const { originIndex } = useCatalog();
  const settings = useSettings();
  // sales closed: no price and no stock state (src/core/showcase.ts)
  const browseOnly = useBrowseOnly();
  const { arabica, robusta } = speciesSplit(product.recipe, originIndex);
  const sizes = offeredSizes(product);
  const from = lowestPrice(product);
  const titleId = useId();

  return (
    <Link to={`/product/${product.slug}`} className="pcard" aria-labelledby={titleId}>
      <div className="pcard-media">
        <ProductVisual
          sticker={productSticker(product.name.fr, product.recipe, product.roastLevel, cardSize(sizes), originIndex)}
          alt=""
          image={product.image}
        />
      </div>
      <div className="pcard-body">
        <span className="pcard-kind">{t.kind[product.kind]}</span>
        <Title id={titleId} className="pcard-title">
          {l(product.name)}
        </Title>
        <span className="pcard-tag">{l(product.tagline)}</span>
        <span className="pcard-row">
          <BeanMark />
          <span className="pcard-recipe">
            {arabica > 0 && <span>{fmt(t.product.speciesShare, { n: arabica, name: t.common.arabica })}</span>}
            {robusta > 0 && <span>{fmt(t.product.speciesShare, { n: robusta, name: t.common.robusta })}</span>}
          </span>
        </span>
        <span className="pcard-row">
          <Icon name="cup" size={30} className="pcard-mark" />
          <span className="pcard-notes">
            <b>{t.product.notesLabel}</b>
            <span>{l(product.tastingNotes)}</span>
          </span>
        </span>
        {!browseOnly && (from !== undefined || sizes[0]) && (
          <span className="pcard-buy">
            {from !== undefined && (
              <span className="pcard-price">
                <span className="small">{t.common.from}</span> <strong className="num">{money(from)}</strong>
              </span>
            )}
            {sizes[0] && (
              <Availability recipe={product.recipe} size={sizes[0]} origins={originIndex} roastLossPercent={settings.roastLossPercent} />
            )}
          </span>
        )}
        {/* the card's button (WhatsAppButton steps aside from it) */}
        <span className="pcard-cta" data-button>
          {t.product.cardCta} <Icon name="arrow" size={16} className="flip-rtl" />
        </span>
      </div>
    </Link>
  );
}

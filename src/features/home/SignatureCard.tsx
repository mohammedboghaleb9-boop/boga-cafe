import { Link } from 'react-router';
import { offeredSizes } from '@/core/pricing';
import { speciesSplit } from '@/core/recipe';
import type { Product } from '@/core/types';
import { useCatalog } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { productSticker } from '@/shared/sticker';
import { Icon } from '@/shared/ui/Icon';
import { ProductVisual } from '@/shared/ui/ProductVisual';

/** A filled coffee bean, the mark of the Arabica / Robusta line. */
function BeanMark() {
  return (
    <svg className="sig-mark" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">
      <ellipse cx="16" cy="16" rx="9.5" ry="13" transform="rotate(35 16 16)" fill="currentColor" />
      <path d="M21.8 6.4c-3.6 2.4-2.2 6.6-4.9 9.6s-6.3 2.3-7.6 7" fill="none" stroke="var(--cream-card)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Home page shelf card: the pouch, the name, Arabica / Robusta and the tasting notes; it opens the product page. */
export function SignatureCard({ product }: { product: Product }) {
  const { t, l } = useI18n();
  const { originIndex } = useCatalog();
  const { arabica, robusta } = speciesSplit(product.recipe, originIndex);
  // the same pouch as the shop's card (ProductCard)
  const sizes = offeredSizes(product);
  const shownSize = sizes.includes(1000) ? 1000 : (sizes.at(-1) ?? 1000);
  return (
    <Link to={`/product/${product.slug}`} className="sig-card">
      <span className="sig-media">
        <ProductVisual
          sticker={productSticker(product.name.fr, product.recipe, product.roastLevel, shownSize, originIndex)}
          alt=""
          image={product.image}
        />
      </span>
      <span className="sig-body">
        <span className="sig-kind">{t.kind[product.kind]}</span>
        <h3 className="sig-name">{l(product.name)}</h3>
        <span className="sig-tag">{l(product.tagline)}</span>
        <span className="sig-row">
          <BeanMark />
          <span className="sig-recipe">
            {arabica > 0 && <span>{fmt(t.home.speciesShare, { n: arabica, name: t.common.arabica })}</span>}
            {robusta > 0 && <span>{fmt(t.home.speciesShare, { n: robusta, name: t.common.robusta })}</span>}
          </span>
        </span>
        <span className="sig-row">
          <Icon name="cup" size={30} className="sig-mark" />
          <span className="sig-notes">
            <b>{t.home.notesLabel}</b>
            <span>{l(product.tastingNotes)}</span>
          </span>
        </span>
        <span className="sig-cta">
          {t.home.cardCta} <Icon name="arrow" size={16} className="flip-rtl" />
        </span>
      </span>
    </Link>
  );
}

import { Link } from 'react-router';
import { lowestPrice, offeredSizes } from '@/core/pricing';
import type { Product } from '@/core/types';
import { useCatalog, useSettings } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { recipeView } from '@/shared/recipe-view';
import { productSticker } from '@/shared/sticker';
import { ProductVisual } from '@/shared/ui/ProductVisual';
import { Availability, SpeciesBar } from '@/shared/ui/bits';
import './shop.css';

/** Product tile used by the shop, the home page, Single Origin and B2B. */
export function ProductCard({ product }: { product: Product }) {
  const { t, l, money } = useI18n();
  const { originIndex } = useCatalog();
  const settings = useSettings();
  const view = recipeView(product.recipe, originIndex, l);
  const sizes = offeredSizes(product);
  const from = lowestPrice(product);
  const url = `/product/${product.slug}`;
  const shownSize = sizes.includes(1000) ? 1000 : (sizes.at(-1) ?? 1000);

  return (
    <article className="pcard">
      <Link to={url} className="pcard-media" tabIndex={-1} aria-hidden="true">
        <ProductVisual
          sticker={productSticker(product.name.fr, product.recipe, product.roastLevel, shownSize, originIndex)}
          alt=""
          image={product.image}
        />
      </Link>
      <div className="pcard-body">
        <span className="eyebrow">{t.kind[product.kind]}</span>
        <h3>
          <Link to={url}>{l(product.name)}</Link>
        </h3>
        <p className="muted small">{l(product.tagline)}</p>
        <SpeciesBar {...view.split} />
        <p className="small pcard-notes">
          <strong>{t.roast[product.roastLevel]}</strong> · {l(product.tastingNotes)}
        </p>
        <div className="pcard-foot">
          {from !== undefined && (
            <span className="pcard-price">
              <span className="muted small">{t.common.from}</span> <strong className="num">{money(from)}</strong>
            </span>
          )}
          {sizes[0] && (
            <Availability
              recipe={product.recipe}
              size={sizes[0]}
              origins={originIndex}
              roastLossPercent={settings.roastLossPercent}
            />
          )}
        </div>
      </div>
    </article>
  );
}

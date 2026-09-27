import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatSize } from '@/core/format';
import { offeredSizes } from '@/core/pricing';
import { maxBags } from '@/core/stock';
import { PACK_SIZES, type PackSize } from '@/core/types';
import { NotFound } from '@/app/NotFound';
import { useCatalog, useSettings } from '@/data/hooks';
import { useCart } from '@/features/cart/CartProvider';
import { ProductCard } from '@/features/shop/ProductCard';
import { fmt, useI18n } from '@/i18n';
import { recipeView } from '@/shared/recipe-view';
import { productSticker } from '@/shared/sticker';
import { ProductVisual } from '@/shared/ui/ProductVisual';
import { Flag } from '@/shared/ui/Flag';
import { Icon } from '@/shared/ui/Icon';
import { Availability, QtyStepper, SpeciesBar } from '@/shared/ui/bits';
import './product.css';

export function ProductPage() {
  const { slug } = useParams();
  const { t, l, money } = useI18n();
  const { products, originIndex } = useCatalog();
  const settings = useSettings();
  const cart = useCart();
  const product = products.find((p) => p.slug === slug && p.active);
  const sizes = product ? offeredSizes(product) : [];
  const [size, setSize] = useState<PackSize | undefined>(sizes.includes(1000) ? 1000 : sizes[0]);
  const [qty, setQty] = useState(1);

  if (!product || !size) return <NotFound />;

  const view = recipeView(product.recipe, originIndex, l);
  const price = product.prices[size] ?? 0;
  const inCart = cart.items.reduce(
    (s, i) => (i.type === 'product' && i.productId === product.id && i.size === size ? s + i.qty : s),
    0,
  );
  const available = Math.max(0, maxBags(product.recipe, size, originIndex, settings.roastLossPercent) - inCart);
  const related = products.filter((p) => p.active && p.kind === product.kind && p.id !== product.id).slice(0, 3);

  return (
    <div className="container page">
      <nav className="crumbs small muted" aria-label="Breadcrumb">
        <Link to="/shop">{t.nav.shop}</Link> / <Link to={`/shop?kind=${product.kind}`}>{t.kind[product.kind]}</Link>
      </nav>

      <div className="product">
        <div className="product-media">
          <ProductVisual
            sticker={productSticker(product.name.fr, product.recipe, product.roastLevel, size, originIndex)}
            alt={fmt(t.media.pouch, { name: l(product.name), size: formatSize(size) })}
            image={product.image}
            priority
          />
        </div>

        <div className="product-info stack">
          <span className="eyebrow">{t.kind[product.kind]}</span>
          <h1>{l(product.name)}</h1>
          <p className="lead">{l(product.tagline)}</p>
          <p>{l(product.description)}</p>

          <dl className="facts">
            <div>
              <dt>{t.common.roast}</dt>
              <dd>{t.roast[product.roastLevel]}</dd>
            </div>
            <div>
              <dt>{t.common.tastingNotes}</dt>
              <dd>{l(product.tastingNotes)}</dd>
            </div>
            <div>
              <dt>Arabica / Robusta</dt>
              <dd>
                <SpeciesBar {...view.split} />
              </dd>
            </div>
          </dl>

          <div className="recipe">
            <span className="label">
              {product.kind === 'single-origin' ? t.common.origin : t.common.recipe}
            </span>
            <ul>
              {view.lines.map((line) => (
                <li key={line.originId}>
                  <Flag code={line.origin.countryCode} title={line.name} />
                  <span>
                    <strong>{line.name}</strong>
                    <span className="muted small">
                      {' '}
                      · {line.origin.region} · {t.common[line.origin.species]}
                    </span>
                  </span>
                  <span className="num recipe-pct">{line.percent}%</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="buy panel stack">
            <span className="label">{t.product.chooseSize}</span>
            <div className="seg" role="group" aria-label={t.common.size}>
              {PACK_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={size === s}
                  disabled={!sizes.includes(s)}
                  title={!sizes.includes(s) ? t.product.notOffered : undefined}
                  onClick={() => {
                    setSize(s);
                    setQty(1);
                  }}
                >
                  {formatSize(s)}
                  {product.prices[s] !== undefined && <span className="seg-price num"> · {money(product.prices[s]!)}</span>}
                </button>
              ))}
            </div>
            <div className="spread">
              <QtyStepper value={qty} onChange={setQty} max={Math.max(1, available)} label={t.common.qty} />
              <Availability
                recipe={product.recipe}
                size={size}
                origins={originIndex}
                roastLossPercent={settings.roastLossPercent}
              />
            </div>
            <div className="spread">
              <strong className="buy-total num">{money(price * qty)}</strong>
              <button
                type="button"
                className="btn btn-primary"
                disabled={available < qty}
                onClick={() => cart.addProduct(product.id, size, qty, `${l(product.name)} · ${formatSize(size)} ×${qty}`)}
              >
                <Icon name="cart" size={18} /> {t.common.addToCart}
              </button>
            </div>
            <p className="small muted icon-line">
              <Icon name="bean" size={16} /> {t.product.grindTip}
            </p>
          </div>

          {product.kind === 'b2b' && (
            <div className="notice">
              {t.product.b2bNote} <Link to="/b2b#sample">{t.product.b2bSample} →</Link>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <h2 className="related-title">{t.product.related}</h2>
          <div className="pgrid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

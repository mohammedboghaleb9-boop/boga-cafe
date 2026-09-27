import { useCatalog } from '@/data/hooks';
import { ProductCard } from '@/features/shop/ProductCard';
import { fmt, useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { Photo } from '@/shared/ui/Photo';

export function SingleOriginPage() {
  const { t, l, date } = useI18n();
  const { products, origins } = useCatalog();
  const singles = products.filter((p) => p.active && p.kind === 'single-origin');

  return (
    <div className="container page">
      <div className="page-head">
        <span className="eyebrow">{t.common.origins}</span>
        <h1>{t.single.title}</h1>
        <p className="lead">{t.single.intro}</p>
      </div>

      <figure className="page-banner">
        <Photo name="greenBeans" alt={t.media.greenBeans} priority sizes="(min-width: 1180px) 1180px, 100vw" />
      </figure>

      <div className="origin-strip">
        {origins
          .filter((o) => o.active)
          .map((o) => (
            <div key={o.id} className="origin-chip">
              <Flag code={o.countryCode} title={l(o.name)} size={26} />
              <span>
                <strong>{l(o.name)}</strong>
                <span className="muted small"> · {t.common[o.species]}</span>
              </span>
              {o.stockKg > 0 ? (
                <span className="pill pill-ok">{t.common.inStock}</span>
              ) : (
                <span className="pill pill-bad" title={o.restockDate ? fmt(t.common.backAround, { date: date(o.restockDate) }) : undefined}>
                  {t.common.outOfStock}
                </span>
              )}
            </div>
          ))}
      </div>

      <div className="pgrid">
        {singles.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}

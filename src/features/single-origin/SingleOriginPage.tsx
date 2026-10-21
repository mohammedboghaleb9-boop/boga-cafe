import { onDisplay } from '@/core/showcase';
import { useBrowseOnly, useCatalog } from '@/data/hooks';
import { ProductCard } from '@/shared/product/ProductCard';
import { fmt, useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { Photo } from '@/shared/ui/Photo';
import './single-origin.css';
import { usePageTitle } from '@/shared/layout/usePageTitle';

export function SingleOriginPage() {
  const { t, l, date } = useI18n();
  usePageTitle(t.nav.singleOrigin);
  const { products, origins } = useCatalog();
  const browseOnly = useBrowseOnly();
  const singles = products.filter((p) => onDisplay(p) && p.kind === 'single-origin');
  const shown = origins.filter(onDisplay);

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

      {shown.length === 0 && <p className="muted">{t.common.noOrigins}</p>}
      <div className="origin-strip">
        {shown.map((o) => (
          <div key={o.id} className="origin-chip">
            <Flag code={o.countryCode} title={l(o.name)} size={26} />
            <span>
              <strong>{l(o.name)}</strong>
              <span className="muted small"> · {t.common[o.species]}</span>
            </span>
            {browseOnly ? null : o.stockKg > 0 ? (
              <span className="pill pill-ok">{t.common.inStock}</span>
            ) : (
              <span className="pill pill-bad" title={o.restockDate ? fmt(t.common.backAround, { date: date(o.restockDate) }) : undefined}>
                {t.common.outOfStock}
              </span>
            )}
          </div>
        ))}
      </div>

      {singles.length > 0 && (
        <div className="pgrid">
          {singles.map((p) => (
            <ProductCard key={p.id} product={p} headingLevel={2} />
          ))}
        </div>
      )}
    </div>
  );
}

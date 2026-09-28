import { Link } from 'react-router';
import { useCatalog } from '@/data/hooks';
import { ProductCard } from '@/shared/product/ProductCard';
import { useI18n } from '@/i18n';

export function Featured() {
  const { t } = useI18n();
  const { products } = useCatalog();
  const featured = products.filter((p) => p.active && p.featured).slice(0, 3);
  if (featured.length === 0) return null;
  return (
    <section className="section container">
      <div className="section-head reveal">
        <div className="stack">
          <h2>{t.home.featuredTitle}</h2>
          <p className="muted">{t.home.featuredText}</p>
        </div>
        <Link to="/shop" className="btn btn-ghost btn-sm">
          {t.home.seeAll}
        </Link>
      </div>
      <div className="pgrid">
        {featured.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

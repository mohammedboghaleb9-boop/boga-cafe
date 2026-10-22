import { Link } from 'react-router';
import { onDisplay } from '@/core/showcase';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { ProductCard } from '@/shared/product/ProductCard';
import { Icon } from '@/shared/ui/Icon';

/** The featured blends on the cream shelf. */
export function Featured() {
  const { t } = useI18n();
  const { products } = useCatalog();
  const featured = products.filter((p) => onDisplay(p) && p.featured).slice(0, 3);
  if (featured.length === 0) return null;
  return (
    <section className="shelf" aria-labelledby="shelf-title">
      <div className="container wide">
        <div className="shelf-head">
          <div>
            <span className="eyebrow">{t.home.shelfEyebrow}</span>
            <h2 id="shelf-title" className="shelf-title">
              {t.home.featuredTitle}
            </h2>
          </div>
          <Link to="/shop" className="shelf-all">
            {t.home.seeAll} <Icon name="arrow" size={16} className="flip-rtl" />
          </Link>
        </div>
        <div className="pgrid">
          {featured.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

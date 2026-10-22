import { useSearchParams } from 'react-router';
import { onDisplay } from '@/core/showcase';
import type { ProductKind } from '@/core/types';
import { useCatalog } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { ProductCard } from '@/shared/product/ProductCard';
import { usePageTitle } from '@/shared/layout/usePageTitle';

type Filter = 'all' | ProductKind;

export function ShopPage() {
  const { t } = useI18n();
  usePageTitle(t.nav.shop);
  const { products } = useCatalog();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('kind') as Filter) || 'all';
  const visible = products.filter((p) => onDisplay(p) && (filter === 'all' || p.kind === filter));

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t.shop.filterAll },
    { id: 'signature', label: t.shop.filterSignature },
    { id: 'single-origin', label: t.shop.filterSingle },
    { id: 'b2b', label: t.shop.filterB2B },
  ];

  return (
    <>
      <div className="container wide page page-top">
        <div className="page-head">
          <h1>{t.shop.title}</h1>
          <p className="lead">{t.shop.intro}</p>
        </div>
      </div>
      <div className="shelf">
        <div className="container wide">
          <div className="seg" role="group">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setParams(f.id === 'all' ? {} : { kind: f.id }, { replace: true })}
              >
                {f.label}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="shelf-empty">{t.shop.empty}</p>
          ) : (
            <div className="pgrid">
              {visible.map((p) => (
                <ProductCard key={p.id} product={p} headingLevel={2} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

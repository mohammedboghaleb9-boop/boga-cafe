import { formatSize } from '@/core/format';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { speciesSplit } from '@/core/recipe';
import { maxBags } from '@/core/stock';
import { PACK_SIZES, type ProductKind } from '@/core/types';
import { useCatalog, useSettings } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { Icon } from '@/shared/ui/Icon';
import { Tabs } from '../ui';

export function ProductsPage() {
  const { t, l, money } = useI18n();
  const { products, originIndex } = useCatalog();
  const settings = useSettings();
  const navigate = useNavigate();
  const [kind, setKind] = useState<ProductKind>('signature');
  const list = products.filter((p) => p.kind === kind);

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.products}</h1>
        <Link to={`/admin/products/new?kind=${kind}`} className="btn btn-primary btn-sm">
          <Icon name="plus" size={16} /> {t.admin.products.add}
        </Link>
      </div>
      <Tabs<ProductKind>
        value={kind}
        onChange={setKind}
        items={(['signature', 'single-origin', 'b2b'] as ProductKind[]).map((k) => ({
          id: k,
          label: t.kind[k],
          count: products.filter((p) => p.kind === k).length,
        }))}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.admin.products.name}</th>
              <th>{t.common.recipe}</th>
              <th>A / R</th>
              <th>{t.common.roast}</th>
              {PACK_SIZES.map((s) => (
                <th key={s} className="end">
                  {formatSize(s)}
                </th>
              ))}
              <th className="end">{t.admin.products.bagsLeft} (1 kg)</th>
              <th>{t.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const split = speciesSplit(p.recipe, originIndex);
              return (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/admin/products/${p.id}`)}>
                  <td>
                    <strong>{l(p.name)}</strong>
                    {p.featured && <div className="small muted">★ {t.admin.products.featured}</div>}
                  </td>
                  <td>
                    <span className="row" style={{ ['--gap' as string]: '4px' }}>
                      {p.recipe.map((r) =>
                        originIndex[r.originId] ? (
                          <span key={r.originId} className="cell-flag small">
                            <Flag code={originIndex[r.originId].countryCode} size={16} /> {r.percent}%
                          </span>
                        ) : null,
                      )}
                    </span>
                  </td>
                  <td className="num small">
                    {split.arabica}/{split.robusta}
                  </td>
                  <td className="small">{t.roast[p.roastLevel]}</td>
                  {PACK_SIZES.map((s) => (
                    <td key={s} className="num end">
                      {p.prices[s] !== undefined ? money(p.prices[s]!) : '—'}
                    </td>
                  ))}
                  <td className="num end">{maxBags(p.recipe, 1000, originIndex, settings.roastLossPercent)}</td>
                  <td>
                    <span className={`pill ${p.active ? 'pill-ok' : ''}`}>{p.active ? t.admin.products.active : t.admin.products.hidden}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

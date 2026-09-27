import { formatSize } from '@/core/format';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { recipeTotal, speciesSplit } from '@/core/recipe';
import { maxBags } from '@/core/stock';
import { PACK_SIZES, type Product, type ProductKind, type RoastLevel } from '@/core/types';
import { api } from '@/data/api';
import { useCatalog, useSettings } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { SpeciesBar } from '@/shared/ui/bits';
import { ConfirmButton, LocalizedInput, Switch } from '../ui';

const ROASTS: RoastLevel[] = ['light', 'medium', 'medium-dark', 'dark'];
const empty = { ar: '', fr: '', en: '' };

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function ProductEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t, l } = useI18n();
  const { products, origins, originIndex } = useCatalog();
  const settings = useSettings();
  const isNew = id === 'new';
  const existing = products.find((p) => p.id === id);

  const [p, setP] = useState<Product>(
    () =>
      existing ?? {
        id: '',
        slug: '',
        kind: (params.get('kind') as ProductKind) || 'signature',
        name: { ...empty },
        tagline: { ...empty },
        description: { ...empty },
        recipe: [{ originId: origins[0]?.id ?? '', percent: 100 }],
        roastLevel: 'medium',
        tastingNotes: { ...empty },
        prices: { 250: 0, 500: 0, 1000: 0 },
        featured: false,
        active: false,
        sortOrder: products.length + 1,
      },
  );

  if (!isNew && !existing) return <p className="muted">404</p>;

  const total = recipeTotal(p.recipe);
  const split = speciesSplit(p.recipe, originIndex);
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((cur) => ({ ...cur, [k]: v }));
  const valid = total === 100 && p.name.fr.trim() !== '' && p.recipe.every((r) => originIndex[r.originId]);

  function save() {
    if (!valid) return;
    const slug = p.slug || slugify(p.name.fr) || `product-${Date.now()}`;
    api.saveProduct({ ...p, id: p.id || slug, slug });
    navigate('/admin/products');
  }

  return (
    <>
      <div className="admin-head">
        <div className="stack" style={{ ['--gap' as string]: '4px' }}>
          <Link to="/admin/products" className="small">
            ← {t.admin.nav.products}
          </Link>
          <h1>{isNew ? t.admin.products.add : l(p.name)}</h1>
        </div>
        <div className="toolbar">
          {!isNew && (
            <ConfirmButton
              label={t.common.delete}
              confirmLabel={t.common.confirmDelete}
              onConfirm={() => {
                api.deleteProduct(p.id);
                navigate('/admin/products');
              }}
            />
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid} onClick={save}>
            {t.common.save}
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel stack">
          <div className="form-grid">
            <label className="field">
              <span className="label">{t.admin.products.kind}</span>
              <select className="select" value={p.kind} onChange={(e) => set('kind', e.target.value as ProductKind)}>
                {(['signature', 'single-origin', 'b2b'] as ProductKind[]).map((k) => (
                  <option key={k} value={k}>
                    {t.kind[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">{t.common.roast}</span>
              <select className="select" value={p.roastLevel} onChange={(e) => set('roastLevel', e.target.value as RoastLevel)}>
                {ROASTS.map((r) => (
                  <option key={r} value={r}>
                    {t.roast[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <LocalizedInput id="p-name" label={t.admin.products.name} value={p.name} onChange={(v) => set('name', v)} />
          <LocalizedInput id="p-tagline" label={t.admin.products.tagline} value={p.tagline} onChange={(v) => set('tagline', v)} />
          <LocalizedInput
            id="p-desc"
            label={t.admin.products.description}
            value={p.description}
            onChange={(v) => set('description', v)}
            multiline
          />
          <LocalizedInput
            id="p-notes"
            label={t.common.tastingNotes}
            value={p.tastingNotes}
            onChange={(v) => set('tastingNotes', v)}
          />
        </section>

        <div className="stack" style={{ ['--gap' as string]: '20px' }}>
          <section className="panel stack">
            <span className="label">{t.admin.products.recipeHint}</span>
            <div className="recipe-editor">
              {p.recipe.map((line, i) => (
                <div key={i} className="recipe-editor-row">
                  <select
                    className="select"
                    value={line.originId}
                    aria-label={t.common.origin}
                    onChange={(e) =>
                      set('recipe', p.recipe.map((r, j) => (j === i ? { ...r, originId: e.target.value } : r)))
                    }
                  >
                    {origins.map((o) => (
                      <option key={o.id} value={o.id}>
                        {l(o.name)} ({t.common[o.species]})
                      </option>
                    ))}
                  </select>
                  <input
                    className="input num"
                    type="number"
                    min={1}
                    max={100}
                    value={line.percent}
                    aria-label="%"
                    onChange={(e) =>
                      set('recipe', p.recipe.map((r, j) => (j === i ? { ...r, percent: Number(e.target.value) } : r)))
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost"
                    aria-label={t.common.remove}
                    disabled={p.recipe.length === 1}
                    onClick={() => set('recipe', p.recipe.filter((_, j) => j !== i))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="spread">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => set('recipe', [...p.recipe, { originId: origins[0]?.id ?? '', percent: 0 }])}
              >
                <Icon name="plus" size={14} /> {t.admin.products.addLine}
              </button>
              <strong className={`num ${total === 100 ? 'ok-text' : 'bad-text'}`}>{total}%</strong>
            </div>
            {total !== 100 && <p className="field-error">{t.admin.products.invalidRecipe}</p>}
            <span className="small muted">{t.admin.products.computed}</span>
            <SpeciesBar {...split} />
          </section>

          <section className="panel stack">
            <span className="label">{t.admin.products.pricesHint}</span>
            <div className="form-grid">
              {PACK_SIZES.map((s) => (
                <label key={s} className="field">
                  <span className="label">
                    {formatSize(s)}{' '}
                    <span className="muted">
                      · {t.admin.products.bagsLeft}: {maxBags(p.recipe, s, originIndex, settings.roastLossPercent)}
                    </span>
                  </span>
                  <input
                    className="input num"
                    type="number"
                    min={0}
                    value={p.prices[s] ?? ''}
                    onChange={(e) =>
                      set('prices', { ...p.prices, [s]: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="panel stack">
            <Switch checked={p.active} onChange={(v) => set('active', v)} label={t.admin.products.active} />
            <Switch checked={p.featured} onChange={(v) => set('featured', v)} label={t.admin.products.featured} />
            <label className="field">
              <span className="label">{t.admin.products.sortOrder}</span>
              <input
                className="input num"
                type="number"
                value={p.sortOrder}
                onChange={(e) => set('sortOrder', Number(e.target.value))}
              />
            </label>
          </section>
        </div>
      </div>
    </>
  );
}

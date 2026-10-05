import { useState, type FormEvent } from 'react';
import { formatNumber } from '@/core/format';
import { isPrice } from '@/core/pricing';
import { isLowStock } from '@/core/stock';
import type { Origin, RoastLevel, Species, StockReason } from '@/core/types';
import { api } from '@/data/api';
import { useCatalog, useDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { Icon } from '@/shared/ui/Icon';
import { canEditCatalog } from '../permissions';
import { useAdminRole } from '../session';
import { LocalizedInput, Switch, TableWrap } from '../ui';
import { useAction } from '../useAction';

export function StockPage() {
  const { t, l, date } = useI18n();
  const { origins } = useCatalog();
  const { stockMovements } = useDb();
  const role = useAdminRole()!;
  const editable = canEditCatalog(role);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [editing, setEditing] = useState<Origin | 'new' | null>(null);
  const originName = (id: string) => {
    const o = origins.find((x) => x.id === id);
    return o ? l(o.name) : id;
  };

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.stock}</h1>
        {editable && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> {t.admin.stock.addOrigin}
          </button>
        )}
      </div>
      <p className="muted">{t.admin.stock.intro}</p>
      <p className="notice small">{t.admin.stock.blendRule}</p>

      {/* key: a fresh form for each origin (and for a new one), never the previous one's fields */}
      {editing && <OriginEditor key={editing === 'new' ? 'new' : editing.id} origin={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <TableWrap label={t.admin.nav.stock}>
        <table className="table">
          <thead>
            <tr>
              <th>{t.common.origin}</th>
              <th>{t.admin.stock.species}</th>
              <th className="end">{t.admin.stock.stockKg}</th>
              <th className="end">{t.admin.stock.lowAt}</th>
              <th className="end">{t.admin.stock.pricePerKg}</th>
              <th>{t.admin.stock.inBlend}</th>
              <th>{t.admin.stock.restock}</th>
              <th>
                <span className="sr-only">{t.common.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {origins.map((o) => (
              <OriginRow
                key={o.id}
                o={o}
                editable={editable}
                adjusting={adjusting === o.id}
                onAdjust={() => setAdjusting(adjusting === o.id ? null : o.id)}
                onEdit={() => setEditing(o)}
              />
            ))}
          </tbody>
        </table>
      </TableWrap>

      <section className="stack">
        <h2 className="admin-card-title">{t.admin.stock.movements}</h2>
        <TableWrap label={t.admin.stock.movements}>
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.date}</th>
                <th>{t.common.origin}</th>
                <th className="end">kg</th>
                <th>{t.admin.stock.reason}</th>
                <th>{t.common.reference}</th>
                <th>{t.admin.stock.note}</th>
              </tr>
            </thead>
            <tbody>
              {stockMovements.slice(0, 40).map((m) => (
                <tr key={m.id}>
                  <td className="small muted num">{date(m.at, true)}</td>
                  <td>{originName(m.originId)}</td>
                  <td className={`num end ${m.deltaKg >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                    {m.deltaKg >= 0 ? '+' : ''}
                    {formatNumber(m.deltaKg, 3)}
                  </td>
                  <td className="small">{t.admin.stock.reasons[m.reason]}</td>
                  <td className="small num">{m.ref}</td>
                  <td className="small muted">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </>
  );
}

function OriginRow({
  o,
  editable,
  adjusting,
  onAdjust,
  onEdit,
}: {
  o: Origin;
  editable: boolean;
  adjusting: boolean;
  onAdjust: () => void;
  onEdit: () => void;
}) {
  const { t, l, money, date } = useI18n();
  const low = isLowStock(o);
  return (
    <>
      <tr>
        <td>
          <span className="cell-flag">
            <Flag code={o.countryCode} /> <strong>{l(o.name)}</strong>
          </span>
          <span className="small muted">{o.region}</span>
        </td>
        <td className="small">{t.common[o.species]}</td>
        <td className="num end">
          <span className={`pill ${o.stockKg === 0 ? 'pill-bad' : low ? 'pill-warn' : 'pill-ok'}`}>
            {formatNumber(o.stockKg, 2)}
          </span>
        </td>
        <td className="num end small">{formatNumber(o.lowStockKg)}</td>
        <td className="num end small">{money(o.pricePerKg)}</td>
        <td>
          <Switch
            checked={o.customBlendEnabled}
            onChange={(v) => editable && api.saveOrigin({ ...o, customBlendEnabled: v })}
            label={o.customBlendEnabled && o.stockKg === 0 ? t.admin.stock.empty : ''}
            name={`${t.admin.stock.inBlend} · ${l(o.name)}`}
          />
        </td>
        <td className="small">{o.restockDate ? date(o.restockDate) : '—'}</td>
        <td>
          <div className="row" style={{ ['--gap' as string]: '6px', flexWrap: 'nowrap' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onAdjust}>
              {t.admin.stock.adjust}
            </button>
            {editable && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit} aria-label={t.common.edit}>
                {t.common.edit}
              </button>
            )}
          </div>
        </td>
      </tr>
      {adjusting && (
        <tr>
          <td colSpan={8}>
            <AdjustForm origin={o} onDone={onAdjust} />
          </td>
        </tr>
      )}
    </>
  );
}

function AdjustForm({ origin, onDone }: { origin: Origin; onDone: () => void }) {
  const { t } = useI18n();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<StockReason>('restock');
  const [note, setNote] = useState('');
  const [busy, run] = useAction();
  const value = Number(delta.replace(',', '.'));
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(value) || value === 0) return;
    void run(async () => {
      await api.adjustStock(origin.id, value, reason, note);
      onDone();
    });
  }
  return (
    <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
      <label className="field">
        <span className="label">{t.admin.stock.delta}</span>
        {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the "adjust" button: this is the field the user asked for */}
        <input className="input num" inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+20 / -1.5" autoFocus />
      </label>
      <label className="field">
        <span className="label">{t.admin.stock.reason}</span>
        <select className="select" value={reason} onChange={(e) => setReason(e.target.value as StockReason)}>
          <option value="restock">{t.admin.stock.reasons.restock}</option>
          <option value="correction">{t.admin.stock.reasons.correction}</option>
        </select>
      </label>
      <label className="field" style={{ flex: '1 1 200px' }}>
        <span className="label">{t.admin.stock.note}</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary btn-sm" disabled={!Number.isFinite(value) || value === 0 || busy}>
        {t.admin.stock.apply}
      </button>
    </form>
  );
}

const ROASTS: RoastLevel[] = ['light', 'medium', 'medium-dark', 'dark'];

function OriginEditor({ origin, onClose }: { origin: Origin | null; onClose: () => void }) {
  const { t } = useI18n();
  const [o, setO] = useState<Origin>(
    origin ?? {
      id: '',
      name: { ar: '', fr: '', en: '' },
      countryCode: '',
      species: 'arabica',
      region: '',
      roastLevel: 'medium',
      tastingNotes: { ar: '', fr: '', en: '' },
      stockKg: 0,
      lowStockKg: 5,
      pricePerKg: 200,
      customBlendEnabled: true,
      active: true,
    },
  );
  const set = <K extends keyof Origin>(k: K, v: Origin[K]) => setO((cur) => ({ ...cur, [k]: v }));
  const [refused, setRefused] = useState(false);
  const [busy, run] = useAction();
  const priced = isPrice(o.pricePerKg);
  const valid = o.name.fr.trim() && o.countryCode.trim().length === 2 && priced;
  const save = () =>
    run(async () => {
      if (!valid) return;
      const next = { ...o, countryCode: o.countryCode.toUpperCase() };
      const done = origin ? await api.saveOrigin(next) : (await api.createOrigin(next)) !== null;
      if (done) onClose();
      else setRefused(true); // never close as if it had worked
    });
  return (
    <section className="panel stack">
      <div className="spread">
        <h2 className="admin-card-title">{origin ? t.admin.stock.editOrigin : t.admin.stock.addOrigin}</h2>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid || busy} onClick={save}>
            {t.common.save}
          </button>
        </div>
      </div>
      {refused && <p className="field-error">{t.admin.saveRefused}</p>}
      <div className="detail-grid">
        <div className="stack">
          <LocalizedInput id="o-name" label={t.admin.products.name} value={o.name} onChange={(v) => set('name', v)} />
          <LocalizedInput id="o-notes" label={t.common.tastingNotes} value={o.tastingNotes} onChange={(v) => set('tastingNotes', v)} />
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="label">{t.admin.stock.country}</span>
            <input className="input" maxLength={2} value={o.countryCode} onChange={(e) => set('countryCode', e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{t.admin.stock.species}</span>
            <select className="select" value={o.species} onChange={(e) => set('species', e.target.value as Species)}>
              <option value="arabica">{t.common.arabica}</option>
              <option value="robusta">{t.common.robusta}</option>
            </select>
          </label>
          <label className="field">
            <span className="label">{t.common.region}</span>
            <input className="input" value={o.region} onChange={(e) => set('region', e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{t.common.roast}</span>
            <select className="select" value={o.roastLevel} onChange={(e) => set('roastLevel', e.target.value as RoastLevel)}>
              {ROASTS.map((r) => (
                <option key={r} value={r}>
                  {t.roast[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">{t.admin.stock.pricePerKg}</span>
            <input className="input num" type="number" min={1} step={1} value={o.pricePerKg} onChange={(e) => set('pricePerKg', Number(e.target.value))} />
            {!priced && <span className="field-error">{t.admin.stock.needsPrice}</span>}
          </label>
          <label className="field">
            <span className="label">{t.admin.stock.lowAt}</span>
            <input className="input num" type="number" min={0} value={o.lowStockKg} onChange={(e) => set('lowStockKg', Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="label">{t.admin.stock.restock}</span>
            <input className="input" type="date" value={o.restockDate ?? ''} onChange={(e) => set('restockDate', e.target.value || undefined)} />
          </label>
          <div className="stack span-all">
            <Switch checked={o.customBlendEnabled} onChange={(v) => set('customBlendEnabled', v)} label={t.admin.stock.inBlend} />
            <Switch checked={o.active} onChange={(v) => set('active', v)} label={t.admin.products.active} />
          </div>
        </div>
      </div>
    </section>
  );
}

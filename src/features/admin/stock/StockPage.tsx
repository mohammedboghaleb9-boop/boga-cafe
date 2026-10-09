import { useState, type FormEvent } from 'react';
import { formatKg, formatNumber } from '@/core/format';
import { isPrice } from '@/core/pricing';
import { isLowStock } from '@/core/stock';
import type { Origin, RoastLevel, Species, StockReason } from '@/core/types';
import { api } from '@/data/api';
import { canWrite, useAdminCatalog, useAdminDb } from '@/data/hooks';
import { useI18n } from '@/i18n';
import { Flag } from '@/shared/ui/Flag';
import { Icon } from '@/shared/ui/Icon';
import { canEditCatalog } from '../permissions';
import { useAdminRole } from '../session';
import { ComingSoon, LocalizedInput, Switch, TableWrap, WriteError } from '../ui';
import { refuse, useAction } from '../useAction';

export function StockPage() {
  const { t, l, date } = useI18n();
  const { origins } = useAdminCatalog();
  const { stockMovements } = useAdminDb();
  const role = useAdminRole()!;
  const editable = canEditCatalog(role) && canWrite('catalog');
  const soon = !canWrite('stock') || (canEditCatalog(role) && !canWrite('catalog'));
  const [adjusting, setAdjusting] = useState<string | null>(null);
  // the origin's id, so the editor follows what is saved (read again after each save)
  const [editing, setEditing] = useState<string | null>(null);
  const edited = editing === 'new' ? null : origins.find((o) => o.id === editing);
  const originName = (id: string) => {
    const o = origins.find((x) => x.id === id);
    return o ? l(o.name) : id;
  };

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.stock}</h1>
        {canEditCatalog(role) && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!editable} onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> {t.admin.stock.addOrigin}
          </button>
        )}
      </div>
      {soon && <ComingSoon />}
      <p className="muted">{t.admin.stock.intro}</p>
      <p className="notice small">{t.admin.stock.blendRule}</p>

      {/* key: a fresh form for each origin (and for a new one), never the previous one's fields */}
      {(editing === 'new' || edited) && <OriginEditor key={editing} origin={edited ?? null} onClose={() => setEditing(null)} />}

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
                showEdit={canEditCatalog(role)}
                adjusting={adjusting === o.id}
                onAdjust={() => setAdjusting((cur) => (cur === o.id ? null : o.id))}
                onAdjusted={() => setAdjusting((cur) => (cur === o.id ? null : cur))}
                onEdit={() => setEditing(o.id)}
              />
            ))}
          </tbody>
        </table>
      </TableWrap>

      <section className="stack">
        <h2 className="admin-card-title">{t.admin.stock.movements}</h2>
        {stockMovements.length === 0 ? (
          <p className="small muted">{t.admin.nothingYet}</p>
        ) : (
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
        )}
      </section>
    </>
  );
}

function OriginRow({
  o,
  editable,
  showEdit,
  adjusting,
  onAdjust,
  onAdjusted,
  onEdit,
}: {
  o: Origin;
  /** May change the origin's details (role, and the live site's slice 9). */
  editable: boolean;
  /** The role may edit origins: the button shows, off while not connected. */
  showEdit: boolean;
  adjusting: boolean;
  onAdjust: () => void;
  /** The adjustment was saved: this row's form closes (not another row's, opened meanwhile). */
  onAdjusted: () => void;
  onEdit: () => void;
}) {
  const { t, l, money, date } = useI18n();
  const low = isLowStock(o);
  const [busy, run, failed] = useAction();
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
            disabled={!editable || busy}
            onChange={(v) =>
              editable &&
              run(async () => {
                if (!(await api.saveOrigin({ ...o, customBlendEnabled: v }))) refuse('origin');
              })
            }
            label={o.customBlendEnabled && o.stockKg === 0 ? t.admin.stock.empty : ''}
            name={`${t.admin.stock.inBlend} · ${l(o.name)}`}
          />
        </td>
        <td className="small">{o.restockDate ? date(o.restockDate) : '—'}</td>
        <td>
          <div className="row" style={{ ['--gap' as string]: '6px', flexWrap: 'nowrap' }}>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!canWrite('stock')} onClick={onAdjust}>
              {t.admin.stock.adjust}
            </button>
            {showEdit && (
              <button type="button" className="btn btn-sm btn-ghost" disabled={!editable} onClick={onEdit} aria-label={t.common.edit}>
                {t.common.edit}
              </button>
            )}
          </div>
        </td>
      </tr>
      {failed && (
        <tr>
          <td colSpan={8}>
            <WriteError show />
          </td>
        </tr>
      )}
      {adjusting && (
        <tr>
          <td colSpan={8}>
            <AdjustForm origin={o} onDone={onAdjusted} />
          </td>
        </tr>
      )}
    </>
  );
}

type Direction = 'add' | 'remove';

/**
 * The stock change the form sends: +amount or -amount, or null until both the direction and
 * a real amount above 0 are given. A positive amount and two buttons, not a signed number:
 * a phone's decimal keypad (inputMode decimal, iOS) has no minus key. A comma works as the point.
 */
export function stockChange(direction: Direction | null, amount: string): number | null {
  const kg = Number(amount.trim().replace(',', '.'));
  if (!direction || !amount.trim() || !Number.isFinite(kg) || kg <= 0) return null;
  return direction === 'add' ? kg : -kg;
}

function AdjustForm({ origin, onDone }: { origin: Origin; onDone: () => void }) {
  const { t } = useI18n();
  // no default: the admin says whether it is a delivery or a withdrawal
  const [direction, setDirection] = useState<Direction | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<StockReason>('restock');
  const [note, setNote] = useState('');
  const [busy, run, failed] = useAction();
  const delta = stockChange(direction, amount);
  // as the database applies it: stock never goes under 0
  const after = delta === null ? null : Math.max(0, origin.stockKg + delta);
  function choose(d: Direction) {
    setDirection(d);
    // a withdrawal is a correction, never a "delivery from the roaster"; either can still be changed
    setReason(d === 'add' ? 'restock' : 'correction');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (delta === null) return;
    void run(async () => {
      await api.adjustStock(origin.id, delta, reason, note);
      onDone();
    });
  }
  return (
    <form className="row adjust-form" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
      <WriteError show={failed} />
      <div className="seg" role="group" aria-label={t.admin.stock.direction}>
        {(['add', 'remove'] as const).map((d) => (
          <button key={d} type="button" aria-pressed={direction === d} onClick={() => choose(d)}>
            {d === 'add' ? t.admin.stock.add : t.admin.stock.remove}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="label">{t.admin.stock.amount}</span>
        {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the "adjust" button: this is the field the user asked for */}
        <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10" autoFocus />
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
        <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {after !== null && (
        <p className="small stock-result" aria-live="polite">
          {t.admin.stock.result} <span className="num">{formatKg(origin.stockKg)}</span> <span className="dir-arrow" aria-hidden="true">→</span>{' '}
          <strong className="num">{formatKg(after)}</strong>
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-sm" disabled={delta === null} aria-disabled={busy || undefined}>
        {t.admin.stock.apply}
      </button>
    </form>
  );
}

const ROASTS: RoastLevel[] = ['light', 'medium', 'medium-dark', 'dark'];

/**
 * A new origin, or an existing one's price per kg, alert level and Custom Blend switch: what
 * the database saves (save_origin). Its name, country and the rest are set at creation; it is
 * created hidden, at 0 kg, and the restock date is not saved from here yet.
 */
function OriginEditor({ origin, onClose }: { origin: Origin | null; onClose: () => void }) {
  const { t } = useI18n();
  const locked = origin !== null;
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
      active: false,
    },
  );
  // what is saved changed (read again after a refused save): the form starts again from it
  const version = origin ? (origin.updatedAt ?? JSON.stringify(origin)) : null;
  const [seen, setSeen] = useState(version);
  if (origin && seen !== version) {
    setSeen(version);
    setO(origin);
  }
  const set = <K extends keyof Origin>(k: K, v: Origin[K]) => setO((cur) => ({ ...cur, [k]: v }));
  const [busy, run, failed] = useAction();
  const priced = isPrice(o.pricePerKg);
  const valid = o.name.fr.trim() && /^[a-z]{2}$/i.test(o.countryCode) && priced && Number.isFinite(o.lowStockKg) && o.lowStockKg >= 0;
  const save = () =>
    run(async () => {
      if (!valid) return;
      const next = { ...o, countryCode: o.countryCode.toUpperCase() };
      const done = origin ? await api.saveOrigin(next) : (await api.createOrigin(next)) !== null;
      if (!done) refuse('origin'); // never close as if it had worked
      onClose();
    });
  return (
    <section className="panel stack">
      <div className="spread">
        <h2 className="admin-card-title">{origin ? t.admin.stock.editOrigin : t.admin.stock.addOrigin}</h2>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid} aria-disabled={busy || undefined} onClick={save}>
            {t.common.save}
          </button>
        </div>
      </div>
      <WriteError show={failed} />
      <p className="small muted">{locked ? t.admin.stock.editLimits : t.admin.stock.createdHidden}</p>
      <div className="detail-grid">
        <fieldset className="plain-fieldset stack" disabled={locked}>
          <LocalizedInput id="o-name" label={t.admin.products.name} value={o.name} onChange={(v) => set('name', v)} maxLength={80} />
          <LocalizedInput id="o-notes" label={t.common.tastingNotes} value={o.tastingNotes} onChange={(v) => set('tastingNotes', v)} maxLength={200} />
        </fieldset>
        <div className="form-grid">
          <label className="field">
            <span className="label">{t.admin.stock.country}</span>
            <input className="input" maxLength={2} disabled={locked} value={o.countryCode} onChange={(e) => set('countryCode', e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{t.admin.stock.species}</span>
            <select className="select" disabled={locked} value={o.species} onChange={(e) => set('species', e.target.value as Species)}>
              <option value="arabica">{t.common.arabica}</option>
              <option value="robusta">{t.common.robusta}</option>
            </select>
          </label>
          <label className="field">
            <span className="label">{t.common.region}</span>
            <input className="input" maxLength={80} disabled={locked} value={o.region} onChange={(e) => set('region', e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{t.common.roast}</span>
            <select className="select" disabled={locked} value={o.roastLevel} onChange={(e) => set('roastLevel', e.target.value as RoastLevel)}>
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
            <input className="input" type="date" disabled value={o.restockDate ?? ''} onChange={(e) => set('restockDate', e.target.value || undefined)} />
          </label>
          <div className="stack span-all">
            <Switch checked={o.customBlendEnabled} onChange={(v) => set('customBlendEnabled', v)} label={t.admin.stock.inBlend} />
            <Switch checked={o.active} disabled onChange={(v) => set('active', v)} label={t.admin.products.active} />
          </div>
        </div>
      </div>
    </section>
  );
}

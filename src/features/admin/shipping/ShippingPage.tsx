import { useState } from 'react';
import { MAX_FREE_SHIPPING, shippingRateOk, trimmedRate } from '@/core/config';
import { shippingFee } from '@/core/shipping';
import type { ShippingRate } from '@/core/types';
import { api } from '@/data/api';
import { canWrite, useAdminDb } from '@/data/hooks';
import { SERVER_DATA } from '@/data/mode';
import { fmt, useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { ComingSoon, ConfirmButton, SavedFlash, Switch, TableWrap, WriteError, useSavedFlash } from '../ui';
import { useAdminRole } from '../session';
import { refuse, useAction } from '../useAction';
import { useSavedDraft } from '../useSavedDraft';

const num = (v: string) => Math.max(0, Number(v) || 0);

const NEW_CITY: ShippingRate = {
  id: '',
  city: { ar: '', fr: '', en: '' },
  distanceKm: 0,
  // no example fee: a new city is priced by the owner before it is shown (shippingRateOk); the included
  // weight is the owner's rule (3 kg, 2026-10-19), so a forgotten field never charges every kilo
  baseFee: 0,
  includedKg: 3,
  extraPerKg: 0,
  deliveryDays: '',
  active: false,
};

/** "Distance (km) · Oujda"; a city without a name yet gives just the field name. */
function useRowLabel() {
  const { l } = useI18n();
  return (field: string, r: ShippingRate) => (l(r.city).trim() ? `${field} · ${l(r.city).trim()}` : field);
}

/**
 * Delivery prices by city. Each row and the free-shipping threshold are saved by their own
 * button, never on each keystroke, and "saved" shows only once the database confirmed.
 */
export function ShippingPage() {
  const { t, l, money } = useI18n();
  const { shippingRates, settings } = useAdminDb();
  const writable = canWrite('shipping');
  const [adding, setAdding] = useState(false);
  const [simCity, setSimCity] = useState(shippingRates[0]?.id ?? '');
  const [simKg, setSimKg] = useState(4);
  const [simSubtotal, setSimSubtotal] = useState(300);
  const simRate = shippingRates.find((r) => r.id === simCity);

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.shipping}</h1>
        <button type="button" className="btn btn-primary btn-sm" disabled={!writable || adding} onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> {t.admin.shipping.addCity}
        </button>
      </div>
      <p className="muted">{t.admin.shipping.intro}</p>
      {!writable && <ComingSoon />}

      {adding && <NewCityForm onClose={() => setAdding(false)} />}

      <div className="detail-grid">
        {/* works on what is read: no change is saved */}
        <section className="panel stack shipping-sim">
          <h2 className="admin-card-title">{t.admin.shipping.simulator}</h2>
          <div className="form-grid">
            <label className="field">
              <span className="label">{t.admin.shipping.city}</span>
              <select className="select" value={simCity} onChange={(e) => setSimCity(e.target.value)}>
                {shippingRates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {l(r.city) || r.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">{t.admin.shipping.simWeight}</span>
              <input className="input num" type="number" min={0} step={0.25} value={simKg} onChange={(e) => setSimKg(num(e.target.value))} />
            </label>
            <label className="field">
              <span className="label">{t.common.subtotal}</span>
              <input className="input num" type="number" min={0} value={simSubtotal} onChange={(e) => setSimSubtotal(num(e.target.value))} />
            </label>
          </div>
          {simRate && (
            <strong className="num">
              {fmt(t.admin.shipping.simResult, { fee: money(shippingFee(simRate, simKg, simSubtotal, settings)) })}
            </strong>
          )}
        </section>
        <FreeShippingForm writable={writable} />
      </div>

      <TableWrap label={t.admin.nav.shipping}>
        <table className="table">
          <thead>
            <tr>
              <th>{t.admin.shipping.city} (FR)</th>
              <th>{t.admin.shipping.city} (ع)</th>
              <th>{t.admin.shipping.distance}</th>
              <th>{t.admin.shipping.base}</th>
              <th>{t.admin.shipping.included}</th>
              <th>{t.admin.shipping.extra}</th>
              <th>{t.admin.shipping.cap}</th>
              <th>{t.admin.shipping.days}</th>
              <th>{t.admin.payments.enabled}</th>
              <th>
                <span className="sr-only">{t.common.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shippingRates.map((r) => (
              <RateRow key={r.id} rate={r} writable={writable} />
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

function FreeShippingForm({ writable }: { writable: boolean }) {
  const { t } = useI18n();
  const role = useAdminRole()!;
  const { settings, configVersions } = useAdminDb();
  const [amount, setAmount] = useSavedDraft(settings.freeShippingOver, configVersions?.freeShipping ?? String(settings.freeShippingOver));
  const [saved, flash] = useSavedFlash();
  const [busy, run, failed] = useAction();
  const valid = amount <= MAX_FREE_SHIPPING;
  return (
    <fieldset className="plain-fieldset panel stack" disabled={!writable}>
      <WriteError show={failed} />
      <label className="field">
        <span className="label">{t.admin.shipping.freeOver}</span>
        <input className="input num" type="number" min={0} max={MAX_FREE_SHIPPING} value={amount} onChange={(e) => setAmount(num(e.target.value))} />
        {!valid && <span className="field-error">{t.admin.shipping.freeOverInvalid}</span>}
      </label>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!valid || amount === settings.freeShippingOver}
          aria-disabled={busy || undefined}
          aria-label={`${t.common.save} · ${t.admin.shipping.freeOver}`}
          onClick={() =>
            run(async () => {
              if (!(await api.saveFreeShipping(amount, role))) refuse('free shipping'); // never the "saved" flash
              flash();
            })
          }
        >
          {t.common.save}
        </button>
        <SavedFlash show={saved} />
      </div>
    </fieldset>
  );
}

/** The fields of a city, in a table row (an existing city) or the add form. */
function RateFields({
  r,
  set,
  label,
  disabled,
}: {
  r: ShippingRate;
  set: (patch: Partial<ShippingRate>) => void;
  label: (field: string) => string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <td>
        <input disabled={disabled} className="input input-wide" maxLength={60} value={r.city.fr} aria-label={`${t.admin.shipping.city} FR`} onChange={(e) => set({ city: { ...r.city, fr: e.target.value, en: e.target.value } })} />
      </td>
      <td>
        <input disabled={disabled} className="input input-wide" dir="rtl" maxLength={60} value={r.city.ar} aria-label={`${t.admin.shipping.city} AR`} onChange={(e) => set({ city: { ...r.city, ar: e.target.value } })} />
      </td>
      <td>
        <input disabled={disabled} className="input num" type="number" min={0} max={3000} step={1} value={r.distanceKm} aria-label={label(t.admin.shipping.distance)} onChange={(e) => set({ distanceKm: num(e.target.value) })} />
      </td>
      <td>
        <input disabled={disabled} className="input num" type="number" min={0} max={1000} value={r.baseFee} aria-label={label(t.admin.shipping.base)} onChange={(e) => set({ baseFee: num(e.target.value) })} />
      </td>
      <td>
        <input disabled={disabled} className="input num" type="number" min={0} max={100} value={r.includedKg} aria-label={label(t.admin.shipping.included)} onChange={(e) => set({ includedKg: num(e.target.value) })} />
      </td>
      <td>
        <input disabled={disabled} className="input num" type="number" min={0} max={1000} value={r.extraPerKg} aria-label={label(t.admin.shipping.extra)} onChange={(e) => set({ extraPerKg: num(e.target.value) })} />
      </td>
      <td>
        {/* empty = no cap */}
        <input
          disabled={disabled}
          className="input num"
          type="number"
          min={0}
          max={1000}
          step={1}
          value={r.maxFee ?? ''}
          aria-label={label(t.admin.shipping.cap)}
          onChange={(e) => set({ maxFee: e.target.value === '' ? undefined : num(e.target.value) })}
        />
      </td>
      <td>
        <input disabled={disabled} className="input" maxLength={20} value={r.deliveryDays} aria-label={label(t.admin.shipping.days)} onChange={(e) => set({ deliveryDays: e.target.value })} />
      </td>
    </>
  );
}

function RateRow({ rate, writable }: { rate: ShippingRate; writable: boolean }) {
  const { t } = useI18n();
  const role = useAdminRole()!;
  const rowLabel = useRowLabel();
  const [r, setR] = useSavedDraft(rate, rate.updatedAt ?? JSON.stringify(rate));
  const [saved, flash] = useSavedFlash();
  const [busy, run, failed] = useAction();
  const valid = shippingRateOk(r);
  // what would be saved, not what is typed: a space at the end of a name is no change (and would only mark the city as saved by someone)
  const changed = JSON.stringify(trimmedRate(r)) !== JSON.stringify(rate);
  const label = (field: string) => rowLabel(field, rate);
  return (
    <>
      <tr>
        <RateFields r={r} set={(patch) => setR((cur) => ({ ...cur, ...patch }))} label={label} disabled={!writable} />
        <td>
          <Switch disabled={!writable} checked={r.active} onChange={(v) => setR((cur) => ({ ...cur, active: v }))} label="" name={label(t.admin.payments.enabled)} />
        </td>
        <td>
          <div className="row" style={{ ['--gap' as string]: '6px', flexWrap: 'nowrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!writable || !valid || !changed}
              aria-disabled={busy || undefined}
              aria-label={label(t.common.save)}
              onClick={() =>
                run(async () => {
                  if (!(await api.saveShippingRate(r, role))) refuse('city'); // never the "saved" flash
                  flash();
                })
              }
            >
              {t.common.save}
            </button>
            <SavedFlash show={saved} />
            {/* live site: orders keep their city, so a city is hidden, never deleted */}
            {!SERVER_DATA && (
              <ConfirmButton disabled={!writable} label={t.common.delete} confirmLabel={t.common.confirmDelete} onConfirm={() => api.deleteShippingRate(rate.id)} />
            )}
          </div>
        </td>
      </tr>
      {(failed || !valid) && (
        <tr>
          <td colSpan={9}>{failed ? <WriteError show /> : <p className="field-error">{t.admin.shipping.rowInvalid}</p>}</td>
        </tr>
      )}
    </>
  );
}

/** A new city: created hidden (shown by its row's switch, after a check), its id from its French name. */
function NewCityForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const role = useAdminRole()!;
  const [r, setR] = useState(NEW_CITY);
  const [busy, run, failed] = useAction();
  const valid = shippingRateOk(r);
  return (
    <section className="panel stack">
      <div className="spread">
        <h2 className="admin-card-title">{t.admin.shipping.addCity}</h2>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!valid}
            aria-disabled={busy || undefined}
            onClick={() =>
              run(async () => {
                if (!(await api.createShippingRate(r, role))) refuse('new city'); // never close as if it had worked
                onClose();
              })
            }
          >
            {t.common.save}
          </button>
        </div>
      </div>
      <WriteError show={failed} />
      <p className="small muted">{t.admin.shipping.createdHidden}</p>
      {!valid && <p className="field-error">{t.admin.shipping.rowInvalid}</p>}
      <TableWrap label={t.admin.shipping.addCity}>
        <table className="table">
          <thead>
            <tr>
              <th>{t.admin.shipping.city} (FR)</th>
              <th>{t.admin.shipping.city} (ع)</th>
              <th>{t.admin.shipping.distance}</th>
              <th>{t.admin.shipping.base}</th>
              <th>{t.admin.shipping.included}</th>
              <th>{t.admin.shipping.extra}</th>
              <th>{t.admin.shipping.cap}</th>
              <th>{t.admin.shipping.days}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <RateFields r={r} set={(patch) => setR((cur) => ({ ...cur, ...patch }))} label={(field) => field} />
            </tr>
          </tbody>
        </table>
      </TableWrap>
    </section>
  );
}

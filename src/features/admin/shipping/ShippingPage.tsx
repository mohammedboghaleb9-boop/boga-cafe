import { useState } from 'react';
import { shippingFee } from '@/core/shipping';
import type { ShippingRate } from '@/core/types';
import { api } from '@/data/api';
import { useDb } from '@/data/hooks';
import { fmt, useI18n } from '@/i18n';
import { Icon } from '@/shared/ui/Icon';
import { ConfirmButton, Switch } from '../ui';

export function ShippingPage() {
  const { t, l, money } = useI18n();
  const { shippingRates, settings } = useDb();
  const [simCity, setSimCity] = useState(shippingRates[0]?.id ?? '');
  const [simKg, setSimKg] = useState(4);
  const [simSubtotal, setSimSubtotal] = useState(300);
  const simRate = shippingRates.find((r) => r.id === simCity);
  const save = (r: ShippingRate, patch: Partial<ShippingRate>) => api.saveShippingRate({ ...r, ...patch });
  const num = (v: string) => Math.max(0, Number(v) || 0);

  function addCity() {
    api.saveShippingRate({
      id: `city-${Date.now()}`,
      city: { ar: '', fr: '', en: '' },
      distanceKm: 0,
      baseFee: 40,
      includedKg: 3,
      extraPerKg: 5,
      deliveryDays: '2–3',
      active: false,
    });
  }

  return (
    <>
      <div className="admin-head">
        <h1>{t.admin.nav.shipping}</h1>
        <button type="button" className="btn btn-primary btn-sm" onClick={addCity}>
          <Icon name="plus" size={16} /> {t.admin.shipping.addCity}
        </button>
      </div>
      <p className="muted">{t.admin.shipping.intro}</p>

      <div className="detail-grid">
        <section className="panel stack">
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
        <section className="panel stack">
          <label className="field">
            <span className="label">{t.admin.shipping.freeOver}</span>
            <input
              className="input num"
              type="number"
              min={0}
              value={settings.freeShippingOver}
              onChange={(e) => api.saveSettings({ ...settings, freeShippingOver: num(e.target.value) })}
            />
          </label>
        </section>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.admin.shipping.city} (FR)</th>
              <th>{t.admin.shipping.city} (ع)</th>
              <th>{t.admin.shipping.distance}</th>
              <th>{t.admin.shipping.base}</th>
              <th>{t.admin.shipping.included}</th>
              <th>{t.admin.shipping.extra}</th>
              <th>{t.admin.shipping.days}</th>
              <th>{t.admin.payments.enabled}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shippingRates.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    className="input input-wide"
                    value={r.city.fr}
                    aria-label={`${t.admin.shipping.city} FR`}
                    onChange={(e) => save(r, { city: { ...r.city, fr: e.target.value, en: e.target.value } })}
                  />
                </td>
                <td>
                  <input
                    className="input input-wide"
                    dir="rtl"
                    value={r.city.ar}
                    aria-label={`${t.admin.shipping.city} AR`}
                    onChange={(e) => save(r, { city: { ...r.city, ar: e.target.value } })}
                  />
                </td>
                <td>
                  <input className="input num" type="number" min={0} value={r.distanceKm} onChange={(e) => save(r, { distanceKm: num(e.target.value) })} />
                </td>
                <td>
                  <input className="input num" type="number" min={0} value={r.baseFee} onChange={(e) => save(r, { baseFee: num(e.target.value) })} />
                </td>
                <td>
                  <input className="input num" type="number" min={0} value={r.includedKg} onChange={(e) => save(r, { includedKg: num(e.target.value) })} />
                </td>
                <td>
                  <input className="input num" type="number" min={0} value={r.extraPerKg} onChange={(e) => save(r, { extraPerKg: num(e.target.value) })} />
                </td>
                <td>
                  <input className="input" value={r.deliveryDays} onChange={(e) => save(r, { deliveryDays: e.target.value })} />
                </td>
                <td>
                  <Switch checked={r.active} onChange={(v) => save(r, { active: v })} label="" />
                </td>
                <td>
                  <ConfirmButton label={t.common.delete} confirmLabel={t.common.confirmDelete} onConfirm={() => api.deleteShippingRate(r.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

-- A shown delivery city has a base fee above 0 (P5 slice 13, owner 2026-10-19).
--
-- The real start set every city's fees to 0 and hid them: 0 means "not priced yet", never free delivery (free
-- delivery is settings.freeShippingOver). The Admin Panel already refuses to show a city with a base fee of 0
-- (src/core/config.ts shippingRateOk); this makes the database refuse it too, whoever writes: save_shipping_rate,
-- a direct table write, the service key. A hidden city may keep 0 until its real tariff is entered; showing it
-- and giving it its fee happen in the same save. With a base above 0 the cap (max_fee >= base_fee) cannot bring
-- a fee back to 0 either. The included weight is not touched (owner 2026-10-19: it stays the city's own value).
--
-- No row changes: it stops ("violated by some row") if a shown city has a base fee of 0, so nothing is hidden or
-- re-priced behind the owner's back. Live on 2026-10-19: all 20 cities hidden, so it applies as is.
-- Rollback: supabase/manual/20261020090000_city_shown_needs_fee.rollback.sql (drops the check; SQL Editor).

alter table public.shipping_rates
  add constraint shipping_rates_shown_needs_fee check (not active or base_fee > 0);

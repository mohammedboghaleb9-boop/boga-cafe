-- Admin writes (P5 slice 8).
--
-- B2B requests: the team changes only the follow-up (status, final price, its notes),
-- through update_quote_request(); the request itself (customer, lines, figures) is
-- written once by the storefront function and never edited by hand. Until now
-- "admins manage" let any admin update any column, insert or delete rows through the
-- API. The follow-up records who changed it and when, and is refused ('stale') when
-- the row changed since the page read it: a second admin's work is never overwritten
-- with an old copy.

alter table public.quote_requests
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid;

-- Every admin role follows up B2B requests (Admin → B2B, src/features/admin/permissions.ts).
-- p_seen_at: the updated_at the page read.
create or replace function public.update_quote_request(p_id uuid, p_status text, p_final_price numeric, p_admin_notes text, p_seen_at timestamptz)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_status is null or p_status not in ('new', 'negotiating', 'confirmed', 'closed') then
    raise exception 'invalid_status';
  end if;
  -- a real price or none ('NaN' and 'Infinity' are valid numeric values)
  if p_final_price is not null and (p_final_price < 0 or p_final_price in ('NaN', 'Infinity')) then
    raise exception 'invalid_price';
  end if;
  if char_length(coalesce(p_admin_notes, '')) > 500 then
    raise exception 'invalid_notes';
  end if;
  update public.quote_requests
     set status = p_status, final_price = p_final_price, admin_notes = coalesce(p_admin_notes, ''),
         -- clock time, not the transaction's: each change gets its own mark
         updated_at = clock_timestamp(), updated_by = auth.uid()
   where id = p_id and updated_at = p_seen_at;
  if not found then
    if exists (select 1 from public.quote_requests where id = p_id) then
      raise exception 'stale';
    end if;
    raise exception 'not_found';
  end if;
end $$;

revoke all on function public.update_quote_request(uuid, text, numeric, text, timestamptz) from public, anon;
grant execute on function public.update_quote_request(uuid, text, numeric, text, timestamptz) to authenticated;

-- Orders, their history, stock lines, the message queue and B2B requests change only
-- through the server's functions (owned by the tables' owner, so not affected). The API
-- roles lose the direct write privileges Supabase gives every new table, so a future
-- policy too broad (as "admins manage" was, for every role on quote_requests) cannot
-- open them again. (Revoking, not dropping that policy: the tool that applies
-- migrations to the live project hangs on DROP.)
revoke insert, update, delete, truncate
  on public.orders, public.order_events, public.stock_movements, public.notification_outbox, public.quote_requests
  from anon, authenticated;

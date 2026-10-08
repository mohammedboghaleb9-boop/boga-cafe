-- B2B requests (P5 slice 8): the team changes only the follow-up (status, final price,
-- its notes), through update_quote_request(); the request itself (customer, lines,
-- figures) is written once by the storefront function and never edited by hand.
-- Until now "admins manage" let any admin update any column, insert or delete rows
-- through the API. Restrictive policies close those three: no DROP needed (the tool
-- that applies migrations to the live project hangs on DROP). Functions that own the
-- table (commit_quote_request, the one below) are not subject to row level security.

create policy "no direct insert" on public.quote_requests as restrictive for insert with check (false);
create policy "no direct update" on public.quote_requests as restrictive for update using (false);
create policy "no direct delete" on public.quote_requests as restrictive for delete using (false);

-- Every admin role follows up B2B requests (Admin → B2B, src/features/admin/permissions.ts).
create or replace function public.update_quote_request(p_id uuid, p_status text, p_final_price numeric, p_admin_notes text)
returns void
language plpgsql security definer set search_path = public as $$
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
     set status = p_status, final_price = p_final_price, admin_notes = coalesce(p_admin_notes, '')
   where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
end $$;

revoke all on function public.update_quote_request(uuid, text, numeric, text) from public, anon;
grant execute on function public.update_quote_request(uuid, text, numeric, text) to authenticated;

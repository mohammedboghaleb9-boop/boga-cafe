-- P5 step 3, slice 3b: the order's idempotency key (one random uuid per submission,
-- the same when the customer sends the same submission again). commit_order uses it
-- (next migration). No key = no check, as before. B2B requests have none yet.
alter table public.orders add column idempotency_key uuid;
alter table public.orders add constraint orders_idempotency_key_key unique (idempotency_key);
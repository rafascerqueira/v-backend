-- Data correction: per_sale billings were created with a NULL due_date, which the
-- frontend rendered as 01/01/1970 (new Date(null) → Unix epoch). For per_sale the
-- sale date *is* the due date, so backfill due_date from the billing's creation date.
--
-- We normalize to local midnight (America/Sao_Paulo) to match how new due dates are
-- stored by computeDueDate (setHours(0,0,0,0) on a UTC-3 server) and how the prior
-- 20260418222831_fix_date_utc_offset migration treats date-only values.
--
-- Only per_sale customers are touched: `custom` mode legitimately keeps a NULL due
-- date until the seller sets it manually.

UPDATE billings b
SET due_date = date_trunc('day', b."createdAt" AT TIME ZONE 'America/Sao_Paulo')
                 AT TIME ZONE 'America/Sao_Paulo'
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE b.order_id = o.id
  AND c.billing_mode = 'per_sale'
  AND b.due_date IS NULL;

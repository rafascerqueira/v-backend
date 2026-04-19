-- Data correction: date-only strings (YYYY-MM-DD) were previously parsed with
-- new Date("YYYY-MM-DD"), which the ECMAScript spec treats as UTC midnight.
-- On a UTC-3 (America/Sao_Paulo) server this stored dates 3 hours too early.
-- This migration shifts all affected UTC-midnight timestamps to local midnight.

UPDATE promotions
SET
  start_date = start_date + INTERVAL '3 hours',
  end_date   = end_date   + INTERVAL '3 hours'
WHERE
  EXTRACT(HOUR   FROM start_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM start_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM start_date AT TIME ZONE 'UTC') = 0;

UPDATE billings
SET due_date = due_date + INTERVAL '3 hours'
WHERE
  due_date IS NOT NULL
  AND EXTRACT(HOUR   FROM due_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM due_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM due_date AT TIME ZONE 'UTC') = 0;

UPDATE billings
SET payment_date = payment_date + INTERVAL '3 hours'
WHERE
  payment_date IS NOT NULL
  AND EXTRACT(HOUR   FROM payment_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM payment_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM payment_date AT TIME ZONE 'UTC') = 0;

UPDATE supplier_debts
SET due_date = due_date + INTERVAL '3 hours'
WHERE
  due_date IS NOT NULL
  AND EXTRACT(HOUR   FROM due_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM due_date AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM due_date AT TIME ZONE 'UTC') = 0;

UPDATE product_prices
SET valid_from = valid_from + INTERVAL '3 hours'
WHERE
  valid_from IS NOT NULL
  AND EXTRACT(HOUR   FROM valid_from AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM valid_from AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM valid_from AT TIME ZONE 'UTC') = 0;

UPDATE product_prices
SET valid_to = valid_to + INTERVAL '3 hours'
WHERE
  valid_to IS NOT NULL
  AND EXTRACT(HOUR   FROM valid_to AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM valid_to AT TIME ZONE 'UTC') = 0
  AND EXTRACT(SECOND FROM valid_to AT TIME ZONE 'UTC') = 0;

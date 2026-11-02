-- Database guards for the payment ledger (Phase 1C, security review M-2 / L-1).
--
-- 1. billings.paid_amount only moves through the ledger. The ledger transaction
--    sets `app.ledger_write = on` (SET LOCAL); any other write that changes the
--    amount fails loudly. Without this, code that predates the ledger (the deploy
--    window, or a rollback) would write paid_amount directly, and the next ledger
--    entry would silently recompute it from the ledger, erasing the difference.
--    Inserting a charge with paid_amount 0 (orders, sync, manual) stays allowed.
CREATE OR REPLACE FUNCTION billings_guard_paid_amount() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_write', true) IS DISTINCT FROM 'on' AND (
       (TG_OP = 'INSERT' AND NEW.paid_amount <> 0)
    OR (TG_OP = 'UPDATE' AND NEW.paid_amount IS DISTINCT FROM OLD.paid_amount)
  ) THEN
    RAISE EXCEPTION 'billings.paid_amount only changes through the payment ledger (billing_payments)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billings_guard_paid_amount ON billings;
CREATE TRIGGER billings_guard_paid_amount
  BEFORE INSERT OR UPDATE OF paid_amount ON billings
  FOR EACH ROW EXECUTE FUNCTION billings_guard_paid_amount();

-- 2. billing_payments is append-only: a mistake is undone with a reversal row.
--    UPDATE always fails. DELETE fails unless it is the cascade of deleting the
--    whole account (it then runs nested inside the foreign-key trigger, depth > 1)
--    or an explicit maintenance session (`app.ledger_maintenance = on`, SET LOCAL;
--    used by test cleanup, never by the app).
CREATE OR REPLACE FUNCTION billing_payments_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'billing_payments is append-only: record a reversal instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF pg_trigger_depth() <= 1
     AND current_setting('app.ledger_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'billing_payments is append-only: record a reversal instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billing_payments_append_only ON billing_payments;
CREATE TRIGGER billing_payments_append_only
  BEFORE UPDATE OR DELETE ON billing_payments
  FOR EACH ROW EXECUTE FUNCTION billing_payments_append_only();

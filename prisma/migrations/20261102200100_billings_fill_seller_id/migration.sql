-- Deploy/rollback compatibility for billings.seller_id (Phase 1A).
--
-- The pipeline runs `migrate deploy` BEFORE reloading the app. For those seconds,
-- and for good after a rollback, code that predates seller_id inserts billings
-- without it, and the NOT NULL column would reject the insert (failing every
-- per-sale order). This trigger fills seller_id from the order when an INSERT
-- leaves it NULL; current code always sets it, so for it the trigger is a no-op.
-- BEFORE ROW triggers run before NOT NULL is checked.
CREATE OR REPLACE FUNCTION billings_fill_seller_id() RETURNS trigger AS $$
BEGIN
  IF NEW.seller_id IS NULL THEN
    SELECT o.seller_id INTO NEW.seller_id FROM orders o WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billings_fill_seller_id ON billings;
CREATE TRIGGER billings_fill_seller_id
  BEFORE INSERT ON billings
  FOR EACH ROW EXECUTE FUNCTION billings_fill_seller_id();

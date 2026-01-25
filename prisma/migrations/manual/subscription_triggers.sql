-- ============================================================
-- SUBSCRIPTION SYSTEM - POSTGRESQL TRIGGERS AND FUNCTIONS
-- Execute after Prisma migrations
-- ============================================================

-- Function to get current month period boundaries
CREATE OR REPLACE FUNCTION get_current_month_period()
RETURNS TABLE(period_start TIMESTAMPTZ, period_end TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('month', NOW())::TIMESTAMPTZ as period_start,
    (date_trunc('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 second')::TIMESTAMPTZ as period_end;
END;
$$ LANGUAGE plpgsql;

-- Function to update usage_records when products change
CREATE OR REPLACE FUNCTION update_products_usage()
RETURNS TRIGGER AS $$
DECLARE
  seller TEXT;
  p_start TIMESTAMPTZ;
  p_end TIMESTAMPTZ;
  product_count INT;
BEGIN
  -- Get seller_id from the affected row
  IF TG_OP = 'DELETE' THEN
    seller := OLD.seller_id;
  ELSE
    seller := NEW.seller_id;
  END IF;
  
  -- Get current period
  SELECT * INTO p_start, p_end FROM get_current_month_period();
  
  -- Count active products for this seller
  SELECT COUNT(*) INTO product_count
  FROM products
  WHERE seller_id = seller AND deleted_at IS NULL;
  
  -- Upsert usage record
  INSERT INTO usage_records (account_id, period_start, period_end, products_count, orders_count, customers_count, "createdAt", "updatedAt")
  VALUES (seller, p_start, p_end, product_count, 0, 0, NOW(), NOW())
  ON CONFLICT (account_id, period_start) 
  DO UPDATE SET 
    products_count = product_count,
    "updatedAt" = NOW();
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update usage_records when orders are created
CREATE OR REPLACE FUNCTION update_orders_usage()
RETURNS TRIGGER AS $$
DECLARE
  p_start TIMESTAMPTZ;
  p_end TIMESTAMPTZ;
  order_count INT;
BEGIN
  -- Get current period
  SELECT * INTO p_start, p_end FROM get_current_month_period();
  
  -- Count orders for this seller in current month
  SELECT COUNT(*) INTO order_count
  FROM orders
  WHERE seller_id = NEW.seller_id 
    AND "createdAt" >= p_start 
    AND "createdAt" <= p_end;
  
  -- Upsert usage record
  INSERT INTO usage_records (account_id, period_start, period_end, products_count, orders_count, customers_count, "createdAt", "updatedAt")
  VALUES (NEW.seller_id, p_start, p_end, 0, order_count, 0, NOW(), NOW())
  ON CONFLICT (account_id, period_start) 
  DO UPDATE SET 
    orders_count = order_count,
    "updatedAt" = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update usage_records when customers change
CREATE OR REPLACE FUNCTION update_customers_usage()
RETURNS TRIGGER AS $$
DECLARE
  seller TEXT;
  p_start TIMESTAMPTZ;
  p_end TIMESTAMPTZ;
  customer_count INT;
BEGIN
  -- Get seller_id from the affected row
  IF TG_OP = 'DELETE' THEN
    seller := OLD.seller_id;
  ELSE
    seller := NEW.seller_id;
  END IF;
  
  -- Get current period
  SELECT * INTO p_start, p_end FROM get_current_month_period();
  
  -- Count active customers for this seller
  SELECT COUNT(*) INTO customer_count
  FROM customers
  WHERE seller_id = seller AND active = true;
  
  -- Upsert usage record
  INSERT INTO usage_records (account_id, period_start, period_end, products_count, orders_count, customers_count, "createdAt", "updatedAt")
  VALUES (seller, p_start, p_end, 0, 0, customer_count, NOW(), NOW())
  ON CONFLICT (account_id, period_start) 
  DO UPDATE SET 
    customers_count = customer_count,
    "updatedAt" = NOW();
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trg_products_usage ON products;
DROP TRIGGER IF EXISTS trg_orders_usage ON orders;
DROP TRIGGER IF EXISTS trg_customers_usage ON customers;

-- Create triggers
CREATE TRIGGER trg_products_usage
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_usage();

CREATE TRIGGER trg_orders_usage
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_usage();

CREATE TRIGGER trg_customers_usage
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_customers_usage();

-- ============================================================
-- SUBSCRIPTION EXPIRATION CHECK
-- Can be run via cron job or pg_cron extension
-- ============================================================

CREATE OR REPLACE FUNCTION check_expired_subscriptions()
RETURNS void AS $$
BEGIN
  -- Update expired subscriptions
  UPDATE subscriptions
  SET status = 'canceled', canceled_at = NOW()
  WHERE status = 'active'
    AND cancel_at_period_end = true
    AND current_period_end < NOW();
  
  -- Downgrade accounts with no active subscription
  UPDATE accounts a
  SET plan_type = 'free'
  WHERE plan_type != 'free'
    AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.account_id = a.id
        AND s.status IN ('active', 'trialing')
        AND s.current_period_end > NOW()
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- INDEXES FOR PERFORMANCE OPTIMIZATION
-- ============================================================

-- Composite index for usage queries
CREATE INDEX IF NOT EXISTS idx_usage_account_period 
  ON usage_records (account_id, period_start, period_end);

-- Index for subscription status checks
CREATE INDEX IF NOT EXISTS idx_subscriptions_active 
  ON subscriptions (account_id, status, current_period_end) 
  WHERE status IN ('active', 'trialing');

-- Index for seller data isolation queries
CREATE INDEX IF NOT EXISTS idx_products_seller_active 
  ON products (seller_id, active) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_seller_period 
  ON orders (seller_id, "createdAt");

CREATE INDEX IF NOT EXISTS idx_customers_seller_active 
  ON customers (seller_id, active);

-- ============================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================

-- View for current usage per seller
CREATE OR REPLACE VIEW vw_seller_current_usage AS
SELECT 
  a.id as seller_id,
  a.name as seller_name,
  a.plan_type,
  COALESCE(ur.products_count, 0) as products_count,
  COALESCE(ur.orders_count, 0) as orders_count,
  COALESCE(ur.customers_count, 0) as customers_count,
  CASE a.plan_type
    WHEN 'free' THEN 50
    WHEN 'pro' THEN 500
    ELSE -1
  END as max_products,
  CASE a.plan_type
    WHEN 'free' THEN 30
    WHEN 'pro' THEN 500
    ELSE -1
  END as max_orders_month,
  CASE a.plan_type
    WHEN 'free' THEN 100
    WHEN 'pro' THEN 1000
    ELSE -1
  END as max_customers
FROM accounts a
LEFT JOIN usage_records ur ON ur.account_id = a.id 
  AND ur.period_start = date_trunc('month', NOW())
WHERE a.role = 'seller';

-- View for subscription status
CREATE OR REPLACE VIEW vw_subscription_status AS
SELECT 
  a.id as account_id,
  a.name,
  a.email,
  a.plan_type,
  s.status as subscription_status,
  s.current_period_start,
  s.current_period_end,
  s.cancel_at_period_end,
  s.payment_provider
FROM accounts a
LEFT JOIN subscriptions s ON s.account_id = a.id 
  AND s.status IN ('active', 'trialing')
WHERE a.role = 'seller';

-- ============================================================
-- SCHEDULED JOB (requires pg_cron extension)
-- Run: CREATE EXTENSION IF NOT EXISTS pg_cron;
-- ============================================================

-- Uncomment the following if pg_cron is available:
-- SELECT cron.schedule('check-subscriptions', '0 * * * *', 'SELECT check_expired_subscriptions()');

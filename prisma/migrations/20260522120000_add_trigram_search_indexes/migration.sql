-- Enables substring/ILIKE search to use an index instead of a sequential scan.
-- Backs the products and customers list endpoints, which filter with
-- `contains` + `mode: 'insensitive'` (translates to ILIKE '%term%').

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_sku_trgm
  ON products USING GIN (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_category_trgm
  ON products USING GIN (category gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
  ON customers USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
  ON customers USING GIN (phone gin_trgm_ops);

-- CreateView: v_seller_stats
-- Aggregates per-seller summary stats used by the dashboard.
-- The application layer applies Redis caching (TTL 60s) on top of this view.

CREATE OR REPLACE VIEW v_seller_stats AS
SELECT
  a.id                                                                              AS seller_id,
  COUNT(DISTINCT p.id) FILTER (WHERE p.active = true AND p."deletedAt" IS NULL)    AS active_products,
  COUNT(DISTINCT c.id) FILTER (WHERE c.active = true)                              AS active_customers,
  COUNT(DISTINCT o.id)                                                              AS total_orders,
  COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'pending')                         AS pending_orders,
  COALESCE(SUM(o.total) FILTER (WHERE o.status IN ('delivered', 'confirmed')), 0)  AS total_revenue
FROM accounts a
LEFT JOIN products  p ON p.seller_id = a.id
LEFT JOIN customers c ON c.seller_id = a.id
LEFT JOIN orders    o ON o.seller_id = a.id
WHERE a.role = 'seller'
GROUP BY a.id;
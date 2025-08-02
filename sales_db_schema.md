## Triggers e Funções PostgreSQL

### Função para atualizar timestamps automaticamente
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Aplicar trigger em todas as tabelas com updated_at
CREATE TRIGGER trigger_users_updated_at 
    BEFORE UPDATE ON users FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_customers_updated_at 
    BEFORE UPDATE ON customers FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_products_updated_at 
    BEFORE UPDATE ON products FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_orders_updated_at 
    BEFORE UPDATE ON orders FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_store_stock_updated_at 
    BEFORE UPDATE ON store_stock FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_billings_updated_at 
    BEFORE UPDATE ON billings FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
```

### Função para controle de estoque com Row Level Security
```sql
CREATE OR REPLACE FUNCTION update_stock_after_sale()
RETURNS TRIGGER AS $
DECLARE
    current_stock NUMERIC;
    stock_record RECORD;
BEGIN
    -- Verificar se há estoque suficiente
    SELECT quantity, reserved_quantity INTO stock_record
    FROM store# Esquema de Banco de Dados - Gestor de Vendas

## Estrutura das Tabelas

### 1. **users** (Usuários do Sistema)
```sql
-- Criar ENUM types primeiro (específico do PostgreSQL)
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'seller');

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'seller'::user_role,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. **customers** (Clientes)
```sql
CREATE TABLE customers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    document VARCHAR(20), -- CPF/CNPJ
    address JSONB, -- Estrutura flexível para endereço completo
    city VARCHAR(100),
    state VARCHAR(2),
    zip_code VARCHAR(10),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice GIN para busca no JSONB
CREATE INDEX idx_customers_address_gin ON customers USING GIN (address);
```

### 3. **products** (Produtos)
```sql
CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sku VARCHAR(50) UNIQUE NOT NULL,
    barcode VARCHAR(50),
    category VARCHAR(100),
    brand VARCHAR(100),
    unit VARCHAR(20) DEFAULT 'un', -- un, kg, m, l, etc.
    specifications JSONB, -- Dados técnicos flexíveis
    images TEXT[], -- Array de URLs das imagens
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices específicos do PostgreSQL
CREATE INDEX idx_products_name_gin ON products USING GIN (to_tsvector('portuguese', name));
CREATE INDEX idx_products_specifications_gin ON products USING GIN (specifications);
CREATE INDEX idx_products_category ON products (category) WHERE active = TRUE;
```

### 4. **product_prices** (Preços dos Produtos)
```sql
CREATE TYPE price_type AS ENUM ('cost', 'sale', 'wholesale', 'promotional');

CREATE TABLE product_prices (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL,
    price_type price_type NOT NULL,
    price NUMERIC(10,2) NOT NULL, -- NUMERIC é mais preciso que DECIMAL no Postgres
    valid_from DATE NOT NULL,
    valid_to DATE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    -- Constraint para garantir que não há sobreposição de datas para o mesmo tipo
    EXCLUDE USING gist (
        product_id WITH =,
        price_type WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
    ) WHERE (active = TRUE)
);
```

### 5. **store_stock** (Estoque)
```sql
CREATE TABLE store_stock (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL,
    quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
    reserved_quantity NUMERIC(10,3) NOT NULL DEFAULT 0, -- Qtd reservada em pedidos
    min_stock NUMERIC(10,3) DEFAULT 0, -- Estoque mínimo
    max_stock NUMERIC(10,3) DEFAULT 0, -- Estoque máximo
    location VARCHAR(50), -- Localização no estoque
    last_movement_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id),
    -- Check constraints específicos do PostgreSQL
    CONSTRAINT check_positive_quantity CHECK (quantity >= 0),
    CONSTRAINT check_positive_reserved CHECK (reserved_quantity >= 0),
    CONSTRAINT check_reserved_not_greater_than_total CHECK (reserved_quantity <= quantity)
);
```

### 6. **orders** (Pedidos/Vendas)
```sql
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');
CREATE TYPE payment_method AS ENUM ('cash', 'credit_card', 'debit_card', 'pix', 'bank_transfer', 'installment');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'partial', 'overdue', 'cancelled');

CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL DEFAULT 'ORD-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(nextval('order_seq')::TEXT, 6, '0'),
    customer_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL, -- Vendedor responsável
    status order_status DEFAULT 'pending'::order_status,
    order_date TIMESTAMPTZ DEFAULT NOW(),
    delivery_date DATE,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount NUMERIC(12,2) DEFAULT 0,
    tax NUMERIC(12,2) DEFAULT 0,
    shipping NUMERIC(12,2) DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method payment_method,
    payment_status payment_status DEFAULT 'pending'::payment_status,
    metadata JSONB, -- Dados extras flexíveis
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    -- Check constraints
    CONSTRAINT check_positive_subtotal CHECK (subtotal >= 0),
    CONSTRAINT check_positive_total CHECK (total >= 0)
);

-- Sequência para numeração automática
CREATE SEQUENCE order_seq START 1;

-- Índices otimizados
CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date DESC);
CREATE INDEX idx_orders_user_date ON orders (user_id, order_date DESC);
CREATE INDEX idx_orders_status_date ON orders (status, order_date DESC);
CREATE INDEX idx_orders_metadata_gin ON orders USING GIN (metadata);
```

### 7. **order_items** (Itens do Pedido)
```sql
CREATE TABLE order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity NUMERIC(10,3) NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    discount NUMERIC(10,2) DEFAULT 0,
    total NUMERIC(12,2) NOT NULL,
    product_snapshot JSONB, -- Snapshot dos dados do produto no momento da venda
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT check_positive_quantity CHECK (quantity > 0),
    CONSTRAINT check_positive_unit_price CHECK (unit_price >= 0),
    CONSTRAINT check_positive_total CHECK (total >= 0)
);

-- Índice composto otimizado
CREATE INDEX idx_order_items_order_product ON order_items (order_id, product_id);
```

### 8. **billings** (Faturamento)
```sql
CREATE TYPE billing_status AS ENUM ('pending', 'paid', 'partial', 'overdue', 'cancelled');

CREATE TABLE billings (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL,
    invoice_number VARCHAR(50) UNIQUE NOT NULL DEFAULT 'INV-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(nextval('invoice_seq')::TEXT, 6, '0'),
    issue_date TIMESTAMPTZ DEFAULT NOW(),
    due_date DATE,
    total_amount NUMERIC(12,2) NOT NULL,
    paid_amount NUMERIC(12,2) DEFAULT 0,
    status billing_status DEFAULT 'pending'::billing_status,
    payment_date TIMESTAMPTZ,
    payment_details JSONB, -- Detalhes do pagamento
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT check_positive_amounts CHECK (total_amount >= 0 AND paid_amount >= 0),
    CONSTRAINT check_paid_not_exceeds_total CHECK (paid_amount <= total_amount)
);

-- Sequência para numeração automática de faturas
CREATE SEQUENCE invoice_seq START 1;

-- Índices otimizados para relatórios
CREATE INDEX idx_billings_status_due ON billings (status, due_date) WHERE status IN ('pending', 'partial', 'overdue');
CREATE INDEX idx_billings_issue_date ON billings (issue_date DESC);
```

### 9. **stock_movements** (Movimentações de Estoque)
```sql
CREATE TYPE movement_type AS ENUM ('in', 'out', 'adjustment', 'return', 'transfer');
CREATE TYPE reference_type AS ENUM ('purchase', 'sale', 'adjustment', 'return', 'initial', 'transfer');

CREATE TABLE stock_movements (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL,
    movement_type movement_type NOT NULL,
    quantity NUMERIC(10,3) NOT NULL,
    reference_type reference_type,
    reference_id BIGINT, -- ID da ordem, compra, etc.
    previous_quantity NUMERIC(10,3) NOT NULL,
    new_quantity NUMERIC(10,3) NOT NULL,
    cost NUMERIC(10,2),
    user_id BIGINT,
    reason TEXT,
    movement_date TIMESTAMPTZ DEFAULT NOW(),
    batch_id UUID DEFAULT gen_random_uuid(), -- Para agrupar movimentações relacionadas
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Índices otimizados para consultas temporais
CREATE INDEX idx_stock_movements_product_date ON stock_movements (product_id, movement_date DESC);
CREATE INDEX idx_stock_movements_batch ON stock_movements (batch_id);
CREATE INDEX idx_stock_movements_reference ON stock_movements (reference_type, reference_id);
```

## Relacionamentos Principais

1. **users** ↔ **orders** (n:1) - Um usuário pode ter várias vendas
2. **customers** ↔ **orders** (1:n) - Um cliente pode ter várias vendas
3. **orders** ↔ **order_items** (1:n) - Uma venda tem vários itens
4. **products** ↔ **order_items** (1:n) - Um produto pode estar em várias vendas
5. **products** ↔ **store_stock** (1:1) - Cada produto tem um registro de estoque
6. **products** ↔ **product_prices** (1:n) - Um produto pode ter vários preços
7. **orders** ↔ **billings** (1:1) - Cada venda gera um faturamento

## Índices Recomendados

```sql
-- Índices para performance (específicos do PostgreSQL)
CREATE INDEX CONCURRENTLY idx_orders_customer_id ON orders(customer_id);
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);
CREATE INDEX CONCURRENTLY idx_orders_date ON orders(order_date DESC);
CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status) WHERE status != 'delivered';
CREATE INDEX CONCURRENTLY idx_order_items_order_id ON order_items(order_id);
CREATE INDEX CONCURRENTLY idx_order_items_product_id ON order_items(product_id);
CREATE INDEX CONCURRENTLY idx_billings_order_id ON billings(order_id);
CREATE INDEX CONCURRENTLY idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX CONCURRENTLY idx_product_prices_product_id ON product_prices(product_id);
CREATE INDEX CONCURRENTLY idx_customers_document ON customers(document) WHERE document IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_products_sku ON products(sku);

-- Índices de texto completo em português
CREATE INDEX CONCURRENTLY idx_customers_name_fts ON customers 
  USING GIN (to_tsvector('portuguese', name));
CREATE INDEX CONCURRENTLY idx_products_name_fts ON products 
  USING GIN (to_tsvector('portuguese', name || ' ' || COALESCE(description, '')));

-- Índices para relatórios por período
CREATE INDEX CONCURRENTLY idx_orders_period_stats ON orders (
  DATE_TRUNC('month', order_date), status
) WHERE status IN ('confirmed', 'delivered');
```

## Views Úteis para Relatórios

### Vendas com Detalhes
```sql
CREATE VIEW sales_details AS
SELECT 
    o.id as order_id,
    o.order_number,
    o.order_date,
    c.name as customer_name,
    c.document as customer_document,
    u.name as seller_name,
    o.status,
    o.total,
    o.payment_status,
    o.payment_method,
    COUNT(oi.id) as items_count,
    o.metadata
FROM orders o
JOIN customers c ON o.customer_id = c.id
JOIN users u ON o.user_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id, c.name, c.document, u.name;
```

### Estoque Atual com Alertas
```sql
CREATE VIEW current_stock AS
SELECT 
    p.id as product_id,
    p.name as product_name,
    p.sku,
    p.category,
    s.quantity,
    s.reserved_quantity,
    (s.quantity - s.reserved_quantity) as available_quantity,
    s.min_stock,
    s.max_stock,
    s.location,
    CASE 
        WHEN s.quantity <= 0 THEN 'OUT_OF_STOCK'
        WHEN s.quantity <= s.min_stock THEN 'LOW_STOCK'
        WHEN s.quantity >= s.max_stock THEN 'OVERSTOCK'
        ELSE 'OK'
    END as stock_status,
    s.last_movement_at
FROM products p
LEFT JOIN store_stock s ON p.id = s.product_id
WHERE p.active = TRUE;
```

### Top Produtos por Vendas
```sql
CREATE VIEW top_selling_products AS
SELECT 
    p.id as product_id,
    p.name as product_name,
    p.sku,
    SUM(oi.quantity) as total_sold,
    SUM(oi.total) as total_revenue,
    COUNT(DISTINCT oi.order_id) as order_count,
    AVG(oi.unit_price) as avg_price
FROM products p
JOIN order_items oi ON p.id = oi.product_id
JOIN orders o ON oi.order_id = o.id
WHERE o.status IN ('confirmed', 'delivered')
  AND o.order_date >= NOW() - INTERVAL '30 days'
GROUP BY p.id, p.name, p.sku
ORDER BY total_revenue DESC;
```

### Dashboard de Vendas (função específica do PostgreSQL)
```sql
CREATE OR REPLACE FUNCTION sales_dashboard(
    start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
    end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    period_sales NUMERIC,
    period_orders INTEGER,
    avg_order_value NUMERIC,
    top_customer TEXT,
    top_seller TEXT,
    low_stock_alerts INTEGER
) AS $
BEGIN
    RETURN QUERY
    WITH sales_data AS (
        SELECT 
            SUM(o.total) as total_sales,
            COUNT(o.id) as total_orders,
            AVG(o.total) as avg_value
        FROM orders o 
        WHERE o.order_date::date BETWEEN start_date AND end_date
          AND o.status IN ('confirmed', 'delivered')
    ),
    top_customer_data AS (
        SELECT c.name
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.order_date::date BETWEEN start_date AND end_date
        GROUP BY c.id, c.name
        ORDER BY SUM(o.total) DESC
        LIMIT 1
    ),
    top_seller_data AS (
        SELECT u.name
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.order_date::date BETWEEN start_date AND end_date
        GROUP BY u.id, u.name
        ORDER BY SUM(o.total) DESC
        LIMIT 1
    ),
    stock_alerts AS (
        SELECT COUNT(*) as alerts
        FROM current_stock
        WHERE stock_status IN ('LOW_STOCK', 'OUT_OF_STOCK')
    )
    SELECT 
        COALESCE(sd.total_sales, 0),
        COALESCE(sd.total_orders, 0),
        COALESCE(sd.avg_value, 0),
        COALESCE(tcd.name, 'N/A'),
        COALESCE(tsd.name, 'N/A'),
        COALESCE(sa.alerts, 0)
    FROM sales_data sd
    CROSS JOIN top_customer_data tcd
    CROSS JOIN top_seller_data tsd
    CROSS JOIN stock_alerts sa;
END;
$ LANGUAGE plpgsql;
```

## Recursos Avançados do PostgreSQL

### 1. **Particionamento por Data (para tabelas grandes)**
```sql
-- Particionar tabela de movimentações por mês
CREATE TABLE stock_movements_partitioned (
    LIKE stock_movements INCLUDING ALL
) PARTITION BY RANGE (movement_date);

-- Criar partições para os próximos meses
CREATE TABLE stock_movements_2025_06 
    PARTITION OF stock_movements_partitioned
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE stock_movements_2025_07 
    PARTITION OF stock_movements_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
```

### 2. **Row Level Security (RLS) para controle de acesso**
```sql
-- Habilitar RLS na tabela de pedidos
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Política: usuários só veem seus próprios pedidos (exceto admins)
CREATE POLICY orders_user_policy ON orders
    FOR ALL TO PUBLIC
    USING (
        user_id = current_user_id() OR 
        current_user_role() = 'admin'
    );

-- Função auxiliar para obter usuário atual
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS BIGINT AS $
BEGIN
    -- Implementar lógica para obter ID do usuário da sessão
    -- Pode usar variáveis de sessão configuradas pela aplicação
    RETURN COALESCE(
        current_setting('app.current_user_id', true)::BIGINT,
        0
    );
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $
BEGIN
    RETURN COALESCE(
        current_setting('app.current_user_role', true),
        'seller'
    );
END;
$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3. **Funções de Agregação Personalizadas**
```sql
-- Função para calcular margem de lucro
CREATE OR REPLACE FUNCTION calculate_profit_margin(
    sale_price NUMERIC,
    cost_price NUMERIC
) RETURNS NUMERIC AS $
BEGIN
    IF cost_price = 0 OR cost_price IS NULL THEN
        RETURN NULL;
    END IF;
    
    RETURN ROUND(((sale_price - cost_price) / cost_price) * 100, 2);
END;
$ LANGUAGE plpgsql IMMUTABLE;

-- View com análise de margem
CREATE VIEW product_profitability AS
SELECT 
    p.id,
    p.name,
    p.sku,
    cost_prices.price as cost_price,
    sale_prices.price as sale_price,
    calculate_profit_margin(sale_prices.price, cost_prices.price) as margin_percent,
    (sale_prices.price - cost_prices.price) as profit_amount
FROM products p
LEFT JOIN (
    SELECT DISTINCT ON (product_id) 
        product_id, price 
    FROM product_prices 
    WHERE price_type = 'cost' AND active = TRUE
    ORDER BY product_id, valid_from DESC
) cost_prices ON p.id = cost_prices.product_id
LEFT JOIN (
    SELECT DISTINCT ON (product_id) 
        product_id, price 
    FROM product_prices 
    WHERE price_type = 'sale' AND active = TRUE
    ORDER BY product_id, valid_from DESC
) sale_prices ON p.id = sale_prices.product_id
WHERE p.active = TRUE;
```

### 4. **Notificações automáticas (LISTEN/NOTIFY)**
```sql
-- Função para notificar baixo estoque
CREATE OR REPLACE FUNCTION notify_low_stock()
RETURNS TRIGGER AS $
BEGIN
    IF NEW.quantity <= NEW.min_stock AND NEW.quantity > 0 THEN
        PERFORM pg_notify(
            'low_stock_alert',
            json_build_object(
                'product_id', NEW.product_id,
                'current_stock', NEW.quantity,
                'min_stock', NEW.min_stock,
                'timestamp', NOW()
            )::text
        );
    ELSIF NEW.quantity = 0 THEN
        PERFORM pg_notify(
            'out_of_stock_alert',
            json_build_object(
                'product_id', NEW.product_id,
                'timestamp', NOW()
            )::text
        );
    END IF;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_stock_alerts
    AFTER UPDATE ON store_stock
    FOR EACH ROW EXECUTE FUNCTION notify_low_stock();
```

### 5. **Backup e Manutenção automatizada**
```sql
-- Função para limpar dados antigos (executar via cron)
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS VOID AS $
BEGIN
    -- Mover movimentações antigas para tabela de arquivo
    INSERT INTO stock_movements_archive 
    SELECT * FROM stock_movements 
    WHERE movement_date < NOW() - INTERVAL '2 years';
    
    -- Deletar movimentações arquivadas
    DELETE FROM stock_movements 
    WHERE movement_date < NOW() - INTERVAL '2 years';
    
    -- Log da operação
    INSERT INTO system_logs (action, description, created_at)
    VALUES ('cleanup', 'Limpeza automática de dados antigos', NOW());
    
    -- Atualizar estatísticas das tabelas
    ANALYZE stock_movements;
    ANALYZE orders;
    ANALYZE order_items;
END;
$ LANGUAGE plpgsql;
```

## Considerações Específicas do PostgreSQL

### **Melhorias implementadas:**

1. **Tipos ENUM customizados** - Mais eficientes que VARCHAR com CHECK constraints
2. **TIMESTAMPTZ** - Timestamps com timezone para aplicações globais
3. **NUMERIC** em vez de DECIMAL - Maior precisão para valores monetários
4. **JSONB** - Armazenamento flexível e indexável para dados semi-estruturados
5. **Arrays** - Para listas simples como URLs de imagens
6. **UUID** - Para IDs únicos distribuídos
7. **Índices GIN** - Para busca full-text e consultas em JSONB
8. **EXCLUDE constraints** - Para evitar sobreposição de períodos de preços
9. **Sequences** - Para numeração automática personalizada
10. **Row Level Security** - Controle de acesso granular
11. **Particionamento** - Para tabelas que crescem muito
12. **LISTEN/NOTIFY** - Para notificações em tempo real
13. **Funções PL/pgSQL** - Lógica complexa no banco
14. **Views materializadas** (opcional) - Para relatórios pesados

### **Configurações recomendadas no postgresql.conf:**

```sql
-- Para melhor performance
shared_buffers = 256MB                    -- 25% da RAM
effective_cache_size = 1GB                -- 75% da RAM
random_page_cost = 1.1                    -- Para SSDs
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100

-- Para aplicações brasileiras
timezone = 'America/Sao_Paulo'
lc_monetary = 'pt_BR.UTF-8'
lc_numeric = 'pt_BR.UTF-8'
```

### **Extensões úteis para instalar:**
```sql
-- Para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Para busca full-text avançada
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Para funções de agregação adicionais
CREATE EXTENSION IF NOT EXISTS "tablefunc";

-- Para criptografia (senhas)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### **Scripts de manutenção:**
```sql
-- Vacuum automático otimizado
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.1;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.05;

-- Para reindexar periodicamente
REINDEX INDEX CONCURRENTLY idx_orders_date;
REINDEX INDEX CONCURRENTLY idx_stock_movements_product_date;
```

Este esquema otimizado para PostgreSQL oferece:
- **Performance superior** com índices específicos
- **Integridade garantida** com constraints e triggers
- **Flexibilidade** com JSONB para dados dinâmicos  
- **Escalabilidade** com particionamento
- **Segurança** com RLS e criptografia
- **Monitoramento** com notificações automáticas
- **Facilidade de manutenção** com funções automatizadas
export const schemaSql = `
-- Schema Definition for Ticket Selling System

CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ticket_types (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    price NUMERIC(12, 2) NOT NULL,
    total_quota INT NOT NULL CHECK (total_quota >= 0),
    reserved_quota INT NOT NULL DEFAULT 0 CHECK (reserved_quota >= 0),
    sold_quota INT NOT NULL DEFAULT 0 CHECK (sold_quota >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_total_quota CHECK (reserved_quota + sold_quota <= total_quota)
);

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    event_id VARCHAR(36) NOT NULL REFERENCES events(id),
    total_amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'EXPIRED')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    ticket_type_id VARCHAR(36) NOT NULL REFERENCES ticket_types(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    price_per_unit NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL REFERENCES orders(id),
    ticket_type_id VARCHAR(36) NOT NULL REFERENCES ticket_types(id),
    ticket_code VARCHAR(100) UNIQUE NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_webhooks (
    id VARCHAR(36) PRIMARY KEY,
    payment_reference VARCHAR(100) UNIQUE NOT NULL,
    order_id VARCHAR(36) NOT NULL REFERENCES orders(id),
    amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    raw_payload JSONB,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for optimal query and lock performance
CREATE INDEX IF NOT EXISTS idx_orders_user_event ON orders(user_id, event_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_expires_at ON orders(expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_code ON tickets(ticket_code);
`;

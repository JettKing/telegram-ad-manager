-- Multi-currency asset metadata. Historical monetary values remain CNY at scale 2.
ALTER TABLE ad_packages ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE ad_packages ADD COLUMN currency_scale INTEGER NOT NULL DEFAULT 2 CHECK (currency_scale BETWEEN 0 AND 12);
ALTER TABLE ad_packages ADD COLUMN network TEXT;
ALTER TABLE ad_orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE ad_orders ADD COLUMN currency_scale INTEGER NOT NULL DEFAULT 2 CHECK (currency_scale BETWEEN 0 AND 12);
ALTER TABLE ad_orders ADD COLUMN network TEXT;
ALTER TABLE ad_order_payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE ad_order_payments ADD COLUMN amount_scale INTEGER NOT NULL DEFAULT 2 CHECK (amount_scale BETWEEN 0 AND 12);
ALTER TABLE ad_order_payments ADD COLUMN network TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE ad_order_refunds ADD COLUMN amount_scale INTEGER NOT NULL DEFAULT 2 CHECK (amount_scale BETWEEN 0 AND 12);
ALTER TABLE ad_order_refunds ADD COLUMN network TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN actual_amount_minor INTEGER;
ALTER TABLE ad_order_refunds ADD COLUMN actual_currency TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN actual_network TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN payment_id TEXT REFERENCES ad_order_payments(id);
CREATE INDEX idx_order_refunds_payment ON ad_order_refunds(payment_id, status);
ALTER TABLE financial_transactions ADD COLUMN amount_scale INTEGER NOT NULL DEFAULT 2 CHECK (amount_scale BETWEEN 0 AND 12);
ALTER TABLE financial_transactions ADD COLUMN network TEXT;

UPDATE ad_order_payments SET currency = COALESCE((SELECT currency FROM ad_orders WHERE id = ad_order_payments.order_id), 'CNY');
UPDATE ad_order_refunds
SET currency = COALESCE((SELECT currency FROM ad_orders WHERE id = ad_order_refunds.order_id), 'CNY'),
    amount_scale = COALESCE((SELECT currency_scale FROM ad_orders WHERE id = ad_order_refunds.order_id), 2),
    network = (SELECT network FROM ad_orders WHERE id = ad_order_refunds.order_id);

-- Multi-currency assets and chain-aware manual finance. Existing rows remain CNY at scale 2.
ALTER TABLE ad_packages ADD COLUMN currency_scale INTEGER NOT NULL DEFAULT 2 CHECK (currency_scale BETWEEN 0 AND 12);
ALTER TABLE ad_packages ADD COLUMN network TEXT;
ALTER TABLE ad_orders ADD COLUMN currency_scale INTEGER NOT NULL DEFAULT 2 CHECK (currency_scale BETWEEN 0 AND 12);
ALTER TABLE ad_orders ADD COLUMN network TEXT;
ALTER TABLE payment_submissions ADD COLUMN amount_scale INTEGER NOT NULL DEFAULT 2 CHECK (amount_scale BETWEEN 0 AND 12);
ALTER TABLE payment_submissions ADD COLUMN network TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE ad_order_refunds ADD COLUMN amount_scale INTEGER NOT NULL DEFAULT 2 CHECK (amount_scale BETWEEN 0 AND 12);
ALTER TABLE ad_order_refunds ADD COLUMN network TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN actual_amount_minor INTEGER;
ALTER TABLE ad_order_refunds ADD COLUMN actual_currency TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN actual_network TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN payment_submission_id TEXT REFERENCES payment_submissions(id);
CREATE INDEX idx_order_refunds_payment_submission ON ad_order_refunds(payment_submission_id, status);
ALTER TABLE financial_ledger_entries ADD COLUMN amount_scale INTEGER NOT NULL DEFAULT 2 CHECK (amount_scale BETWEEN 0 AND 12);
ALTER TABLE financial_ledger_entries ADD COLUMN network TEXT;

-- Snapshot the order's asset on historic refund records without rewriting financial history.
UPDATE ad_order_refunds
SET currency = COALESCE((SELECT o.currency FROM ad_orders o WHERE o.id = ad_order_refunds.order_id), 'CNY'),
    amount_scale = COALESCE((SELECT o.currency_scale FROM ad_orders o WHERE o.id = ad_order_refunds.order_id), 2),
    network = (SELECT o.network FROM ad_orders o WHERE o.id = ad_order_refunds.order_id);
UPDATE ad_order_refunds
SET actual_amount_minor = amount_minor,
    actual_currency = currency,
    actual_network = network
WHERE disbursed_at IS NOT NULL AND disbursement_legacy_inferred = 0;

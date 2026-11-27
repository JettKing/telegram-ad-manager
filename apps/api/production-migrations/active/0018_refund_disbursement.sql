-- Separate refund approval from actual cash disbursement and accounting.
ALTER TABLE ad_order_refunds ADD COLUMN idempotency_key TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN disbursed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ad_order_refunds ADD COLUMN disbursed_at TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN disbursement_method TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN disbursement_transaction_ref TEXT;
ALTER TABLE ad_order_refunds ADD COLUMN disbursement_legacy_inferred INTEGER NOT NULL DEFAULT 0 CHECK (disbursement_legacy_inferred IN (0, 1));

-- Older production code created random-ID refund ledger debits as part of approval. The old ledger
-- did not retain refund_id, so link only an unambiguous order/amount/reviewer/timestamp match.
-- Every pre-migration approved refund requires human bank-statement reconciliation: an accounting
-- debit at approval time is not proof that money was actually transferred.
UPDATE ad_order_refunds
SET disbursement_legacy_inferred = 1
WHERE status = 'approved';

UPDATE ad_order_refunds
SET disbursed_by = reviewed_by,
    disbursed_at = (SELECT l.created_at FROM financial_ledger_entries l
      WHERE l.order_id = ad_order_refunds.order_id AND l.amount_minor = ad_order_refunds.amount_minor
        AND l.entry_type = 'refund' AND l.reason = 'refund_approved'
        AND l.created_at = ad_order_refunds.reviewed_at AND l.actor_user_id IS ad_order_refunds.reviewed_by LIMIT 1),
    disbursement_method = 'other',
    disbursement_transaction_ref = NULL
WHERE status = 'approved' AND reviewed_at IS NOT NULL
  AND (SELECT COUNT(*) FROM financial_ledger_entries l
    WHERE l.order_id = ad_order_refunds.order_id AND l.amount_minor = ad_order_refunds.amount_minor
      AND l.entry_type = 'refund' AND l.reason = 'refund_approved'
      AND l.created_at = ad_order_refunds.reviewed_at AND l.actor_user_id IS ad_order_refunds.reviewed_by) = 1
  AND (SELECT COUNT(*) FROM ad_order_refunds other
    WHERE other.order_id = ad_order_refunds.order_id AND other.amount_minor = ad_order_refunds.amount_minor
      AND other.status = 'approved' AND other.reviewed_at = ad_order_refunds.reviewed_at
      AND other.reviewed_by IS ad_order_refunds.reviewed_by) = 1;

CREATE INDEX IF NOT EXISTS idx_order_refunds_disbursement ON ad_order_refunds(tenant_id, workspace_id, status, disbursed_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refunds_disbursement_ref_unique
  ON ad_order_refunds(tenant_id, workspace_id, disbursement_transaction_ref)
  WHERE disbursement_transaction_ref IS NOT NULL AND TRIM(disbursement_transaction_ref) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_request_idempotency
  ON payment_submissions(tenant_id, workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_order_refunds_request_idempotency
  ON ad_order_refunds(tenant_id, workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

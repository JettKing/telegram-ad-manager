-- TG Ad Manager V1.1 / Migration 0010
-- Scheduling, publish queue claiming and expiration indexes.

CREATE INDEX IF NOT EXISTS idx_schedules_tenant_planned ON ad_schedules(tenant_id, planned_at, cancelled_at);
CREATE INDEX IF NOT EXISTS idx_publish_tasks_claim ON ad_publish_tasks(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_publish_tasks_order ON ad_publish_tasks(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_publish_logs_task_result ON ad_publish_logs(task_id, result, executed_at);
CREATE INDEX IF NOT EXISTS idx_orders_expiration ON ad_orders(status, planned_end_at);

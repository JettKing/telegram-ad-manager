import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./business.js";
import type { Role } from "./identity.js";

const roles = new Set<Role>(["owner", "admin", "manager", "editor", "finance", "viewer"]);
const statuses = new Set(["active", "suspended"]);
async function all<T>(db: D1Like, query: string, ...values: unknown[]): Promise<T[]> { const prepared = db.prepare(query).bind(...values); return prepared.all ? (await prepared.all<T>()).results : []; }
type Scope = { tenantId: string; workspaceId: string };
export type WorkspaceMember = { userId: string; telegramUserId: string; username?: string; displayName: string; role: Role; status: string; joinedAt: string; lastSeenAt?: string };
export type AuditLog = { id: string; actorUserId?: string; actorDisplayName?: string; action: string; entityType: string; entityId: string; beforeSummary?: string; afterSummary?: string; source: string; result: string; createdAt: string };

export async function writeProductionAudit(db: D1Like, input: { tenantId: string; workspaceId: string; actorUserId?: string; action: string; entityType: string; entityId: string; before?: Record<string, unknown>; after?: Record<string, unknown>; source?: string; result?: string; createdAt: string }): Promise<void> {
  await db.prepare("INSERT INTO audit_logs (id, tenant_id, workspace_id, actor_user_id, actor_type, action, object_type, object_id, before_summary, after_summary, source, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), input.tenantId, input.workspaceId, input.actorUserId ?? null, input.actorUserId ? "user" : "system", input.action, input.entityType, input.entityId, input.before ? JSON.stringify(input.before) : null, input.after ? JSON.stringify(input.after) : null, input.source ?? "admin", input.result ?? "success", input.createdAt).run();
}

export class ProductionAdminRepository {
  constructor(private readonly db: D1Like) {}

  async listMembers(scope: Scope): Promise<WorkspaceMember[]> {
    return all<WorkspaceMember>(this.db, `SELECT u.id AS userId, u.telegram_user_id AS telegramUserId, u.telegram_username AS username, u.display_name AS displayName, wm.role, wm.status, wm.created_at AS joinedAt, (SELECT MAX(last_seen_at) FROM user_sessions us WHERE us.user_id = u.id AND us.tenant_id = wm.tenant_id) AS lastSeenAt FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.tenant_id = ? AND wm.workspace_id = ? ORDER BY wm.created_at ASC`, scope.tenantId, scope.workspaceId);
  }

  async updateMember(scope: Scope, actorUserId: string, actorRole: Role, userId: string, role: Role | undefined, status: "active" | "suspended" | undefined, now: string): Promise<{ updated: boolean; before: { role: Role; status: string }; after: { role: Role; status: string } }> {
    if (userId === actorUserId && status === "suspended") throw new BusinessValidationError("SELF_SUSPENSION_FORBIDDEN", "不能暂停当前登录成员");
    if (role !== undefined && !roles.has(role)) throw new BusinessValidationError("INVALID_MEMBER_ROLE", "成员角色不合法");
    if (status !== undefined && !statuses.has(status)) throw new BusinessValidationError("INVALID_MEMBER_STATUS", "成员状态不合法");
    const current = await this.db.prepare("SELECT role, status FROM workspace_members WHERE tenant_id = ? AND workspace_id = ? AND user_id = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, userId).first<{ role: Role; status: string }>();
    if (!current) throw new BusinessValidationError("MEMBER_NOT_FOUND", "成员不存在或不属于当前工作空间");
    if (current.role === "owner" && role !== undefined && role !== "owner") throw new BusinessValidationError("OWNER_ROLE_PROTECTED", "不能直接降级工作空间 owner");
    if (role === "owner" && current.role !== "owner" && actorRole !== "owner") throw new BusinessValidationError("OWNER_GRANT_FORBIDDEN", "只有当前工作空间 owner 可以授予 owner 角色");

    if (current.role === "owner" && current.status === "active" && status === "suspended") {
      const anotherActiveOwner = await this.db.prepare("SELECT user_id FROM workspace_members WHERE tenant_id = ? AND workspace_id = ? AND role = 'owner' AND status = 'active' AND user_id <> ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, userId).first<{ user_id: string }>();
      if (!anotherActiveOwner) throw new BusinessValidationError("LAST_ACTIVE_OWNER_REQUIRED", "不能暂停工作空间最后一位有效 owner");
    }

    const result = await this.db.prepare(`UPDATE workspace_members SET role = COALESCE(?, role), status = COALESCE(?, status), updated_at = ?
      WHERE tenant_id = ? AND workspace_id = ? AND user_id = ?
        AND (COALESCE(?, status) <> 'suspended' OR role <> 'owner' OR EXISTS (
          SELECT 1 FROM workspace_members other WHERE other.tenant_id = workspace_members.tenant_id AND other.workspace_id = workspace_members.workspace_id
            AND other.role = 'owner' AND other.status = 'active' AND other.user_id <> workspace_members.user_id))
        AND (COALESCE(?, '') <> 'owner' OR role = 'owner' OR EXISTS (
          SELECT 1 FROM workspace_members actor WHERE actor.tenant_id = workspace_members.tenant_id AND actor.workspace_id = workspace_members.workspace_id
            AND actor.user_id = ? AND actor.role = 'owner' AND actor.status = 'active'))`)
      .bind(role ?? null, status ?? null, now, scope.tenantId, scope.workspaceId, userId, status ?? null, role ?? null, actorUserId).run();
    if ((result.meta?.changes ?? 0) === 0) {
      if (role === "owner" && current.role !== "owner") {
        const actorOwner = await this.db.prepare("SELECT user_id FROM workspace_members WHERE tenant_id = ? AND workspace_id = ? AND user_id = ? AND role = 'owner' AND status = 'active' LIMIT 1").bind(scope.tenantId, scope.workspaceId, actorUserId).first<{ user_id: string }>();
        if (!actorOwner) throw new BusinessValidationError("OWNER_GRANT_FORBIDDEN", "只有当前工作空间有效 owner 可以授予 owner 角色");
      }
      throw new BusinessValidationError("LAST_ACTIVE_OWNER_REQUIRED", "不能暂停工作空间最后一位有效 owner");
    }
    const after = { role: role ?? current.role, status: status ?? current.status };
    return { updated: true, before: current, after };
  }

  async removeMember(scope: Scope, userId: string, now: string): Promise<{ removed: boolean; before: { role: Role; status: string } }> {
    const current = await this.db.prepare("SELECT role, status FROM workspace_members WHERE tenant_id = ? AND workspace_id = ? AND user_id = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, userId).first<{ role: Role; status: string }>();
    if (!current) throw new BusinessValidationError("MEMBER_NOT_FOUND", "成员不存在或不属于当前工作空间");
    if (current.role === "owner") throw new BusinessValidationError("OWNER_MEMBER_PROTECTED", "不能移除工作空间 owner");
    const result = await this.db.prepare("UPDATE workspace_members SET status = 'suspended', updated_at = ? WHERE tenant_id = ? AND workspace_id = ? AND user_id = ? AND status <> 'suspended' AND role <> 'owner'").bind(now, scope.tenantId, scope.workspaceId, userId).run();
    if ((result.meta?.changes ?? 0) > 0) return { removed: true, before: current };
    const latest = await this.db.prepare("SELECT role, status FROM workspace_members WHERE tenant_id = ? AND workspace_id = ? AND user_id = ? LIMIT 1").bind(scope.tenantId, scope.workspaceId, userId).first<{ role: Role; status: string }>();
    if (!latest) throw new BusinessValidationError("MEMBER_NOT_FOUND", "成员不存在或不属于当前工作空间");
    if (latest.role === "owner") throw new BusinessValidationError("OWNER_MEMBER_PROTECTED", "成员已成为工作空间 owner，不能移除");
    return { removed: false, before: latest };
  }

  async listAudit(scope: Scope, limit = 100): Promise<AuditLog[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
    return all<AuditLog>(this.db, `SELECT al.id, al.actor_user_id AS actorUserId, u.display_name AS actorDisplayName, al.action, al.object_type AS entityType, al.object_id AS entityId, al.before_summary AS beforeSummary, al.after_summary AS afterSummary, al.source, al.result, al.created_at AS createdAt FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id WHERE al.tenant_id = ? AND al.workspace_id = ? ORDER BY al.created_at DESC LIMIT ${safeLimit}`, scope.tenantId, scope.workspaceId);
  }
}

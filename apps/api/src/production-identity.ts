import type { TelegramUser, D1Like } from "@tg-ad-manager/telegram";
import type { IdentityContext, ProvisionedIdentity, Role } from "./identity.js";
import { BusinessValidationError } from "./errors.js";

interface UserRow { id: string; telegram_user_id: string; display_name: string; is_active: number }
interface MembershipRow { tenant_id: string; tenant_name: string; tenant_slug: string; role: Role }
interface WorkspaceRow { id: string; name: string }

function displayNameFor(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || (user.username ? `@${user.username}` : `Telegram ${user.id}`);
}
function slugPart(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "workspace"; }
function toBase64Url(value: string): string { const bytes = new TextEncoder().encode(value); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function fromBase64Url(value: string): string | null { try { const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")); return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))); } catch { return null; } }
function hex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join(""); }
async function hmac(value: string, secret: string): Promise<string> { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret) as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value) as unknown as BufferSource)); }
async function sha256(value: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value) as unknown as BufferSource); return hex(digest); }
function safeEqual(left: string, right: string): boolean { if (left.length !== right.length) return false; let diff = 0; for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i); return diff === 0; }

export async function provisionProductionTelegramIdentity(db: D1Like, user: TelegramUser, now = new Date().toISOString()): Promise<ProvisionedIdentity> {
  const displayName = displayNameFor(user);
  await db.prepare(`INSERT INTO users (id, telegram_user_id, telegram_username, display_name, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT (telegram_user_id) DO UPDATE SET telegram_username = excluded.telegram_username, display_name = excluded.display_name, updated_at = excluded.updated_at WHERE users.is_active = 1`).bind(crypto.randomUUID(), String(user.id), user.username ?? null, displayName, now, now).run();
  const storedUser = await db.prepare("SELECT id, telegram_user_id, display_name, is_active FROM users WHERE telegram_user_id = ? LIMIT 1").bind(String(user.id)).first<UserRow>();
  if (!storedUser) throw new Error("USER_UPSERT_FAILED");
  if (storedUser.is_active !== 1) throw new BusinessValidationError("USER_SUSPENDED", "此 Telegram 账号已停权，请联系工作空间管理员");
  let membership = await db.prepare(`SELECT tm.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, tm.role FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id WHERE tm.user_id = ? AND tm.status = 'active' AND t.status = 'active' ORDER BY tm.created_at LIMIT 1`).bind(storedUser.id).first<MembershipRow>();
  let workspace: WorkspaceRow | null = null;
  if (!membership) {
    const previousMembership = await db.prepare("SELECT tenant_id FROM tenant_members WHERE user_id = ? LIMIT 1").bind(storedUser.id).first<{ tenant_id: string }>();
    if (previousMembership) throw new BusinessValidationError("NO_ACTIVE_TENANT_MEMBERSHIP", "此账号没有可用的工作空间成员资格，请联系管理员恢复访问");
    const tenantId = crypto.randomUUID(); const workspaceId = crypto.randomUUID(); const tenantName = `${displayName} Workspace`; const nowSlug = `tenant-${slugPart(String(user.id))}-${tenantId.slice(0, 8)}`;
    if (!db.batch) throw new Error("D1_BATCH_NOT_SUPPORTED");
    await db.batch([
      db.prepare("INSERT INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(tenantId, tenantName, nowSlug, now, now),
      db.prepare("INSERT INTO workspaces (id, tenant_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").bind(workspaceId, tenantId, "默认工作空间", `default-${workspaceId.slice(0, 8)}`, now, now),
      db.prepare("INSERT INTO tenant_members (tenant_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)").bind(tenantId, storedUser.id, now, now),
      db.prepare("INSERT INTO workspace_members (workspace_id, tenant_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'active', ?, ?)").bind(workspaceId, tenantId, storedUser.id, now, now),
    ]);
    membership = { tenant_id: tenantId, tenant_name: tenantName, tenant_slug: nowSlug, role: "owner" };
    workspace = { id: workspaceId, name: "默认工作空间" };
  }
  if (!workspace) workspace = await db.prepare(`SELECT w.id, w.name FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.tenant_id = w.tenant_id WHERE w.tenant_id = ? AND w.status = 'active' AND wm.user_id = ? AND wm.status = 'active' ORDER BY w.created_at LIMIT 1`).bind(membership.tenant_id, storedUser.id).first<WorkspaceRow>();
  if (!workspace) throw new BusinessValidationError("NO_ACTIVE_WORKSPACE", "此账号没有可用的工作空间成员资格，请联系管理员恢复访问");
  return { userId: storedUser.id, telegramUserId: storedUser.telegram_user_id, displayName: storedUser.display_name, tenantId: membership.tenant_id, tenantName: membership.tenant_name, workspaceId: workspace.id, workspaceName: workspace.name, role: membership.role };
}

export async function issueProductionPlatformSession(db: D1Like, identity: ProvisionedIdentity, secret: string, ttlSeconds = 86_400, now = new Date()): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  if (!secret.trim()) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
  const sessionId = crypto.randomUUID(); const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString(); const token = `${toBase64Url(sessionId)}.${await hmac(sessionId, secret)}`;
  await db.prepare("INSERT INTO user_sessions (id, user_id, tenant_id, token_hash, expires_at, revoked_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").bind(sessionId, identity.userId, identity.tenantId, await sha256(token), expiresAt, now.toISOString(), now.toISOString()).run();
  return { token, sessionId, expiresAt };
}

export async function readProductionPlatformSession(db: D1Like, token: string | undefined, secret: string, now = new Date()): Promise<IdentityContext | null> {
  if (!token || !secret.trim()) return null; const [encoded, signature] = token.split("."); const sessionId = encoded ? fromBase64Url(encoded) : null; if (!sessionId || !signature || !safeEqual(await hmac(sessionId, secret), signature)) return null;
  const row = await db.prepare(`SELECT us.id AS sessionId, us.expires_at AS expiresAt, u.id AS userId, u.telegram_user_id AS telegramUserId, tm.tenant_id AS tenantId, wm.workspace_id AS workspaceId, wm.role
    FROM user_sessions us JOIN users u ON u.id = us.user_id AND u.is_active = 1 JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = us.tenant_id AND tm.status = 'active'
    JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
    JOIN workspace_members wm ON wm.user_id = u.id AND wm.tenant_id = tm.tenant_id AND wm.status = 'active' JOIN workspaces w ON w.id = wm.workspace_id AND w.status = 'active'
    WHERE us.id = ? AND us.token_hash = ? AND us.revoked_at IS NULL AND us.expires_at > ? LIMIT 1`).bind(sessionId, await sha256(token), now.toISOString()).first<IdentityContext>();
  if (!row) return null; await db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?").bind(now.toISOString(), sessionId).run(); return row;
}

export async function revokeProductionPlatformSession(db: D1Like, sessionId: string, now = new Date()): Promise<void> { await db.prepare("UPDATE user_sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now.toISOString(), now.toISOString(), sessionId).run(); }

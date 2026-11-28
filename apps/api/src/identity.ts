import type { TelegramUser } from "@tg-ad-manager/telegram";
import type { D1Like } from "@tg-ad-manager/telegram";
import { BusinessValidationError } from "./errors.js";

export type Role = "owner" | "admin" | "manager" | "editor" | "finance" | "viewer";
export type Permission =
  | "workspace:read"
  | "workspace:manage"
  | "channel:read"
  | "channel:manage"
  | "customer:read"
  | "customer:write"
  | "order:read"
  | "order:write"
  | "finance:read"
  | "finance:write"
  | "publish:read"
  | "publish:write"
  | "media:read"
  | "media:write"
  | "settings:write";

export interface IdentityContext {
  sessionId: string;
  userId: string;
  telegramUserId: string;
  tenantId: string;
  workspaceId: string;
  role: Role;
  expiresAt: string;
}

export interface ProvisionedIdentity {
  userId: string;
  telegramUserId: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
}

interface UserRow {
  id: string;
  telegram_user_id: string;
  display_name: string;
  is_active: number;
}

interface MembershipRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: Role;
}

interface WorkspaceRow {
  id: string;
  name: string;
}

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set([
    "workspace:read", "workspace:manage", "channel:read", "channel:manage", "customer:read", "customer:write",
    "order:read", "order:write", "finance:read", "finance:write", "publish:read", "publish:write", "media:read", "media:write", "settings:write",
  ]),
  admin: new Set([
    "workspace:read", "workspace:manage", "channel:read", "channel:manage", "customer:read", "customer:write",
    "order:read", "order:write", "finance:read", "finance:write", "publish:read", "publish:write", "media:read", "media:write", "settings:write",
  ]),
  manager: new Set([
    "workspace:read", "channel:read", "channel:manage", "customer:read", "customer:write", "order:read", "order:write",
    "publish:read", "publish:write", "media:read", "media:write",
  ]),
  editor: new Set(["workspace:read", "channel:read", "customer:read", "customer:write", "order:read", "order:write", "publish:read", "publish:write", "media:read", "media:write"]),
  finance: new Set(["workspace:read", "channel:read", "customer:read", "order:read", "finance:read", "finance:write", "media:read"]),
  viewer: new Set(["workspace:read", "channel:read", "customer:read", "order:read", "publish:read", "media:read"]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ["owner", "admin", "manager", "editor", "finance", "viewer"].includes(value);
}

function displayNameFor(user: TelegramUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || (user.username ? `@${user.username}` : `Telegram ${user.id}`);
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "workspace";
}

export async function provisionTelegramIdentity(db: D1Like, user: TelegramUser, now = new Date().toISOString()): Promise<ProvisionedIdentity> {
  const displayName = displayNameFor(user);
  const existingId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO users (id, telegram_user_id, username, display_name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (telegram_user_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, updated_at = excluded.updated_at WHERE users.is_active = 1`,
  ).bind(existingId, String(user.id), user.username ?? null, displayName, now, now).run();

  const storedUser = await db.prepare("SELECT id, telegram_user_id, display_name, is_active FROM users WHERE telegram_user_id = ? LIMIT 1").bind(String(user.id)).first<UserRow>();
  if (!storedUser) throw new Error("USER_UPSERT_FAILED");
  if (storedUser.is_active !== 1) throw new BusinessValidationError("USER_SUSPENDED", "此 Telegram 账号已停权，请联系工作空间管理员");

  let membership = await db.prepare(
    `SELECT tm.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, tm.role
     FROM tenant_members tm JOIN tenants t ON t.id = tm.tenant_id
     WHERE tm.user_id = ? AND tm.status = 'active' AND t.status = 'active'
     ORDER BY tm.created_at LIMIT 1`,
  ).bind(storedUser.id).first<MembershipRow>();

  let workspace: WorkspaceRow | null = null;
  if (!membership) {
    const previousMembership = await db.prepare("SELECT tenant_id FROM tenant_members WHERE user_id = ? LIMIT 1").bind(storedUser.id).first<{ tenant_id: string }>();
    if (previousMembership) throw new BusinessValidationError("NO_ACTIVE_TENANT_MEMBERSHIP", "此账号没有可用的工作空间成员资格，请联系管理员恢复访问");
    const tenantId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const tenantName = `${displayName} Workspace`;
    const tenantSlug = `tenant-${slugPart(String(user.id))}-${tenantId.slice(0, 8)}`;
    const workspaceName = "默认工作空间";
    await db.prepare("INSERT INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(tenantId, tenantName, tenantSlug, now, now).run();
    await db.prepare("INSERT INTO workspaces (id, tenant_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").bind(workspaceId, tenantId, workspaceName, `default-${workspaceId.slice(0, 8)}`, now, now).run();
    await db.prepare("INSERT INTO tenant_members (tenant_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)").bind(tenantId, storedUser.id, now, now).run();
    await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)").bind(workspaceId, storedUser.id, now, now).run();
    membership = { tenant_id: tenantId, tenant_name: tenantName, tenant_slug: tenantSlug, role: "owner" };
    workspace = { id: workspaceId, name: workspaceName };
  }

  if (!workspace) workspace = await db.prepare(
    `SELECT w.id, w.name FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE w.tenant_id = ? AND w.status = 'active' AND wm.user_id = ?
     ORDER BY w.created_at LIMIT 1`,
  ).bind(membership.tenant_id, storedUser.id).first<WorkspaceRow>();

  if (!workspace) throw new BusinessValidationError("NO_ACTIVE_WORKSPACE", "此账号没有可用的工作空间成员资格，请联系管理员恢复访问");

  return {
    userId: storedUser.id,
    telegramUserId: storedUser.telegram_user_id,
    displayName: storedUser.display_name,
    tenantId: membership.tenant_id,
    tenantName: membership.tenant_name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    role: membership.role,
  };
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(normalized);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sessionSignature(sessionId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret) as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sessionId) as unknown as BufferSource));
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function issuePlatformSession(
  db: D1Like,
  identity: ProvisionedIdentity,
  secret: string,
  ttlSeconds = 86_400,
  now = new Date(),
): Promise<{ token: string; sessionId: string; expiresAt: string }> {
  if (!secret.trim()) throw new Error("SESSION_SECRET_NOT_CONFIGURED");
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  await db.prepare("INSERT INTO user_sessions (id, user_id, tenant_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(sessionId, identity.userId, identity.tenantId, expiresAt, now.toISOString()).run();
  return { token: `${toBase64Url(sessionId)}.${await sessionSignature(sessionId, secret)}`, sessionId, expiresAt };
}

export async function readPlatformSession(db: D1Like, token: string | undefined, secret: string, now = new Date()): Promise<IdentityContext | null> {
  if (!token || !secret.trim()) return null;
  const [encodedId, signature] = token.split(".");
  const sessionId = encodedId ? fromBase64Url(encodedId) : null;
  if (!sessionId || !signature || !safeEqual(await sessionSignature(sessionId, secret), signature)) return null;
  const row = await db.prepare(
    `SELECT us.id AS sessionId, us.expires_at AS expiresAt, u.id AS userId, u.telegram_user_id AS telegramUserId,
            tm.tenant_id AS tenantId, tm.role, wm.workspace_id AS workspaceId
     FROM user_sessions us
     JOIN users u ON u.id = us.user_id AND u.is_active = 1
     JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = us.tenant_id AND tm.status = 'active'
     LEFT JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = (
       SELECT id FROM workspaces WHERE tenant_id = us.tenant_id AND status = 'active' ORDER BY created_at LIMIT 1
     )
     WHERE us.id = ? AND us.revoked_at IS NULL AND us.expires_at > ?`,
  ).bind(sessionId, now.toISOString()).first<IdentityContext>();
  return row && isRole(row.role) && row.workspaceId ? row : null;
}

export async function revokePlatformSession(db: D1Like, sessionId: string, now = new Date()): Promise<void> {
  await db.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now.toISOString(), sessionId).run();
}

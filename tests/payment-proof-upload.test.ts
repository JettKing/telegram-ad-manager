import { describe, expect, it } from "vitest";
import type { D1Like } from "@tg-ad-manager/telegram";
import { app } from "../apps/api/src/app";
import { issueProductionPlatformSession } from "../apps/api/src/production-identity";
import type { ProvisionedIdentity } from "../apps/api/src/identity";

const identity: ProvisionedIdentity = {
  userId: "user-1",
  telegramUserId: "123",
  displayName: "Test",
  tenantId: "tenant-1",
  tenantName: "Tenant",
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  role: "owner",
};

function createDb(activationChanges = 1) {
  const statements: string[] = [];
  const db = {
    prepare(query: string) {
      statements.push(query);
      return {
        bind() {
          return {
            async first<T>() {
              if (query.includes("SELECT us.id AS sessionId")) return {
                sessionId: "session-1", expiresAt: "2027-01-01T00:00:00.000Z", userId: identity.userId,
                telegramUserId: identity.telegramUserId, tenantId: identity.tenantId, workspaceId: identity.workspaceId, role: identity.role,
              } as T;
              return null;
            },
            async run() {
              if (query.includes("UPDATE payment_proof_uploads SET status = 'ready'")) return { meta: { changes: activationChanges } };
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Like;
  return { db, statements };
}

async function submitUpload(options: { activationChanges?: number; failPut?: boolean } = {}) {
  const { db, statements } = createDb(options.activationChanges);
  const token = (await issueProductionPlatformSession(db, identity, "session-secret")).token;
  const events: string[] = [];
  const bucket = {
    async put() { events.push("put"); if (options.failPut) throw new Error("simulated R2 put failure"); },
    async get() { return null; },
    async delete() { events.push("delete"); },
  };
  const form = new FormData();
  form.append("file", new Blob(["proof"], { type: "image/png" }), "proof.png");
  const response = await app.request("/api/v1/payments/proofs/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  }, {
    DB: db, D1_SCHEMA_CONTRACT: "production-0009", SESSION_SECRET: "session-secret", R2_BUCKET: bucket,
  } as never);
  return { response, events, statements };
}

describe("payment proof upload compensation", () => {
  it("activates the D1 metadata only after uploading the R2 object", async () => {
    const { response, events, statements } = await submitUpload();
    expect(response.status).toBe(201);
    expect(events).toEqual(["put"]);
    expect(statements.some((query) => query.includes("VALUES (?, ?, ?, ?, ?, ?, ?, 'deleted', ?, ?)"))).toBe(true);
    expect(statements.some((query) => query.includes("UPDATE payment_proof_uploads SET status = 'ready'"))).toBe(true);
  });

  it("deletes the uploaded R2 object if D1 cannot activate its metadata", async () => {
    const { response, events } = await submitUpload({ activationChanges: 0 });
    expect(response.status).toBe(503);
    expect(events).toEqual(["put", "delete"]);
  });

  it("attempts R2 cleanup when the upload itself fails after the tombstone is created", async () => {
    const { response, events } = await submitUpload({ failPut: true });
    expect(response.status).toBe(503);
    expect(events).toEqual(["put", "delete"]);
  });
});

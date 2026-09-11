import request from "supertest";
import { Wallet } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearChallengesForTests } from "../auth/challenges.js";
import { buildSessionCookie, clearSessionsForTests, sessionCookieName } from "../auth/session.js";
import { env } from "../config/env.js";
import { createApp } from "../app.js";
import { AuditEventModel } from "../models/audit-event.js";

afterEach(() => {
  clearChallengesForTests();
  clearSessionsForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function getChallenge(app: ReturnType<typeof createApp>) {
  const response = await request(app).get("/api/auth/challenge").expect(200);
  return response.body as { message: string; nonce: string; expiresAt: string };
}

function verificationPayload(challenge: { message: string; nonce: string }, signature: string) {
  return {
    message: challenge.message,
    nonce: challenge.nonce,
    signature
  };
}

describe("wallet authentication", () => {
  it("logs in with a valid wallet signature", async () => {
    const app = createApp();
    const wallet = Wallet.createRandom();
    const challenge = await getChallenge(app);
    const signature = await wallet.signMessage(challenge.message);
    const auditCreateSpy = vi.spyOn(AuditEventModel, "create").mockResolvedValue({} as never);

    const response = await request(app)
      .post("/api/auth/verify")
      .send({
        message: challenge.message,
        nonce: challenge.nonce,
        signature
      })
      .expect(200);

    expect(response.body).toEqual({
      authenticated: true,
      walletAddress: wallet.address.toLowerCase()
    });
    expect(response.headers["set-cookie"][0]).toContain(`${sessionCookieName}=`);
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(auditCreateSpy).toHaveBeenCalledWith({
      walletAddress: wallet.address.toLowerCase(),
      assetId: null,
      action: "WALLET_AUTHENTICATED",
      detail: "Wallet authenticated",
      blockchainTxHash: null,
      timestamp: expect.any(Date)
    });

    const me = await request(app).get("/api/auth/me").set("Cookie", response.headers["set-cookie"]).expect(200);
    expect(me.body).toEqual({
      authenticated: true,
      walletAddress: wallet.address.toLowerCase()
    });
  });

  it("uses cross-site secure cookies for HTTPS frontend origins", () => {
    const originalCorsOrigin = env.CORS_ORIGIN;
    env.CORS_ORIGIN = "https://blockchain-project-sih-1.onrender.com";

    try {
      const cookie = buildSessionCookie("session-id");

      expect(cookie).toContain("SameSite=None");
      expect(cookie).toContain("Secure");
    } finally {
      env.CORS_ORIGIN = originalCorsOrigin;
    }
  });

  it("rejects a wrong signature", async () => {
    const app = createApp();
    const challenge = await getChallenge(app);

    const response = await request(app)
      .post("/api/auth/verify")
      .send({
        message: challenge.message,
        nonce: challenge.nonce,
        signature: "not-a-valid-signature"
      })
      .expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_INVALID_SIGNATURE",
      message: "Invalid wallet signature"
    });
  });

  it("rejects a reused nonce", async () => {
    const app = createApp();
    const wallet = Wallet.createRandom();
    const challenge = await getChallenge(app);
    const signature = await wallet.signMessage(challenge.message);
    vi.spyOn(AuditEventModel, "create").mockResolvedValue({} as never);

    await request(app).post("/api/auth/verify").send(verificationPayload(challenge, signature)).expect(200);

    const response = await request(app).post("/api/auth/verify").send(verificationPayload(challenge, signature)).expect(401);
    expect(response.body.error).toEqual({
      code: "AUTH_INVALID_CHALLENGE",
      message: "Invalid or expired authentication challenge"
    });
  });

  it("rejects an expired nonce", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00.000Z"));

    const app = createApp();
    const wallet = Wallet.createRandom();
    const challenge = await getChallenge(app);
    const signature = await wallet.signMessage(challenge.message);
    vi.spyOn(AuditEventModel, "create").mockResolvedValue({} as never);

    vi.setSystemTime(new Date("2026-09-07T00:06:00.000Z"));

    const response = await request(app).post("/api/auth/verify").send(verificationPayload(challenge, signature)).expect(401);
    expect(response.body.error.code).toBe("AUTH_INVALID_CHALLENGE");
  });

  it("logs out", async () => {
    const app = createApp();
    const wallet = Wallet.createRandom();
    const challenge = await getChallenge(app);
    const signature = await wallet.signMessage(challenge.message);
    vi.spyOn(AuditEventModel, "create").mockResolvedValue({} as never);
    const login = await request(app).post("/api/auth/verify").send(verificationPayload(challenge, signature)).expect(200);

    const logout = await request(app).post("/api/auth/logout").set("Cookie", login.headers["set-cookie"]).expect(200);

    expect(logout.body).toEqual({ authenticated: false });
    expect(logout.headers["set-cookie"][0]).toContain(`${sessionCookieName}=`);
    expect(logout.headers["set-cookie"][0]).toContain("Max-Age=0");

    await request(app).get("/api/auth/me").set("Cookie", login.headers["set-cookie"]).expect(401);
  });

  it("rejects unauthenticated users", async () => {
    const app = createApp();

    const response = await request(app).get("/api/auth/me").expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
  });
});

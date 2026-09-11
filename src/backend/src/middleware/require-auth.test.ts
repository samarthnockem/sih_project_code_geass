import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildSessionCookie, createSession } from "../auth/session.js";
import { attachSession } from "../auth/session.js";
import { requireAuth } from "./require-auth.js";

function createProtectedTestApp() {
  const app = express();

  app.use(express.json());
  app.use(attachSession);
  app.post("/temporary-protected", requireAuth, (req, res) => {
    res.json({
      walletAddress: req.auth?.walletAddress,
      suppliedWalletAddress: req.body.walletAddress
    });
  });

  return app;
}

describe("requireAuth middleware", () => {
  it("returns 401 without an authenticated session", async () => {
    const response = await request(createProtectedTestApp()).post("/temporary-protected").expect(401);

    expect(response.body).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required"
      }
    });
  });

  it("attaches wallet address from session context", async () => {
    const walletAddress = "0x1111111111111111111111111111111111111111";
    const sessionId = createSession(walletAddress);

    const response = await request(createProtectedTestApp())
      .post("/temporary-protected")
      .set("Cookie", buildSessionCookie(sessionId))
      .send({})
      .expect(200);

    expect(response.body.walletAddress).toBe(walletAddress);
  });

  it("does not trust frontend-supplied wallet address as identity", async () => {
    const sessionWallet = "0x1111111111111111111111111111111111111111";
    const attackerSuppliedWallet = "0x2222222222222222222222222222222222222222";
    const sessionId = createSession(sessionWallet);

    const response = await request(createProtectedTestApp())
      .post("/temporary-protected")
      .set("Cookie", buildSessionCookie(sessionId))
      .send({
        walletAddress: attackerSuppliedWallet
      })
      .expect(200);

    expect(response.body.walletAddress).toBe(sessionWallet);
    expect(response.body.suppliedWalletAddress).toBe(attackerSuppliedWallet);
  });
});
